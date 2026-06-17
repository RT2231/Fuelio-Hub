import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authRoutes } from './routes/auth'
import { vehicleRoutes } from './routes/vehicles'
import { fuelRoutes } from './routes/fuel'
import { maintenanceRoutes } from './routes/maintenance'
import { statsRoutes } from './routes/stats'
import { tokenRoutes } from './routes/tokens'
import { publicRoutes } from './routes/public'
import { autodevRoutes } from './routes/autodev'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())

app.use('*', async (c, next) => {
  // 末尾スラッシュの有無で一致判定がブレないように正規化
  const origin = (c.env.FRONTEND_URL || '*').replace(/\/$/, '')
  return cors({
    origin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next)
})

app.get('/', (c) => c.json({ service: 'Fuelio Hub API', version: '1.0.0' }))
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

const api = new Hono<{ Bindings: Env }>()
api.route('/auth', authRoutes)
api.route('/vehicles', vehicleRoutes)
api.route('/fuel-records', fuelRoutes)
api.route('/maintenance', maintenanceRoutes)
api.route('/stats', statsRoutes)
api.route('/tokens', tokenRoutes)
api.route('/public', publicRoutes)
api.route('/autodev', autodevRoutes)

app.route('/api/v1', api)

app.notFound((c) => c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
})

export default app
