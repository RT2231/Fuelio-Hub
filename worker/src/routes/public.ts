import { Hono } from 'hono'
import type { Env } from '../types'

export const publicRoutes = new Hono<{ Bindings: Env }>()

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

publicRoutes.get('/vehicles/:id/statistics', async (c) => {
  const vehicleId = c.req.param('id')
  const token = c.req.header('X-API-Token')
  if (!token) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'APIトークンが必要です' } }, 403)

  const tokenHash = await hashToken(token)
  const apiToken = await c.env.DB.prepare(
    "SELECT id FROM api_tokens WHERE vehicle_id = ? AND token_hash = ? AND visibility IN ('public','open')"
  ).bind(vehicleId, tokenHash).first<{ id: string }>()

  if (!apiToken) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)

  await c.env.DB.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").bind(apiToken.id).run()

  const stats = await c.env.DB.prepare(`
    SELECT AVG(efficiency) as average_efficiency, MAX(efficiency) as best_efficiency, MIN(efficiency) as worst_efficiency
    FROM fuel_records WHERE vehicle_id = ? AND efficiency IS NOT NULL
  `).bind(vehicleId).first<any>()

  return c.json({
    success: true,
    data: {
      averageEfficiency: stats?.average_efficiency ? Math.round(stats.average_efficiency * 100) / 100 : null,
      bestEfficiency: stats?.best_efficiency || null,
      worstEfficiency: stats?.worst_efficiency || null,
    }
  })
})

publicRoutes.get('/vehicles/:id/fuel-records', async (c) => {
  const vehicleId = c.req.param('id')
  const token = c.req.header('X-API-Token')
  if (!token) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'APIトークンが必要です' } }, 403)

  const tokenHash = await hashToken(token)
  const apiToken = await c.env.DB.prepare(
    "SELECT id FROM api_tokens WHERE vehicle_id = ? AND token_hash = ? AND visibility IN ('public','open')"
  ).bind(vehicleId, tokenHash).first<{ id: string }>()

  if (!apiToken) return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'アクセス権限がありません' } }, 403)

  const records = await c.env.DB.prepare(
    'SELECT date, odometer, fuel_amount, fuel_price, total_cost, efficiency FROM fuel_records WHERE vehicle_id = ? ORDER BY date DESC LIMIT 100'
  ).bind(vehicleId).all()

  return c.json({ success: true, data: records.results })
})
