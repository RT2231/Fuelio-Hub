import { Hono } from 'hono'
import { authMiddleware, generateId } from '../middleware/auth'
import type { AppContext } from '../types'

export const tokenRoutes = new Hono<AppContext>()
tokenRoutes.use('*', authMiddleware)

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

// GET /api/v1/tokens/vehicle/:vehicleId
tokenRoutes.get('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!member || member.role !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみ閲覧できます' } }, 403)
  }

  const tokens = await c.env.DB.prepare(
    'SELECT id, name, visibility, rate_limit, last_used_at, created_at FROM api_tokens WHERE vehicle_id = ? ORDER BY created_at DESC'
  ).bind(vehicleId).all()

  return c.json({ success: true, data: tokens.results })
})

// POST /api/v1/tokens/vehicle/:vehicleId
tokenRoutes.post('/vehicle/:vehicleId', async (c) => {
  const userId = c.get('userId')
  const vehicleId = c.req.param('vehicleId')

  const member = await c.env.DB.prepare(
    'SELECT role FROM vehicle_members WHERE vehicle_id = ? AND user_id = ?'
  ).bind(vehicleId, userId).first<{ role: string }>()

  if (!member || member.role !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'オーナーのみトークンを作成できます' } }, 403)
  }

  const { name, visibility = 'private' } = await c.req.json()
  if (!name) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '名前は必須です' } }, 400)
  }

  const rawToken = `fh_${crypto.randomUUID().replace(/-/g, '')}`
  const tokenHash = await hashToken(rawToken)
  const id = generateId()

  await c.env.DB.prepare(
    'INSERT INTO api_tokens (id, vehicle_id, name, token_hash, visibility) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, vehicleId, name, tokenHash, visibility).run()

  return c.json({ success: true, data: { id, name, token: rawToken, visibility, created_at: new Date().toISOString() } }, 201)
})

// DELETE /api/v1/tokens/:id
tokenRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const tokenId = c.req.param('id')

  const token = await c.env.DB.prepare(`
    SELECT at.* FROM api_tokens at
    JOIN vehicle_members vm ON at.vehicle_id = vm.vehicle_id
    WHERE at.id = ? AND vm.user_id = ? AND vm.role = 'owner'
  `).bind(tokenId, userId).first()

  if (!token) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'トークンが見つかりません' } }, 404)
  }

  await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ?').bind(tokenId).run()
  return c.json({ success: true, data: { message: 'トークンを削除しました' } })
})
