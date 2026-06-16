// ===== Dashboard Page =====
let dashCharts = {}

async function renderDashboard() {
  const container = document.getElementById('page-dashboard')

  if (!appState.currentVehicle) {
    container.innerHTML = `
      <div class="page-header"><div><div class="page-title">ダッシュボード</div></div></div>
      <div class="page-body">${noVehicleHTML('ダッシュボードを表示')}</div>
    `
    return
  }

  const v = appState.currentVehicle
  const typeInfo = VEHICLE_TYPES[v.vehicle_type] || VEHICLE_TYPES.other
  const fuelInfo = FUEL_TYPES[v.fuel_type] || FUEL_TYPES.other

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${typeInfo.icon} ${v.name}</div>
        <div class="page-subtitle">${v.manufacturer || ''} ${v.model || ''} ${v.year ? '・' + v.year + '年' : ''} ／ ${fuelInfo.icon} ${fuelInfo.label}</div>
      </div>
      <button class="btn-primary" style="width:auto;padding:10px 20px" onclick="openFuelModal()">⛽ 給油を記録</button>
    </div>
    <div class="page-body">
      <div id="dash-stats-grid" class="stats-grid">
        <div class="stat-card"><div class="stat-label">読み込み中</div><div class="stat-value" style="font-size:18px"><div class="spinner"></div></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px" id="dash-charts-row">
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">📈 燃費推移</div></div>
          <div class="chart-canvas-wrap"><canvas id="eff-chart"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">💴 月別コスト</div></div>
          <div class="chart-canvas-wrap"><canvas id="cost-chart"></canvas></div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title">⛽ 最近の給油記録</div>
          <button class="btn-secondary" onclick="navigate('fuel')">すべて見る →</button>
        </div>
        <div id="dash-recent-fuel"><div class="page-loading"><div class="spinner"></div></div></div>
      </div>
    </div>
  `

  // レスポンシブ対応
  if (window.innerWidth <= 768) {
    document.getElementById('dash-charts-row').style.gridTemplateColumns = '1fr'
  }

  // データ取得
  try {
    const [statsRes, fuelRes] = await Promise.all([
      api.get(`/stats/vehicles/${v.id}`),
      api.get(`/fuel-records/vehicle/${v.id}?limit=5`),
    ])
    renderDashStats(statsRes.data)
    renderDashCharts(statsRes.data)
    renderDashRecentFuel(fuelRes.data, statsRes.data.averageEfficiency)
  } catch (e) {
    toast('データの読み込みに失敗しました', 'error')
  }
}

function renderDashStats(s) {
  const eff = s.averageEfficiency
  const best = s.bestEfficiency
  const worst = s.worstEfficiency
  const gaugeW = eff && best ? Math.min(100, Math.round((eff / best) * 100)) : 0
  const gaugeClass = gaugeW >= 80 ? 'good' : gaugeW >= 50 ? '' : 'warn'

  document.getElementById('dash-stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">平均燃費</div>
      <div class="stat-value accent">${fmt(eff, 1)} <span style="font-size:14px;color:var(--text-2)">km/L</span></div>
      <div class="gauge-bar"><div class="gauge-fill ${gaugeClass}" style="width:${gaugeW}%"></div></div>
      <div class="stat-sub">最良 ${fmt(best,1)} / 最悪 ${fmt(worst,1)} km/L</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">今月のコスト</div>
      <div class="stat-value">${fmtCost(s.monthlyCost)}</div>
      <div class="stat-sub">今年: ${fmtCost(s.yearlyCost)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">1km コスト</div>
      <div class="stat-value">${s.costPerKm != null ? fmt(s.costPerKm,1,'円') : '—'}</div>
      <div class="stat-sub">総コスト: ${fmtCost(s.totalCost)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">総走行距離</div>
      <div class="stat-value good">${s.totalDistance != null ? Math.round(s.totalDistance).toLocaleString('ja-JP') : '—'} <span style="font-size:14px;color:var(--text-2)">km</span></div>
      <div class="stat-sub">給油回数: ${s.totalRecords || 0}回</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">総給油量</div>
      <div class="stat-value">${fmt(s.totalFuel, 1)} <span style="font-size:14px;color:var(--text-2)">L</span></div>
      <div class="stat-sub">CO₂推定: ${fmt(s.co2Estimate, 1)} kg</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">整備コスト</div>
      <div class="stat-value warn">${fmtCost(s.maintenanceCost)}</div>
      <div class="stat-sub">累計整備費用</div>
    </div>
  `
}

function renderDashCharts(s) {
  // Destroy existing
  Object.values(dashCharts).forEach(c => c?.destroy())
  dashCharts = {}

  const chartDefaults = {
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#4B6080', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#4B6080', font: { size: 11 } } }
    }
  }

  // 燃費推移
  const effData = s.efficiencyTrend || []
  if (effData.length > 0) {
    const ctx = document.getElementById('eff-chart')
    if (ctx) {
      dashCharts.eff = new Chart(ctx, {
        type: 'line',
        data: {
          labels: effData.map(r => fmtDate(r.date)),
          datasets: [{
            data: effData.map(r => r.efficiency),
            borderColor: '#00D4FF',
            backgroundColor: 'rgba(0,212,255,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#00D4FF',
          }]
        },
        options: { ...chartDefaults, responsive: true, maintainAspectRatio: false,
          scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, title: { display: true, text: 'km/L', color: '#4B6080', font: { size: 10 } } } }
        }
      })
    }
  }

  // 月別コスト
  const costData = s.monthlyCosts || []
  if (costData.length > 0) {
    const ctx = document.getElementById('cost-chart')
    if (ctx) {
      dashCharts.cost = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: costData.map(r => r.month),
          datasets: [{
            data: costData.map(r => r.cost || 0),
            backgroundColor: 'rgba(16,185,129,0.5)',
            borderColor: '#10B981',
            borderWidth: 1,
            borderRadius: 4,
          }]
        },
        options: { ...chartDefaults, responsive: true, maintainAspectRatio: false,
          scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, title: { display: true, text: '円', color: '#4B6080', font: { size: 10 } } } }
        }
      })
    }
  }
}

function renderDashRecentFuel(records, avgEff) {
  const container = document.getElementById('dash-recent-fuel')
  if (!container) return

  if (!records || records.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 20px"><div class="empty-icon">⛽</div><p>給油記録がまだありません</p><button class="btn-primary" style="width:auto;padding:8px 20px" onclick="openFuelModal()">最初の給油を記録</button></div>`
    return
  }

  const rows = records.map(r => {
    const rating = getEfficiencyRating(r.efficiency, avgEff)
    return `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td class="td-num">${fmtOdo(r.odometer)}</td>
        <td class="td-num">${fmt(r.fuel_amount, 1, 'L')}</td>
        <td class="td-num">${r.fuel_price ? fmt(r.fuel_price, 0, '円/L') : '—'}</td>
        <td class="td-num">${fmtCost(r.total_cost)}</td>
        <td>
          <span class="eff-indicator">
            <span class="eff-dot" style="background:${rating.color || 'var(--text-3)'}"></span>
            ${fmt(r.efficiency, 1)} km/L
          </span>
        </td>
        <td>${r.is_full_tank ? '<span class="badge badge-blue">満タン</span>' : '<span class="badge badge-gray">部分</span>'}</td>
      </tr>
    `
  }).join('')

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>日付</th><th>走行距離</th><th>給油量</th><th>単価</th><th>費用</th><th>燃費</th><th>種別</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}
