import { Hono } from 'hono'
import { authMiddleware, generateId } from '../middleware/auth'
import type { AppContext } from '../types'

export const maintenanceRoutes = new Hono<AppContext>()
maintenanceRoutes.use('*', authMiddleware)

// GET /api/v1/vehicles/:vehicleId/maintenance
maintenanceRoutes.get('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT 1 FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first()

  if (!member) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)
  }

  const records = await c.env.DB.prepare(
    'SELECT * FROM maintenance_records WHERE vehicle_id = ? ORDER BY maintenance_date DESC'
  ).bind(vehicleId).all()

  return c.json({ success: true, data: records.results })
})

// POST /api/v1/vehicles/:vehicleId/maintenance
maintenanceRoutes.post('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!member || member.role === 'viewer') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '追加権限がありません' } }, 403)
  }

  const { title, description, cost, odometer, maintenance_date, category } = await c.req.json()

  if (!title) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'タイトルは必須です' } }, 400)
  }

  const id = generateId()
  await c.env.DB.prepare(
    'INSERT INTO maintenance_records (id, vehicle_id, title, description, cost, odometer, maintenance_date, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, vehicleId, title, description || null, cost || null, odometer || null, maintenance_date || null, category || 'other').run()

  const record = await c.env.DB.prepare('SELECT * FROM maintenance_records WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: record }, 201)
})

// PATCH /api/v1/maintenance/:id
maintenanceRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(`
    SELECT mr.*, vm.role FROM maintenance_records mr
    JOIN vehicle_members vm ON mr.vehicle_id = vm.vehicle_id
    WHERE mr.id = ? AND vm.user_id = ?
  `).bind(recordId, userId).first<any>()

  if (!record) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } }, 404)
  if (record.role === 'viewer') return c.json({ success: false, error: { code: 'FORBIDDEN', message: '編集権限がありません' } }, 403)

  const { title, description, cost, odometer, maintenance_date, category } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE maintenance_records SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      cost = COALESCE(?, cost),
      odometer = COALESCE(?, odometer),
      maintenance_date = COALESCE(?, maintenance_date),
      category = COALESCE(?, category)
    WHERE id = ?
  `).bind(title || null, description || null, cost || null, odometer || null, maintenance_date || null, category || null, recordId).run()

  const updated = await c.env.DB.prepare('SELECT * FROM maintenance_records WHERE id = ?').bind(recordId).first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/v1/maintenance/:id
maintenanceRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(`
    SELECT mr.*, vm.role FROM maintenance_records mr
    JOIN vehicle_members vm ON mr.vehicle_id = vm.vehicle_id
    WHERE mr.id = ? AND vm.user_id = ?
  `).bind(recordId, userId).first<any>()

  if (!record) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } }, 404)
  if (record.role === 'viewer') return c.json({ success: false, error: { code: 'FORBIDDEN', message: '削除権限がありません' } }, 403)

  await c.env.DB.prepare('DELETE FROM maintenance_records WHERE id = ?').bind(recordId).run()
  return c.json({ success: true, data: { message: '記録を削除しました' } })
})
