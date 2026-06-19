// Fuelio Hub - Config
const CONFIG = {
  API_BASE: 'https://fuelio-hub-api.shirokuma0822.workers.dev/api/v1',
}

// ===== XSS対策: HTMLエスケープ =====
// テキストやHTML属性値にユーザー入力を埋め込む際は、必ずこの関数を通すこと。
function esc(val) {
  if (val == null) return ''
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// オブジェクトを onclick="fn(JSON)" のように直接埋め込むのは危険（値にクォートが
// 含まれると属性が破壊されHTML/JSが注入される）。代わりに data-* 属性へエスケープ
// した JSON を格納し、クリック時に dataset から安全に読み出すためのヘルパー。
// 使い方:
//   HTML側: data-obj="${dataAttr(record)}" onclick="handler(readDataAttr(this))"
function dataAttr(obj) {
  return esc(JSON.stringify(obj))
}
function readDataAttr(el, key = 'obj') {
  try {
    return JSON.parse(el.dataset[key])
  } catch {
    return null
  }
}

// 燃料タイプ
const FUEL_TYPES = {
  gasoline:   { label: 'レギュラー', icon: '⛽' },
  high_octane:{ label: 'ハイオク',   icon: '⛽' },
  diesel:     { label: '軽油',       icon: '🛢️' },
  electric:   { label: '電気',       icon: '⚡' },
  other:      { label: 'その他',     icon: '🔋' },
}

// 車両タイプ
const VEHICLE_TYPES = {
  car:         { label: '乗用車',   icon: '🚗' },
  motorcycle:  { label: 'バイク',   icon: '🏍️' },
  electric:    { label: 'EV',       icon: '⚡' },
  generator:   { label: '発電機',   icon: '🔌' },
  other:       { label: 'その他',   icon: '🚙' },
}

// メンテカテゴリ
const MAINT_CATEGORIES = {
  oil:         { label: 'オイル交換',     icon: '🛢️' },
  tire:        { label: 'タイヤ',         icon: '🔄' },
  brake:       { label: 'ブレーキ',       icon: '🛑' },
  battery:     { label: 'バッテリー',     icon: '🔋' },
  inspection:  { label: '車検・点検',     icon: '🔍' },
  wash:        { label: '洗車',           icon: '🚿' },
  other:       { label: 'その他',         icon: '🔧' },
}

// 燃費評価
function getEfficiencyRating(eff, avg) {
  if (!eff || !avg) return { class: '', label: '-' }
  const ratio = eff / avg
  if (ratio >= 1.1)  return { class: 'good', label: '良好', color: 'var(--green)' }
  if (ratio >= 0.9)  return { class: '',     label: '普通', color: 'var(--text-2)' }
  return { class: 'warn', label: '低め', color: 'var(--yellow)' }
}

// 数値フォーマット
function fmt(val, decimals = 1, unit = '') {
  if (val == null || val === '' || isNaN(val)) return '—'
  return Number(val).toFixed(decimals) + (unit ? ' ' + unit : '')
}
function fmtCost(val) {
  if (val == null || isNaN(val)) return '—'
  return '¥' + Math.round(val).toLocaleString('ja-JP')
}
function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}
function fmtOdo(val) {
  if (val == null) return '—'
  return Number(val).toLocaleString('ja-JP') + ' km'
}

// トースト
function toast(msg, type = 'success') {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.className = `show toast-${type}`
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.className = '' }, 3000)
}
