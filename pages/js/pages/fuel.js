// ===== Fuel Records Page =====
let fuelRecords = []
let fuelAvgEff = null
let fuelMeta = { total: 0, offset: 0, limit: 50 }

async function renderFuelPage() {
  const container = document.getElementById('page-fuel')
  if (!appState.currentVehicle) {
    container.innerHTML = `<div class="page-header"><div class="page-title">給油記録</div></div><div class="page-body">${noVehicleHTML()}</div>`
    return
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">⛽ 給油記録</div>
        <div class="page-subtitle" id="fuel-subtitle">読み込み中...</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" onclick="exportFuelCSV()">📥 CSV</button>
        <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="openFuelModal()">＋ 記録を追加</button>
      </div>
    </div>
    <div class="page-body">
      <div id="fuel-stats" class="stats-grid" style="margin-bottom:16px"></div>
      <div class="card" style="padding:0">
        <div style="padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)">
          <input type="date" id="fuel-from" style="width:140px" onchange="loadFuelRecords()">
          <span style="color:var(--text-3);font-size:13px">〜</span>
          <input type="date" id="fuel-to" style="width:140px" onchange="loadFuelRecords()">
          <button class="btn-secondary" onclick="clearFuelFilter()">リセット</button>
        </div>
        <div id="fuel-table-wrap"><div class="page-loading"><div class="spinner"></div></div></div>
        <div id="fuel-pagination" style="padding:12px 16px;display:flex;justify-content:center;gap:8px"></div>
      </div>
    </div>
  `

  await loadFuelRecords()
}

async function loadFuelRecords(offset = 0) {
  const v = appState.currentVehicle
  if (!v) return

  const from = document.getElementById('fuel-from')?.value
  const to = document.getElementById('fuel-to')?.value

  let url = `/fuel-records/vehicle/${v.id}?limit=50&offset=${offset}`
  if (from) url += `&from=${from}`
  if (to) url += `&to=${to}`

  try {
    const [fuelRes, statsRes] = await Promise.all([
      api.get(url),
      api.get(`/stats/vehicles/${v.id}`)
    ])
    fuelRecords = fuelRes.data || []
    fuelMeta = { ...fuelRes.meta, offset }
    fuelAvgEff = statsRes.data.averageEfficiency

    const s = statsRes.data
    const subtitle = document.getElementById('fuel-subtitle')
    if (subtitle) subtitle.textContent = `全 ${fuelMeta.total} 件 ／ 平均燃費 ${fmt(s.averageEfficiency,1)} km/L`

    // Stats mini
    const statsEl = document.getElementById('fuel-stats')
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-label">平均燃費</div><div class="stat-value accent">${fmt(s.averageEfficiency,1,'km/L')}</div></div>
        <div class="stat-card"><div class="stat-label">最良燃費</div><div class="stat-value good">${fmt(s.bestEfficiency,1,'km/L')}</div></div>
        <div class="stat-card"><div class="stat-label">総給油量</div><div class="stat-value">${fmt(s.totalFuel,1,'L')}</div></div>
        <div class="stat-card"><div class="stat-label">総燃料費</div><div class="stat-value">${fmtCost(s.totalCost)}</div></div>
      `
    }

    renderFuelTable()
    renderFuelPagination()
  } catch (e) {
    toast('給油記録の読み込みに失敗しました', 'error')
  }
}

function renderFuelTable() {
  const wrap = document.getElementById('fuel-table-wrap')
  if (!wrap) return

  if (fuelRecords.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⛽</div><p>給油記録がありません</p><button class="btn-primary" style="width:auto;padding:8px 20px" onclick="openFuelModal()">最初の給油を記録</button></div>`
    return
  }

  const rows = fuelRecords.map(r => {
    const rating = getEfficiencyRating(r.efficiency, fuelAvgEff)
    return `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td class="td-num">${fmtOdo(r.odometer)}</td>
        <td class="td-num">${fmt(r.fuel_amount,1,'L')}</td>
        <td class="td-num">${r.fuel_price ? fmt(r.fuel_price,0,'円/L') : '—'}</td>
        <td class="td-num">${fmtCost(r.total_cost)}</td>
        <td class="td-num">
          ${r.efficiency != null
            ? `<span style="color:${rating.color || 'var(--text)'};font-variant-numeric:tabular-nums">${fmt(r.efficiency,2)}</span>`
            : '<span style="color:var(--text-3)">—</span>'}
        </td>
        <td>${r.is_full_tank ? '<span class="badge badge-blue">満タン</span>' : '<span class="badge badge-gray">部分</span>'}</td>
        <td style="color:var(--text-3);font-size:12px">${r.station_name || ''}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn-icon" title="編集" onclick="openFuelModal(${JSON.stringify(r).replace(/"/g,"'")})">✏️</button>
            <button class="btn-icon" title="削除" onclick="deleteFuelRecord('${r.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `
  }).join('')

  wrap.innerHTML = `
    <div class="table-wrap" style="border:none;border-radius:0">
      <table>
        <thead><tr>
          <th>日付</th><th>オドメーター</th><th>給油量</th><th>単価</th><th>費用</th><th>燃費(km/L)</th><th>種別</th><th>スタンド</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function renderFuelPagination() {
  const el = document.getElementById('fuel-pagination')
  if (!el) return
  const { total, offset, limit } = fuelMeta
  const totalPages = Math.ceil(total / limit)
  const current = Math.floor(offset / limit)
  if (totalPages <= 1) { el.innerHTML = ''; return }

  let html = ''
  if (current > 0) html += `<button class="btn-secondary" onclick="loadFuelRecords(${(current-1)*limit})">← 前へ</button>`
  html += `<span style="font-size:13px;color:var(--text-2);padding:0 8px">${current+1} / ${totalPages}</span>`
  if (current < totalPages - 1) html += `<button class="btn-secondary" onclick="loadFuelRecords(${(current+1)*limit})">次へ →</button>`
  el.innerHTML = html
}

function clearFuelFilter() {
  document.getElementById('fuel-from').value = ''
  document.getElementById('fuel-to').value = ''
  loadFuelRecords()
}

// ===== Fuel Modal =====
function openFuelModal(record = null) {
  const isEdit = !!record
  const r = record || {}
  const today = new Date().toISOString().split('T')[0]

  showModal(`
    <div class="modal-title">${isEdit ? '✏️ 給油記録を編集' : '⛽ 給油を記録'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>日付 <span style="color:var(--red)">*</span></label>
        <input type="date" id="fr-date" value="${r.date || today}">
      </div>
      <div class="field">
        <label>オドメーター(km) <span style="color:var(--red)">*</span></label>
        <input type="number" id="fr-odo" value="${r.odometer || ''}" placeholder="12345" step="0.1">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="field">
        <label>給油量(L)</label>
        <input type="number" id="fr-amount" value="${r.fuel_amount || ''}" placeholder="30.5" step="0.01" oninput="autoCalcCost()">
      </div>
      <div class="field">
        <label>単価(円/L)</label>
        <input type="number" id="fr-price" value="${r.fuel_price || ''}" placeholder="170" step="0.1" oninput="autoCalcCost()">
      </div>
      <div class="field">
        <label>合計金額(円)</label>
        <input type="number" id="fr-total" value="${r.total_cost || ''}" placeholder="5100">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>スタンド名</label>
        <input type="text" id="fr-station" value="${r.station_name || ''}" placeholder="エネオス 〇〇店">
      </div>
      <div class="field">
        <label>天気</label>
        <select id="fr-weather">
          <option value="" ${!r.weather?'selected':''}>— 未選択 —</option>
          <option value="晴れ" ${r.weather==='晴れ'?'selected':''}>☀️ 晴れ</option>
          <option value="曇り" ${r.weather==='曇り'?'selected':''}>☁️ 曇り</option>
          <option value="雨" ${r.weather==='雨'?'selected':''}>🌧️ 雨</option>
          <option value="雪" ${r.weather==='雪'?'selected':''}>❄️ 雪</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;font-size:13px">
        <input type="checkbox" id="fr-full" ${r.is_full_tank !== 0 ? 'checked' : ''} style="width:auto">
        満タン給油
      </label>
    </div>
    <div class="field">
      <label>メモ</label>
      <textarea id="fr-memo" placeholder="任意のメモ">${r.memo || ''}</textarea>
    </div>
    <div id="fuel-modal-err" class="error-msg hidden"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="saveFuelRecord('${r.id || ''}')">
        ${isEdit ? '更新' : '記録'}
      </button>
    </div>
  `)
}

function autoCalcCost() {
  const amount = parseFloat(document.getElementById('fr-amount')?.value)
  const price = parseFloat(document.getElementById('fr-price')?.value)
  const totalEl = document.getElementById('fr-total')
  if (amount && price && totalEl && !totalEl.value) {
    totalEl.value = Math.round(amount * price)
  }
}

async function saveFuelRecord(recordId) {
  const date = document.getElementById('fr-date').value
  const odometer = parseFloat(document.getElementById('fr-odo').value)
  const fuel_amount = parseFloat(document.getElementById('fr-amount').value) || null
  const fuel_price = parseFloat(document.getElementById('fr-price').value) || null
  const total_cost = parseFloat(document.getElementById('fr-total').value) || null
  const is_full_tank = document.getElementById('fr-full').checked
  const station_name = document.getElementById('fr-station').value.trim() || null
  const weather = document.getElementById('fr-weather').value || null
  const memo = document.getElementById('fr-memo').value.trim() || null
  const errEl = document.getElementById('fuel-modal-err')

  if (!date || isNaN(odometer)) {
    errEl.textContent = '日付とオドメーターは必須です'
    errEl.classList.remove('hidden')
    return
  }

  try {
    const body = { date, odometer, fuel_amount, fuel_price, total_cost, is_full_tank, station_name, weather, memo }
    if (recordId) {
      await api.patch(`/fuel-records/${recordId}`, body)
      toast('給油記録を更新しました')
    } else {
      await api.post(`/fuel-records/vehicle/${appState.currentVehicle.id}`, body)
      toast('給油を記録しました')
    }
    closeModal()
    await loadFuelRecords(fuelMeta.offset)
    // ダッシュボードのキャッシュをクリア
    if (appState.currentPage === 'dashboard') renderDashboard()
  } catch (e) {
    errEl.textContent = e.message
    errEl.classList.remove('hidden')
  }
}

async function deleteFuelRecord(id) {
  if (!confirm('この給油記録を削除しますか？')) return
  try {
    await api.delete(`/fuel-records/${id}`)
    toast('削除しました')
    await loadFuelRecords(fuelMeta.offset)
  } catch (e) {
    toast(e.message, 'error')
  }
}

function exportFuelCSV() {
  if (!fuelRecords.length) { toast('エクスポートするデータがありません', 'error'); return }
  const headers = ['日付','オドメーター(km)','給油量(L)','単価(円/L)','合計(円)','燃費(km/L)','満タン','スタンド','天気','メモ']
  const rows = fuelRecords.map(r => [
    r.date, r.odometer, r.fuel_amount ?? '', r.fuel_price ?? '', r.total_cost ?? '',
    r.efficiency ?? '', r.is_full_tank ? '満タン' : '部分', r.station_name ?? '', r.weather ?? '', r.memo ?? ''
  ])
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${appState.currentVehicle.name}_給油記録_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
