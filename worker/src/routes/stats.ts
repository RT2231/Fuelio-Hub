import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const statsRoutes = new Hono<AppContext>()
statsRoutes.use('*', authMiddleware)

// GET /api/v1/stats/vehicles/:vehicleId
statsRoutes.get('/vehicles/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT 1 FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first()

  if (!member) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)
  }

  // 全体統計
  const effStats = await c.env.DB.prepare(`
    SELECT
      AVG(efficiency) as average_efficiency,
      MAX(efficiency) as best_efficiency,
      MIN(efficiency) as worst_efficiency,
      COUNT(*) as total_records,
      SUM(fuel_amount) as total_fuel,
      SUM(total_cost) as total_cost
    FROM fuel_records
    WHERE vehicle_id = ? AND efficiency IS NOT NULL
  `).bind(vehicleId).first<any>()

  // 走行距離
  const odometerStats = await c.env.DB.prepare(`
    SELECT MAX(odometer) - MIN(odometer) as total_distance
    FROM fuel_records WHERE vehicle_id = ?
  `).bind(vehicleId).first<any>()

  // 月別コスト（過去12ヶ月）
  const monthlyCosts = await c.env.DB.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(total_cost) as cost,
      SUM(fuel_amount) as fuel_amount,
      COUNT(*) as fill_count
    FROM fuel_records
    WHERE vehicle_id = ? AND date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month ASC
  `).bind(vehicleId).all()

  // 今月のコスト
  const thisMonth = await c.env.DB.prepare(`
    SELECT SUM(total_cost) as cost FROM fuel_records
    WHERE vehicle_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
  `).bind(vehicleId).first<any>()

  // 今年のコスト
  const thisYear = await c.env.DB.prepare(`
    SELECT SUM(total_cost) as cost FROM fuel_records
    WHERE vehicle_id = ? AND strftime('%Y', date) = strftime('%Y', 'now')
  `).bind(vehicleId).first<any>()

  // 1kmあたりのコスト
  const totalDist = odometerStats?.total_distance || 0
  const totalCost = effStats?.total_cost || 0
  const costPerKm = totalDist > 0 ? Math.round((totalCost / totalDist) * 100) / 100 : null

  // CO2推定 (平均ガソリン: 2.3kg CO2/L)
  const co2Estimate = effStats?.total_fuel ? Math.round(effStats.total_fuel * 2.3 * 10) / 10 : null

  // 燃費トレンド（直近20記録）
  const efficiencyTrend = await c.env.DB.prepare(`
    SELECT date, odometer, efficiency, fuel_amount, total_cost
    FROM fuel_records
    WHERE vehicle_id = ? AND efficiency IS NOT NULL
    ORDER BY date DESC
    LIMIT 20
  `).bind(vehicleId).all()

  // 月別平均燃費
  const monthlyEfficiency = await c.env.DB.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      AVG(efficiency) as avg_efficiency
    FROM fuel_records
    WHERE vehicle_id = ? AND efficiency IS NOT NULL AND date >= date('now', '-12 months')
    GROUP BY month
    ORDER BY month ASC
  `).bind(vehicleId).all()

  // メンテナンスコスト合計
  const maintenanceCost = await c.env.DB.prepare(`
    SELECT SUM(cost) as total FROM maintenance_records WHERE vehicle_id = ?
  `).bind(vehicleId).first<any>()

  return c.json({
    success: true,
    data: {
      averageEfficiency: effStats?.average_efficiency ? Math.round(effStats.average_efficiency * 100) / 100 : null,
      bestEfficiency: effStats?.best_efficiency || null,
      worstEfficiency: effStats?.worst_efficiency || null,
      totalRecords: effStats?.total_records || 0,
      totalFuel: effStats?.total_fuel ? Math.round(effStats.total_fuel * 10) / 10 : null,
      totalCost: totalCost || null,
      totalDistance: totalDist || null,
      monthlyCost: thisMonth?.cost || null,
      yearlyCost: thisYear?.cost || null,
      costPerKm,
      co2Estimate,
      maintenanceCost: maintenanceCost?.total || null,
      monthlyCosts: monthlyCosts.results,
      efficiencyTrend: efficiencyTrend.results.reverse(),
      monthlyEfficiency: monthlyEfficiency.results,
    }
  })
})
