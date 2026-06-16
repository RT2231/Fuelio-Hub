import { Hono } from 'hono'
import { createJWT, hashPassword, generateId, authMiddleware } from '../middleware/auth'
import type { AppContext, Env } from '../types'

export const authRoutes = new Hono<AppContext>()

// POST /api/v1/auth/register
authRoutes.post('/register', async (c) => {
  const { email, password, display_name } = await c.req.json()

  if (!email || !password) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'メールとパスワードは必須です' } }, 400)
  }
  if (password.length < 8) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'パスワードは8文字以上必要です' } }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first()
  if (existing) {
    return c.json({ success: false, error: { code: 'CONFLICT', message: 'このメールアドレスは既に使用されています' } }, 409)
  }

  const id = generateId()
  const passwordHash = await hashPassword(password)

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)'
  ).bind(id, email.toLowerCase(), passwordHash, display_name || null).run()

  const token = await createJWT({ sub: id, email: email.toLowerCase() }, c.env.JWT_SECRET)

  return c.json({
    success: true,
    data: {
      token,
      user: { id, email: email.toLowerCase(), display_name: display_name || null }
    }
  }, 201)
})

// POST /api/v1/auth/login
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'メールとパスワードは必須です' } }, 400)
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first<{ id: string; email: string; password_hash: string; display_name: string | null }>()

  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'メールまたはパスワードが正しくありません' } }, 401)
  }

  const passwordHash = await hashPassword(password)
  if (passwordHash !== user.password_hash) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'メールまたはパスワードが正しくありません' } }, 401)
  }

  const token = await createJWT({ sub: user.id, email: user.email }, c.env.JWT_SECRET)

  return c.json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, display_name: user.display_name }
    }
  })
})

// GET /api/v1/auth/me
authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare(
    'SELECT id, email, display_name, created_at FROM users WHERE id = ?'
  ).bind(userId).first()

  if (!user) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } }, 404)
  }

  return c.json({ success: true, data: user })
})

// PATCH /api/v1/auth/me
authRoutes.patch('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const { display_name } = await c.req.json()

  await c.env.DB.prepare(
    'UPDATE users SET display_name = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(display_name || null, userId).run()

  return c.json({ success: true, data: { display_name } })
})

// POST /api/v1/auth/change-password
authRoutes.post('/change-password', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const { current_password, new_password } = await c.req.json()

  if (!current_password || !new_password) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '現在のパスワードと新しいパスワードは必須です' } }, 400)
  }
  if (new_password.length < 8) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '新しいパスワードは8文字以上必要です' } }, 400)
  }

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first<{ password_hash: string }>()
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } }, 404)

  const currentHash = await hashPassword(current_password)
  if (currentHash !== user.password_hash) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '現在のパスワードが正しくありません' } }, 401)
  }

  const newHash = await hashPassword(new_password)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run()

  return c.json({ success: true, data: { message: 'パスワードを変更しました' } })
})
