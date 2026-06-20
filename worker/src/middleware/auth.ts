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
