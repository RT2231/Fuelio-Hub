// ===== Maintenance Page =====
let maintRecords = []

async function renderMaintenancePage() {
  const container = document.getElementById('page-maintenance')
  if (!appState.currentVehicle) {
    container.innerHTML = `<div class="page-header"><div class="page-title">メンテナンス</div></div><div class="page-body">${noVehicleHTML()}</div>`
    return
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">🔧 メンテナンス記録</div>
        <div class="page-subtitle">${esc(appState.currentVehicle.name)}</div>
      </div>
      <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="openMaintModal()">＋ 記録を追加</button>
    </div>
    <div class="page-body">
      <div id="maint-stats" class="stats-grid" style="margin-bottom:16px"></div>
      <div class="card" style="padding:0">
        <div id="maint-table-wrap"><div class="page-loading"><div class="spinner"></div></div></div>
      </div>
    </div>
  `

  await loadMaintRecords()
}

async function loadMaintRecords() {
  const v = appState.currentVehicle
  if (!v) return
  try {
    const res = await api.get(`/maintenance/vehicle/${v.id}`)
    maintRecords = res.data || []

    // Stats
    const totalCost = maintRecords.reduce((s, r) => s + (r.cost || 0), 0)
    const statsEl = document.getElementById('maint-stats')
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-label">記録件数</div><div class="stat-value">${maintRecords.length}<span style="font-size:14px;color:var(--text-2)"> 件</span></div></div>
        <div class="stat-card"><div class="stat-label">累計整備費用</div><div class="stat-value warn">${fmtCost(totalCost)}</div></div>
      `
    }

    renderMaintTable()
  } catch (e) {
    toast('メンテナンス記録の読み込みに失敗しました', 'error')
  }
}

function renderMaintTable() {
  const wrap = document.getElementById('maint-table-wrap')
  if (!wrap) return

  if (maintRecords.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🔧</div><p>メンテナンス記録がありません</p><button class="btn-primary" style="width:auto;padding:8px 20px" onclick="openMaintModal()">最初の記録を追加</button></div>`
    return
  }

  // カテゴリ別グループ
  const grouped = {}
  maintRecords.forEach(r => {
    const cat = r.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(r)
  })

  const rows = maintRecords.map(r => {
    const cat = MAINT_CATEGORIES[r.category] || MAINT_CATEGORIES.other
    return `
      <tr>
        <td>${fmtDate(r.maintenance_date)}</td>
        <td>
          <span class="badge badge-gray">${cat.icon} ${cat.label}</span>
        </td>
        <td>${esc(r.title)}</td>
        <td class="td-num">${fmtCost(r.cost)}</td>
        <td class="td-num">${r.odometer ? fmtOdo(r.odometer) : '—'}</td>
        <td style="color:var(--text-2);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(r.description || '')}</td>
        <td>
          <div style="display:flex;gap:4px" data-obj="${dataAttr(r)}">
            <button class="btn-icon" onclick="openMaintModal(readDataAttr(this.parentElement))">✏️</button>
            <button class="btn-icon" onclick="deleteMaintRecord(readDataAttr(this.parentElement).id)">🗑️</button>
          </div>
        </td>
      </tr>
    `
  }).join('')

  wrap.innerHTML = `
    <div class="table-wrap" style="border:none;border-radius:0">
      <table>
        <thead><tr>
          <th>日付</th><th>カテゴリ</th><th>タイトル</th><th>費用</th><th>走行距離</th><th>メモ</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function openMaintModal(record = null) {
  const isEdit = !!record
  const r = record || {}
  const today = new Date().toISOString().split('T')[0]

  const catOptions = Object.entries(MAINT_CATEGORIES).map(([k, c]) =>
    `<option value="${k}" ${(r.category || 'other') === k ? 'selected' : ''}>${c.icon} ${c.label}</option>`
  ).join('')

  showModal(`
    <div class="modal-title">${isEdit ? '✏️ 整備記録を編集' : '🔧 整備記録を追加'}</div>
    <div class="field">
      <label>タイトル <span style="color:var(--red)">*</span></label>
      <input type="text" id="m-title" value="${esc(r.title || '')}" placeholder="オイル交換">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>カテゴリ</label>
        <select id="m-cat">${catOptions}</select>
      </div>
      <div class="field">
        <label>日付</label>
        <input type="date" id="m-date" value="${esc(r.maintenance_date || today)}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>費用(円)</label>
        <input type="number" id="m-cost" value="${esc(r.cost || '')}" placeholder="5000">
      </div>
      <div class="field">
        <label>走行距離(km)</label>
        <input type="number" id="m-odo" value="${esc(r.odometer || '')}" placeholder="12345">
      </div>
    </div>
    <div class="field">
      <label>メモ</label>
      <textarea id="m-desc" placeholder="作業内容の詳細">${esc(r.description || '')}</textarea>
    </div>
    <div id="maint-modal-err" class="error-msg hidden"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="saveMaintRecord('${esc(r.id || '')}')">
        ${isEdit ? '更新' : '追加'}
      </button>
    </div>
  `)
}

async function saveMaintRecord(recordId) {
  const title = document.getElementById('m-title').value.trim()
  const category = document.getElementById('m-cat').value
  const maintenance_date = document.getElementById('m-date').value
  const cost = parseFloat(document.getElementById('m-cost').value) || null
  const odometer = parseFloat(document.getElementById('m-odo').value) || null
  const description = document.getElementById('m-desc').value.trim() || null
  const errEl = document.getElementById('maint-modal-err')

  if (!title) {
    errEl.textContent = 'タイトルは必須です'
    errEl.classList.remove('hidden')
    return
  }

  try {
    const body = { title, category, maintenance_date, cost, odometer, description }
    if (recordId) {
      await api.patch(`/maintenance/${recordId}`, body)
      toast('記録を更新しました')
    } else {
      await api.post(`/maintenance/vehicle/${appState.currentVehicle.id}`, body)
      toast('記録を追加しました')
    }
    closeModal()
    await loadMaintRecords()
  } catch (e) {
    errEl.textContent = e.message
    errEl.classList.remove('hidden')
  }
}

async function deleteMaintRecord(id) {
  if (!confirm('この整備記録を削除しますか？')) return
  try {
    await api.delete(`/maintenance/${id}`)
    toast('削除しました')
    await loadMaintRecords()
  } catch (e) {
    toast(e.message, 'error')
  }
}
