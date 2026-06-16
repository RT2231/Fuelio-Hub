import { Hono } from 'hono'
import { authMiddleware, generateId } from '../middleware/auth'
import type { AppContext } from '../types'

export const fuelRoutes = new Hono<AppContext>()
fuelRoutes.use('*', authMiddleware)

// 燃費計算ヘルパー
async function recalcEfficiency(db: D1Database, vehicleId: string, recordId: string): Promise<number | null> {
  // 現在レコードの前後の満タン記録を取得して燃費を計算
  const current = await db.prepare('SELECT * FROM fuel_records WHERE id = ?').bind(recordId).first<any>()
  if (!current || !current.is_full_tank) return null

  const prev = await db.prepare(`
    SELECT * FROM fuel_records
    WHERE vehicle_id = ? AND date < ? AND is_full_tank = 1 AND id != ?
    ORDER BY date DESC, odometer DESC
    LIMIT 1
  `).bind(vehicleId, current.date, recordId).first<any>()

  if (!prev || !current.fuel_amount) return null

  // 区間内の全給油量を合計
  const intermediateRecords = await db.prepare(`
    SELECT SUM(fuel_amount) as total_fuel
    FROM fuel_records
    WHERE vehicle_id = ? AND date > ? AND date <= ? AND id != ?
  `).bind(vehicleId, prev.date, current.date, recordId).first<any>()

  const totalFuel = (intermediateRecords?.total_fuel || 0) + current.fuel_amount
  const distance = current.odometer - prev.odometer

  if (distance <= 0 || totalFuel <= 0) return null
  return Math.round((distance / totalFuel) * 100) / 100
}

// GET /api/v1/vehicles/:vehicleId/fuel-records
fuelRoutes.get('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')
  const { limit = '50', offset = '0', from, to } = c.req.query()

  const member = await c.env.DB.prepare(
    'SELECT 1 FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first()

  if (!member) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)
  }

  let query = 'SELECT * FROM fuel_records WHERE vehicle_id = ?'
  const params: any[] = [vehicleId]

  if (from) { query += ' AND date >= ?'; params.push(from) }
  if (to) { query += ' AND date <= ?'; params.push(to) }

  query += ' ORDER BY date DESC, odometer DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const records = await c.env.DB.prepare(query).bind(...params).all()
  const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM fuel_records WHERE vehicle_id = ?').bind(vehicleId).first<{ count: number }>()

  return c.json({ success: true, data: records.results, meta: { total: total?.count || 0, limit: parseInt(limit), offset: parseInt(offset) } })
})

// POST /api/v1/vehicles/:vehicleId/fuel-records
fuelRoutes.post('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!member || member.role === 'viewer') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '記録の追加権限がありません' } }, 403)
  }

  const body = await c.req.json()
  const { date, odometer, fuel_amount, fuel_price, total_cost, is_full_tank = true, memo, weather, latitude, longitude, station_name } = body

  if (!date || odometer === undefined) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '日付とオドメーターは必須です' } }, 400)
  }

  const id = generateId()

  // total_costを自動計算
  let calculatedTotalCost = total_cost
  if (!calculatedTotalCost && fuel_amount && fuel_price) {
    calculatedTotalCost = Math.round(fuel_amount * fuel_price * 100) / 100
  }

  await c.env.DB.prepare(`
    INSERT INTO fuel_records (id, vehicle_id, date, odometer, fuel_amount, fuel_price, total_cost, is_full_tank, memo, weather, latitude, longitude, station_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, vehicleId, date, odometer, fuel_amount || null, fuel_price || null, calculatedTotalCost || null, is_full_tank ? 1 : 0, memo || null, weather || null, latitude || null, longitude || null, station_name || null, userId).run()

  // 燃費を計算して更新
  const efficiency = await recalcEfficiency(c.env.DB, vehicleId, id)
  if (efficiency !== null) {
    await c.env.DB.prepare('UPDATE fuel_records SET efficiency = ? WHERE id = ?').bind(efficiency, id).run()
  }

  const record = await c.env.DB.prepare('SELECT * FROM fuel_records WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: record }, 201)
})

// GET /api/v1/fuel-records/:id
fuelRoutes.get('/:id', async (c) => {
  const userId = c.get('userId')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(`
    SELECT fr.* FROM fuel_records fr
    JOIN vehicle_members vm ON fr.vehicle_id = vm.vehicle_id
    WHERE fr.id = ? AND vm.user_id = ?
  `).bind(recordId, userId).first()

  if (!record) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } }, 404)
  }

  return c.json({ success: true, data: record })
})

// PATCH /api/v1/fuel-records/:id
fuelRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(`
    SELECT fr.*, vm.role FROM fuel_records fr
    JOIN vehicle_members vm ON fr.vehicle_id = vm.vehicle_id
    WHERE fr.id = ? AND vm.user_id = ?
  `).bind(recordId, userId).first<any>()

  if (!record) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } }, 404)
  }
  if (record.role === 'viewer') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '編集権限がありません' } }, 403)
  }

  const body = await c.req.json()
  const { date, odometer, fuel_amount, fuel_price, total_cost, is_full_tank, memo, weather, latitude, longitude, station_name } = body

  let calculatedTotalCost = total_cost
  if (!calculatedTotalCost && (fuel_amount || record.fuel_amount) && (fuel_price || record.fuel_price)) {
    const amt = fuel_amount || record.fuel_amount
    const prc = fuel_price || record.fuel_price
    calculatedTotalCost = Math.round(amt * prc * 100) / 100
  }

  await c.env.DB.prepare(`
    UPDATE fuel_records SET
      date = COALESCE(?, date),
      odometer = COALESCE(?, odometer),
      fuel_amount = COALESCE(?, fuel_amount),
      fuel_price = COALESCE(?, fuel_price),
      total_cost = COALESCE(?, total_cost),
      is_full_tank = COALESCE(?, is_full_tank),
      memo = COALESCE(?, memo),
      weather = COALESCE(?, weather),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      station_name = COALESCE(?, station_name)
    WHERE id = ?
  `).bind(date || null, odometer || null, fuel_amount || null, fuel_price || null, calculatedTotalCost || null, is_full_tank !== undefined ? (is_full_tank ? 1 : 0) : null, memo || null, weather || null, latitude || null, longitude || null, station_name || null, recordId).run()

  // 燃費再計算
  const efficiency = await recalcEfficiency(c.env.DB, record.vehicle_id, recordId)
  if (efficiency !== null) {
    await c.env.DB.prepare('UPDATE fuel_records SET efficiency = ? WHERE id = ?').bind(efficiency, recordId).run()
  }

  const updated = await c.env.DB.prepare('SELECT * FROM fuel_records WHERE id = ?').bind(recordId).first()
  return c.json({ success: true, data: updated })
})

// DELETE /api/v1/fuel-records/:id
fuelRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(`
    SELECT fr.*, vm.role FROM fuel_records fr
    JOIN vehicle_members vm ON fr.vehicle_id = vm.vehicle_id
    WHERE fr.id = ? AND vm.user_id = ?
  `).bind(recordId, userId).first<any>()

  if (!record) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '記録が見つかりません' } }, 404)
  }
  if (record.role === 'viewer') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: '削除権限がありません' } }, 403)
  }

  await c.env.DB.prepare('DELETE FROM fuel_records WHERE id = ?').bind(recordId).run()
  return c.json({ success: true, data: { message: '記録を削除しました' } })
})
