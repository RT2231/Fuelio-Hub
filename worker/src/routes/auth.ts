import { Hono } from 'hono'
import {
  createSession, revokeSession, revokeAllSessionsForUser, hashPassword, verifyPassword,
  generateId, authMiddleware, loginRateLimitMiddleware, registerRateLimitMiddleware,
  checkRateLimit, resetRateLimit, checkPasswordStrength,
} from '../middleware/auth'
import type { AppContext, Env } from '../types'

export const authRoutes = new Hono<AppContext>()

// POST /api/v1/auth/register
authRoutes.post('/register', registerRateLimitMiddleware, async (c) => {
  const { email, password, display_name } = await c.req.json()

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'メールとパスワードは必須です' } }, 400)
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '有効なメールアドレスを入力してください' } }, 400)
  }
  if (display_name != null && typeof display_name === 'string' && display_name.length > 100) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '表示名は100文字以内で入力してください' } }, 400)
  }

  const strength = checkPasswordStrength(password)
  if (!strength.valid) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: strength.message } }, 400)
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

  const token = await createSession(c.env.DB, id, c.env.JWT_SECRET)

  return c.json({
    success: true,
    data: {
      token,
      user: { id, email: email.toLowerCase(), display_name: display_name || null }
    }
  }, 201)
})

// POST /api/v1/auth/login
authRoutes.post('/login', loginRateLimitMiddleware, async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'メールとパスワードは必須です' } }, 400)
  }

  const normalizedEmail = email.toLowerCase()

  // 特定アカウントへの集中的な総当たりを防ぐため、メールアドレス単位でも制限する
  // (IP単位の制限だけだと、分散したIPから1アカウントを狙う攻撃を防げないため)
  const emailLimitKey = `login_email:${normalizedEmail}`
  const emailLimit = await checkRateLimit(c.env.DB, emailLimitKey, 8, 15 * 60)
  if (!emailLimit.allowed) {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'このアカウントへのログイン試行が多すぎます。しばらく経ってから再度お試しください' }
    }, 429, { 'Retry-After': String(emailLimit.retryAfterSeconds) })
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = ?'
  ).bind(normalizedEmail).first<{ id: string; email: string; password_hash: string; display_name: string | null }>()

  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'メールまたはパスワードが正しくありません' } }, 401)
  }

  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'メールまたはパスワードが正しくありません' } }, 401)
  }

  // ログイン成功したので、このアカウントの失敗カウンタはリセットする
  await resetRateLimit(c.env.DB, emailLimitKey)

  const token = await createSession(c.env.DB, user.id, c.env.JWT_SECRET)

  return c.json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, display_name: user.display_name }
    }
  })
})

// POST /api/v1/auth/logout
// 現在のトークンに対応するセッションのみをD1から削除し、即座に失効させる。
authRoutes.post('/logout', authMiddleware, async (c) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader!.slice(7)
  await revokeSession(c.env.DB, token, c.env.JWT_SECRET)
  return c.json({ success: true, data: { message: 'ログアウトしました' } })
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

  if (display_name != null && typeof display_name === 'string' && display_name.length > 100) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '表示名は100文字以内で入力してください' } }, 400)
  }

  await c.env.DB.prepare(
    'UPDATE users SET display_name = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(display_name || null, userId).run()

  return c.json({ success: true, data: { display_name } })
})

// POST /api/v1/auth/change-password
authRoutes.post('/change-password', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const { current_password, new_password } = await c.req.json()

  if (!current_password || !new_password || typeof current_password !== 'string' || typeof new_password !== 'string') {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '現在のパスワードと新しいパスワードは必須です' } }, 400)
  }
  const strength = checkPasswordStrength(new_password)
  if (!strength.valid) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: strength.message } }, 400)
  }

  // セッションが盗まれた状態での現在パスワード総当たりを防ぐ
  const changePassLimitKey = `change_pass:${userId}`
  const changePassLimit = await checkRateLimit(c.env.DB, changePassLimitKey, 8, 15 * 60)
  if (!changePassLimit.allowed) {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: '試行回数が多すぎます。しばらく経ってから再度お試しください' }
    }, 429, { 'Retry-After': String(changePassLimit.retryAfterSeconds) })
  }

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(userId).first<{ password_hash: string }>()
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } }, 404)

  const isValid = await verifyPassword(current_password, user.password_hash)
  if (!isValid) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '現在のパスワードが正しくありません' } }, 401)
  }

  // 成功したのでカウンタはリセット
  await resetRateLimit(c.env.DB, changePassLimitKey)

  const newHash = await hashPassword(new_password)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run()

  // パスワード変更は「乗っ取られた可能性がある」シグナルでもあるため、
  // 他の端末も含めて全セッションを失効させ、今この操作をしているクライアントの分だけ
  // 新しいトークンを発行し直す。
  await revokeAllSessionsForUser(c.env.DB, userId)
  const newToken = await createSession(c.env.DB, userId, c.env.JWT_SECRET)

  return c.json({ success: true, data: { message: 'パスワードを変更しました', token: newToken } })
})
