// ===== Stats Page =====
let statsCharts = {}

async function renderStatsPage() {
  const container = document.getElementById('page-stats')
  if (!appState.currentVehicle) {
    container.innerHTML = `<div class="page-header"><div class="page-title">統計・分析</div></div><div class="page-body">${noVehicleHTML()}</div>`
    return
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">📈 統計・分析</div>
        <div class="page-subtitle">${appState.currentVehicle.name}</div>
      </div>
    </div>
    <div class="page-body">
      <div id="stats-kpi" class="stats-grid" style="margin-bottom:20px">
        <div class="page-loading"><div class="spinner"></div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px" id="stats-row1">
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">📈 燃費推移（全期間）</div></div>
          <div class="chart-canvas-wrap"><canvas id="sc-eff"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">📊 月別平均燃費</div></div>
          <div class="chart-canvas-wrap"><canvas id="sc-meff"></canvas></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px" id="stats-row2">
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">💴 月別コスト（過去12ヶ月）</div></div>
          <div class="chart-canvas-wrap"><canvas id="sc-cost"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-header"><div class="chart-title">⛽ 月別給油量</div></div>
          <div class="chart-canvas-wrap"><canvas id="sc-fuel"></canvas></div>
        </div>
      </div>

      <div class="chart-card" id="stats-summary">
        <div class="chart-title" style="margin-bottom:16px">🌿 環境・コスト サマリー</div>
        <div id="stats-eco"></div>
      </div>
    </div>
  `

  // レスポンシブ
  if (window.innerWidth <= 768) {
    document.getElementById('stats-row1').style.gridTemplateColumns = '1fr'
    document.getElementById('stats-row2').style.gridTemplateColumns = '1fr'
  }

  try {
    const res = await api.get(`/stats/vehicles/${appState.currentVehicle.id}`)
    renderStatsKPI(res.data)
    renderStatsCharts(res.data)
    renderStatsEco(res.data)
  } catch (e) {
    toast('統計データの読み込みに失敗しました', 'error')
  }
}

function renderStatsKPI(s) {
  document.getElementById('stats-kpi').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">平均燃費</div>
      <div class="stat-value accent">${fmt(s.averageEfficiency,2,'km/L')}</div>
      <div class="stat-sub">最良 ${fmt(s.bestEfficiency,2)} / 最悪 ${fmt(s.worstEfficiency,2)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">総走行距離</div>
      <div class="stat-value good">${s.totalDistance ? Math.round(s.totalDistance).toLocaleString() : '—'} km</div>
      <div class="stat-sub">給油 ${s.totalRecords || 0}回</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">今月のコスト</div>
      <div class="stat-value">${fmtCost(s.monthlyCost)}</div>
      <div class="stat-sub">今年: ${fmtCost(s.yearlyCost)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">1km あたり</div>
      <div class="stat-value">${s.costPerKm != null ? fmt(s.costPerKm,1,'円') : '—'}</div>
      <div class="stat-sub">総燃料費: ${fmtCost(s.totalCost)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">総給油量</div>
      <div class="stat-value">${fmt(s.totalFuel,1,'L')}</div>
      <div class="stat-sub">整備費: ${fmtCost(s.maintenanceCost)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">CO₂排出推定</div>
      <div class="stat-value warn">${fmt(s.co2Estimate,1,'kg')}</div>
      <div class="stat-sub">約 ${s.co2Estimate ? fmt(s.co2Estimate/1000,2,'t') : '—'}</div>
    </div>
  `
}

function renderStatsCharts(s) {
  Object.values(statsCharts).forEach(c => c?.destroy())
  statsCharts = {}

  const defaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(28,27,23,0.05)' }, ticks: { color: '#A29C89', font: { size: 10 }, maxRotation: 45 } },
      y: { grid: { color: 'rgba(28,27,23,0.05)' }, ticks: { color: '#A29C89', font: { size: 10 } } }
    }
  }

  // 燃費推移
  const effData = s.efficiencyTrend || []
  if (effData.length && document.getElementById('sc-eff')) {
    statsCharts.eff = new Chart(document.getElementById('sc-eff'), {
      type: 'line',
      data: {
        labels: effData.map(r => fmtDate(r.date)),
        datasets: [{
          data: effData.map(r => r.efficiency),
          borderColor: '#E0631E', backgroundColor: 'rgba(224,99,30,0.06)',
          fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: '#E0631E'
        }, {
          // 平均線
          data: effData.map(() => s.averageEfficiency),
          borderColor: 'rgba(28,27,23,0.18)', borderDash: [4,4],
          pointRadius: 0, fill: false
        }]
      },
      options: defaults
    })
  }

  // 月別平均燃費
  const meffData = s.monthlyEfficiency || []
  if (meffData.length && document.getElementById('sc-meff')) {
    statsCharts.meff = new Chart(document.getElementById('sc-meff'), {
      type: 'bar',
      data: {
        labels: meffData.map(r => r.month),
        datasets: [{
          data: meffData.map(r => r.avg_efficiency ? Math.round(r.avg_efficiency*100)/100 : 0),
          backgroundColor: meffData.map(r => (r.avg_efficiency || 0) >= (s.averageEfficiency || 0)
            ? 'rgba(31,122,77,0.55)' : 'rgba(224,99,30,0.35)'),
          borderWidth: 0, borderRadius: 4
        }]
      },
      options: { ...defaults, scales: { ...defaults.scales, y: { ...defaults.scales.y, title: { display:true, text:'km/L', color:'#A29C89', font:{size:10} } } } }
    })
  }

  // 月別コスト
  const costData = s.monthlyCosts || []
  if (costData.length && document.getElementById('sc-cost')) {
    statsCharts.cost = new Chart(document.getElementById('sc-cost'), {
      type: 'bar',
      data: {
        labels: costData.map(r => r.month),
        datasets: [{
          data: costData.map(r => r.cost || 0),
          backgroundColor: 'rgba(31,122,77,0.45)', borderColor: '#1F7A4D',
          borderWidth: 1, borderRadius: 4
        }]
      },
      options: defaults
    })
  }

  // 月別給油量
  if (costData.length && document.getElementById('sc-fuel')) {
    statsCharts.fuel = new Chart(document.getElementById('sc-fuel'), {
      type: 'bar',
      data: {
        labels: costData.map(r => r.month),
        datasets: [{
          data: costData.map(r => r.fuel_amount ? Math.round(r.fuel_amount*10)/10 : 0),
          backgroundColor: 'rgba(224,99,30,0.35)', borderColor: '#E0631E',
          borderWidth: 1, borderRadius: 4
        }]
      },
      options: { ...defaults, scales: { ...defaults.scales, y: { ...defaults.scales.y, title: { display:true, text:'L', color:'#A29C89', font:{size:10} } } } }
    })
  }
}

function renderStatsEco(s) {
  const eco = document.getElementById('stats-eco')
  if (!eco) return

  const co2 = s.co2Estimate || 0
  const dist = s.totalDistance || 0
  const trees = co2 > 0 ? Math.round(co2 / 12) : 0 // 木1本あたり年12kgCO2吸収の目安

  eco.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
      <div style="background:var(--bg-card2);padding:16px;border-radius:var(--radius)">
        <div style="font-size:24px;margin-bottom:4px">🌱</div>
        <div style="font-size:13px;color:var(--text-3);margin-bottom:4px">CO₂推定排出量</div>
        <div style="font-size:20px;font-weight:700;color:var(--yellow)">${fmt(co2,1,'kg')}</div>
        <div style="font-size:12px;color:var(--text-3)">相殺に必要な木: 約 ${trees}本/年</div>
      </div>
      <div style="background:var(--bg-card2);padding:16px;border-radius:var(--radius)">
        <div style="font-size:24px;margin-bottom:4px">🚗</div>
        <div style="font-size:13px;color:var(--text-3);margin-bottom:4px">総走行距離</div>
        <div style="font-size:20px;font-weight:700;color:var(--green)">${dist ? Math.round(dist).toLocaleString() : '—'} km</div>
        <div style="font-size:12px;color:var(--text-3)">地球 ${dist ? (dist/40075).toFixed(2) : '—'} 周分</div>
      </div>
      <div style="background:var(--bg-card2);padding:16px;border-radius:var(--radius)">
        <div style="font-size:24px;margin-bottom:4px">💴</div>
        <div style="font-size:13px;color:var(--text-3);margin-bottom:4px">燃料費 + 整備費</div>
        <div style="font-size:20px;font-weight:700;color:var(--text)">${fmtCost((s.totalCost||0)+(s.maintenanceCost||0))}</div>
        <div style="font-size:12px;color:var(--text-3)">1km: ${s.costPerKm ? fmt(s.costPerKm,1,'円') : '—'}</div>
      </div>
    </div>
  `
}
