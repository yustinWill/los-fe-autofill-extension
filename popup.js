'use strict'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Fallback date string (DD-MM-YYYY), computed once at startup
const FALLBACK_DATE = (() => {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + '-'
       + String(d.getMonth() + 1).padStart(2, '0') + '-'
       + d.getFullYear()
})()

let lastResults = {}   // populated by execute handler; read by runAllWizardSteps

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const jsonInput        = document.getElementById('jsonInput')
const detectBtn        = document.getElementById('detectBtn')
const executeBtn       = document.getElementById('executeBtn')
const buildJsonBtn     = document.getElementById('buildJsonBtn')
const exportBtn        = document.getElementById('exportBtn')
const delayInput       = document.getElementById('delayInput')
const allStepsCb       = document.getElementById('allStepsCb')
const doubleCheckCb    = document.getElementById('doubleCheckCb')
const ignoreDisabledCb = document.getElementById('ignoreDisabledCb')
const skipFilledCb     = document.getElementById('skipFilledCb')
const skipOptionalCb   = document.getElementById('skipOptionalCb')
const fieldsPanel      = document.getElementById('fieldsPanel')
const fieldsList       = document.getElementById('fieldsList')
const fieldCount       = document.getElementById('fieldCount')
const closeFieldsBtn   = document.getElementById('closeFieldsBtn')
const badge1           = document.getElementById('badge1')
const badge2           = document.getElementById('badge2')
const badge3           = document.getElementById('badge3')
const progressWrap     = document.getElementById('progressWrap')
const progressFill     = document.getElementById('progressFill')
const progressLabel    = document.getElementById('progressLabel')
const resultStrip      = document.getElementById('resultStrip')
const toast            = document.getElementById('toast')

// ─── Step badge state ─────────────────────────────────────────────────────────
function setStepActive(num) {
  ;[badge1, badge2, badge3].forEach((b, i) => {
    b.classList.remove('active', 'done')
    if (i + 1 < num) b.classList.add('done')
    else if (i + 1 === num) b.classList.add('active')
  })
}
function markStepDone(num) {
  const b = [badge1, badge2, badge3][num - 1]
  if (b) { b.classList.remove('active'); b.classList.add('done') }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer
function showToast(msg, bg = '#1f2937') {
  clearTimeout(toastTimer)
  toast.textContent = msg
  toast.style.background = bg
  toast.classList.remove('hidden')
  requestAnimationFrame(() => toast.classList.add('show'))
  toastTimer = setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.classList.add('hidden'), 220)
  }, 2600)
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────
function parseJSON() {
  const text = jsonInput.value.trim()
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}
const prettyJSON = obj => JSON.stringify(obj, null, 2)

// ─── Smart default generator ──────────────────────────────────────────────────
// Keys = normalized label text (lowercase, trailing * stripped).
// Date values use DD-MM-YYYY (passed to react-datepicker via fillText which parses → Date object,
// or passed to Cleave masked date fields as raw digits after stripping dashes).

// Random helpers — used by LABEL_DEFAULTS getters and smartDefault
const _PICK = arr => arr[Math.floor(Math.random() * arr.length)]
const _RAMT = (mn, mx, step = 1000000) => String(mn + Math.floor(Math.random() * Math.ceil((mx - mn) / step)) * step)
const _RD2  = () => String(Math.floor(Math.random() * 90) + 10)  // 2-digit random
const _R6   = () => String(Math.floor(Math.random() * 900000) + 100000)

const _NAMES_DEBTOR  = ['Budi Santoso', 'Agus Setiawan', 'Hendra Wijaya', 'Reza Pratama', 'Denny Kusuma', 'Eko Prabowo', 'Feri Gunawan', 'Galih Saputra']
const _NAMES_FEMALE  = ['Dewi Kusuma', 'Sari Wulandari', 'Rina Anggraeni', 'Maya Putri', 'Fitri Rahayu', 'Indah Lestari', 'Yuni Astuti']
const _NAMES_DAD     = ['Slamet Riyadi', 'Wahyu Santoso', 'Bambang Sutrisno', 'Hadi Wijaya', 'Sugeng Raharjo', 'Joko Widodo', 'Mulyono Prabowo']
const _NAMES_MOM     = ['Siti Aminah', 'Wati Rahayu', 'Sunarti', 'Purwati', 'Endang Susilowati', 'Sri Mulyani', 'Hartini']
const _ALIASES       = ['Budi', 'Agus', 'Hendra', 'Reza', 'Denny', 'Eko', 'Feri', 'Galih']
const _CITIES        = ['Jakarta Selatan', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Yogyakarta', 'Makassar', 'Denpasar', 'Palembang']
const _STREET_NUMS   = ['1', '12', '27', '45', '88', '103', '5A', '10B']
const _STREETS       = ['Jl. Sudirman', 'Jl. Thamrin', 'Jl. Gatot Subroto', 'Jl. Kuningan', 'Jl. HR Rasuna Said', 'Jl. Sisingamangaraja', 'Jl. Panglima Polim']
const _POSITIONS     = ['Direktur', 'Manajer', 'Staff', 'Supervisor', 'Kepala Divisi', 'Komisaris']
const _TENORS        = ['12', '18', '24', '36', '48', '60']

const LABEL_DEFAULTS = {
  // ── Identitas ──────────────────────────────────────────────────────────────
  get 'nama lengkap'()       { return _PICK(_NAMES_DEBTOR) },
  get 'nama alias'()         { return _PICK(_ALIASES) },
  get 'nomor ktp'()          { return '32' + _RD2() + _RD2() + _R6() + _RD2() + '00' + _RD2() },
  get 'nomor npwp'()         { return _R6() + _R6() + _RD2() + _RD2() + _RD2() + _RD2() },
  get 'nomor nib'()          { return '912020' + _R6() + _RD2() },
  'id privy':                  'PRV123456',

  // ── Kontak ─────────────────────────────────────────────────────────────────
  get 'nomor handphone'()    { return '0812' + _R6() + _RD2() + _RD2() },
  get 'nomor telepon rumah'() { return '021' + _R6() + _RD2() },
  get 'nomor telepon perusahaan'() { return '021' + _R6() + _RD2() },
  get 'alamat email'()       { const n = _PICK(_NAMES_DEBTOR).toLowerCase().replace(' ', '.'); return n + '@example.com' },

  // ── Lahir / pendirian ──────────────────────────────────────────────────────
  get 'tanggal lahir'()      { const y = 1975 + Math.floor(Math.random() * 25); const m = String(1+Math.floor(Math.random()*12)).padStart(2,'0'); const d = String(1+Math.floor(Math.random()*28)).padStart(2,'0'); return d+'-'+m+'-'+y },
  'tanggal pendirian':         '20-05-2010',

  // ── Alamat ─────────────────────────────────────────────────────────────────
  get 'alamat tempat tinggal (sesuai ktp)'() { return _PICK(_STREETS) + ' No. ' + _PICK(_STREET_NUMS) },
  get 'alamat tempat tinggal (domisili)'()   { return _PICK(_STREETS) + ' No. ' + _PICK(_STREET_NUMS) },
  get 'alamat perusahaan'()  { return _PICK(_STREETS) + ' No. ' + _PICK(_STREET_NUMS) },
  get 'kode pos'()           { return String(10000 + Math.floor(Math.random() * 89000)) },
  get 'rw'()                 { return String(Math.floor(Math.random() * 9) + 1).padStart(3, '0') },
  get 'rt'()                 { return String(Math.floor(Math.random() * 9) + 1).padStart(3, '0') },

  // ── Keluarga ───────────────────────────────────────────────────────────────
  get 'nama ayah kandung'()  { return _PICK(_NAMES_DAD) },
  get 'nama ibu kandung'()   { return _PICK(_NAMES_MOM) },
  get 'nama pasangan'()      { return _PICK(_NAMES_FEMALE) },
  get 'jumlah saudara kandung'() { return String(Math.floor(Math.random() * 4)) },
  get 'jumlah tanggungan'()  { return String(Math.floor(Math.random() * 4)) },
  get 'nomor kartu keluarga'() { return '32' + _RD2() + _RD2() + _R6() + _R6() },

  // ── Pekerjaan ──────────────────────────────────────────────────────────────
  get 'jabatan'()            { return _PICK(_POSITIONS) },
  get 'lama bekerja'()       { return String(1 + Math.floor(Math.random() * 20)) },
  get 'nama perusahaan'()    { return _PICK(['PT Maju Sejahtera', 'CV Karya Mandiri', 'PT Nusantara Jaya', 'PT Sukses Makmur', 'CV Berkah Abadi']) },
  get 'nama dagang perusahaan'() { return _PICK(['Maju Sejahtera', 'Karya Mandiri', 'Nusantara Jaya', 'Sukses Makmur', 'Berkah Abadi']) },

  // ── Keuangan ───────────────────────────────────────────────────────────────
  get 'nominal pendapatan'() { return _RAMT(5000000, 50000000) },
  get 'nominal pengeluaran'(){ return _RAMT(1500000, 20000000, 500000) },
  get 'total pendapatan'()   { return _RAMT(5000000, 50000000) },
  get 'total pengeluaran'()  { return _RAMT(1500000, 20000000, 500000) },
  get 'plafond'()            { return _RAMT(50000000, 500000000, 10000000) },
  get 'tenor'()              { return _PICK(_TENORS) },

  // ── Perusahaan / legal ─────────────────────────────────────────────────────
  'nama notaris':              'Budi Notaris, SH',
  get 'nomor akta'()         { return String(1 + Math.floor(Math.random() * 99)).padStart(2, '0') },
  get 'nomor sk'()           { return 'AHU-' + _R6() + '.AH.01.01.' + (2015 + Math.floor(Math.random() * 10)) },
  get 'nomor nib perusahaan'(){ return '912020' + _R6() + _RD2() },

  // ── Laporan Keuangan ───────────────────────────────────────────────────────
  get 'periode tahun'()      { return String(new Date().getFullYear() - 1) },
  get 'tahun buku'()         { return String(new Date().getFullYear() - 1) },
}

// Pattern-based fallback — searched against "FIELD_NAME label" lowercased.
// Values may be () => string functions for randomization.
const SMART_RULES = [
  [/\b(ibu kandung|mother name|nama ibu)\b/,             () => _PICK(_NAMES_MOM)],
  [/\b(ayah kandung|father name|nama ayah)\b/,           () => _PICK(_NAMES_DAD)],
  [/\b(nama alias|alias name|panggilan)\b/,              () => _PICK(_ALIASES)],
  [/\b(nama pasangan|spouse name)\b/,                    () => _PICK(_NAMES_FEMALE)],
  [/\b(nama lengkap|full name|debtor.*full)\b/,          () => _PICK(_NAMES_DEBTOR)],
  [/\b(nama perusahaan|company name)\b/,                 () => _PICK(['PT Maju Sejahtera', 'CV Karya Mandiri', 'PT Nusantara Jaya', 'PT Sukses Makmur'])],
  [/\b(nama dagang|trade name)\b/,                       () => _PICK(['Maju Sejahtera', 'Karya Mandiri', 'Nusantara Jaya', 'Sukses Makmur'])],
  [/\bnomor ktp\b/,                                      () => '32' + _RD2() + _RD2() + _R6() + _RD2() + '00' + _RD2()],
  [/\bnomor npwp\b/,                                     () => _R6() + _R6() + _RD2() + _RD2() + _RD2() + _RD2()],
  [/\bnomor nib\b/,                                      () => '912020' + _R6() + _RD2()],
  [/\b(passport|paspor)\b/,                              () => 'A' + (1000000 + Math.floor(Math.random() * 8999999))],
  [/\b(kartu keluarga|family card)\b/,                   () => '32' + _RD2() + _RD2() + _R6() + _R6()],
  [/\bprivy\b/,                                                    'PRV123456'],
  [/\bemail\b/,                                          () => { const n = _PICK(_NAMES_DEBTOR).toLowerCase().replace(' ', '.'); return n + '@example.com' }],
  [/\b(handphone|mobile phone|no hp)\b/,                 () => '0812' + _R6() + _RD2() + _RD2()],
  [/\b(telepon rumah|home phone)\b/,                     () => '021' + _R6() + _RD2()],
  [/\b(telepon perusahaan|company phone|nomor telepon)\b/, () => '021' + _R6() + _RD2()],
  [/\bfax\b/,                                                       '02112345679'],
  [/\b(website|url)\b/,                                             'https://example.com'],
  [/\b(alamat|full address|address)\b/,                  () => _PICK(_STREETS) + ' No. ' + _PICK(_STREET_NUMS)],
  [/\b(kelurahan|sub district)\b/,                       () => _PICK(['Menteng', 'Kebayoran', 'Kuningan', 'Senayan', 'Tebet', 'Cikini'])],
  [/\b(kecamatan|district)\b/,                           () => _PICK(['Menteng', 'Kebayoran Baru', 'Setiabudi', 'Tebet', 'Mampang'])],
  [/\b(kota|city|kabupaten)\b/,                          () => _PICK(_CITIES)],
  [/\b(provinsi|province)\b/,                            () => _PICK(['DKI Jakarta', 'Jawa Barat', 'Jawa Timur', 'Jawa Tengah', 'Banten', 'Bali'])],
  [/\b(kode pos|postal code)\b/,                         () => String(10000 + Math.floor(Math.random() * 89000))],
  [/\b(negara|country)\b/,                                          'Indonesia'],
  [/(^| )rw( |$)/,                                       () => String(Math.floor(Math.random() * 9) + 1).padStart(3, '0')],
  [/(^| )rt( |$)/,                                       () => String(Math.floor(Math.random() * 9) + 1).padStart(3, '0')],
  [/\b(tempat lahir|birth place|tempat pendirian)\b/,    () => _PICK(_CITIES)],
  [/\b(tanggal lahir|birth date|tanggal pendirian)\b/,   () => { const y = 1970 + Math.floor(Math.random() * 30); const m = String(1+Math.floor(Math.random()*12)).padStart(2,'0'); const d = String(1+Math.floor(Math.random()*28)).padStart(2,'0'); return d+'-'+m+'-'+y }],
  [/\bjabatan\b/,                                        () => _PICK(_POSITIONS)],
  [/\b(lama bekerja|work duration)\b/,                   () => String(1 + Math.floor(Math.random() * 20))],
  [/\b(jumlah saudara|sibling count)\b/,                 () => String(Math.floor(Math.random() * 4))],
  [/\b(jumlah tanggungan|dependent count)\b/,            () => String(Math.floor(Math.random() * 4))],
  [/\b(nominal pendapatan|income amount)\b/,             () => _RAMT(5000000, 50000000)],
  [/\b(nominal pengeluaran|expense amount)\b/,           () => _RAMT(1500000, 20000000, 500000)],
  [/\btotal pendapatan\b/,                               () => _RAMT(5000000, 50000000)],
  [/\btotal pengeluaran\b/,                              () => _RAMT(1500000, 20000000, 500000)],
  [/\b(plafond|jumlah pinjaman|loan amount)\b/,          () => _RAMT(50000000, 500000000, 10000000)],
  [/\b(tenor|jangka waktu)\b/,                           () => _PICK(_TENORS)],
  [/\bnomor sk\b/,                                       () => 'AHU-' + _R6() + '.AH.01.01.' + (2015 + Math.floor(Math.random() * 10))],
  [/\bnomor akta\b/,                                     () => String(1 + Math.floor(Math.random() * 99)).padStart(2, '0')],
  [/\bnotaris\b/,                                                   'Budi Notaris, SH'],
  [/\b(catatan|keterangan|deskripsi|description|note)\b/,           'Tidak ada keterangan'],
  // year-only picker fields (e.g. "Periode Tahun", "FR_REPORT_PERIOD_YEAR")
  [/\b(periode tahun|period year|tahun buku|fiscal year|report.*year|year.*report)\b/, () => String(new Date().getFullYear() - 1)],
  // numeric-hint catch: return '000' before general text fallback
  [/\b(nomor|number|no\.)\b/,                                       '000'],
]

// Returns smart default for a field.
// '' for selects means "pick first live option during fill" (handles cascade-disabled fields).
function smartDefault(name, label, type, options = []) {
  if (type === 'autocomplete' || type === 'muiselect' || type === 'select') {
    const first = options.find(o => o.value !== '' && o.value !== null && o.value !== undefined)
    return first ? first.value : ''
  }
  if (type === 'radio') {
    const first = options.find(o => o.value !== '' && o.value !== null && o.value !== undefined)
    return first ? first.value : ''
  }
  if (type === 'checkbox' || type === 'checkbox_group') return false
  if (type === 'time') return ''

  // 0. Table numeric cells stamped by pageDetect scanner
  if (name.startsWith('__TBL__')) {
    const lbl = (label || name).toLowerCase()
    if (/penjualan|pendapatan usaha/.test(lbl))           return _RAMT(500000000, 10000000000, 100000000)
    if (/harga pokok|hpp/.test(lbl))                       return _RAMT(300000000, 7000000000, 100000000)
    if (/beban usaha|beban operasional/.test(lbl))         return _RAMT(50000000, 2000000000, 50000000)
    if (/beban bunga|biaya bunga/.test(lbl))               return _RAMT(5000000, 200000000, 5000000)
    if (/pajak penghasilan|pph/.test(lbl))                 return _RAMT(10000000, 500000000, 10000000)
    if (/depresiasi|amortisasi/.test(lbl))                 return _RAMT(10000000, 300000000, 10000000)
    if (/laba bersih|net income|net profit/.test(lbl))     return _RAMT(50000000, 3000000000, 100000000)
    if (/laba kotor|gross profit/.test(lbl))               return _RAMT(100000000, 4000000000, 100000000)
    if (/laba/.test(lbl))                                  return _RAMT(50000000, 2000000000, 100000000)
    if (/kas dan setara kas|kas/.test(lbl))                return _RAMT(100000000, 2000000000, 50000000)
    if (/piutang/.test(lbl))                               return _RAMT(50000000, 1500000000, 50000000)
    if (/persediaan/.test(lbl))                            return _RAMT(100000000, 3000000000, 100000000)
    if (/investasi/.test(lbl))                             return _RAMT(50000000, 500000000, 50000000)
    if (/tanah|bangunan|kendaraan|properti/.test(lbl))     return _RAMT(200000000, 5000000000, 100000000)
    if (/aktiva tetap|aset tetap/.test(lbl))               return _RAMT(200000000, 5000000000, 100000000)
    if (/total aktiva|total aset/.test(lbl))               return _RAMT(500000000, 10000000000, 500000000)
    if (/hutang bank|utang bank/.test(lbl))                return _RAMT(100000000, 3000000000, 100000000)
    if (/hutang dagang|utang usaha/.test(lbl))             return _RAMT(50000000, 1000000000, 50000000)
    if (/hutang pajak|utang pajak/.test(lbl))              return _RAMT(10000000, 200000000, 10000000)
    if (/modal disetor/.test(lbl))                         return _RAMT(500000000, 5000000000, 500000000)
    if (/total pasiva|total ekuitas/.test(lbl))            return _RAMT(500000000, 10000000000, 500000000)
    return _RAMT(10000000, 500000000, 10000000)
  }

  // 1. Exact label match (highest priority)
  const normLabel = label.replace(/\s*\*\s*$/, '').trim().toLowerCase()
  if (normLabel && normLabel in LABEL_DEFAULTS) return LABEL_DEFAULTS[normLabel]

  const searchKey = (name + ' ' + label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  // 2. Native date input (type='date') — ISO format required
  if (type === 'date') {
    if (/\b(lahir|birth|dob|pendirian|establishment)\b/.test(searchKey)) return '1990-01-15'
    return ''
  }

  // 3. Regex pattern rules — values may be functions for randomization
  for (const [pattern, defaultVal] of SMART_RULES) {
    if (pattern.test(searchKey)) return typeof defaultVal === 'function' ? defaultVal() : defaultVal
  }

  // 4. Fallback — numeric hint → '000', otherwise '{label} DD-MM-YYYY'
  const isNumericHint = /\b(nominal|jumlah|total|plafond|tenor|angka|amount|count|qty)\b/.test(searchKey)
  if (isNumericHint) return '000'
  const fallbackLabel = normLabel || name.toLowerCase().replace(/_/g, ' ')
  return `${fallbackLabel} ${FALLBACK_DATE}`
}

// ─── Active tab ───────────────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

// ─── Page-context detect function ─────────────────────────────────────────────
// Self-contained — runs in world:'MAIN'. Peeks select options WITHOUT leaving them open.
async function pageDetect() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = (fn, ms = 1400) => new Promise(res => {
    const end = Date.now() + ms
    const t = () => { const r = fn(); if (r) return res(r); if (Date.now() > end) return res(null); setTimeout(t, 40) }
    t()
  })

  // Detect an open MUI dialog by its backdrop — the only element that is
  // unconditionally rendered (and only rendered) while a dialog is open.
  // Class/attribute checks on .MuiDialog-paper are fragile; the backdrop is not.
  const modalRoot = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
    ? (document.querySelector('.MuiDialog-paper') || null)
    : null
  const root = modalRoot || document

  // Close any open listbox. triggerEl = the element that opened it (Escape goes there first).
  async function closeListbox(triggerEl) {
    const escOpts = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }
    if (triggerEl) {
      triggerEl.dispatchEvent(new KeyboardEvent('keydown', escOpts))
      triggerEl.dispatchEvent(new KeyboardEvent('keyup', escOpts))
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', escOpts))
      document.dispatchEvent(new KeyboardEvent('keyup', escOpts))
    }
    await waitFor(() => !document.querySelector('[role="listbox"]'), 600)
    if (document.querySelector('[role="listbox"]')) {
      // Fallback: click outside
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(120)
    }
    await sleep(80)
  }

  function getFiberFieldName(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 100) {
      const p = f.memoizedProps
      if (p && p.name && p.control && typeof p.name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(p.name)) return p.name
      f = f.return
    }
    return null
  }

  function getLabel(el) {
    const fc = el.closest && el.closest('.MuiFormControl-root') || el
    const lbl = fc.querySelector && fc.querySelector('.MuiFormLabel-root, .MuiInputLabel-root')
    if (lbl) return lbl.textContent.replace(/\s*\*\s*$/, '').trim()
    if (el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) return l.textContent.replace(/\s*\*\s*$/, '').trim() }
    // Fallback for table inputs stamped by the table scanner below
    const al = el.getAttribute ? el.getAttribute('data-autofill-label') : ''
    if (al) return al
    return ''
  }

  function findMaskSelectUnit(name) {
    for (const fc of root.querySelectorAll('[aria-describedby$="-maskselect-helper"]')) {
      const ni = fc.querySelector('.MuiSelect-nativeInput')
      if (!ni) continue
      const sn = ni.getAttribute('data-autofill-name') || getFiberFieldName(ni)
      if (sn === name) return { outerFc: fc, ni }
    }
    return null
  }

  function isFieldDisabled(name, type) {
    if (type === 'autocomplete') {
      const fc = root.querySelector('[aria-describedby="' + name + '-select"]')
      if (!fc) return false
      const inp = fc.querySelector('input[role="combobox"]')
      if (inp && inp.disabled) return true
      const base = fc.querySelector('.MuiInputBase-root')
      return base ? base.classList.contains('Mui-disabled') : false
    }
    if (type === 'muiselect') {
      const ni = root.querySelector('.MuiSelect-nativeInput[name="' + name + '"]') || (findMaskSelectUnit(name) || {}).ni
      if (!ni) return false
      const base = ni.closest('.MuiInputBase-root')
      return base ? base.classList.contains('Mui-disabled') : false
    }
    const el = root.querySelector('input[name="' + name + '"]:not([aria-hidden="true"]), textarea[name="' + name + '"]')
    if (!el) return false
    if (el.disabled) return true
    const base = el.closest && el.closest('.MuiInputBase-root')
    return base ? base.classList.contains('Mui-disabled') : false
  }

  function resolveType(name) {
    if (root.querySelector('input[type="checkbox"][name="' + name + '"]'))
      return root.querySelectorAll('input[type="checkbox"][name="' + name + '"]').length > 1 ? 'checkbox_group' : 'checkbox'
    if (root.querySelector('input[type="radio"][name="' + name + '"]')) return 'radio'
    if (root.querySelector('textarea[name="' + name + '"]')) return 'textarea'
    if (root.querySelector('[aria-describedby="' + name + '-select"]')) return 'autocomplete'
    if (root.querySelector('.MuiSelect-nativeInput[name="' + name + '"]')) return 'muiselect'
    if (findMaskSelectUnit(name)) return 'muiselect'
    const inp = root.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
    if (!inp) return null
    if (inp.closest('.react-datepicker__input-container')) return 'datepicker'
    if (inp.type === 'date') return 'date'
    if (inp.type === 'time') return 'time'
    if (inp.type === 'password') return 'password'
    return 'text'
  }

  function currentValue(name, type) {
    if (type === 'checkbox') { const el = root.querySelector('input[type="checkbox"][name="' + name + '"]'); return el ? el.checked : false }
    if (type === 'checkbox_group') return Array.from(root.querySelectorAll('input[type="checkbox"][name="' + name + '"]:checked')).map(c => c.value)
    if (type === 'radio') { const el = root.querySelector('input[type="radio"][name="' + name + '"]:checked'); return el ? el.value : '' }
    if (type === 'autocomplete') { const el = root.querySelector('[aria-describedby="' + name + '-select"] input[role="combobox"]'); return el ? el.value : '' }
    if (type === 'muiselect') {
      const ni = root.querySelector('.MuiSelect-nativeInput[name="' + name + '"]') || (findMaskSelectUnit(name) || {}).ni
      return ni ? ni.value : ''
    }
    const el = root.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])') || root.querySelector('textarea[name="' + name + '"]')
    return el ? el.value : ''
  }

  async function peekAutocompleteOptions(name) {
    const fc = root.querySelector('[aria-describedby="' + name + '-select"]')
    if (!fc) return []
    const btn = fc.querySelector('.MuiAutocomplete-popupIndicator')
    if (!btn || btn.disabled) return []
    btn.click()
    // Listbox is a portal — always rendered at document level, not inside root
    const lb = await waitFor(() => document.querySelector('[role="listbox"]'), 800)
    const opts = lb
      ? Array.from(lb.querySelectorAll('[role="option"]')).map(o => ({ value: o.textContent.trim(), label: o.textContent.trim() }))
      : []
    btn.click()
    await waitFor(() => !document.querySelector('[role="listbox"]'), 600)
    if (document.querySelector('[role="listbox"]')) {
      if (root !== document) {
        // Modal context: ESC bubbles past the Autocomplete and closes the parent dialog.
        // Use a body mousedown instead — MUI's click-away handler treats it as "outside".
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(120)
      } else {
        await closeListbox(btn)
      }
    }
    await sleep(60)
    return opts
  }

  async function peekMuiSelectOptions(name) {
    const namedNi = root.querySelector('.MuiSelect-nativeInput[name="' + name + '"]')
    let trigger = namedNi && namedNi.closest('.MuiInputBase-root') && namedNi.closest('.MuiInputBase-root').querySelector('.MuiSelect-select') || null
    if (!trigger) {
      const found = findMaskSelectUnit(name)
      trigger = found && found.outerFc && found.outerFc.querySelector('.MuiSelect-select') || null
    }
    if (!trigger) return []
    trigger.click()
    const lb = await waitFor(() => document.querySelector('[role="listbox"]'), 800)
    const safeClose = async (el) => {
      if (root !== document) {
        // Modal context: skip ESC — it bubbles and closes the parent dialog
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(120)
      } else {
        await closeListbox(el)
      }
    }
    if (!lb) {
      await safeClose(trigger)
      return []
    }
    const opts = Array.from(lb.querySelectorAll('[role="option"]')).map(o => ({ value: o.getAttribute('data-value') || o.textContent.trim(), label: o.textContent.trim() }))
    await safeClose(trigger)
    return opts
  }

  // Stamp MaskSelect field names before scanning
  root.querySelectorAll('[aria-describedby$="-maskselect-helper"]').forEach(function(fc) {
    const ni = fc.querySelector('.MuiSelect-nativeInput')
    if (!ni || ni.hasAttribute('data-autofill-name')) return
    const n = getFiberFieldName(ni)
    if (n) ni.setAttribute('data-autofill-name', n)
  })

  const seen = new Set(), entries = []

  for (const el of root.querySelectorAll('input[name]:not([aria-hidden="true"]):not([tabindex="-1"]), textarea[name]')) {
    const name = el.getAttribute('name')
    if (!name || seen.has(name)) continue
    if (el.type !== 'hidden') {
      const s = getComputedStyle(el), r = el.getBoundingClientRect()
      if (s.display === 'none' || s.visibility === 'hidden' || (!r.width && !r.height)) continue
    }
    seen.add(name); entries.push({ name, anchor: el })
  }
  for (const fc of root.querySelectorAll('.MuiFormControl-root[aria-describedby$="-select"]')) {
    const raw = fc.getAttribute('aria-describedby')
    const name = raw.replace(/-select$/, '')
    if (!name || seen.has(name) || !fc.querySelector('input[role="combobox"]')) continue
    seen.add(name); entries.push({ name, anchor: fc })
  }
  for (const el of root.querySelectorAll('.MuiSelect-nativeInput[name]')) {
    const name = el.getAttribute('name')
    if (!name || seen.has(name)) continue
    seen.add(name); entries.push({ name, anchor: el })
  }
  for (const fc of root.querySelectorAll('[aria-describedby$="-maskselect-helper"]')) {
    const ni = fc.querySelector('.MuiSelect-nativeInput')
    if (!ni) continue
    const name = ni.getAttribute('data-autofill-name') || getFiberFieldName(ni)
    if (!name || seen.has(name)) continue
    seen.add(name); entries.push({ name, anchor: ni })
  }

  entries.sort(function(a, b) { return a.anchor.compareDocumentPosition(b.anchor) & 4 ? -1 : 1 })

  const fields = []
  for (const { name, anchor } of entries) {
    const type = resolveType(name)
    if (!type) continue
    const label = getLabel(anchor)
    const value = currentValue(name, type)
    const disabled = isFieldDisabled(name, type)
    const optional = !(label && label.includes('*'))
    const field = { name, type, label, value, disabled, optional, options: [] }

    if (type === 'autocomplete' && !disabled) {
      field.options = await peekAutocompleteOptions(name)
    } else if (type === 'muiselect' && !disabled) {
      field.options = await peekMuiSelectOptions(name)
    } else if (type === 'radio') {
      field.options = Array.from(root.querySelectorAll('input[type="radio"][name="' + name + '"]')).map(function(r) {
        const lbl = root.querySelector('label[for="' + r.id + '"]') || r.closest('label')
        return { value: r.value, label: lbl ? lbl.textContent.trim() : r.value }
      })
    } else if (type === 'checkbox_group') {
      field.options = Array.from(root.querySelectorAll('input[type="checkbox"][name="' + name + '"]')).map(function(c) {
        const lbl = root.querySelector('label[for="' + c.id + '"]') || c.closest('label')
        return { value: c.value, label: lbl ? lbl.textContent.trim() : c.value }
      })
    }

    fields.push(field)
  }

  return fields
}

// ─── Page-context single-field fill function ──────────────────────────────────
// Self-contained — called per-field from executeBtn so the popup shows live progress.
// value='' for selects means "pick first available option" (handles cascade-disabled fields).
async function fillSingleField(name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, isOptional) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = (fn, ms = 1400) => new Promise(res => {
    const end = Date.now() + ms
    const t = () => { const r = fn(); if (r) return res(r); if (Date.now() > end) return res(null); setTimeout(t, 40) }
    t()
  })

  function pressEsc() {
    const opts = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }
    document.dispatchEvent(new KeyboardEvent('keydown', opts))
    document.dispatchEvent(new KeyboardEvent('keyup', opts))
  }

  async function ensureClosed() {
    await waitFor(() => !document.querySelector('[role="listbox"]'), 700)
    if (document.querySelector('[role="listbox"]')) { pressEsc(); await sleep(150) }
  }

  function getFiberFieldName(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 100) {
      const p = f.memoizedProps
      if (p && p.name && p.control && typeof p.name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(p.name)) return p.name
      f = f.return
    }
    return null
  }

  function findMaskSelectUnit(name) {
    for (const fc of document.querySelectorAll('[aria-describedby$="-maskselect-helper"]')) {
      const ni = fc.querySelector('.MuiSelect-nativeInput')
      if (!ni) continue
      const sn = ni.getAttribute('data-autofill-name') || getFiberFieldName(ni)
      if (sn === name) return { outerFc: fc, ni }
    }
    return null
  }

  function resolveType(name) {
    if (document.querySelector('input[type="checkbox"][name="' + name + '"]'))
      return document.querySelectorAll('input[type="checkbox"][name="' + name + '"]').length > 1 ? 'checkbox_group' : 'checkbox'
    if (document.querySelector('input[type="radio"][name="' + name + '"]')) return 'radio'
    if (document.querySelector('textarea[name="' + name + '"]')) return 'textarea'
    if (document.querySelector('[aria-describedby="' + name + '-select"]')) return 'autocomplete'
    if (document.querySelector('.MuiSelect-nativeInput[name="' + name + '"]')) return 'muiselect'
    if (findMaskSelectUnit(name)) return 'muiselect'
    const inp = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
    if (!inp) return null
    if (inp.closest('.react-datepicker__input-container')) return 'datepicker'
    if (inp.type === 'date') return 'date'
    if (inp.type === 'time') return 'time'
    return 'text'
  }

  function isFieldDisabled(name, type) {
    if (type === 'autocomplete') {
      const fc = document.querySelector('[aria-describedby="' + name + '-select"]')
      if (!fc) return false
      const base = fc.querySelector('.MuiInputBase-root')
      return base ? base.classList.contains('Mui-disabled') : false
    }
    if (type === 'muiselect') {
      const ni = document.querySelector('.MuiSelect-nativeInput[name="' + name + '"]') || (findMaskSelectUnit(name) || {}).ni
      if (!ni) return false
      const base = ni.closest('.MuiInputBase-root')
      return base ? base.classList.contains('Mui-disabled') : false
    }
    const el = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"]), textarea[name="' + name + '"]')
    if (!el) return false
    if (el.disabled) return true
    const base = el.closest && el.closest('.MuiInputBase-root')
    return base ? base.classList.contains('Mui-disabled') : false
  }

  // Fill a plain text input or Cleave masked input.
  // react-datepicker fields are handled separately by fillDatePicker.
  async function fillText(name, value) {
    const sel = 'input[name="' + name + '"]:not([aria-hidden="true"]):not([type="radio"]):not([type="checkbox"])'
    const el = document.querySelector(sel) || document.querySelector('textarea[name="' + name + '"]')
    if (!el) return false

    el.focus()
    await sleep(40)
    const strVal = String(value)
    let filled = false
    const fk = Object.keys(el).find(k => /^__reactFiber\$/.test(k))

    // ── Cleave / regular text: RHF control.register(name).onChange via fiber walk ─
    if (!filled && fk) {
      let f = el[fk], depth = 0
      while (f && depth++ < 150) {
        const p = f.memoizedProps
        if (p && p.control && p.name && typeof p.name === 'string') {
          try {
            const reg = p.control.register(p.name)
            if (reg && typeof reg.onChange === 'function') {
              const parentBase = el.closest('.MuiInputBase-root')
              const isNumeric = parentBase && parentBase.getAttribute('inputmode') === 'numeric'
              const finalVal = isNumeric ? strVal.replace(/\D+/g, '') : strVal
              await reg.onChange({ target: { value: finalVal, name: p.name } })
              filled = true
            }
          } catch (_) { /* ignore, fall through */ }
          break
        }
        f = f.return
      }
    }

    // ── Fallback 1: __reactProps$.onChange (Cleave's own chain) ──────────────
    if (!filled) {
      const rk = Object.keys(el).find(k => /^__reactProps\$/.test(k))
      if (rk && typeof el[rk].onChange === 'function') {
        el[rk].onChange({ target: { value: strVal, rawValue: strVal, name: el.getAttribute('name') || '' } })
        filled = true
      }
    }

    // ── Fallback 2: native setter + InputEvent ────────────────────────────────
    if (!filled) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set
      if (setter) {
        setter.call(el, strVal)
        if (el._valueTracker) { try { el._valueTracker.setValue('') } catch(_){} }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    await sleep(120)
    el.blur()
    await sleep(60)
    return true
  }

  async function fillAutocomplete(name, value) {
    const fc = document.querySelector('[aria-describedby="' + name + '-select"]')
    if (!fc) return false
    const openBtn = fc.querySelector('.MuiAutocomplete-popupIndicator')
    const comboInput = fc.querySelector('input[role="combobox"]')
    if (!openBtn && !comboInput) return false
    ;(openBtn || comboInput).click()
    const lb = await waitFor(() => document.querySelector('[role="listbox"]'), 1400)
    if (!lb) { await ensureClosed(); return false }

    const strVal = String(value)
    const options = Array.from(lb.querySelectorAll('[role="option"]'))
    const target = strVal
      ? (options.find(o => o.textContent.trim() === strVal) || options[0])
      : options[0]

    if (!target) { await ensureClosed(); return false }
    target.click()
    await ensureClosed()
    await sleep(delayMs + 300)
    return true
  }

  async function fillMuiSelect(name, value) {
    let trigger = null
    const namedNi = document.querySelector('.MuiSelect-nativeInput[name="' + name + '"]')
    if (namedNi) trigger = namedNi.closest('.MuiInputBase-root') && namedNi.closest('.MuiInputBase-root').querySelector('.MuiSelect-select') || null
    if (!trigger) {
      const found = findMaskSelectUnit(name)
      if (found) trigger = found.outerFc.querySelector('.MuiSelect-select') || null
    }
    if (!trigger) return false

    trigger.click()
    const lb = await waitFor(() => document.querySelector('[role="listbox"]'), 1200)
    if (!lb) { await ensureClosed(); return false }

    const strVal = String(value)
    const options = Array.from(lb.querySelectorAll('[role="option"]'))
    const target = strVal
      ? (options.find(o => o.getAttribute('data-value') === strVal || o.textContent.trim() === strVal) || options[0])
      : options[0]

    if (!target) { await ensureClosed(); return false }
    target.click()
    await ensureClosed()
    await sleep(delayMs + 200)
    return true
  }

  async function fillCheckbox(name, value) {
    const el = document.querySelector('input[type="checkbox"][name="' + name + '"]')
    if (!el) return false
    if (el.checked !== Boolean(value)) { el.click(); await sleep(80) }
    return true
  }

  async function fillCheckboxGroup(name, values) {
    const arr = Array.isArray(values) ? values : [values]
    const cbs = document.querySelectorAll('input[type="checkbox"][name="' + name + '"]')
    if (!cbs.length) return false
    for (const cb of cbs) { if (cb.checked !== arr.includes(cb.value)) { cb.click(); await sleep(60) } }
    return true
  }

  async function fillRadio(name, value) {
    const strVal = String(value)
    const all = Array.from(document.querySelectorAll('input[type="radio"][name="' + name + '"]'))
    if (!all.length) return false
    let el = all.find(r => r.value === strVal) || null
    if (!el && strVal) {
      el = all.find(function(r) {
        const lbl = document.querySelector('label[for="' + r.id + '"]') || r.closest('label')
        return lbl && lbl.textContent.trim() === strVal
      }) || null
    }
    if (!el) el = all[0]  // pick first option as fallback
    el.click(); await sleep(80)
    return true
  }

  async function fillDatePicker(name, value) {
    const strVal = String(value)

    const inp = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
    if (!inp) return false

    // ── Find the DatePicker class instance via fiber walk ─────────────────────
    let dpInstance = null
    const fk = Object.keys(inp).find(k => /^__reactFiber\$/.test(k))
    if (fk) {
      let f = inp[fk], depth = 0
      while (f && depth++ < 300) {
        if (f.stateNode &&
            typeof f.stateNode.setOpen     === 'function' &&
            typeof f.stateNode.setSelected === 'function') {
          dpInstance = f.stateNode
          break
        }
        f = f.return
      }
    }

    // ── Year-only picker (value is a 4-digit year, e.g. "2025") ──────────────
    if (/^\d{4}$/.test(strVal)) {
      const targetYear = +strVal

      // Approach A: setSelected with Jan 1 of target year
      if (dpInstance) {
        try {
          dpInstance.setSelected(new Date(targetYear, 0, 1))
          await sleep(200)
          if (inp.value.trim()) return true
        } catch (_) {}
      }

      // Approach B: open picker and click the year text cell
      const getPopper = () => {
        const p = document.querySelector('.react-datepicker-popper')
        return p && p.getBoundingClientRect().height > 0 ? p : null
      }
      if (!getPopper()) {
        if (dpInstance) { try { dpInstance.setOpen(true) } catch (_) {} await sleep(150) }
        if (!getPopper()) {
          inp.focus(); await sleep(80)
          inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          inp.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }))
          await sleep(200)
        }
      }
      const popper = await waitFor(getPopper, 1500)
      if (popper) {
        const yearEl = popper.querySelector('.react-datepicker__year-text.react-datepicker__year-' + targetYear)
                    || document.querySelector('.react-datepicker__year-text.react-datepicker__year-' + targetYear)
        if (yearEl) { yearEl.click(); await sleep(200); return true }
      }

      // Approach C: type year directly into the input
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, strVal)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(100)
      return inp.value.trim().length > 0
    }

    // ── Regular date picker (DD-MM-YYYY format) ───────────────────────────────
    const m = strVal.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/)
    if (!m) return false

    const targetDay   = +m[1]
    const targetMonth = +m[2]  // 1-12
    const targetYear  = +m[3]
    const dateObj     = new Date(targetYear, targetMonth - 1, targetDay)

    // ── Approach 1: setSelected() directly ────────────────────────────────────
    // Bypasses focus/events entirely — works inside MUI dialogs where focus-lock
    // prevents inp.focus() from reaching the datepicker. setSelected() calls
    // props.onChange(date) → RHF updates → DatePicker re-renders with formatted value.
    if (dpInstance) {
      try {
        dpInstance.setSelected(dateObj)
        await sleep(200)
        if (inp.value.trim()) return true
      } catch (_) {}
    }

    // ── Approach 2: type date string via __reactProps$.onChange ───────────────
    // Simulates typing the formatted date; react-datepicker parses it via
    // handleInputChange → setSelected internally. Falls back to this when
    // setSelected() didn't visually update (inputValue race in some versions).
    const dateStr = String(targetDay).padStart(2, '0') + '-'
                  + String(targetMonth).padStart(2, '0') + '-'
                  + String(targetYear)
    const pk = Object.keys(inp).find(k => /^__reactProps\$/.test(k))
    if (pk && typeof inp[pk].onChange === 'function') {
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeSetter.call(inp, dateStr)
        inp[pk].onChange({ target: inp, nativeEvent: new Event('change'), preventDefault() {}, stopPropagation() {} })
        await sleep(200)
        if (inp.value.trim()) return true
      } catch (_) {}
    }

    // ── Approach 3: open calendar via setOpen(true) + UI clicks ───────────────
    const getPopper = () => {
      const p = document.querySelector('.react-datepicker-popper')
      return p && p.getBoundingClientRect().height > 0 ? p : null
    }

    if (!getPopper()) {
      if (dpInstance) {
        try { dpInstance.setOpen(true) } catch (_) {}
        await sleep(120)
      } else {
        inp.focus()
        await sleep(80)
        if (!getPopper()) {
          inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          inp.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }))
          await sleep(150)
        }
      }
    }
    const popper = await waitFor(getPopper, 1500)
    if (!popper) return false
    await sleep(80)

    // ── Set Year via scrollable dropdown ──────────────────────────────────────
    const yearBtn = popper.querySelector('.react-datepicker__year-read-view')
    if (yearBtn) {
      yearBtn.click()
      await sleep(150)
      // The dropdown appends inside the calendar but may render outside the popper
      // subtree in some dialog contexts, so fall back to document scope.
      const yDrop = popper.querySelector('.react-datepicker__year-dropdown')
                 || document.querySelector('.react-datepicker__year-dropdown')
      if (yDrop) {
        const getOpt = () => Array.from(yDrop.querySelectorAll('.react-datepicker__year-option'))
          .find(el => el.textContent.trim() === String(targetYear))
        let opt = getOpt()
        const downArrow = yDrop.querySelector('.react-datepicker__year-option--years-down-arrow')
        let t = 0
        while (!opt && downArrow && t++ < 120) {
          downArrow.click()
          await sleep(25)
          opt = getOpt()
        }
        if (opt) { opt.click(); await sleep(200) }
      }
    }

    // ── Set Month via dropdown ────────────────────────────────────────────────
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const monthBtn = popper.querySelector('.react-datepicker__month-read-view')
    if (monthBtn) {
      monthBtn.click()
      await sleep(150)
      const mDrop = popper.querySelector('.react-datepicker__month-dropdown')
               || document.querySelector('.react-datepicker__month-dropdown')
      if (mDrop) {
        const mOpt = Array.from(mDrop.querySelectorAll('.react-datepicker__month-option'))
          .find(el => el.textContent.trim() === MONTHS[targetMonth - 1])
        if (mOpt) { mOpt.click(); await sleep(200) }
      }
    }

    // ── Click the target day cell ─────────────────────────────────────────────
    const dayClass = 'react-datepicker__day--' + String(targetDay).padStart(3, '0')
    const dayEl = Array.from(popper.querySelectorAll('.' + dayClass))
      .find(el => !el.classList.contains('react-datepicker__day--outside-month') &&
                  el.getAttribute('aria-disabled') !== 'true')
    if (!dayEl) return false
    dayEl.click()
    await sleep(100)
    return true
  }

  // ── dispatch ──
  const type = resolveType(name)
  if (!type) return 'not_found'
  if (ignoreDisabled && isFieldDisabled(name, type)) return 'skipped_disabled'
  if (skipOptional && isOptional) return 'skipped_optional'

  if (skipFilled) {
    function currentValueNow(n, t) {
      if (t === 'autocomplete') { const e = document.querySelector('[aria-describedby="' + n + '-select"] input[role="combobox"]'); return e ? e.value.trim() : '' }
      if (t === 'muiselect') { const ni = document.querySelector('.MuiSelect-nativeInput[name="' + n + '"]') || (findMaskSelectUnit(n) || {}).ni; return ni ? ni.value.trim() : '' }
      if (t === 'radio') { const e = document.querySelector('input[type="radio"][name="' + n + '"]:checked'); return e ? e.value : '' }
      if (t === 'checkbox' || t === 'checkbox_group') return ''  // never skip checkboxes
      const e = document.querySelector('input[name="' + n + '"]:not([aria-hidden="true"])') || document.querySelector('textarea[name="' + n + '"]')
      return e ? e.value.trim() : ''
    }
    const cur = currentValueNow(name, type)
    if (cur !== '' && cur !== false) return 'skipped_filled'
  }

  let filled = false
  if (type === 'autocomplete')        filled = await fillAutocomplete(name, value)
  else if (type === 'muiselect')      filled = await fillMuiSelect(name, value)
  else if (type === 'checkbox')       filled = await fillCheckbox(name, value)
  else if (type === 'checkbox_group') filled = await fillCheckboxGroup(name, value)
  else if (type === 'radio')          filled = await fillRadio(name, value)
  else if (type === 'datepicker')     filled = await fillDatePicker(name, value)
  else                                filled = await fillText(name, value)  // text / date / time / textarea

  return filled ? 'ok' : 'not_found'
}

// ─── Financial table fill (Neraca Keuangan / Laporan Laba Rugi) ──────────────
// Self-contained: scans AND fills in one injection so there's no coordination
// gap where React could re-render and wipe any stamped attributes.
// For Neraca Keuangan: enforces Total Aktiva = Total Pasiva.
// Strategy: detect input columns dynamically (no fixed index assumptions),
// split them into aktiva-side and pasiva-side by column midpoint,
// fill aktiva details → compute sum → distribute that exact sum across pasiva details,
// then stamp both total cells with the same sum.
async function fillTableInputsDirect() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const STEP = 1000000
  const rAmt = (mn, mx, st) => mn + Math.floor(Math.random() * Math.ceil((mx - mn) / (st || STEP))) * (st || STEP)

  function amtForLabel(lbl) {
    if (/penjualan|pendapatan usaha/.test(lbl))        return rAmt(500000000, 10000000000, 100000000)
    if (/harga pokok|hpp/.test(lbl))                   return rAmt(300000000, 7000000000, 100000000)
    if (/beban usaha|beban operasional/.test(lbl))     return rAmt(50000000, 2000000000, 50000000)
    if (/beban bunga|biaya bunga/.test(lbl))           return rAmt(5000000, 200000000, 5000000)
    if (/pajak penghasilan|pph/.test(lbl))             return rAmt(10000000, 500000000, 10000000)
    if (/depresiasi|amortisasi/.test(lbl))             return rAmt(10000000, 300000000, 10000000)
    if (/laba bersih|net profit|net income/.test(lbl)) return rAmt(50000000, 3000000000, 100000000)
    if (/laba kotor|gross profit/.test(lbl))           return rAmt(100000000, 4000000000, 100000000)
    if (/laba/.test(lbl))                              return rAmt(50000000, 2000000000, 100000000)
    if (/kas/.test(lbl))                               return rAmt(100000000, 2000000000, 50000000)
    if (/piutang/.test(lbl))                           return rAmt(50000000, 1500000000, 50000000)
    if (/persediaan/.test(lbl))                        return rAmt(100000000, 3000000000, 100000000)
    if (/investasi/.test(lbl))                         return rAmt(50000000, 500000000, 50000000)
    if (/tanah|bangunan|kendaraan|properti/.test(lbl)) return rAmt(200000000, 5000000000, 100000000)
    if (/aktiva tetap|aset tetap/.test(lbl))           return rAmt(200000000, 5000000000, 100000000)
    if (/hutang bank|utang bank/.test(lbl))            return rAmt(100000000, 3000000000, 100000000)
    if (/hutang dagang|utang usaha/.test(lbl))         return rAmt(50000000, 1000000000, 50000000)
    if (/hutang pajak|utang pajak/.test(lbl))          return rAmt(10000000, 200000000, 10000000)
    if (/modal disetor/.test(lbl))                     return rAmt(500000000, 5000000000, 500000000)
    return rAmt(10000000, 500000000, 10000000)
  }

  // Split `total` into n positive multiples of STEP that sum exactly to `total`.
  function distribute(total, n) {
    if (n <= 0) return []
    if (n === 1) return [total]
    const out = []
    let rem = total
    for (let i = 0; i < n - 1; i++) {
      const leave = (n - 1 - i) * STEP            // reserve at least STEP for each remaining slot
      const cap   = Math.floor((rem - leave) / STEP) * STEP
      const share = Math.max(STEP, Math.floor(Math.random() * (cap / STEP)) * STEP || STEP)
      out.push(Math.min(share, cap))
      rem -= out[out.length - 1]
    }
    out.push(Math.max(STEP, rem))
    return out
  }

  const modalEl = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
  const root = modalEl ? (document.querySelector('.MuiDialog-paper') || document) : document
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

  function getInp(cell) {
    const el = cell.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
    if (!el || el.disabled || el.readOnly) return null
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return null
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return null
    return el
  }

  function fillInp(inp, numVal) {
    inp.focus()
    setter.call(inp, String(numVal))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
  }

  let filled = 0

  for (const tbl of root.querySelectorAll('table')) {
    const tblText = tbl.textContent.toLowerCase()
    const isNeraca = /aktiva/.test(tblText) && /pasiva/.test(tblText)

    if (isNeraca) {
      // ── Neraca Keuangan: balanced fill ──────────────────────────────────────
      //
      // Approach: enumerate ALL (colIndex, inp, labelText) tuples from every row.
      // Split inputs into aktiva-side vs pasiva-side by the column midpoint —
      // no hardcoded column assumptions.  Within each side, any row whose label
      // contains "total" or "jumlah" is a total row; everything else is a detail.
      // Fallback: if no total label found on a side, treat the last input as total.
      //
      // Guarantee: sum(aktiva details) is computed, distributed across pasiva details,
      // then BOTH total cells are stamped with that same sum → Total Aktiva = Total Pasiva.

      // Step 1 — collect every input with its column index and nearest preceding label
      const all = []  // { col, inp, lbl }
      for (const row of tbl.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('td, th'))
        for (let ci = 0; ci < cells.length; ci++) {
          const inp = getInp(cells[ci])
          if (!inp) continue
          let lbl = ''
          for (let li = ci - 1; li >= 0; li--) {
            const t = cells[li].textContent.trim()
            if (t) { lbl = t; break }
          }
          all.push({ col: ci, inp, lbl })
        }
      }
      if (!all.length) continue

      // Step 2 — split by column midpoint
      const uniqueCols = [...new Set(all.map(x => x.col))].sort((a, b) => a - b)
      const mid = uniqueCols[Math.floor(uniqueCols.length / 2)]
      const aktivaAll = all.filter(x => x.col < mid)
      const pasivaAll = all.filter(x => x.col >= mid)

      // Step 3 — separate detail rows from total rows within each side
      const isTotalLbl = lbl => /\b(total|jumlah)\b/i.test(lbl)

      function splitSide(side) {
        let details = side.filter(x => !isTotalLbl(x.lbl))
        let totals  = side.filter(x =>  isTotalLbl(x.lbl))
        // Fallback: no total label found → treat the LAST input as the total
        if (!totals.length && details.length) {
          totals = [details[details.length - 1]]
          details = details.slice(0, -1)
        }
        return { details, totals }
      }

      const { details: aktivaDetails, totals: aktivaTotals } = splitSide(aktivaAll)
      const { details: pasivaDetails, totals: pasivaTotals } = splitSide(pasivaAll)

      // Step 4 — fill aktiva details, sum them
      let aktivaSum = 0
      for (const { inp, lbl } of aktivaDetails) {
        const v = amtForLabel(lbl.toLowerCase())
        fillInp(inp, v)
        aktivaSum += v
        filled++
        await sleep(25)
      }

      // Step 5 — distribute aktivaSum across pasiva details so their sum = aktivaSum
      const pasivaAmts = distribute(aktivaSum, pasivaDetails.length)
      for (let i = 0; i < pasivaDetails.length; i++) {
        fillInp(pasivaDetails[i].inp, pasivaAmts[i])
        filled++
        await sleep(25)
      }

      // Step 6 — stamp BOTH total cells with aktivaSum (guaranteed equal)
      for (const { inp } of aktivaTotals) { fillInp(inp, aktivaSum); filled++ }
      for (const { inp } of pasivaTotals) { fillInp(inp, aktivaSum); filled++ }
      await sleep(50)

    } else {
      // ── Other financial tables (Laporan Laba Rugi, etc.) ────────────────────
      for (const row of tbl.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('td'))
        for (let ci = 0; ci < cells.length; ci++) {
          const inp = getInp(cells[ci])
          if (!inp) continue
          let lbl = ''
          for (let li = ci - 1; li >= 0; li--) {
            const t = cells[li].textContent.trim()
            if (t) { lbl = t; break }
          }
          fillInp(inp, amtForLabel(lbl.toLowerCase()))
          filled++
          await sleep(25)
        }
      }
    }
  }

  return filled
}

// ─── Page-context read-values function ───────────────────────────────────────
// Reads current form field values without opening any dropdowns.
function pageReadFieldValues(fieldNames) {
  function getFiberFieldName(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 100) {
      const p = f.memoizedProps
      if (p && p.name && p.control && typeof p.name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(p.name)) return p.name
      f = f.return
    }
    return null
  }

  function findMaskSelectUnit(name) {
    for (const fc of document.querySelectorAll('[aria-describedby$="-maskselect-helper"]')) {
      const ni = fc.querySelector('.MuiSelect-nativeInput')
      if (!ni) continue
      const sn = ni.getAttribute('data-autofill-name') || getFiberFieldName(ni)
      if (sn === name) return { outerFc: fc, ni }
    }
    return null
  }

  function resolveType(name) {
    if (document.querySelector('input[type="checkbox"][name="' + name + '"]'))
      return document.querySelectorAll('input[type="checkbox"][name="' + name + '"]').length > 1 ? 'checkbox_group' : 'checkbox'
    if (document.querySelector('input[type="radio"][name="' + name + '"]')) return 'radio'
    if (document.querySelector('textarea[name="' + name + '"]')) return 'textarea'
    if (document.querySelector('[aria-describedby="' + name + '-select"]')) return 'autocomplete'
    if (document.querySelector('.MuiSelect-nativeInput[name="' + name + '"]')) return 'muiselect'
    if (findMaskSelectUnit(name)) return 'muiselect'
    const inp = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
    if (!inp) return null
    if (inp.closest('.react-datepicker__input-container')) return 'datepicker'
    if (inp.type === 'date') return 'date'
    if (inp.type === 'time') return 'time'
    return 'text'
  }

  function currentValue(name, type) {
    if (type === 'checkbox') { const el = document.querySelector('input[type="checkbox"][name="' + name + '"]'); return el ? el.checked : false }
    if (type === 'checkbox_group') return Array.from(document.querySelectorAll('input[type="checkbox"][name="' + name + '"]:checked')).map(c => c.value)
    if (type === 'radio') { const el = document.querySelector('input[type="radio"][name="' + name + '"]:checked'); return el ? el.value : '' }
    if (type === 'autocomplete') { const el = document.querySelector('[aria-describedby="' + name + '-select"] input[role="combobox"]'); return el ? el.value : '' }
    if (type === 'muiselect') {
      const ni = document.querySelector('.MuiSelect-nativeInput[name="' + name + '"]') || (findMaskSelectUnit(name) || {}).ni
      return ni ? ni.value : ''
    }
    // text, datepicker, date, time, textarea — all read from DOM input value
    const el = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])') || document.querySelector('textarea[name="' + name + '"]')
    return el ? el.value : ''
  }

  const result = {}
  for (const name of fieldNames) {
    const type = resolveType(name)
    result[name] = type ? currentValue(name, type) : ''
  }
  return result
}

// ─── Step 1: Detect ───────────────────────────────────────────────────────────
let lastDetectedFields = []
let lastDetectedFieldsByStep = []   // [{stepIdx, fields}] — set during all-steps scan

// Page-context helper: returns the active wizard step index (skin="filled" avatar).
// Returns -1 when a modal dialog is open so the scan loop treats the modal as
// a single-step form and doesn't try to navigate the main wizard behind it.
function getCurrentStepIndex() {
  const modal = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
  if (modal) return -1

  for (const el of document.querySelectorAll('[data-step-index]')) {
    if (el.querySelector('[skin="filled"]')) {
      const idx = parseInt(el.getAttribute('data-step-index'), 10)
      if (!isNaN(idx)) return idx
    }
  }
  const active = document.querySelector('.MuiStep-root.Mui-active')
  if (active) {
    const el = active.closest('[data-step-index]')
    if (el) { const idx = parseInt(el.getAttribute('data-step-index'), 10); if (!isNaN(idx)) return idx }
  }
  return 0
}

// Page-context helper: click the step label at the given index.
function goToWizardStep(idx) {
  const label = document.querySelector('[data-step-index="' + idx + '"] .MuiStepLabel-root')
  if (label) { label.click(); return true }
  return false
}

detectBtn.addEventListener('click', async () => {
  detectBtn.disabled = true
  executeBtn.disabled = true
  buildJsonBtn.disabled = true
  lastDetectedFields = []
  lastDetectedFieldsByStep = []

  try {
    const tab = await getActiveTab()

    if (allStepsCb.checked) {
      // ── Scan all wizard steps ──────────────────────────────────────────────
      let prevStepIdx = null

      for (let s = 0; s < 20; s++) {
        detectBtn.textContent = s === 0 ? '⏳…' : `Scan ${s + 1}…`

        const [{ result: stepIdx }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: getCurrentStepIndex
        })
        if (prevStepIdx !== null && stepIdx === prevStepIdx) break
        prevStepIdx = stepIdx

        const [{ result: fields }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: pageDetect
        })
        if (fields && fields.length) {
          lastDetectedFieldsByStep.push({ stepIdx, fields })
          for (const f of fields) {
            if (!lastDetectedFields.some(x => x.name === f.name)) lastDetectedFields.push(f)
          }
        }

        const [{ result: adv }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: advanceWizardStep
        })
        if (adv !== 'clicked') break

        await sleep(800)
      }
    } else {
      // ── Scan current step only ─────────────────────────────────────────────
      const [{ result: fields }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: pageDetect
      })
      lastDetectedFields = fields || []
    }

    renderFieldsPanel(lastDetectedFields)

    const disabledCount = lastDetectedFields.filter(f => f.disabled).length
    const stepInfo = lastDetectedFieldsByStep.length > 1 ? ` · ${lastDetectedFieldsByStep.length} steps` : ''
    fieldCount.textContent = `${lastDetectedFields.length} fields${stepInfo}${disabledCount > 0 ? ` (${disabledCount} disabled)` : ''}`

    executeBtn.disabled = lastDetectedFields.length === 0
    buildJsonBtn.disabled = lastDetectedFields.length === 0
    markStepDone(1)
    setStepActive(2)
    showToast(`Detected ${lastDetectedFields.length} fields${stepInfo}`, '#4f46e5')
  } catch (e) {
    showToast('Detect failed: ' + e.message, '#dc2626')
  } finally {
    detectBtn.disabled = false
    detectBtn.textContent = 'Scan'
  }
})

// ─── Step 2: Execute ──────────────────────────────────────────────────────────
executeBtn.addEventListener('click', async () => {
  if (!lastDetectedFields.length) { showToast('Scan the page first (step 1)', '#dc2626'); return }

  const delayMs        = Math.max(50, parseInt(delayInput.value, 10) || 300)
  const ignoreDisabled = ignoreDisabledCb.checked
  const skipFilled     = skipFilledCb.checked
  const skipOptional   = skipOptionalCb.checked

  // Use JSON editor if user has pasted values, else compute smart defaults
  let data = parseJSON()
  if (!data) {
    data = {}
    for (const f of lastDetectedFields) {
      data[f.name] = smartDefault(f.name, f.label, f.type, f.options)
    }
  }

  const detectedNames = lastDetectedFields.map(f => f.name)
  const inOrder    = lastDetectedFields.map(f => [f.name, data[f.name] ?? smartDefault(f.name, f.label, f.type, f.options)])
  const extra      = Object.entries(data).filter(([n]) => !detectedNames.includes(n))
  const fieldOrder = [...inOrder, ...extra]

  const prevExportDisabled = exportBtn.disabled
  const lockUI = () => {
    detectBtn.disabled = true
    quickFillBtn.disabled = true
    allStepsCb.disabled = true
    executeBtn.disabled = true
    buildJsonBtn.disabled = true
    exportBtn.disabled = true
    delayInput.disabled = true
    ignoreDisabledCb.disabled = true
    skipFilledCb.disabled = true
    skipOptionalCb.disabled = true
  }
  const unlockUI = () => {
    detectBtn.disabled = false
    quickFillBtn.disabled = false
    allStepsCb.disabled = false
    executeBtn.disabled = false
    delayInput.disabled = false
    ignoreDisabledCb.disabled = false
    skipFilledCb.disabled = false
    skipOptionalCb.disabled = false
    exportBtn.disabled = prevExportDisabled
    // buildJsonBtn is managed separately below
  }

  lockUI()
  executeBtn.textContent = '⏳…'
  resultStrip.classList.add('hidden')
  progressWrap.classList.remove('hidden')
  progressFill.style.width = '0%'
  progressLabel.textContent = 'Starting…'

  const results = {}
  let tab
  try { tab = await getActiveTab() }
  catch (e) {
    showToast('Cannot get tab: ' + e.message, '#dc2626')
    unlockUI()
    executeBtn.textContent = '▶ Run'
    progressWrap.classList.add('hidden')
    return
  }

  if (lastDetectedFieldsByStep.length > 0) {
    // ── Multi-step execute: navigate step-by-step ──────────────────────────
    // Go back to the first scanned step before filling.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: goToWizardStep, args: [lastDetectedFieldsByStep[0].stepIdx]
    })
    await sleep(800)

    const totalFields = lastDetectedFields.length
    let filled = 0

    for (let s = 0; s < lastDetectedFieldsByStep.length; s++) {
      const { stepIdx, fields: stepFields } = lastDetectedFieldsByStep[s]
      const stepLabel = `Step ${stepIdx + 1}/${lastDetectedFieldsByStep[lastDetectedFieldsByStep.length - 1].stepIdx + 1}`

      for (let i = 0; i < stepFields.length; i++) {
        const f = stepFields[i]
        const value = data[f.name] ?? smartDefault(f.name, f.label, f.type, f.options)
        const isOptional = !!f.optional

        progressFill.style.width = Math.round((filled / totalFields) * 100) + '%'
        progressLabel.textContent = `${stepLabel}  (${i + 1}/${stepFields.length})  ${f.name}…`

        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN',
            func: fillSingleField,
            args: [f.name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, isOptional]
          })
          results[f.name] = result || 'error'
        } catch (e) {
          results[f.name] = 'error'
        }

        filled++
        if (i < stepFields.length - 1) await sleep(delayMs)
      }

      // Advance to next step unless this is the last
      if (s < lastDetectedFieldsByStep.length - 1) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: advanceWizardStep
        })
        await sleep(800)
      }
    }

    // Return to the first step after all filling is done
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: goToWizardStep, args: [lastDetectedFieldsByStep[0].stepIdx]
    })
    await sleep(400)
  } else {
    // ── Single-step execute ────────────────────────────────────────────────
    for (let i = 0; i < fieldOrder.length; i++) {
      const [name, value] = fieldOrder[i]
      const pct = Math.round((i / fieldOrder.length) * 100)
      progressFill.style.width = pct + '%'
      progressLabel.textContent = `(${i + 1}/${fieldOrder.length})  ${name}…`

      const fieldMeta = lastDetectedFields.find(f => f.name === name)
      const isOptional = fieldMeta ? !!fieldMeta.optional : true

      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: fillSingleField,
          args: [name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, isOptional]
        })
        results[name] = result || 'error'
      } catch (e) {
        results[name] = 'error'
      }

      if (i < fieldOrder.length - 1) await sleep(delayMs)
    }
  }

  // Fill any financial table inputs (Neraca Keuangan / Laporan Laba Rugi) that
  // regular field scan misses because those inputs carry no name attribute.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: fillTableInputsDirect
    })
  } catch (_) { /* non-fatal — table fill is best-effort */ }

  progressFill.style.width = '100%'
  progressLabel.textContent = 'Done'
  await sleep(300)
  progressWrap.classList.add('hidden')

  lastResults = { ...results }
  renderResults(results)
  markStepDone(2)
  setStepActive(3)
  buildJsonBtn.disabled = false

  const vals         = Object.values(results)
  const ok           = vals.filter(v => v === 'ok').length
  const skipDis      = vals.filter(v => v === 'skipped_disabled').length
  const skipFilledCt = vals.filter(v => v === 'skipped_filled').length
  const skipOptCt    = vals.filter(v => v === 'skipped_optional').length
  const skipped      = skipDis + skipFilledCt + skipOptCt
  const err          = vals.length - ok - skipped

  if      (err === 0 && skipped === 0) showToast(`✓ ${ok} fields filled`, '#059669')
  else if (err === 0)                  showToast(`✓ ${ok} filled · ${skipped} skipped`, '#059669')
  else                                 showToast(`${ok} ok · ${skipped} skip · ${err} not found`, '#d97706')

  unlockUI()
  executeBtn.textContent = '▶ Run'
})

// ─── Step 3: Capture JSON ─────────────────────────────────────────────────────
buildJsonBtn.addEventListener('click', async () => {
  if (!lastDetectedFields.length) { showToast('Scan the page first (step 1)', '#dc2626'); return }

  buildJsonBtn.disabled = true
  buildJsonBtn.textContent = '⏳…'

  try {
    const tab = await getActiveTab()
    const [{ result: values }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageReadFieldValues,
      args: [lastDetectedFields.map(f => f.name)]
    })

    const json = {}
    for (const f of lastDetectedFields) {
      json[f.name] = values[f.name] ?? ''
    }
    jsonInput.value = prettyJSON(json)
    markStepDone(3)
    showToast('JSON captured from current form state', '#059669')
  } catch (e) {
    showToast('Capture failed: ' + e.message, '#dc2626')
  } finally {
    buildJsonBtn.disabled = false
    buildJsonBtn.textContent = 'Capture'
  }
})

// ─── Fields panel ─────────────────────────────────────────────────────────────
function renderFieldsPanel(fields) {
  fieldsList.innerHTML = ''
  if (!fields.length) {
    fieldsList.innerHTML = '<p style="padding:8px 10px;color:#9ca3af;font-size:12px">No fields found.</p>'
    fieldsPanel.classList.remove('hidden')
    return
  }

  function appendField(f) {
    const row = document.createElement('div')
    row.className = 'field-row' + (f.disabled ? ' field-disabled' : '')
    row.title = f.disabled ? `[DISABLED] ${f.name}` : `Click to add "${f.name}" to JSON`
    const typeBadge  = f.disabled
      ? `<span class="field-type type-disabled">disabled</span>`
      : `<span class="field-type">${escHtml(f.type)}</span>`
    const optionHint = f.options && f.options.length ? `<span class="field-opts">${f.options.length} opts</span>` : ''
    row.innerHTML = `
      <div class="field-row-top">
        <span class="field-name">${escHtml(f.name)}</span>
        <span class="field-insert">＋</span>
      </div>
      <div class="field-row-bot">
        ${typeBadge}
        ${f.label ? `<span class="field-label" title="${escHtml(f.label)}">${escHtml(f.label)}</span>` : ''}
        ${optionHint}
      </div>
    `
    row.addEventListener('click', () => { if (!f.disabled) insertFieldIntoJSON(f) })
    fieldsList.appendChild(row)
  }

  if (lastDetectedFieldsByStep.length > 1) {
    // Render fields grouped by step with a sticky step header between each
    for (const { stepIdx, fields: stepFields } of lastDetectedFieldsByStep) {
      const header = document.createElement('div')
      header.className = 'step-group-header'
      header.textContent = `Step ${stepIdx + 1}  ·  ${stepFields.length} field${stepFields.length !== 1 ? 's' : ''}`
      fieldsList.appendChild(header)
      for (const f of stepFields) appendField(f)
    }
  } else {
    for (const f of fields) appendField(f)
  }

  fieldsPanel.classList.remove('hidden')
}

function insertFieldIntoJSON(field) {
  let current = {}
  try { current = JSON.parse(jsonInput.value.trim()) } catch { current = {} }
  if (!(field.name in current)) {
    current[field.name] = smartDefault(field.name, field.label, field.type, field.options)
  }
  jsonInput.value = prettyJSON(current)
  showToast(`+ "${field.name}" added`)
}

closeFieldsBtn.addEventListener('click', () => fieldsPanel.classList.add('hidden'))

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Export ───────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  const text = jsonInput.value.trim()
  if (!text) { showToast('JSON editor is empty', '#d97706'); return }
  try {
    await navigator.clipboard.writeText(text)
    showToast('JSON copied to clipboard', '#059669')
  } catch {
    showToast('Failed to copy clipboard', '#dc2626')
  }
})

// ─── Results ──────────────────────────────────────────────────────────────────
function renderResults(results) {
  resultStrip.innerHTML = ''
  resultStrip.classList.remove('hidden')

  const entries    = Object.entries(results)
  const ok         = entries.filter(([, v]) => v === 'ok').length
  const skipDis    = entries.filter(([, v]) => v === 'skipped_disabled').length
  const skipFilled = entries.filter(([, v]) => v === 'skipped_filled').length
  const skipOpt    = entries.filter(([, v]) => v === 'skipped_optional').length
  const totalSkip  = skipDis + skipFilled + skipOpt

  const summary = document.createElement('span')
  summary.className = 'badge badge-summary'
  summary.textContent = `${ok} filled · ${totalSkip} skipped · ${entries.length - ok - totalSkip} failed`
  resultStrip.appendChild(summary)

  function makeRow(name, status) {
    const META = {
      ok:               { cls: 'result-ok',   icon: '✓', label: '' },
      skipped_disabled: { cls: 'result-skip', icon: '—', label: 'disabled' },
      skipped_filled:   { cls: 'result-skip', icon: '·', label: 'filled' },
      skipped_optional: { cls: 'result-skip', icon: '○', label: 'optional' },
    }
    const m = META[status] || { cls: 'result-err', icon: '✗', label: 'not found' }
    const fieldMeta = lastDetectedFields.find(f => f.name === name)
    const row = document.createElement('div')
    row.className = `result-row ${m.cls}`
    row.title = name
    row.innerHTML = `
      <span class="result-icon">${m.icon}</span>
      <span class="result-name">${escHtml(name)}</span>
      ${fieldMeta && fieldMeta.label
        ? `<span class="result-label" title="${escHtml(fieldMeta.label)}">${escHtml(fieldMeta.label.replace(/\*$/, '').trim())}</span>`
        : m.label ? `<span class="result-label">${m.label}</span>` : ''}
    `
    return row
  }

  if (lastDetectedFieldsByStep.length > 1) {
    // Group results by step with sticky headers
    for (const { stepIdx, fields: stepFields } of lastDetectedFieldsByStep) {
      const header = document.createElement('div')
      header.className = 'step-group-header'
      const stepOk = stepFields.filter(f => results[f.name] === 'ok').length
      header.textContent = `Step ${stepIdx + 1}  ·  ${stepOk}/${stepFields.length} filled`
      resultStrip.appendChild(header)
      for (const f of stepFields) {
        if (results[f.name] !== undefined) resultStrip.appendChild(makeRow(f.name, results[f.name]))
      }
    }
  } else {
    for (const [name, status] of entries) resultStrip.appendChild(makeRow(name, status))
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setStepActive(1)

// ── Persist checkbox prefs ────────────────────────────────────────────────────
;(async () => {
  const prefs = await chrome.storage.local.get(['pref_allSteps', 'pref_doubleCheck', 'pref_ignoreDisabled', 'pref_skipFilled', 'pref_skipOptional'])
  if (prefs.pref_allSteps      !== undefined) allStepsCb.checked      = prefs.pref_allSteps
  if (prefs.pref_doubleCheck   !== undefined) doubleCheckCb.checked   = prefs.pref_doubleCheck
  if (prefs.pref_ignoreDisabled !== undefined) ignoreDisabledCb.checked = prefs.pref_ignoreDisabled
  if (prefs.pref_skipFilled    !== undefined) skipFilledCb.checked    = prefs.pref_skipFilled
  if (prefs.pref_skipOptional  !== undefined) skipOptionalCb.checked  = prefs.pref_skipOptional
})()

allStepsCb.addEventListener('change',      () => chrome.storage.local.set({ pref_allSteps:      allStepsCb.checked }))
doubleCheckCb.addEventListener('change',   () => chrome.storage.local.set({ pref_doubleCheck:   doubleCheckCb.checked }))
ignoreDisabledCb.addEventListener('change', () => chrome.storage.local.set({ pref_ignoreDisabled: ignoreDisabledCb.checked }))
skipFilledCb.addEventListener('change',    () => chrome.storage.local.set({ pref_skipFilled:    skipFilledCb.checked }))
skipOptionalCb.addEventListener('change',  () => chrome.storage.local.set({ pref_skipOptional:  skipOptionalCb.checked }))

// ─── Wizard step advancement (runs in page MAIN world) ───────────────────────
// Strategy 1: look for an explicit Next/Continue button by text.
// Strategy 2: MUI CustomFormWizard — steps are navigated by clicking the next
//   step's MuiStepLabel-root. Active step is identified by its avatar having
//   the attribute skin="filled"; inactive steps have skin="light".
// Returns 'clicked' or 'no_next'.
function advanceWizardStep() {
  // When a modal is open, don't touch the main wizard stepper behind it.
  const modal = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
  if (modal) return 'no_next'

  // ── Strategy 1: explicit Next button ──────────────────────────────────────
  const NEXT_RE = /\b(selanjutnya|lanjutkan|lanjut|berikutnya|next|continue|proceed)\b/i
  const buttons = Array.from(document.querySelectorAll('button:not([disabled])'))
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim()
    if (NEXT_RE.test(text) && text.length < 40) { btn.click(); return 'clicked' }
  }
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').trim()
    if (NEXT_RE.test(label)) { btn.click(); return 'clicked' }
  }

  // ── Strategy 2: MUI Stepper label click ───────────────────────────────────
  const allSteps = Array.from(document.querySelectorAll('[data-step-index]'))
  if (!allSteps.length) return 'no_next'

  // Active step: its avatar has skin="filled"; all others have skin="light".
  let currentIdx = -1
  for (const step of allSteps) {
    if (step.querySelector('[skin="filled"]')) {
      const idx = parseInt(step.getAttribute('data-step-index'), 10)
      if (!isNaN(idx)) { currentIdx = idx; break }
    }
  }
  // Fallback: MUI's own Mui-active class on the step container
  if (currentIdx === -1) {
    const active = document.querySelector('.MuiStep-root.Mui-active, [data-step-index].Mui-active')
    if (active) {
      const el = active.closest('[data-step-index]') || active
      const idx = parseInt(el.getAttribute('data-step-index'), 10)
      if (!isNaN(idx)) currentIdx = idx
    }
  }
  if (currentIdx === -1) return 'no_next'

  const nextLabel = document.querySelector('[data-step-index="' + (currentIdx + 1) + '"] .MuiStepLabel-root')
  if (!nextLabel) return 'no_next'  // already on last step

  nextLabel.click()
  return 'clicked'
}

// ─── Quick Fill orchestrator ──────────────────────────────────────────────────
// Clicks Scan then Execute. The detect handler handles all-steps scanning;
// the execute handler handles per-step filling. No manual step loop needed here.
async function runAllWizardSteps({ onStep } = {}) {
  const waitEnabled = (btn, ms) => new Promise(resolve => {
    const t = setInterval(() => { if (!btn.disabled) { clearInterval(t); resolve() } }, 150)
    setTimeout(() => { clearInterval(t); resolve() }, ms)
  })

  if (onStep) onStep('Scanning…')
  detectBtn.click()
  // All-steps scan visits every step (~800ms each); allow up to 60s for 20 steps.
  await waitEnabled(executeBtn, 60000)
  if (executeBtn.disabled) return lastResults

  if (onStep) onStep('Filling…')
  await sleep(150)
  executeBtn.click()
  await sleep(300)
  // Per-step execution with navigation; allow up to 5 min total.
  await waitEnabled(executeBtn, 300000)

  // ── Double-check loop ─────────────────────────────────────────────────────
  // Re-scan after each fill pass. If new conditional fields appeared, fill them
  // (with skipFilled forced on so already-filled fields are left alone).
  // Repeat until no new fields appear, or after 5 extra passes as a safety cap.
  if (doubleCheckCb.checked) {
    for (let pass = 1; pass <= 5; pass++) {
      const prevNames = new Set(lastDetectedFields.map(f => f.name))

      if (onStep) onStep(`Re-scan ${pass}…`)
      detectBtn.click()
      await sleep(400)  // let lockUI fire before polling
      await waitEnabled(executeBtn, 60000)

      const newFields = lastDetectedFields.filter(f => !prevNames.has(f.name))
      if (!newFields.length) break

      if (onStep) onStep(`Fill pass ${pass + 1}…`)
      const wasSkipFilled = skipFilledCb.checked
      skipFilledCb.checked = true
      await sleep(150)
      executeBtn.click()
      await sleep(300)
      await waitEnabled(executeBtn, 300000)
      skipFilledCb.checked = wasSkipFilled
    }
  }

  return lastResults
}

// ── Quick Fill button ─────────────────────────────────────────────────────────
const quickFillBtn = document.getElementById('quickFillBtn')
quickFillBtn.addEventListener('click', async () => {
  quickFillBtn.disabled = true
  try {
    await runAllWizardSteps({
      onStep: n => { quickFillBtn.textContent = `Step ${n}…` }
    })
  } finally {
    quickFillBtn.disabled = false
    quickFillBtn.textContent = '⚡ Quick Fill'
  }
})

// ── On-open behaviour toggle ──────────────────────────────────────────────────
const onOpenQuickFill = document.getElementById('onOpenQuickFill')
const onOpenPopup     = document.getElementById('onOpenPopup')

;(async () => {
  const { pref_onOpen } = await chrome.storage.local.get('pref_onOpen')
  if (pref_onOpen === 'popup') onOpenPopup.checked = true
  else onOpenQuickFill.checked = true
})()

document.querySelectorAll('input[name="onOpen"]').forEach(r => {
  r.addEventListener('change', () => chrome.storage.local.set({ pref_onOpen: r.value }))
})

// ── Auto-run on popup open ────────────────────────────────────────────────────
// If the user chose "Quick Fill", auto-run the wizard loop and close when done.
// If they chose "Open Popup", just show the panel for manual use.
;(async () => {
  const { pref_onOpen } = await chrome.storage.local.get('pref_onOpen')
  if (pref_onOpen === 'popup') return

  await sleep(300)
  await runAllWizardSteps()
  await sleep(900)
  window.close()
})()
