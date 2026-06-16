import { Hono } from 'hono'
import { authMiddleware, generateId } from '../middleware/auth'
import type { AppContext } from '../types'

export const vehicleRoutes = new Hono<AppContext>()
vehicleRoutes.use('*', authMiddleware)

// GET /api/v1/vehicles
vehicleRoutes.get('/', async (c) => {
  const userId = c.get('userId')

  const vehicles = await c.env.DB.prepare(`
    SELECT v.*, vm.role as user_role
    FROM vehicles v
    JOIN vehicle_members vm ON v.id = vm.vehicle_id
    WHERE vm.user_id = ?
    ORDER BY v.created_at DESC
  `).bind(userId).all()

  return c.json({ success: true, data: vehicles.results })
})

// POST /api/v1/vehicles
vehicleRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()

  const { name, manufacturer, model, year, vehicle_type, fuel_type, color, note } = body

  if (!name || !vehicle_type || !fuel_type) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '名前・車両種別・燃料種別は必須です' } }, 400)
  }

  const validVehicleTypes = ['car', 'motorcycle', 'electric', 'generator', 'other']
  const validFuelTypes = ['gasoline', 'high_octane', 'diesel', 'electric', 'other']

  if (!validVehicleTypes.includes(vehicle_type) || !validFuelTypes.includes(fuel_type)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '無効な車両種別または燃料種別です' } }, 400)
  }

  const id = generateId()

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO vehicles (id, owner_id, name, manufacturer, model, year, vehicle_type, fuel_type, color, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, userId, name, manufacturer || null, model || null, year || null, vehicle_type, fuel_type, color || null, note || null),
    c.env.DB.prepare(
      'INSERT INTO vehicle_members (vehicle_id, user_id, role) VALUES (?, ?, ?)'
    ).bind(id, userId, 'owner')
  ])

  const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: { ...vehicle, user_role: 'owner' } }, 201)
})

// GET /api/v1/vehicles/:id
vehicleRoutes.get('/:id', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')

  const vehicle = await c.env.DB.prepare(`
    SELECT v.*, vm.role as user_role
    FROM vehicles v
    JOIN vehicle_members vm ON v.id = vm.vehicle_id
    WHERE v.id = ? AND vm.user_id = ?
  `).bind(vehicleId, userId).first()

  if (!vehicle) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '車両が見つかりません' } }, 404)
  }

  return c.json({ success: true, data: vehicle })
})

// PATCH /api/v1/vehicles/:id
vehicleRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')

  const member = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!member || member.role === 'viewer') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '編集権限がありません' } }, 403)
  }

  const body = await c.req.json()
  const { name, manufacturer, model, year, vehicle_type, fuel_type, color, note } = body

  await c.env.DB.prepare(`
    UPDATE vehicles SET
      name = COALESCE(?, name),
      manufacturer = COALESCE(?, manufacturer),
      model = COALESCE(?, model),
      year = COALESCE(?, year),
      vehicle_type = COALESCE(?, vehicle_type),
      fuel_type = COALESCE(?, fuel_type),
      color = COALESCE(?, color),
      note = COALESCE(?, note),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(name || null, manufacturer || null, model || null, year || null, vehicle_type || null, fuel_type || null, color || null, note || null, vehicleId).run()

  const vehicle = await c.env.DB.prepare('SELECT * FROM vehicles WHERE id = ?').bind(vehicleId).first()
  return c.json({ success: true, data: vehicle })
})

// DELETE /api/v1/vehicles/:id
vehicleRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')

  const vehicle = await c.env.DB.prepare(
    'SELECT owner_id FROM vehicles WHERE id = ?'
  ).bind(vehicleId).first<{ owner_id: string }>()

  if (!vehicle) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '車両が見つかりません' } }, 404)
  }
  if (vehicle.owner_id !== userId) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみ削除できます' } }, 403)
  }

  await c.env.DB.prepare('DELETE FROM vehicles WHERE id = ?').bind(vehicleId).run()
  return c.json({ success: true, data: { message: '車両を削除しました' } })
})

// GET /api/v1/vehicles/:id/members
vehicleRoutes.get('/:id/members', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')

  const isMember = await c.env.DB.prepare(
    'SELECT 1 FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first()

  if (!isMember) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)
  }

  const members = await c.env.DB.prepare(`
    SELECT vm.*, u.email, u.display_name
    FROM vehicle_members vm
    JOIN users u ON vm.user_id = u.id
    WHERE vm.vehicle_id = ?
  `).bind(vehicleId).all()

  return c.json({ success: true, data: members.results })
})

// POST /api/v1/vehicles/:id/members
vehicleRoutes.post('/:id/members', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')

  const owner = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!owner || owner.role !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみメンバーを追加できます' } }, 403)
  }

  const { email, role } = await c.req.json()
  if (!email || !role) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'メールとロールは必須です' } }, 400)
  }

  const targetUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first<{ id: string }>()
  if (!targetUser) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } }, 404)
  }

  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, targetUser.id).first()

  if (existing) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'このユーザーは既にメンバーです' } }, 409)
  }

  await c.env.DB.prepare(
    'INSERT INTO vehicle_members (vehicle_id, user_id, role) VALUES (?, ?, ?)'
  ).bind(vehicleId, targetUser.id, role).run()

  return c.json({ success: true, data: { message: 'メンバーを追加しました' } }, 201)
})

// PATCH /api/v1/vehicles/:id/members/:userId
vehicleRoutes.patch('/:id/members/:targetUserId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')
  const targetUserId = c.req.param('targetUserId')

  const owner = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!owner || owner.role !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみ権限を変更できます' } }, 403)
  }

  const { role } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE vehicle_members SET role = ? WHERE vehicle_id = ? AND user_id = ?'
  ).bind(role, vehicleId, targetUserId).run()

  return c.json({ success: true, data: { message: '権限を更新しました' } })
})

// DELETE /api/v1/vehicles/:id/members/:userId
vehicleRoutes.delete('/:id/members/:targetUserId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('id')
  const targetUserId = c.req.param('targetUserId')

  const owner = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!owner || owner.role !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみメンバーを削除できます' } }, 403)
  }

  await c.env.DB.prepare(
    'DELETE FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, targetUserId).run()

  return c.json({ success: true, data: { message: 'メンバーを削除しました' } })
})
