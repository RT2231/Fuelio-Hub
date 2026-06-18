// Fuelio Hub - API Client
const api = {
  async request(method, path, body) {
    const token = localStorage.getItem('fh_token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(CONFIG.API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await res.json()

    if (!data.success) {
      if (res.status === 401) {
        localStorage.removeItem('fh_token')
        localStorage.removeItem('fh_user')
        window.location.href = '/login.html'
        return
      }
      throw new Error(data.error?.message || 'エラーが発生しました')
    }

    return data
  },

  get:    (path)        => api.request('GET',    path),
  post:   (path, body)  => api.request('POST',   path, body),
  patch:  (path, body)  => api.request('PATCH',  path, body),
  delete: (path)        => api.request('DELETE', path),
}
