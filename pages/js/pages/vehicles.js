// ===== Vehicles Page =====
async function renderVehiclesPage() {
  const container = document.getElementById('page-vehicles')
  container.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">🚙 車両管理</div></div>
      <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="openVehicleModal()">＋ 車両を追加</button>
    </div>
    <div class="page-body">
      <div id="vehicles-list"><div class="page-loading"><div class="spinner"></div></div></div>
    </div>
  `
  await loadVehicles()
  renderVehiclesList()
}

function renderVehiclesList() {
  const el = document.getElementById('vehicles-list')
  if (!el) return

  if (appState.vehicles.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🚗</div><p>車両が登録されていません</p><button class="btn-primary" style="width:auto;padding:8px 20px" onclick="openVehicleModal()">最初の車両を追加</button></div>`
    return
  }

  const cards = appState.vehicles.map(v => {
    const t = VEHICLE_TYPES[v.vehicle_type] || VEHICLE_TYPES.other
    const f = FUEL_TYPES[v.fuel_type] || FUEL_TYPES.other
    const isCurrent = appState.currentVehicle?.id === v.id
    return `
      <div class="card" style="margin-bottom:12px;${isCurrent ? 'border-color:var(--accent)' : ''}">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="font-size:36px;line-height:1">${t.icon}</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:17px;font-weight:700">${esc(v.name)}</span>
              ${isCurrent ? '<span class="badge badge-blue">選択中</span>' : ''}
              <span class="badge badge-gray">${v.user_role === 'owner' ? 'オーナー' : v.user_role === 'editor' ? '編集者' : '閲覧者'}</span>
            </div>
            <div style="font-size:13px;color:var(--text-2)">
              ${esc([v.manufacturer, v.model, v.year ? v.year+'年' : ''].filter(Boolean).join(' ・ '))}
              ${v.manufacturer || v.model ? '／' : ''} ${f.icon} ${f.label} ・ ${t.label}
            </div>
            ${v.vin ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px;font-family:monospace;letter-spacing:0.03em">VIN: ${esc(v.vin)}</div>` : ''}
            ${v.note ? `<div style="font-size:12px;color:var(--text-3);margin-top:4px">${esc(v.note)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0" data-obj="${dataAttr(v)}">
            ${!isCurrent ? `<button class="btn-secondary" onclick="selectVehicle(readDataAttr(this.parentElement));renderVehiclesList()">選択</button>` : ''}
            ${v.vin ? `<button class="btn-secondary" onclick="showVehicleSpecs(readDataAttr(this.parentElement).vin, readDataAttr(this.parentElement).name)">📋 スペック</button>` : ''}
            ${v.user_role !== 'viewer' ? `<button class="btn-secondary" onclick="openVehicleModal(readDataAttr(this.parentElement))">✏️ 編集</button>` : ''}
            ${v.user_role === 'owner' ? `<button class="btn-danger" onclick="deleteVehicle(readDataAttr(this.parentElement).id)">削除</button>` : ''}
          </div>
        </div>
        ${v.user_role === 'owner' ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:8px" data-obj="${dataAttr(v)}">
            <button class="btn-secondary" onclick="showMembersModal(readDataAttr(this.parentElement).id, readDataAttr(this.parentElement).name)">👥 メンバー管理</button>
          </div>
        ` : ''}
      </div>
    `
  }).join('')

  el.innerHTML = cards
}

async function deleteVehicle(id) {
  if (!confirm('この車両と全ての記録を削除しますか？この操作は取り消せません。')) return
  try {
    await api.delete(`/vehicles/${id}`)
    toast('車両を削除しました')
    await loadVehicles()
    if (appState.currentVehicle?.id === id) {
      appState.currentVehicle = appState.vehicles[0] || null
      if (appState.currentVehicle) selectVehicle(appState.currentVehicle)
    }
    renderVehiclesList()
  } catch (e) {
    toast(e.message, 'error')
  }
}

// メンバー管理モーダル
async function showMembersModal(vehicleId, vehicleName) {
  showModal(`
    <div class="modal-title">👥 ${esc(vehicleName)} のメンバー</div>
    <div id="members-list"><div class="page-loading"><div class="spinner"></div></div></div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:8px">メンバーを追加</div>
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px">
        <input type="email" id="member-email" placeholder="メールアドレス">
        <select id="member-role">
          <option value="editor">編集者</option>
          <option value="viewer">閲覧者</option>
        </select>
        <button class="btn-secondary" onclick="addMember('${esc(vehicleId)}')">追加</button>
      </div>
      <div id="member-err" class="error-msg hidden" style="margin-top:8px"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">閉じる</button>
    </div>
  `)

  await loadMembers(vehicleId)
}

async function loadMembers(vehicleId) {
  const el = document.getElementById('members-list')
  if (!el) return
  try {
    const res = await api.get(`/vehicles/${vehicleId}/members`)
    const members = res.data || []
    if (members.length === 0) {
      el.innerHTML = '<p style="color:var(--text-3);font-size:13px">メンバーがいません</p>'
      return
    }
    el.innerHTML = members.map(m => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${esc(m.display_name || m.email)}</div>
          <div style="font-size:11px;color:var(--text-3)">${esc(m.email)}</div>
        </div>
        <span class="badge ${m.role==='owner'?'badge-blue':m.role==='editor'?'badge-green':'badge-gray'}">
          ${m.role === 'owner' ? 'オーナー' : m.role === 'editor' ? '編集者' : '閲覧者'}
        </span>
        ${m.role !== 'owner' ? `<button class="btn-icon" data-vid="${esc(vehicleId)}" data-uid="${esc(m.user_id)}" onclick="removeMember(this.dataset.vid, this.dataset.uid)">✕</button>` : ''}
      </div>
    `).join('')
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);font-size:13px">${esc(e.message)}</p>`
  }
}

async function addMember(vehicleId) {
  const email = document.getElementById('member-email').value.trim()
  const role = document.getElementById('member-role').value
  const errEl = document.getElementById('member-err')
  errEl.classList.add('hidden')

  if (!email) {
    errEl.textContent = 'メールアドレスを入力してください'
    errEl.classList.remove('hidden')
    return
  }

  try {
    await api.post(`/vehicles/${vehicleId}/members`, { email, role })
    document.getElementById('member-email').value = ''
    toast('メンバーを追加しました')
    await loadMembers(vehicleId)
  } catch (e) {
    errEl.textContent = e.message
    errEl.classList.remove('hidden')
  }
}

async function removeMember(vehicleId, userId) {
  if (!confirm('このメンバーを削除しますか？')) return
  try {
    await api.delete(`/vehicles/${vehicleId}/members/${userId}`)
    toast('メンバーを削除しました')
    await loadMembers(vehicleId)
  } catch (e) {
    toast(e.message, 'error')
  }
}


// ===== API Tokens Page =====
async function renderTokensPage() {
  const container = document.getElementById('page-tokens')
  if (!appState.currentVehicle) {
    container.innerHTML = `<div class="page-header"><div class="page-title">APIトークン</div></div><div class="page-body">${noVehicleHTML()}</div>`
    return
  }

  const v = appState.currentVehicle
  if (v.user_role !== 'owner') {
    container.innerHTML = `<div class="page-header"><div class="page-title">🔑 APIトークン</div></div><div class="page-body"><div class="empty-state"><div class="empty-icon">🔒</div><p>オーナーのみAPIトークンを管理できます</p></div></div>`
    return
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">🔑 APIトークン</div>
        <div class="page-subtitle">${esc(v.name)} ／ 外部連携用トークン</div>
      </div>
      <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="openCreateTokenModal()">＋ トークンを作成</button>
    </div>
    <div class="page-body">
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:13px;color:var(--text-2);line-height:1.7">
          <strong>APIトークン</strong>を使うと、外部アプリやスクリプトからデータにアクセスできます。<br>
          トークンは作成時にのみ表示されます。必ず安全な場所に保存してください。<br>
          エンドポイント: <code style="font-size:11px;background:var(--bg-deep);padding:2px 6px;border-radius:4px">${esc(CONFIG.API_BASE)}/public/vehicles/${esc(v.id)}/fuel-records</code>
        </div>
      </div>
      <div id="tokens-list"><div class="page-loading"><div class="spinner"></div></div></div>
    </div>
  `

  await loadTokens()
}

async function loadTokens() {
  const el = document.getElementById('tokens-list')
  if (!el) return

  try {
    const res = await api.get(`/tokens/vehicle/${appState.currentVehicle.id}`)
    const tokens = res.data || []

    if (tokens.length === 0) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔑</div><p>APIトークンがありません</p><button class="btn-primary" style="width:auto;padding:8px 20px" onclick="openCreateTokenModal()">最初のトークンを作成</button></div>`
      return
    }

    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>名前</th><th>公開範囲</th><th>最終使用</th><th>作成日</th><th></th></tr></thead>
      <tbody>
        ${tokens.map(t => `
          <tr>
            <td style="font-weight:600">${esc(t.name)}</td>
            <td>
              <span class="badge ${t.visibility==='public'||t.visibility==='open'?'badge-green':'badge-gray'}">
                ${t.visibility === 'public' ? '🌐 パブリック' : t.visibility === 'open' ? '🔓 オープン' : '🔒 プライベート'}
              </span>
            </td>
            <td style="color:var(--text-2);font-size:12px">${t.last_used_at ? fmtDate(t.last_used_at) : '未使用'}</td>
            <td style="color:var(--text-2);font-size:12px">${fmtDate(t.created_at)}</td>
            <td><button class="btn-danger" data-id="${esc(t.id)}" onclick="deleteToken(this.dataset.id)">削除</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`
  } catch (e) {
    el.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`
  }
}

function openCreateTokenModal() {
  showModal(`
    <div class="modal-title">🔑 APIトークンを作成</div>
    <div class="field">
      <label>トークン名 <span style="color:var(--red)">*</span></label>
      <input type="text" id="tk-name" placeholder="例: 外部ダッシュボード">
    </div>
    <div class="field">
      <label>公開範囲</label>
      <select id="tk-vis">
        <option value="private">🔒 プライベート（自分のみ）</option>
        <option value="public">🌐 パブリック（誰でも統計を閲覧可）</option>
        <option value="open">🔓 オープン（誰でも全データ閲覧可）</option>
      </select>
    </div>
    <div id="tk-err" class="error-msg hidden"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="createToken()">作成</button>
    </div>
  `)
}

async function createToken() {
  const name = document.getElementById('tk-name').value.trim()
  const visibility = document.getElementById('tk-vis').value
  const errEl = document.getElementById('tk-err')
  errEl.classList.add('hidden')

  if (!name) {
    errEl.textContent = '名前は必須です'
    errEl.classList.remove('hidden')
    return
  }

  try {
    const res = await api.post(`/tokens/vehicle/${appState.currentVehicle.id}`, { name, visibility })
    const token = res.data.token
    closeModal()
    showModal(`
      <div class="modal-title">✅ トークンが作成されました</div>
      <div class="success-msg">このトークンは一度しか表示されません。必ず今すぐコピーしてください！</div>
      <div class="field">
        <label>APIトークン</label>
        <div style="display:flex;gap:8px">
          <input type="text" value="${esc(token)}" id="tk-display" readonly style="font-family:monospace;font-size:12px">
          <button class="btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('tk-display').value).then(()=>toast('コピーしました'))">📋</button>
        </div>
      </div>
      <div class="field">
        <label>使用例（curl）</label>
        <textarea readonly id="tk-curl-example" style="font-size:11px;font-family:monospace;height:80px">curl -H "X-API-Token: ${esc(token)}" ${esc(CONFIG.API_BASE)}/public/vehicles/${esc(appState.currentVehicle.id)}/fuel-records</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="closeModal();loadTokens()">確認した</button>
      </div>
    `)
  } catch (e) {
    errEl.textContent = e.message
    errEl.classList.remove('hidden')
  }
}

async function deleteToken(id) {
  if (!confirm('このAPIトークンを削除しますか？利用中の場合はアクセスできなくなります。')) return
  try {
    await api.delete(`/tokens/${id}`)
    toast('トークンを削除しました')
    await loadTokens()
  } catch (e) {
    toast(e.message, 'error')
  }
}


// ===== Auto.dev: スペック確認 =====
async function showVehicleSpecs(vin, vehicleName) {
  showModal(`
    <div class="modal-title">📋 ${esc(vehicleName)} のスペック</div>
    <div id="specs-content"><div class="page-loading"><div class="spinner"></div></div></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">閉じる</button>
    </div>
  `)

  const content = document.getElementById('specs-content')
  try {
    const res = await api.get(`/autodev/vin/${vin}`)
    const d = res.data

    const rows = [
      ['メーカー', d.make],
      ['モデル', d.model],
      ['年式', d.year],
      ['トリム', d.trim],
      ['ボディタイプ', d.bodyStyle],
      ['駆動方式', d.drivenWheels],
      ['ドア数', d.numOfDoors],
      ['トランスミッション', d.transmission],
      ['エンジン', d.engine?.name],
      ['燃料タイプ', d.engine?.fuelType],
      ['馬力', d.engine?.horsepower ? `${d.engine.horsepower} hp` : null],
      ['排気量', d.engine?.displacement ? `${d.engine.displacement} L` : null],
      ['燃費(市街地)', d.mpg?.city ? `${d.mpg.city} MPG` : null],
      ['燃費(高速)', d.mpg?.highway ? `${d.mpg.highway} MPG` : null],
      ['新車時価格(MSRP)', d.baseMsrp ? `$${Number(d.baseMsrp).toLocaleString()}` : null],
    ].filter(([, val]) => val != null && val !== '')

    if (rows.length === 0) {
      content.innerHTML = `<div class="empty-state" style="padding:20px"><p>スペック情報が見つかりませんでした</p></div>`
      return
    }

    content.innerHTML = `
      <div class="table-wrap">
        <table>
          <tbody>
            ${rows.map(([label, val]) => `
              <tr><td style="color:var(--text-2);width:40%">${esc(label)}</td><td style="font-weight:600">${esc(val)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text-3)">
        ※ MPG（マイル/ガロン）は米国基準の燃費表示です。データ提供: Auto.dev
      </div>
    `
  } catch (e) {
    content.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`
  }
}
