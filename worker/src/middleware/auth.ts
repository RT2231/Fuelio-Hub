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

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'fuelio_salt_2024')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
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
