import { createMiddleware } from 'hono/factory'
import type { AppContext } from '../types'

// セッショントークンの形式: "<sessionId>.<signature>"
// sessionId自体はDBに保存しない平文ID。signatureはHMAC-SHA256でsessionIdに署名したもの。
// トークンの検証は「署名が正しいか」のみをここで確認し、実際にセッションが
// 有効かどうか(ログアウトされていないか、期限切れでないか)はD1のsessionsテーブルを見て判断する。
// これにより、ログアウト時にD1からセッション行を削除するだけでトークンを即時失効できる。

async function signSessionId(sessionId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sessionId))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const dotIndex = token.lastIndexOf('.')
  if (dotIndex === -1) return null

  const sessionId = token.slice(0, dotIndex)
  const givenSig = token.slice(dotIndex + 1)
  if (!sessionId || !givenSig) return null

  const expectedSig = await signSessionId(sessionId, secret)

  // 定数時間比較
  if (expectedSig.length !== givenSig.length) return null
  let diff = 0
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ givenSig.charCodeAt(i)
  }
  return diff === 0 ? sessionId : null
}

async function hashSessionId(sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(sessionId)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

const SESSION_DURATION_SECONDS = 86400 * 30 // 30日

// ログイン/登録成功時に呼び出す。D1にセッション行を作成し、クライアントに返すトークンを生成する。
export async function createSession(db: D1Database, userId: string, secret: string): Promise<string> {
  const sessionId = crypto.randomUUID()
  const tokenHash = await hashSessionId(sessionId)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000).toISOString()

  await db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, tokenHash, expiresAt).run()

  const signature = await signSessionId(sessionId, secret)
  return `${sessionId}.${signature}`
}

// ログアウト時に呼び出す。該当セッションをD1から削除し、以後そのトークンを無効化する。
export async function revokeSession(db: D1Database, token: string, secret: string): Promise<void> {
  const sessionId = await verifySessionToken(token, secret)
  if (!sessionId) return
  const tokenHash = await hashSessionId(sessionId)
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

// パスワード変更時など、そのユーザーの全セッションを失効させたい場合に使用
export async function revokeAllSessionsForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

// パスワードハッシュ: PBKDF2 (SHA-256, 100,000回反復) + ユーザーごとのランダムソルト
// 保存形式: "pbkdf2$<iterations>$<salt_base64>$<hash_base64>"
const PBKDF2_ITERATIONS = 100_000

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )

  const saltB64 = btoa(String.fromCharCode(...salt))
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)))

  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

    const iterations = parseInt(parts[1], 10)
    const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0))
    const expectedHashB64 = parts[3]

    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    )

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    )

    const actualHashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)))

    // タイミング攻撃を避けるため定数時間比較
    if (actualHashB64.length !== expectedHashB64.length) return false
    let diff = 0
    for (let i = 0; i < actualHashB64.length; i++) {
      diff |= actualHashB64.charCodeAt(i) ^ expectedHashB64.charCodeAt(i)
    }
    return diff === 0
  } catch {
    return false
  }
}

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: '認証が必要です' } }, 401)
  }

  const token = authHeader.slice(7)
  const sessionId = await verifySessionToken(token, c.env.JWT_SECRET)
  if (!sessionId) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'トークンが無効です' } }, 401)
  }

  const tokenHash = await hashSessionId(sessionId)
  const session = await c.env.DB.prepare(
    'SELECT s.user_id, s.expires_at, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ?'
  ).bind(tokenHash).first<{ user_id: string; expires_at: string; email: string }>()

  if (!session) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'セッションが無効です。再度ログインしてください' } }, 401)
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    // 期限切れセッションはついでに掃除しておく
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'セッションの有効期限が切れました。再度ログインしてください' } }, 401)
  }

  c.set('userId', session.user_id)
  c.set('userEmail', session.email)
  await next()
})

export function generateId(): string {
  return crypto.randomUUID()
}

// ===== レート制限 =====
// 固定ウィンドウ方式。D1の rate_limits テーブルに (key, count, window_started_at) を保持し、
// ウィンドウ期間内の試行回数が上限を超えたらブロックする。
// key の例: "login:email正規化", "login_ip:1.2.3.4", "register_ip:1.2.3.4"
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds?: number
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now()
  const row = await db.prepare(
    'SELECT count, window_started_at FROM rate_limits WHERE key = ?'
  ).bind(key).first<{ count: number; window_started_at: string }>()

  if (!row) {
    await db.prepare(
      'INSERT INTO rate_limits (key, count, window_started_at) VALUES (?, 1, ?)'
    ).bind(key, new Date(now).toISOString()).run()
    return { allowed: true, remaining: maxAttempts - 1 }
  }

  const windowStarted = new Date(row.window_started_at).getTime()
  const windowAge = (now - windowStarted) / 1000

  if (windowAge > windowSeconds) {
    // ウィンドウが過ぎているのでリセット
    await db.prepare(
      'UPDATE rate_limits SET count = 1, window_started_at = ? WHERE key = ?'
    ).bind(new Date(now).toISOString(), key).run()
    return { allowed: true, remaining: maxAttempts - 1 }
  }

  if (row.count >= maxAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil(windowSeconds - windowAge))
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run()
  return { allowed: true, remaining: maxAttempts - row.count - 1 }
}

// 成功時にカウンタをリセットする（正しいパスワードでログインできたら、
// それまでの失敗回数はクリアして良い）
export async function resetRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run()
}

function getClientIp(c: any): string {
  // CF-Connecting-IP は Cloudflare のエッジが付与する、偽装不可能な実クライアントIP。
  // X-Forwarded-For はクライアントが任意の値を送れてしまうため信頼しない。
  return c.req.header('CF-Connecting-IP') || 'unknown'
}

export const loginRateLimitMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const ip = getClientIp(c)
  const ipResult = await checkRateLimit(c.env.DB, `login_ip:${ip}`, 20, 15 * 60)
  if (!ipResult.allowed) {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: '試行回数が多すぎます。しばらく経ってから再度お試しください' }
    }, 429, { 'Retry-After': String(ipResult.retryAfterSeconds) })
  }
  await next()
})

export const registerRateLimitMiddleware = createMiddleware<AppContext>(async (c, next) => {
  const ip = getClientIp(c)
  const ipResult = await checkRateLimit(c.env.DB, `register_ip:${ip}`, 10, 60 * 60)
  if (!ipResult.allowed) {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: '登録試行回数が多すぎます。しばらく経ってから再度お試しください' }
    }, 429, { 'Retry-After': String(ipResult.retryAfterSeconds) })
  }
  await next()
})

// ===== パスワード強度チェック =====
// 長さに加えて、ありがちな弱いパスワードと、文字種の単調さを弾く。
// 完璧な強度判定ではないが、最低限の事故防止として機能する範囲。
const COMMON_WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwertyui', 'qwerty123', '11111111', '00000000', 'abc12345', 'letmein1',
  'iloveyou', 'admin123', 'welcome1', 'monkey123', 'football', 'baseball',
  'dragon123', 'master123', 'sunshine', 'princess', 'starwars', '87654321',
  'asdfghjk', 'zxcvbnm1',
])

export function checkPasswordStrength(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'パスワードは8文字以上必要です' }
  }
  if (password.length > 128) {
    return { valid: false, message: 'パスワードは128文字以内で入力してください' }
  }

  const lower = password.toLowerCase()
  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    return { valid: false, message: 'よく使われる単純なパスワードは使用できません。別のパスワードを設定してください' }
  }

  // 同じ文字の連続のみ、または昇順/降順の数字のみのような単調なパスワードを弾く
  const isAllSameChar = /^(.)\1+$/.test(password)
  if (isAllSameChar) {
    return { valid: false, message: '単純すぎるパスワードです。別のパスワードを設定してください' }
  }

  // 文字種の多様性: 数字のみ、英字のみ、のような単一文字種は弾く
  const hasLetter = /[a-zA-Z]/.test(password)
  const hasDigit = /[0-9]/.test(password)
  const hasOther = /[^a-zA-Z0-9]/.test(password)
  const varietyCount = [hasLetter, hasDigit, hasOther].filter(Boolean).length

  if (varietyCount < 2) {
    return { valid: false, message: 'パスワードは英字と数字を組み合わせてください' }
  }

  return { valid: true }
}
