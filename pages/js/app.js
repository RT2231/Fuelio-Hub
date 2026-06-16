// ===== Fuelio Hub - App Core =====

// Auth guard
if (!localStorage.getItem('fh_token')) {
  window.location.href = '/'
}

// App State
const appState = {
  currentVehicle: null,
  vehicles: [],
  currentPage: 'dashboard',
  user: JSON.parse(localStorage.getItem('fh_user') || '{}'),
}

// ===== Init =====
async function initApp() {
  // ユーザー名表示
  if (appState.user.display_name || appState.user.email) {
    document.getElementById('sidebar-username').textContent =
      appState.user.display_name || appState.user.email.split('@')[0]
  }

  await loadVehicles()

  // 最後に選択した車両を復元
  const lastVehicleId = localStorage.getItem('fh_last_vehicle')
  if (lastVehicleId) {
    const v = appState.vehicles.find(v => v.id === lastVehicleId)
    if (v) selectVehicle(v)
  } else if (appState.vehicles.length > 0) {
    selectVehicle(appState.vehicles[0])
  }

  navigate('dashboard')
}

// ===== Vehicles =====
async function loadVehicles() {
  try {
    const res = await api.get('/vehicles')
    appState.vehicles = res.data || []
  } catch (e) {
    toast('車両の読み込みに失敗しました', 'error')
  }
}

function selectVehicle(vehicle) {
  appState.currentVehicle = vehicle
  localStorage.setItem('fh_last_vehicle', vehicle.id)

  const typeInfo = VEHICLE_TYPES[vehicle.vehicle_type] || VEHICLE_TYPES.other
  document.getElementById('vs-icon').textContent = typeInfo.icon
  document.getElementById('vs-name').textContent = vehicle.name

  // 現在ページをリフレッシュ
  renderPage(appState.currentPage)
}

function showVehiclePicker() {
  if (appState.vehicles.length === 0) {
    openVehicleModal()
    return
  }

  const items = appState.vehicles.map(v => {
    const t = VEHICLE_TYPES[v.vehicle_type] || VEHICLE_TYPES.other
    return `<button class="nav-item ${v.id === appState.currentVehicle?.id ? 'active' : ''}"
      style="width:100%;text-align:left;margin-bottom:2px"
      onclick="selectVehicle(${JSON.stringify(v).replace(/"/g,"'")});closeModal()">
      <span>${t.icon}</span> ${v.name}
      <span style="margin-left:auto;font-size:11px;color:var(--text-3)">${FUEL_TYPES[v.fuel_type]?.label || ''}</span>
    </button>`
  }).join('')

  showModal(`
    <div class="modal-title">🚗 車両を選択</div>
    ${items}
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn-secondary" style="width:100%" onclick="closeModal();openVehicleModal()">＋ 新しい車両を追加</button>
    </div>
  `)
}

// ===== Navigation =====
const PAGES = ['dashboard', 'fuel', 'maintenance', 'stats', 'vehicles', 'tokens']

function navigate(page) {
  appState.currentPage = page

  // Sidebar active
  PAGES.forEach(p => {
    const el = document.getElementById(`nav-${p}`)
    const bn = document.getElementById(`bn-${p}`)
    if (el) el.classList.toggle('active', p === page)
    if (bn) bn.classList.toggle('active', p === page)
  })

  // Page visibility
  PAGES.forEach(p => {
    document.getElementById(`page-${p}`)?.classList.toggle('hidden', p !== page)
  })

  renderPage(page)
  closeSidebar()
}

function renderPage(page) {
  switch (page) {
    case 'dashboard':   renderDashboard(); break
    case 'fuel':        renderFuelPage(); break
    case 'maintenance': renderMaintenancePage(); break
    case 'stats':       renderStatsPage(); break
    case 'vehicles':    renderVehiclesPage(); break
    case 'tokens':      renderTokensPage(); break
  }
}

// ===== Sidebar Mobile =====
function openSidebar() {
  document.getElementById('sidebar').classList.add('open')
  document.getElementById('sidebar-overlay').classList.add('open')
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open')
  document.getElementById('sidebar-overlay').classList.remove('open')
}

// ===== Modal =====
function showModal(content) {
  const container = document.getElementById('modal-container')
  container.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">${content}</div>
    </div>
  `
}
function closeModal() {
  document.getElementById('modal-container').innerHTML = ''
}

// ===== Auth =====
function logout() {
  localStorage.removeItem('fh_token')
  localStorage.removeItem('fh_user')
  localStorage.removeItem('fh_last_vehicle')
  window.location.href = '/'
}

async function showProfileModal() {
  const user = appState.user
  showModal(`
    <div class="modal-title">👤 アカウント設定</div>
    <div class="field">
      <label>表示名</label>
      <input type="text" id="profile-name" value="${user.display_name || ''}" placeholder="ニックネーム">
    </div>
    <div class="field">
      <label>メールアドレス</label>
      <input type="email" value="${user.email || ''}" disabled style="opacity:0.5">
    </div>
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
      <div class="field">
        <label>現在のパスワード</label>
        <input type="password" id="current-pass" placeholder="変更する場合のみ">
      </div>
      <div class="field">
        <label>新しいパスワード</label>
        <input type="password" id="new-pass" placeholder="8文字以上">
      </div>
    </div>
    <div id="profile-msg"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" style="width:auto;padding:10px 20px" onclick="saveProfile()">保存</button>
    </div>
  `)
}

async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim()
  const currentPass = document.getElementById('current-pass').value
  const newPass = document.getElementById('new-pass').value
  const msgEl = document.getElementById('profile-msg')

  try {
    if (name !== appState.user.display_name) {
      await api.patch('/auth/me', { display_name: name })
      appState.user.display_name = name
      localStorage.setItem('fh_user', JSON.stringify(appState.user))
      document.getElementById('sidebar-username').textContent = name || appState.user.email?.split('@')[0]
    }

    if (currentPass && newPass) {
      await api.post('/auth/change-password', { current_password: currentPass, new_password: newPass })
    }

    toast('保存しました')
    closeModal()
  } catch (e) {
    msgEl.className = 'error-msg'
    msgEl.textContent = e.message
  }
}

// ===== Vehicle Modal (quick add) =====
function openVehicleModal(vehicle = null) {
  const isEdit = !!vehicle
  const v = vehicle || {}

  const typeOptions = Object.entries(VEHICLE_TYPES).map(([k,t]) =>
    `<option value="${k}" ${v.vehicle_type === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`
  ).join('')

  const fuelOptions = Object.entries(FUEL_TYPES).map(([k,t]) =>
    `<option value="${k}" ${v.fuel_type === k ? 'selected' : ''}>${t.icon} ${t.label}</option>`
  ).join('')

  showModal(`
    <div class="modal-title">${isEdit ? '✏️ 車両を編集' : '🚗 新しい車両を追加'}</div>
    <div class="field">
      <label>車両名 <span style="color:var(--red)">*</span></label>
      <input type="text" id="v-name" value="${v.name || ''}" placeholder="例: マイカー">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field">
        <label>車種</label>
        <select id="v-type">${typeOptions}</select>
      </div>
      <div class="field">
        <label>燃料</label>
        <select id="v-fuel">${fuelOptions}</select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="field">
        <label>メーカー</label>
        <input type="text" id="v-mfr" value="${v.manufacturer || ''}" placeholder="トヨタ">
      </div>
      <div class="field">
        <label>モデル</label>
        <input type="text" id="v-model" value="${v.model || ''}" placeholder="プリウス">
      </div>
      <div class="field">
        <label>年式</label>
        <input type="number" id="v-year" value="${v.year || ''}" placeholder="2023" min="1900" max="2099">
      </div>
    </div>
    <div class="field">
      <label>メモ</label>
      <textarea id="v-note" placeholder="任意のメモ">${v.note || ''}</textarea>
    </div>
    <div id="vehicle-modal-err" class="error-msg hidden"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="saveVehicle('${v.id || ''}')">
        ${isEdit ? '更新' : '追加'}
      </button>
    </div>
  `)
}

async function saveVehicle(vehicleId) {
  const name = document.getElementById('v-name').value.trim()
  const vehicle_type = document.getElementById('v-type').value
  const fuel_type = document.getElementById('v-fuel').value
  const manufacturer = document.getElementById('v-mfr').value.trim()
  const model = document.getElementById('v-model').value.trim()
  const year = document.getElementById('v-year').value
  const note = document.getElementById('v-note').value.trim()
  const errEl = document.getElementById('vehicle-modal-err')

  if (!name) {
    errEl.textContent = '車両名は必須です'
    errEl.classList.remove('hidden')
    return
  }

  try {
    const body = { name, vehicle_type, fuel_type, manufacturer: manufacturer||null, model: model||null, year: year?parseInt(year):null, note: note||null }
    if (vehicleId) {
      await api.patch(`/vehicles/${vehicleId}`, body)
      toast('車両を更新しました')
    } else {
      const res = await api.post('/vehicles', body)
      toast('車両を追加しました')
      await loadVehicles()
      selectVehicle(res.data)
    }
    closeModal()
    await loadVehicles()
    if (appState.currentPage === 'vehicles') renderVehiclesPage()
  } catch (e) {
    errEl.textContent = e.message
    errEl.classList.remove('hidden')
  }
}

// ===== No Vehicle Helper =====
function noVehicleHTML(action = '記録を表示') {
  return `
    <div class="empty-state">
      <div class="empty-icon">🚗</div>
      <p>${action}するには車両を選択または追加してください</p>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="openVehicleModal()">＋ 車両を追加</button>
    </div>
  `
}

// ===== Start =====
initApp()
