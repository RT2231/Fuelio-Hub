import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import type { AppContext } from '../types'

export const autodevRoutes = new Hono<AppContext>()
autodevRoutes.use('*', authMiddleware)

const AUTODEV_BASE = 'https://auto.dev/api'

function requireApiKey(c: any): string | null {
  const key = c.env.AUTODEV_API_KEY
  if (!key || key === 'CHANGE_THIS_IN_DASHBOARD') return null
  return key
}

// インメモリキャッシュ（Worker再起動で消えるが、makes一覧の呼び出し回数削減に有効）
let makesCache: { data: any; expiresAt: number } | null = null
const MAKES_CACHE_TTL_MS = 1000 * 60 * 60 * 6 // 6時間

// GET /api/v1/autodev/makes
// メーカー/モデル一覧を取得（プルダウン用）
autodevRoutes.get('/makes', async (c) => {
  const apiKey = requireApiKey(c)
  if (!apiKey) {
    return c.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Auto.dev APIキーが設定されていません' } }, 503)
  }

  if (makesCache && makesCache.expiresAt > Date.now()) {
    return c.json({ success: true, data: makesCache.data, cached: true })
  }

  try {
    const res = await fetch(`${AUTODEV_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      const text = await res.text()
      return c.json({ success: false, error: { code: 'AUTODEV_ERROR', message: `Auto.dev API エラー (${res.status})`, detail: text } }, 502)
    }

    const data = await res.json()
    makesCache = { data, expiresAt: Date.now() + MAKES_CACHE_TTL_MS }
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_ERROR', message: 'Auto.dev APIへの接続に失敗しました' } }, 502)
  }
})

// GET /api/v1/autodev/vin/:vin
// VINをデコードして年式・メーカー・モデル・トリム等を取得
autodevRoutes.get('/vin/:vin', async (c) => {
  const apiKey = requireApiKey(c)
  if (!apiKey) {
    return c.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Auto.dev APIキーが設定されていません' } }, 503)
  }

  const vin = c.req.param('vin').trim().toUpperCase()
  if (vin.length !== 17) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'VINは17文字で入力してください' } }, 400)
  }

  try {
    const res = await fetch(`${AUTODEV_BASE}/vin/${encodeURIComponent(vin)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (res.status === 404) {
      return c.json({ success: false, error: { code: 'VIN_NOT_FOUND', message: 'このVINに対応する車両情報が見つかりませんでした' } }, 404)
    }
    if (!res.ok) {
      const text = await res.text()
      return c.json({ success: false, error: { code: 'AUTODEV_ERROR', message: `Auto.dev API エラー (${res.status})`, detail: text } }, 502)
    }

    const raw: any = await res.json()

    // フロントで使いやすい形に整形
    const latestYear = raw.years?.[raw.years.length - 1]
    const result = {
      vin,
      make: raw.make?.name || null,
      model: raw.model?.name || null,
      year: latestYear?.year || null,
      trim: latestYear?.styles?.[0]?.trim || null,
      bodyStyle: raw.categories?.vehicleStyle || null,
      vehicleType: raw.categories?.vehicleType || null,
      drivenWheels: raw.drivenWheels || null,
      engine: raw.engine ? {
        name: raw.engine.name || null,
        fuelType: raw.engine.fuelType || null,
        horsepower: raw.engine.horsepower || null,
        cylinder: raw.engine.cylinder || null,
        displacement: raw.engine.displacement || null,
      } : null,
      mpg: raw.mpg ? { city: raw.mpg.city || null, highway: raw.mpg.highway || null } : null,
      transmission: raw.transmission?.name || null,
      numOfDoors: raw.numOfDoors || null,
      baseMsrp: raw.price?.baseMsrp || null,
      _raw: raw,
    }

    return c.json({ success: true, data: result })
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_ERROR', message: 'Auto.dev APIへの接続に失敗しました' } }, 502)
  }
})
