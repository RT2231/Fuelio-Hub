import { createMiddleware } from 'hono/factory'
import type { AppContext } from '../types'

// Simple JWT implementation using Web Crypto API
async function verifyJWT(token: string, secret: string): Promise<{ sub: string; email: string } | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const data = encoder.encode(`${parts[0]}.${parts[1]}`)
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

    const valid = await crypto.subtle.verify('HMAC', key, sig, data)
    if (!valid) return null

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return { sub: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

export async function createJWT(payload: { sub: string; email: string }, secret: string, expiresInSeconds = 86400 * 30): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const body = btoa(JSON.stringify({
    sub: payload.sub,
    email: payload.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const data = encoder.encode(`${header}.${body}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  return `${header}.${body}.${sigB64}`
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
  const payload = await verifyJWT(token, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'トークンが無効または期限切れです' } }, 401)
  }

  c.set('userId', payload.sub)
  c.set('userEmail', payload.email)
  await next()
})

export function generateId(): string {
  return crypto.randomUUID()
}
