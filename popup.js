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

/**
 * The inter-field delay, in ms. Persisted, and quantised to whole hundreds with
 * a floor of 100.
 *
 * 100 is a floor rather than a suggestion: below it the app has not finished
 * re-rendering between fields, and a cascade select reads its options from the
 * previous state — which shows up as an intermittent wrong value rather than an
 * error, so it is the worst kind of failure to allow by accident.
 *
 * Read this instead of `delayInput.value` anywhere a delay is needed; the input
 * can hold anything a user types until it is committed.
 */
const DELAY_MIN = 100
const DELAY_STEP = 100
const DELAY_DEFAULT = 200

const readDelay = () => {
  const raw = parseInt(delayInput.value, 10)
  if (!Number.isFinite(raw)) return DELAY_DEFAULT
  return Math.max(DELAY_MIN, Math.round(raw / DELAY_STEP) * DELAY_STEP)
}

const commitDelay = () => {
  const value = readDelay()
  delayInput.value = String(value)
  chrome.storage.local.set({ pref_delay: value })
  return value
}

;(async () => {
  const { pref_delay } = await chrome.storage.local.get('pref_delay')
  delayInput.value = String(
    Number.isFinite(pref_delay) ? Math.max(DELAY_MIN, pref_delay) : DELAY_DEFAULT
  )
})()

/* `change` rather than `input`: quantising mid-typing fights the user, turning
   "1" into "100" before they can type the rest. */
delayInput.addEventListener('change', commitDelay)

const detectModalCb = document.getElementById('detectModalCb')
const fillModalCb   = document.getElementById('fillModalCb')
const statusBar      = document.getElementById('statusBar')
const statusText     = document.getElementById('statusText')

/**
 * How far a run reaches into the "Tambah …" record modals:
 * 'page' | 'detect' | 'fill'.
 *
 * Two independent checkboxes rather than one control, because they answer
 * different questions: Detect READS (opens a modal, counts its fields, closes
 * it, writes nothing) and Fill WRITES (fills and saves the record). Fill
 * implies Detect — you cannot fill what you have not read — so Fill wins when
 * both are ticked, and neither means page fields only.
 *
 * Fill is the default: a page-only run is the one that silently under-reports,
 * because v1Detect scopes itself to an open dialog and nothing else opens one.
 * On the v1 credit application that is 84 fields versus 179.
 */
const currentScope = () => {
  if (fillModalCb && fillModalCb.checked) return 'fill'
  if (detectModalCb && detectModalCb.checked) return 'detect'
  return 'page'
}

/**
 * The run's own status line.
 *
 * Kept off the Quick Fill button deliberately. Overwriting the button's label
 * with "Step 3…" hid what the control does, resized it mid-run, and left the
 * final phase showing after the run had finished (user, 2026-08-11).
 */
const setStatus = (text, state) => {
  if (!statusBar || !statusText) return
  if (!text) { statusBar.hidden = true; return }
  statusBar.hidden = false
  statusBar.classList.toggle('is-done', state === 'done')
  statusBar.classList.toggle('is-error', state === 'error')
  statusText.textContent = text
}
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
const variantSel       = document.getElementById('variantSel')
const variantHint      = document.getElementById('variantHint')

// ─── Driver selection ─────────────────────────────────────────────────────────
// 'auto' probes the page; 'v1'/'v2' force a dialect. Forcing matters during the
// migration: a v2 route hosting a legacy MUI modal probes as v2, and the v1
// driver is the one that can actually read that modal.
let variantPref = 'auto'      // persisted as pref_variant
let activeVariant = null      // what the last resolve() actually settled on

async function resolveDriver() {
  // Read the pref here rather than trusting module state: the popup can
  // auto-run Quick Fill on open, which would otherwise race the pref load and
  // silently use the wrong driver on the first run after a restart.
  const { pref_variant } = await chrome.storage.local.get('pref_variant')
  variantPref = pref_variant || 'auto'
  if (variantSel) variantSel.value = variantPref

  if (variantPref !== 'auto') {
    activeVariant = variantPref
    return DRIVERS[variantPref]
  }
  const tab = await getActiveTab()
  let found = null
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: pageVariant
    })
    found = result
  } catch (_) { /* injection blocked (chrome:// page, etc.) — fall through */ }

  // Neither dialect recognised: default to v1 rather than refusing to run, but
  // say so, since a wrong guess produces "0 fields" and no other explanation.
  activeVariant = found || 'v1'
  return DRIVERS[activeVariant]
}

function renderVariantHint() {
  if (!variantHint) return
  if (variantPref === 'auto') {
    variantHint.textContent = activeVariant ? `auto → ${DRIVERS[activeVariant].label}` : 'auto'
  } else {
    variantHint.textContent = 'forced'
  }
}

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

/**
 * `_PICK` ROTATES through its list rather than picking at random.
 *
 * Random picking repeats: filling four record modals in one run routinely gave
 * the same shareholder name three times, and a fixture where every person is
 * "Budi Santoso" is a poor test of anything that groups, sorts or de-duplicates.
 * Rotation guarantees each successive call to the SAME list yields the next
 * entry, so a run walking eight modals produces eight distinct people.
 *
 * Keyed by the list's CONTENT, not its identity, because most rules build their
 * array inline (`_PICK(['PT Maju Sejahtera', …])`) — a fresh array object every
 * call, so a WeakMap keyed on the object would reset to index 0 every time and
 * silently never rotate at all.
 *
 * State is per page-load. Values stay deterministic within a run, which also
 * makes a failed run easier to reproduce than random ever was.
 */
const _ROT_STATE = new Map()

const _PICK = arr => {
  if (!Array.isArray(arr) || !arr.length) return ''
  const key = arr.join('')
  const i = _ROT_STATE.get(key) || 0
  _ROT_STATE.set(key, i + 1)
  return arr[i % arr.length]
}

/** Reset every rotation counter — call between independent fixture runs. */
const _PICK_RESET = () => _ROT_STATE.clear()
const _RAMT = (mn, mx, step = 1000000) => String(mn + Math.floor(Math.random() * Math.ceil((mx - mn) / step)) * step)
const _RD2  = () => String(Math.floor(Math.random() * 90) + 10)  // 2-digit random
const _R6   = () => String(Math.floor(Math.random() * 900000) + 100000)

/* Lists are the ROTATION pool — length is what decides how far a run gets before
   it repeats. A modal-walking run touches ~8 people, so keep person lists at 12+
   or two records end up identical and stop testing anything that de-duplicates. */
const _NAMES_DEBTOR  = ['Budi Santoso', 'Agus Setiawan', 'Hendra Wijaya', 'Reza Pratama', 'Denny Kusuma', 'Eko Prabowo', 'Feri Gunawan', 'Galih Saputra',
                        'Irfan Maulana', 'Yoga Permana', 'Rizky Ramadhan', 'Bayu Nugroho', 'Dimas Anggara', 'Fajar Nurdin']
const _NAMES_FEMALE  = ['Dewi Kusuma', 'Sari Wulandari', 'Rina Anggraeni', 'Maya Putri', 'Fitri Rahayu', 'Indah Lestari', 'Yuni Astuti',
                        'Ratna Sari', 'Novi Handayani', 'Lia Permata', 'Citra Dewanti', 'Anisa Rahma']
const _NAMES_DAD     = ['Slamet Riyadi', 'Wahyu Santoso', 'Bambang Sutrisno', 'Hadi Wijaya', 'Sugeng Raharjo', 'Joko Widodo', 'Mulyono Prabowo',
                        'Suparman Hadi', 'Darmawan Susilo', 'Herman Setiadi', 'Yusuf Effendi', 'Tarno Wibisono']
const _NAMES_MOM     = ['Siti Aminah', 'Wati Rahayu', 'Sunarti', 'Purwati', 'Endang Susilowati', 'Sri Mulyani', 'Hartini',
                        'Nurhayati', 'Suryani', 'Marmi Lestari', 'Tuti Herawati', 'Kartini Wulan']
const _ALIASES       = ['Budi', 'Agus', 'Hendra', 'Reza', 'Denny', 'Eko', 'Feri', 'Galih', 'Irfan', 'Yoga', 'Rizky', 'Bayu']
const _CITIES        = ['Jakarta Selatan', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Yogyakarta', 'Makassar', 'Denpasar', 'Palembang',
                        'Malang', 'Bogor', 'Bekasi', 'Tangerang', 'Solo', 'Balikpapan', 'Pontianak']
const _STREET_NUMS   = ['1', '12', '27', '45', '88', '103', '5A', '10B', '17', '33', '76', '91C']
const _STREETS       = ['Jl. Sudirman', 'Jl. Thamrin', 'Jl. Gatot Subroto', 'Jl. Kuningan', 'Jl. HR Rasuna Said', 'Jl. Sisingamangaraja', 'Jl. Panglima Polim',
                        'Jl. Asia Afrika', 'Jl. Diponegoro', 'Jl. Ahmad Yani', 'Jl. Pemuda', 'Jl. Merdeka']
const _POSITIONS     = ['Direktur', 'Manajer', 'Staff', 'Supervisor', 'Kepala Divisi', 'Komisaris',
                        'Direktur Utama', 'Wakil Direktur', 'Kepala Cabang', 'Koordinator']
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

  /* ── Bank-statement transaction rows ────────────────────────────────────────
   *
   * 🔴 `credit` MUST stay empty, and the scoping here is not fussiness.
   *
   * The mutasi modal enforces "Debit dan Kredit tidak boleh diisi bersamaan" —
   * a row may carry one or the other, never both. Filling every field, which is
   * what a generic filler does, put an amount in each and the modal refused to
   * save with no toast: 11 of 11 fields filled and the record never created.
   * That was measured 2026-08-11 and it was the LAST blocker on this modal, not
   * the file dropzone it looked like.
   *
   * Scoped to `transactions <n> credit` rather than `\bcredit\b` because every
   * field on this form is named CREDIT_APPLICATION_* — a bare word match would
   * blank most of the application.
   *
   * These cells carry NO label, so without an explicit rule they fall to the
   * generic text fallback and receive `"<label> <today>"`; through a currency
   * mask that became a balance of Rp 11.082.026, silently derived from the date.
   */
  [/transactions\s+\d+\s+credit/,                                   ''],
  [/transactions\s+\d+\s+debit/,                         () => _RAMT(500000, 25000000, 100000)],
  [/transactions\s+\d+\s+nasabah name/,                  () => _PICK(_NAMES_DEBTOR)],
  [/\b(saldo|balance)\b/,                                () => _RAMT(5000000, 250000000, 100000)],

  /* A share percentage is a percentage, not currency: the fallback produced a
     date-derived figure that rendered as "0 %" in the shareholder table. */
  [/\b(persentase|percentage)\b/,                        () => String(5 + Math.floor(Math.random() * 90))],
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
  // Chooser kinds. v1: autocomplete / muiselect / select / radio.
  // v2: select (SearchableSelect), pills (PillGroup), multiselect.
  if (type === 'autocomplete' || type === 'muiselect' || type === 'select'
      || type === 'radio' || type === 'pills' || type === 'multiselect') {
    const live = options.filter(o => o.value !== '' && o.value !== null && o.value !== undefined)

    // A label rule naming a real option wins over position. This is what makes
    // a YEAR_ONLY field — which v2 renders as a select over a year range, newest
    // first — choose last year rather than whatever happens to sort first.
    const normLabel = label.replace(/\s*\*\s*$/, '').trim().toLowerCase()
    if (normLabel && normLabel in LABEL_DEFAULTS) {
      const hinted = String(LABEL_DEFAULTS[normLabel])
      const hit = live.find(o => String(o.value) === hinted || String(o.label) === hinted)
      if (hit) return hit.value
    }
    return live.length ? live[0].value : ''
  }
  // v2 renders a CHECKBOX descriptor as a two-segment Tidak/Ya toggle. False
  // picks the off segment — a create form starts blank, so the off state is the
  // honest default rather than opting the user into something.
  if (type === 'checkbox' || type === 'checkbox_group' || type === 'toggle') return false
  if (type === 'time') return ''

  /**
   * 🔴 `datepicker` MUST be handled here, alongside `datetext`.
   *
   * v1's react-datepicker fields report type `datepicker`, which hit no date
   * branch at all and fell through to the generic text path — so every one of
   * them received `"<label> <today>"`. Measured 2026-08-11 on the site-visit
   * modal:
   *
   *   Tanggal Kunjungan → "tanggal kunjungan 11-08-2026"  → not_found
   *   Jam Mulai         → "jam mulai 11-08-2026"          → not_found
   *
   * The DRIVER was fine — handed `15-08-2026` the same field filled first try.
   * The VALUE was the bug, and it presented as a broken control. It blocked
   * three modals from saving at all (Kunjungan, Mutasi Rekening, Data Pinjaman).
   *
   * TIME cannot be told from DATE by `type` — v1 reports both as `datepicker`
   * because a time-only react-datepicker still renders an
   * `.react-datepicker__input-container`. So it comes off the NAME, with the
   * Indonesian label as a second signal: `..._START_TIME` / `Jam Mulai` are
   * times, `..._VISIT_DATE` / `Tanggal Kunjungan` are dates.
   */
  if (type === 'datepicker' && (/(^|_)TIME$|_TIME_/.test(String(name).toUpperCase()) || /^jam\b/i.test(label || ''))) {
    return '09:00'
  }

  // v2 DateField is a TYPED dd/mm/yyyy box, not a native picker — it strips
  // non-digits from whatever it receives, so the DD-MM-YYYY the label rules
  // emit lands unchanged. Kept distinct from v1's `date`, which is a real
  // <input type="date"> and needs ISO. `datepicker` takes the same DD-MM-YYYY
  // string; fillDatePicker parses it into a Date.
  if (type === 'datetext' || type === 'datepicker') {
    const normLabel = label.replace(/\s*\*\s*$/, '').trim().toLowerCase()
    if (normLabel && normLabel in LABEL_DEFAULTS) return LABEL_DEFAULTS[normLabel]
    const key = (name + ' ' + label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    for (const [pattern, defaultVal] of SMART_RULES) {
      if (pattern.test(key)) return typeof defaultVal === 'function' ? defaultVal() : defaultVal
    }
    return FALLBACK_DATE
  }

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

// ─── Step 1: Detect ───────────────────────────────────────────────────────────
let lastDetectedFields = []
let lastDetectedFieldsByStep = []   // [{stepIdx, fields}] — set during all-steps scan

detectBtn.addEventListener('click', async () => {
  detectBtn.disabled = true
  executeBtn.disabled = true
  buildJsonBtn.disabled = true
  lastDetectedFields = []
  lastDetectedFieldsByStep = []

  try {
    const tab = await getActiveTab()
    const driver = await resolveDriver()
    renderVariantHint()

    if (allStepsCb.checked) {
      // ── Scan all wizard steps ──────────────────────────────────────────────
      let prevStepIdx = null

      for (let s = 0; s < 20; s++) {
        detectBtn.textContent = s === 0 ? '⏳…' : `Scan ${s + 1}…`

        const [{ result: stepIdx }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: driver.current
        })
        if (prevStepIdx !== null && stepIdx === prevStepIdx) break
        prevStepIdx = stepIdx

        const [{ result: fields }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: driver.detect
        })
        if (fields && fields.length) {
          lastDetectedFieldsByStep.push({ stepIdx, fields })
          for (const f of fields) {
            if (!lastDetectedFields.some(x => x.name === f.name)) lastDetectedFields.push(f)
          }
        }

        const [{ result: adv }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', func: driver.advance
        })
        if (adv !== 'clicked') break

        await sleep(800)
      }
    } else {
      // ── Scan current step only ─────────────────────────────────────────────
      const [{ result: fields }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: driver.detect
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

    // Name the driver on an empty scan. A wrong dialect looks exactly like an
    // empty form, and that ambiguity is the expensive part to debug.
    if (!lastDetectedFields.length) {
      showToast(`No fields found using ${DRIVERS[activeVariant].label}`, '#d97706')
    } else {
      showToast(`Detected ${lastDetectedFields.length} fields${stepInfo} · ${DRIVERS[activeVariant].label}`, '#4f46e5')
    }
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

  const delayMs        = readDelay()
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
  let tab, driver
  try { tab = await getActiveTab(); driver = await resolveDriver() }
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
      func: driver.goTo, args: [lastDetectedFieldsByStep[0].stepIdx]
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
            func: driver.fill,
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
          target: { tabId: tab.id }, world: 'MAIN', func: driver.advance
        })
        await sleep(800)
      }
    }

    // Return to the first step after all filling is done
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: driver.goTo, args: [lastDetectedFieldsByStep[0].stepIdx]
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
          func: driver.fill,
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
      target: { tabId: tab.id }, world: 'MAIN', func: driver.tables
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
      func: driver.read,
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

// ── Form dialect (auto / v1 / v2) ─────────────────────────────────────────────
;(async () => {
  const { pref_variant } = await chrome.storage.local.get('pref_variant')
  variantPref = pref_variant || 'auto'
  variantSel.value = variantPref
  renderVariantHint()
})()

variantSel.addEventListener('change', () => {
  variantPref = variantSel.value
  // A dialect change invalidates the scan: field names may be shared between
  // v1 and v2, but the control kinds behind them are not.
  activeVariant = variantPref === 'auto' ? null : variantPref
  lastDetectedFields = []
  lastDetectedFieldsByStep = []
  executeBtn.disabled = true
  buildJsonBtn.disabled = true
  fieldsPanel.classList.add('hidden')
  setStepActive(1)
  renderVariantHint()
  chrome.storage.local.set({ pref_variant: variantPref })
})

/**
 * Walk the "Tambah …" record modals on the current step: reveal what gates them,
 * open each, fill it, save it.
 *
 * 🔴 Without this the popup UNDER-REPORTS and does not say so. Everything else
 * here scans the page, and `v1Detect` scopes itself to an open dialog — but
 * nothing ever OPENED one, so a seven-step sweep of the credit application found
 * 84 fields and looked complete while 95 more sat behind eight buttons.
 *
 * Three behaviours here are not optional, each learned from a run that looked
 * fine and was not:
 *
 *  · REVEAL FIRST. Step 4's Agunan and Underlying tables — and the buttons above
 *    them — do not exist until a gating checkbox says Ya. `smartDefault` answers
 *    `false` for a checkbox, which is right for a value and wrong for a gate, so
 *    the reveal is a separate call.
 *  · RE-DETECT UNTIL STABLE. These forms mount most of themselves after one
 *    select: Pemegang Saham goes 2 → 18 fields, Fasilitas 8 → 20. A single
 *    detect pass fills the gate and stops.
 *  · ANSWER CONFIRMATIONS. A confirmation is a dialog too, so the fill loop will
 *    happily drive it. Refused by default — the one that prompted this offers to
 *    empty the whole application.
 */
async function walkRecordModals(driver, tabId, { delayMs = 120, onStep, mode = 'fill' } = {}) {
  if (!driver.listModals) return null

  const run = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args })
      .then(r => r[0] && r[0].result)

  const report = []

  if (driver.reveal) { await run(driver.reveal); await sleep(700) }

  const list = (await run(driver.listModals)) || []

  for (let i = 0; i < list.length; i++) {
    const label = list[i].label
    if (onStep) onStep(`Modal: ${label}`)

    const opened = await run(driver.openModal, [i])
    if (!opened || !opened.isModal) { report.push({ label, note: 'inline row-add' }); continue }

    if (driver.reveal) { await run(driver.reveal); await sleep(400) }

    const entry = { label, title: opened.title, seen: 0, filled: 0, failed: [] }
    const seen = new Set()

    /* 'detect' opens the modal, reads it and closes it again without writing —
       the honest way to COUNT modal fields. Only one detect round is possible
       there: the extra fields these forms mount appear after something is
       chosen, so a read-only pass sees the first layer and no more. That
       under-count is inherent to not filling, and is why the label says
       "Detect" rather than "Count". */
    const rounds = mode === 'detect' ? 1 : 6

    for (let round = 0; round < rounds; round++) {
      const fields = ((await run(driver.detect)) || []).filter(f => !seen.has(f.name))
      if (!fields.length) break

      if (mode === 'detect') { fields.forEach(f => seen.add(f.name)); break }

      for (const f of fields) {
        seen.add(f.name)
        const value = smartDefault(f.name, f.label, f.type, f.options)

        // skipFilled is forced ON: overwriting an existing value is what raises
        // this app's destructive "Ganti Jenis" confirmation.
        const res = await run(driver.fill, [f.name, value, delayMs, true, true, false, Boolean(f.optional)])
        if (res === 'ok') entry.filled++
        else if (res !== 'skipped_filled' && res !== 'skipped_empty' && res !== 'skipped_disabled') {
          entry.failed.push((f.label || f.name) + '=' + res)
        }

        if (driver.pendingConfirm) {
          const confirm = await run(driver.pendingConfirm)
          if (confirm) {
            entry.confirms = entry.confirms || []
            entry.confirms.push(confirm.text.slice(0, 60))
            await run(driver.answerConfirm, [false])
          }
        }
        await sleep(delayMs)
      }
      await sleep(500)
    }

    entry.seen = seen.size

    if (mode === 'detect') {
      entry.saved = 'not_attempted'
      await run(driver.closeModal)
    } else {
      entry.saved = await run(driver.saveModal)
      if (entry.saved !== 'saved') await run(driver.closeModal)
    }

    report.push(entry)
    await sleep(500)
  }

  return report
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

  /**
   * 🔴 Quick Fill forces skipFilled ON for EVERY pass, including the first.
   *
   * Only the double-check passes below used to force it; pass 1 honoured the
   * checkbox. With it unticked — which is the default — the first pass
   * OVERWRITES fields that already have a value, and on this app that is
   * destructive: re-setting an already-chosen `Jenis Kredit` raises "Konfirmasi
   * Ganti Jenis Kredit — Mengganti Jenis Kredit akan mengosongkan seluruh data
   * yang sudah diisi", offering to empty the entire application (user,
   * 2026-08-11, mid-run).
   *
   * Quick Fill means "fill what is empty", so protecting existing values is the
   * behaviour the button already implies. The explicit Run button still honours
   * the checkbox for anyone who genuinely wants to overwrite.
   *
   * The user's setting is restored in `finally` so the UI does not silently
   * change under them.
   */
  const userSkipFilled = skipFilledCb.checked
  skipFilledCb.checked = true

  try {
    if (onStep) onStep('Filling…')
    await sleep(150)
    executeBtn.click()
    await sleep(300)
    // Per-step execution with navigation; allow up to 5 min total.
    await waitEnabled(executeBtn, 300000)
  } finally {
    skipFilledCb.checked = userSkipFilled
  }

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

  /* ── Record modals, step by step ──────────────────────────────────────────
     Runs last: several modals only exist once the page fields around them are
     set (Agunan needs a saved facility), and the gates that hide them are only
     worth flipping after the step itself is filled. */
  const scope = currentScope()
  if (scope !== 'page') {
    const tab = await getActiveTab()
    const driver = DRIVERS[activeVariant] || DRIVERS.v1

    if (driver.listModals) {
      const steps = lastDetectedFieldsByStep.length
        ? lastDetectedFieldsByStep.map(s => s.stepIdx)
        : [null]

      const modalReport = []
      for (const stepIdx of steps) {
        if (stepIdx !== null && driver.goTo) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN', func: driver.goTo, args: [stepIdx]
          })
          await sleep(900)
        }
        const r = await walkRecordModals(driver, tab.id, {
          delayMs: readDelay(),
          onStep,
          mode: scope === 'detect' ? 'detect' : 'fill'
        })
        if (r && r.length) modalReport.push({ step: stepIdx, modals: r })
      }

      if (modalReport.length) {
        const all = modalReport.flatMap(s => s.modals).filter(m => !m.note)
        const fields = all.reduce((n, m) => n + (m.seen || 0), 0)

        if (scope === 'detect') {
          showToast(`Modals: ${all.length} · ${fields} fields`, '#4f46e5')
        } else {
          const saved = all.filter(m => m.saved === 'saved').length
          showToast(`Modals: ${saved}/${all.length} saved · ${fields} fields`,
            saved === all.length ? '#059669' : '#d97706')
        }
      }
    }
  }

  return lastResults
}

// ── Quick Fill button ─────────────────────────────────────────────────────────
const quickFillBtn = document.getElementById('quickFillBtn')
quickFillBtn.addEventListener('click', async () => {
  quickFillBtn.disabled = true
  setStatus('Starting…')
  try {
    await runAllWizardSteps({ onStep: n => setStatus(String(n)) })

    /* The scope decides what "done" can even mean, so say which one ran rather
       than a bare "Done" that reads the same whether modals were touched. */
    const scope = currentScope()
    setStatus(scope === 'fill' ? 'Done — page + modals filled'
      : scope === 'detect' ? 'Done — page filled, modals detected'
        : 'Done — page only', 'done')
  } catch (err) {
    setStatus('Failed: ' + (err && err.message ? err.message : String(err)), 'error')
  } finally {
    quickFillBtn.disabled = false
    // The label never changed, so there is nothing to restore.
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
