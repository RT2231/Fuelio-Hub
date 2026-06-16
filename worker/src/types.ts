export interface Env {
  DB: D1Database
  JWT_SECRET: string
  FRONTEND_URL: string
  AI?: Ai
}

export interface User {
  id: string
  email: string
  display_name: string | null
  created_at: string
}

export interface Vehicle {
  id: string
  owner_id: string
  name: string
  manufacturer: string | null
  model: string | null
  year: number | null
  vehicle_type: 'car' | 'motorcycle' | 'electric' | 'generator' | 'other'
  fuel_type: 'gasoline' | 'high_octane' | 'diesel' | 'electric' | 'other'
  color: string | null
  note: string | null
  created_at: string
  updated_at: string
  user_role?: string
}

export interface FuelRecord {
  id: string
  vehicle_id: string
  date: string
  odometer: number
  fuel_amount: number | null
  fuel_price: number | null
  total_cost: number | null
  is_full_tank: number
  memo: string | null
  weather: string | null
  latitude: number | null
  longitude: number | null
  efficiency: number | null
  station_name: string | null
  created_by: string | null
  created_at: string
}

export interface MaintenanceRecord {
  id: string
  vehicle_id: string
  title: string
  description: string | null
  cost: number | null
  odometer: number | null
  maintenance_date: string | null
  category: string
  created_at: string
}

export interface JWTPayload {
  sub: string
  email: string
  exp: number
  iat: number
}

export type AppContext = {
  Bindings: Env
  Variables: {
    userId: string
    userEmail: string
  }
}
