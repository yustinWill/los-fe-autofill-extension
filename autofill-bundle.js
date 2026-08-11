/**
 * LOS v2 autofill — paste-in bundle.
 *
 * GENERATED. Do not edit here: rebuild with `./build-bundle.sh` after changing
 * popup.js or driver-v2.js, so the pasted logic and the extension cannot drift.
 *
 * This is the extension's v2 logic with the Chrome plumbing removed, so it can
 * be pasted straight into a page (devtools console, or one `javascript_tool`
 * call) and driven from there. Same detection, same control handling and the
 * same smart-default tables the extension uses — the only thing dropped is
 * chrome.scripting.
 *
 * Defines `window.__autofill`:
 *
 *   await __autofill.detect()          every field on the current step/modal
 *   await __autofill.run()             detect, then fill everything with defaults
 *   await __autofill.run({ skipFilled: true, only: ['FIELD_NAME'] })
 *   await __autofill.fill(name, value) one field, explicit value
 *   __autofill.read(names)             stored RHF values, not rendered labels
 *   __autofill.smartDefault(name, label, type, options)
 *   __autofill.step.current() / .goTo(i) / .advance()
 *
 * Re-paste after any reload or HMR swap.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Fallback date string (DD-MM-YYYY), computed once at startup
const FALLBACK_DATE = (() => {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + '-'
       + String(d.getMonth() + 1).padStart(2, '0') + '-'
       + d.getFullYear()
})()

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

  // v2 DateField is a TYPED dd/mm/yyyy box, not a native picker — it strips
  // non-digits from whatever it receives, so the DD-MM-YYYY the label rules
  // emit lands unchanged. Kept distinct from v1's `date`, which is a real
  // <input type="date"> and needs ISO.
  if (type === 'datetext') {
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

// ─── Driver: v2 (Kairos design system) ────────────────────────────────────────
//
// Every function below is injected into the page's MAIN world by
// chrome.scripting.executeScript, which serialises it with Function.toString().
// They must therefore stay SELF-CONTAINED — no closure over anything in this
// file, no imports, no shared helpers. That is why the same handful of helpers
// is redeclared inside each one. driver-v1.js does the same.
//
// ── How v2 differs from v1, and why none of v1's selectors survive ───────────
//
// v2 (los-fe/src/app-v2) renders through the Kairos design system rather than
// MUI. Three things break at once:
//
//  1. NO `name` ATTRIBUTE REACHES THE DOM. DynamicField's Controller destructures
//     `{ value, onChange, onBlur, ref }` and never passes `name` down, so
//     `input[name="FIELD"]` — the basis of every v1 selector — matches nothing.
//     Fields are identified by walking the React fiber chain up to the owning
//     <Controller>, whose props carry both `name` and `control`.
//  2. NO STABLE CLASSES. Kairos styles inline; the only class in the form is
//     `kai-input-inner`. Control kind has to be inferred from shape instead.
//  3. CUSTOM CONTROLS. SearchableSelect (a button plus a position:fixed panel,
//     no role="listbox"), PillGroup, SegmentedToggle, MaskedInput, CurrencyField.
//
// What DOES carry over is the field vocabulary: app-v2's `fields.ts` is copied
// verbatim from v1, same UPPERCASE_SNAKE values, so popup.js's smart-default
// tables apply unchanged and JSON captured from a v1 form replays into a v2 one.
//
// ── Interaction rules, learned the expensive way ─────────────────────────────
//
// Distilled from `los/.claude/skills/los-create-autofill` (SKILL.md §7), which
// records a ~60-call manual run against these exact controls:
//
//  · Never read the DOM in the same tick as the click that changed it. React has
//    not re-rendered; an option list read immediately after opening reads EMPTY.
//    Every open here goes through waitFor.
//  · A required label is NOT a leaf: it renders `<span>Label<span> *</span></span>`.
//    Matching leaf text finds every optional field and silently misses every
//    required one, so labels are matched on their OWN text nodes.
//  · Walk up until you FIND something, never a fixed number of levels. A fixed
//    walk overshoots into the step card and starts clicking unrelated controls.
//  · Never trust a fill that was not read back. Writing `el.value` directly does
//    nothing — React tracks its own value and ignores it.
//
// ── What a FULL fixture run proved, 2026-08-07 ───────────────────────────────
//
// Built and submitted a complete Restrukturisasi / Badan Usaha application
// (001CRED030826BXK2). Everything below defeated a fill-and-hope pass, and
// several make driver OUTPUT wrong rather than merely incomplete — the class of
// bug this file already carries two of.
//
//  1. 🔴 A CLEAN FILL CAN STILL 400. Three server rejections fired in sequence,
//     none visible in the UI:
//       · loan_data_list[].plafond / monthly_installment / remaining_loan are
//         posted as NUMBERS; the DTO demands STRINGS. Unfixable from a driver —
//         the modal numericises on change.
//       · the Kelompok picker posts a MOCK code (GRP-001) the BE rejects.
//       · an EXISTING avalis is posted as a NEW record → CODE_ALREADY_EXISTS.
//     So "every field filled, rail all green" is not evidence of a submittable
//     form. Hook XHR and read the 400 body; that is the only reliable signal.
//
//  2. 🔴 READ-ONLY DISPLAY INPUTS HOLD REAL VALUES, invisible to text scraping.
//     The Kelompok picker writes GRP-001 into a `readOnly` input. `innerText`
//     does not include an input's value, so a page-text read reports the field
//     EMPTY while the payload carries it. Read `.value`, never the rendered
//     text. (Exactly this mistake produced the wrong finding "the picker binds
//     nothing".) There is also no UI affordance to clear it once set — only
//     react-hook-form `_formValues`, reached by walking the fiber up to the
//     first `memoizedProps.control`.
//
//  3. 🔴 TOGGLES GATE WHOLE FIELD GROUPS INTO AND OUT OF EXISTENCE. `Terdapat
//     Akta Perubahan` = Ya mounts six fields plus a notary province/city
//     cascade; `Memiliki Avalis / Penjamin` and step 4's two toggles do the
//     same. A detect run before the toggle reports those fields ABSENT — not
//     optional, not missing-from-the-form. Any coverage number taken without
//     first exercising the toggles is understated by construction.
//
//  4. DUPLICATE LABELS INSIDE ONE MODAL. The Neraca carries `Lainnya` ×5,
//     `(Akumulasi Depresiasi)` ×3 and `Kewajiban Sewa Guna Usaha` ×2. A
//     label-keyed filler writes every one of them to the FIRST match and
//     reports success. Index off the input list and map labels once.
//
//  5. STAGED REVEAL. The financial-report modal mounts its rows only after
//     Jenis → Jenis Periode → year, in that order. Detect before that returns
//     almost nothing, which reads as an empty form. The two period types
//     differ: `Full 1 Tahun` shows a `Pilih Periode Tahun` select; `Year to
//     Date (YTD)` has NO year select and auto-fills the period from today.
//
//  6. COORDINATE-ONLY CONTROLS, still. A collateral/underlying row's FASILITAS
//     KREDIT cell is an inline multi-select whose options do not exist in the
//     DOM until clicked and are not queryable after. Same for picker-list rows
//     (`Pilih ›` is a span). A driver cannot reach these; report them as
//     out-of-scope rather than as empty fields.
//
//  7. 🔴 REPLAYING CAPTURED JSON FAILS THE SECOND TIME. `Nomor NIB`, `Nomor
//     NPWP Perusahaan`, `Nomor Akta Pendirian` and `Nomor SK Kemenkumham` are
//     unique company-wide — a second application built from the same capture
//     dies on `NIB_ALREADY_EXISTS` AFTER every other field is filled. Any
//     replay feature must stamp these per run.
//
//  8. Label corrections that cost a retry each: the field is `Nama Dagang
//     Perusahaan` (not `Nama Dagang`); the shareholder percentage is
//     `Persentase Saham` (not `Persentase Kepemilikan`).
//
// Full write-up, with the payloads: `los/.claude/skills/los-create-autofill`
// SKILL.md §3k.

// ─── Detect ───────────────────────────────────────────────────────────────────
// Groups every visible control by the field name of its owning <Controller>,
// then classifies each group by shape. Select options are peeked by opening the
// panel and closing it again, same contract as v1's pageDetect.
async function v2Detect() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = (fn, ms = 1400) => new Promise(res => {
    const end = Date.now() + ms
    const t = () => { const r = fn(); if (r) return res(r); if (Date.now() > end) return res(null); setTimeout(t, 40) }
    t()
  })

  // An open modal owns the page; otherwise scan the step card so the rail,
  // header and footer buttons stay out of the sweep.
  const root = document.querySelector('[role="dialog"]')
    || document.querySelector('[data-m="stepcard"]')
    || document.body

  // The RHF <Controller> that owns this element. Depth 200 because Kairos wraps
  // each control in several layers more than MUI did.
  function fiberName(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 200) {
      const p = f.memoizedProps
      if (p && p.control && typeof p.name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(p.name)) return p.name
      f = f.return
    }
    return null
  }

  // The RHF control object. `_formValues` is the whole form store — the only
  // honest way to read a select, whose trigger displays the option LABEL and
  // shows placeholder text when empty.
  function fiberControl(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 200) {
      const p = f.memoizedProps
      if (p && p.control && typeof p.name === 'string') return p.control
      f = f.return
    }
    return null
  }

  function ownText(el) {
    let t = ''
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
    return t.trim()
  }

  function visible(el) {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return false
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden'
  }

  // True when `el` sits inside a popped-open results panel. Those panels are
  // position:fixed and live INSIDE the field's own subtree, so an open select
  // would otherwise contribute its search box and be misread as a text field.
  // Stops at `root` so a modal's own fixed positioning does not count.
  function inPanel(el) {
    let n = el
    while (n && n !== root && n !== document.body) {
      if (getComputedStyle(n).position === 'fixed') return true
      n = n.parentElement
    }
    return false
  }

  // Shape → kind. Ordered most-specific first; each test rules out the next.
  function classify(els) {
    if (els.some(e => e.tagName === 'TEXTAREA')) return 'textarea'
    const inputs = els.filter(e => e.tagName === 'INPUT')
    const buttons = els.filter(e => e.tagName === 'BUTTON')

    if (inputs.length) {
      const inp = inputs[0]
      if (inp.type === 'checkbox' || inp.type === 'radio') return inp.type
      // The multi-select's own input is a SEARCH box, not a value field. Its
      // placeholder is built as `Cari {label}…` by DynamicField, which is the
      // only thing distinguishing it from a text field.
      if (/^cari\b/i.test(inp.placeholder || '')) return 'multiselect'
      if (inp.type === 'password') return 'password'
      // `datetext`, not `date`: v2's DateField is a TYPED box, whereas v1's
      // `date` is a native <input type="date"> that needs ISO. Sharing the name
      // would hand one of them the other's format.
      if (/dd\/mm\/yyyy|mmm yyyy/i.test(inp.placeholder || '')) return 'datetext'
      return 'text'
    }

    if (buttons.length) {
      // SegmentedToggle wraps its two segments in a role="group" track.
      if (buttons.some(b => b.closest('[role="group"]'))) return 'toggle'
      // SearchableSelect's trigger is the only chooser carrying a chevron.
      // Count alone would misread a one-option PillGroup as a select.
      if (buttons.some(b => b.querySelector('svg'))) return 'select'
      return 'pills'
    }
    return null
  }

  function labelInfo(els) {
    const primary = els.find(e => e.tagName !== 'BUTTON') || els[0]

    // Kairos Input renders a real <label for>; requiredLabel appends
    // `<span> *</span>` inside it, so own-text drops the marker cleanly.
    if (primary.id) {
      let l = null
      try {
        const id = window.CSS && CSS.escape ? CSS.escape(primary.id) : primary.id
        l = document.querySelector('label[for="' + id + '"]')
      } catch (_) { /* malformed generated id — fall through to the walk */ }
      if (l) return { text: ownText(l) || l.textContent.trim(), required: /\*\s*$/.test(l.textContent) }
    }

    // Hand-built controls (select, pills, toggle) label themselves with a
    // preceding <span>. Walk out one level at a time and take the first
    // labelled sibling — going deeper reaches the section heading instead.
    //
    // Candidates must be OUTSIDE the control in both directions. Skipping only
    // ancestors is not enough: a SearchableSelect's trigger holds its own
    // <span> of placeholder text, so a select came back labelled "Pilih jenis
    // kredit" instead of "Jenis Kredit" — and, reading its required marker off
    // that same span, reported a required field as optional.
    const inControl = cand => els.some(e => e === cand || e.contains(cand))

    let node = primary
    for (let d = 0; d < 6 && node.parentElement; d++) {
      node = node.parentElement
      for (const cand of node.querySelectorAll('span, label, p')) {
        if (cand.contains(primary) || inControl(cand)) continue
        const t = ownText(cand)
        if (t && t !== '*') return { text: t, required: /\*\s*$/.test(cand.textContent) }
      }
    }
    return { text: '', required: false }
  }

  async function closePanels() {
    // SearchableSelect closes on a document mousedown whose target is outside
    // its box. Escape also works, but bubbles past the control and would close
    // an enclosing dialog with it.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await sleep(90)
  }

  // Open the panel, read its option buttons, close it. Both SearchableSelect
  // and SearchableMultiSelect render the panel as a position:fixed sibling of
  // their trigger inside a relative wrapper, so one routine covers both.
  async function peekOptions(opener) {
    if (!opener || opener.disabled) return []
    const box = opener.parentElement
    if (!box) return []

    const findPanel = () => Array.from(box.children)
      .find(c => c !== opener && getComputedStyle(c).position === 'fixed') || null

    if (opener.tagName === 'BUTTON') opener.click()
    else { opener.focus(); opener.dispatchEvent(new Event('focus', { bubbles: true })) }

    // Separate tick — React has not re-rendered at the moment of the click.
    const panel = await waitFor(findPanel, 900)
    const opts = panel
      ? Array.from(panel.querySelectorAll('button'))
          .map(b => b.textContent.trim())
          .filter(Boolean)
          .map(t => ({ value: t, label: t }))
      : []

    await closePanels()
    return opts
  }

  const groups = new Map()
  for (const el of root.querySelectorAll('input, textarea, button')) {
    if (!visible(el) || inPanel(el)) continue
    const name = fiberName(el)
    if (!name) continue          // page furniture: not inside any Controller
    let g = groups.get(name)
    if (!g) { g = { name, els: [] }; groups.set(name, g) }
    g.els.push(el)
  }

  const fields = []
  for (const g of groups.values()) {
    const type = classify(g.els)
    if (!type) continue

    const primary = g.els.find(e => e.tagName !== 'BUTTON') || g.els[0]
    const { text: label, required } = labelInfo(g.els)
    const disabled = Boolean(primary.disabled)

    // Read the stored value, not the rendered one: a select's trigger shows the
    // option's LABEL, and its placeholder when empty.
    let value = ''
    const control = fiberControl(primary)
    if (control && control._formValues) {
      const stored = g.name.split('.').reduce((o, k) => (o == null ? o : o[k]), control._formValues)
      if (stored !== undefined && stored !== null) value = stored
    } else if (primary.tagName === 'INPUT' || primary.tagName === 'TEXTAREA') {
      value = primary.value
    }

    const field = { name: g.name, type, label, value, disabled, optional: !required, options: [] }

    if (!disabled && (type === 'select' || type === 'multiselect')) {
      const opener = type === 'select'
        ? g.els.find(e => e.tagName === 'BUTTON')
        : g.els.find(e => e.tagName === 'INPUT')
      field.options = await peekOptions(opener)
    } else if (type === 'pills' || type === 'toggle') {
      // Already on screen — no need to open anything.
      field.options = g.els
        .filter(e => e.tagName === 'BUTTON' && e.textContent.trim())
        .map(b => ({ value: b.textContent.trim(), label: b.textContent.trim() }))
    }

    fields.push(field)
  }

  // ── The controlled-by-props blocks (Konfigurasi → Workflow Engine) ──────────
  //
  // 🔴 Without this, detect UNDER-REPORTS and does not say so. Everything above
  // keys off the owning <Controller>; ConditionsBlock and StagesBlock have none
  // (the page owns `groups`/`stages` in useState and passes {value,onChange}), so
  // a detect run on the Kondisi tab returned the four Identitas fields and
  // nothing else. That reads as "the tab is empty", not "I cannot see this" —
  // the same class of silently-wrong output as the driver-v1 optional bug.
  //
  // Synthetic names keep the seven-function contract intact, so the popup, the
  // JSON replay and `run()` all work unchanged:
  //
  //   WF_COND.<group>.<row>.param | .operand | .value
  //   WF_STAGE.<index>.name | .display | .stepType | .stepRule | .sla
  //                        | .allowUpdateData | .allowCommittee
  //
  // Values are CODES on both sides — never the rendered label. Operator labels
  // are bare symbols (`EQUAL` renders as `=`), so a spec written off the screen
  // fails every pick while looking like a broken control.
  //
  // ⚠️ The `typeof` guard is load-bearing, not defensive noise. This function is
  // handed to chrome.scripting.executeScript as `func: driver.detect` and
  // serialised with Function.toString(), so NOTHING else in this file crosses
  // with it — an unguarded call would throw ReferenceError in the page and take
  // the whole detect down. In the BUNDLE the file is concatenated, so the helper
  // is present and this runs. Extension-popup support needs popup.js to inject
  // the helpers first; until then the extension keeps its previous behaviour
  // rather than breaking.
  if (typeof wfDetectBlocks === 'function') {
    for (const f of await wfDetectBlocks()) fields.push(f)
  }

  return fields
}

// ─── Workflow-form support ────────────────────────────────────────────────────
//
// These are the ONLY functions in this file allowed to be shared helpers rather
// than self-contained: they are never handed to chrome.scripting directly. The
// seven contract functions call them, and the bundle concatenates the whole file
// — so in the extension each caller must inline what it needs. `wfInject` below
// is the string the contract functions splice in.

/**
 * The CURRENT fiber tree's root.
 *
 * 🔴 Never read `el.__reactFiber$.memoizedProps` and trust it. React alternates
 * between two fiber trees, and a host node's property is not guaranteed to point
 * at the newer one. Measured 2026-08-11: immediately after a select wrote
 * TOTAL_EXPOSURE, the ConditionsBlock fiber reached by walking up from a row had
 *
 *     memoizedProps.groups[0].rows      → ['', COLLATERAL_TYPE, …]   (stale)
 *     alternate.memoizedProps.groups[0] → [TOTAL_EXPOSURE, …]        (fresh)
 *
 * so the node's OWN props were the previous render. A driver reading state that
 * way sees its own successful writes as failures and retries them. There is no
 * reliable "newer of the two" test — go to the root, whose `stateNode.current`
 * is the current tree by definition.
 */
function wfCurrentRoot() {
  for (const el of [document.getElementById('root'), ...document.body.children]) {
    if (!el) continue
    const k = Object.keys(el).find(key => /^__reactContainer\$/.test(key))
    if (k && el[k] && el[k].stateNode && el[k].stateNode.current) return el[k].stateNode.current
  }
  return null
}

function wfFindProps(pred) {
  const root = wfCurrentRoot()
  if (!root) return null
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()
    const p = f.memoizedProps
    if (p && typeof p === 'object' && pred(p)) return p
    if (f.child) stack.push(f.child)
    if (f.sibling) stack.push(f.sibling)
  }
  return null
}

const wfConditionProps = () =>
  wfFindProps(p => Array.isArray(p.groups) && p.master && typeof p.onChange === 'function')

const wfStageProps = () => wfFindProps(p => Array.isArray(p.stages) && typeof p.onChange === 'function')

/** Code → the label the control renders, from the master data the block was given. */
const wfLabelFor = (list, code) => {
  const hit = (list || []).find(o => String(o.value) === String(code))
  return hit ? hit.label : code
}

const WF_DISPLAY = {
  INITIAL_PROPOSAL: 'Pengajuan',
  PROPOSAL: 'Pengajuan',
  KYC: 'KYC',
  ANALYSIS: 'Penilaian',
  APPROVAL: 'Persetujuan'
}

const WF_TYPE = { TASK: 'Tugas', RECOMMENDATION: 'Rekomendasi', APPROVAL: 'Persetujuan' }

const WF_RULE = {
  FIRST_RESPOND: 'Responden Pertama',
  ALL_DONE: 'Semua Selesai',
  ALL_APPROVE: 'Semua Setuju',
  VOTE_MAJORITY: 'Mayoritas Setuju'
}

/** Emit synthetic field descriptors for whichever blocks are mounted. */
async function wfDetectBlocks() {
  const out = []
  const cond = wfConditionProps()

  if (cond) {
    cond.groups.forEach((group, gi) => {
      group.rows.forEach((row, ri) => {
        const base = `WF_COND.${gi}.${ri}`
        out.push({
          name: `${base}.param`,
          type: 'select',
          label: 'Parameter',
          value: row.fieldCode,
          disabled: false,
          optional: false,
          options: (cond.master.parameters || []).map(o => ({ value: String(o.value), label: o.label }))
        })
        out.push({
          name: `${base}.operand`,
          type: 'select',
          label: 'Operator',
          value: row.operand,
          disabled: !row.fieldCode,
          optional: false,
          options: (cond.master.operatorsByParameter[row.fieldCode] || []).map(o => ({
            value: String(o.value),
            label: o.label
          }))
        })

        /* One cell, three shapes. CURRENCY is a masked input, MULTI_SELECT a
           chip picker, and "Memiliki Agunan" takes NO value at all — its
           operators are Ada / Tidak Ada, so the operator IS the condition. */
        const values = cond.master.valuesByParameter[row.fieldCode]
        if (values) {
          out.push({
            name: `${base}.value`,
            type: 'multiselect',
            label: 'Nilai',
            value: row.values,
            disabled: !row.fieldCode,
            optional: false,
            options: values.map(o => ({ value: String(o.value), label: o.label }))
          })
        } else if (row.fieldCode && row.fieldCode !== 'COLLATERAL') {
          out.push({
            name: `${base}.value`,
            type: 'text',
            label: 'Nilai',
            value: row.value,
            disabled: false,
            optional: false,
            options: []
          })
        }
      })
    })
  }

  const stg = wfStageProps()
  if (stg) {
    stg.stages.forEach((stage, si) => {
      const base = `WF_STAGE.${si}`
      const push = (key, type, label, value, options) =>
        out.push({ name: `${base}.${key}`, type, label, value, disabled: false, optional: false, options: options || [] })

      push('name', 'text', 'Nama Tahapan', stage.name)
      push('sla', 'text', 'Batas Waktu (SLA)', stage.sla)
      push('display', 'pills', 'Tampilan', stage.displaySource,
        Object.keys(WF_DISPLAY).filter(k => k !== 'INITIAL_PROPOSAL').map(k => ({ value: k, label: WF_DISPLAY[k] })))
      push('stepType', 'select', 'Jenis Tahapan', stage.stepType,
        Object.keys(WF_TYPE).map(k => ({ value: k, label: WF_TYPE[k] })))
      push('stepRule', 'select', 'Aturan Penyelesaian', stage.stepRule,
        Object.keys(WF_RULE).map(k => ({ value: k, label: WF_RULE[k] })))
      push('allowUpdateData', 'toggle', 'Boleh mengubah data pengajuan', stage.allowUpdateData)
      push('allowCommittee', 'toggle', 'Tahapan komite', stage.allowApprovalCommittee)
    })
  }

  return out
}

const wfNap = ms => new Promise(r => setTimeout(r, ms))

const wfWaitFor = (fn, ms = 2000) =>
  new Promise(res => {
    const end = Date.now() + ms
    const t = () => {
      const r = fn()
      if (r) return res(r)
      if (Date.now() > end) return res(null)
      setTimeout(t, 40)
    }
    t()
  })

/**
 * The open option panel.
 *
 * It is the page's only `position: fixed` div carrying option buttons, and it is
 * a SIBLING of the trigger, not a portal to <body> — `document.body.children`
 * does not change when it opens, so a body-mutation watcher never fires.
 */
const wfPanel = () => {
  const cands = [...document.querySelectorAll('div')].filter(
    d => getComputedStyle(d).position === 'fixed' && d.querySelectorAll('button').length > 0
  )
  return cands[cands.length - 1] || null
}

const wfClosePanel = async () => {
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await wfNap(120)
}

async function wfPickOption(trigger, want, keepOpen) {
  if (!trigger) return 'not_found'
  trigger.click()
  const panel = await wfWaitFor(() => {
    const p = wfPanel()
    return p && p.querySelectorAll('button').length ? p : null
  })
  if (!panel) return 'not_found'

  const opts = [...panel.querySelectorAll('button')].filter(b => b.textContent.trim())
  const str = String(want)
  const hit =
    opts.find(b => b.textContent.trim() === str) ||
    opts.find(b => b.textContent.trim().toLowerCase() === str.toLowerCase())

  if (!hit) {
    await wfClosePanel()
    return 'not_found'
  }
  hit.click()
  await wfNap(140)
  if (!keepOpen) await wfClosePanel()
  return 'ok'
}

function wfSetNativeValue(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Condition ROW elements, in document order across all groups.
 *
 * Anchored on the connector span ("Jika" for row 0, "Dan" after). Do NOT index
 * rows by the "Pilih parameter" placeholder: once a parameter is chosen the
 * trigger relabels itself, so a text-keyed lookup silently slides onto the next
 * unfilled row and writes there instead.
 */
const wfRows = () =>
  [...document.querySelectorAll('span')]
    .filter(s => {
      const t = s.textContent.trim()
      return (t === 'Jika' || t === 'Dan') && s.children.length === 0
    })
    .map(s => s.parentElement)

/** The element holding the control(s) for a labelled field in the stage pane. */
function wfStageField(labelText) {
  const el = [...document.querySelectorAll('span,label,div')].find(
    e => e.children.length === 0 && e.textContent.trim() === labelText
  )
  if (!el) return null
  let p = el.parentElement
  let hop = 0
  while (p && hop++ < 5) {
    if (p.querySelectorAll('button,input').length) return p
    p = p.parentElement
  }
  return null
}

/** Rail rows are `div[role="button"][draggable]`, never `<button>` — they contain
 *  their own delete control and a button may not nest a button. */
const wfRail = () => [...document.querySelectorAll('div[role="button"][draggable]')]

/**
 * Fill one synthetic workflow field. Returns the same statuses as v2FillField.
 *
 * ⚠️ Selecting a stage is a PRECONDITION for every WF_STAGE write: the detail
 * pane renders only the active stage, so writing `WF_STAGE.5.name` while stage 0
 * is selected would silently edit stage 0.
 */
/**
 * Bring the tab that mounts `probe`'s block to the front.
 *
 * Only the active tab panel is mounted, so a fill addressed at the other tab's
 * block finds nothing. Rather than returning 'not_found' — which reads as "that
 * field does not exist" when the truth is "you are looking at the wrong tab" —
 * walk the tabs until the block appears. Two tabs, so this is cheap.
 */
async function wfEnsureMounted(probe) {
  if (probe()) return true
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.click()
    await wfNap(400)
    if (probe()) return true
  }
  return Boolean(probe())
}

async function wfFillBlock(name, value) {
  const parts = name.split('.')

  if (parts[0] === 'WF_COND') {
    await wfEnsureMounted(wfConditionProps)
    const cond = wfConditionProps()
    if (!cond) return 'not_found'

    const [, gi, ri, key] = parts
    let flat = 0
    let target = null
    cond.groups.forEach((group, g) => {
      group.rows.forEach((row, r) => {
        if (String(g) === gi && String(r) === ri) target = { row, index: flat }
        flat++
      })
    })
    if (!target) return 'not_found'

    const rowEl = wfRows()[target.index]
    if (!rowEl) return 'not_found'
    const btns = () => [...rowEl.querySelectorAll('button')]

    if (key === 'param') return wfPickOption(btns()[0], wfLabelFor(cond.master.parameters, value))

    if (key === 'operand') {
      const ops = cond.master.operatorsByParameter[target.row.fieldCode]
      return wfPickOption(btns()[1], wfLabelFor(ops, value))
    }

    if (key === 'value') {
      const opts = cond.master.valuesByParameter[target.row.fieldCode]

      if (opts) {
        /* Multi-select: the panel stays open across picks and each chosen option
           drops out of the list, so open once and click each. */
        const wanted = Array.isArray(value) ? value : String(value).split(',').filter(Boolean)
        const trig = btns().find(b => /Isi nilai/.test(b.textContent)) || btns().pop()
        if (!trig) return 'not_found'
        trig.click()
        const panel = await wfWaitFor(() => {
          const p = wfPanel()
          return p && p.querySelectorAll('button').length ? p : null
        })
        if (!panel) return 'not_found'
        for (const code of wanted) {
          const want = wfLabelFor(opts, code)
          const live = wfPanel() || panel
          const hit = [...live.querySelectorAll('button')].find(b => b.textContent.trim() === want)
          if (hit) hit.click()
          await wfNap(160)
        }
        await wfClosePanel()
        return 'ok'
      }

      const inp = [...rowEl.querySelectorAll('input')].pop()
      if (!inp) return 'not_found'
      wfSetNativeValue(inp, String(value))
      await wfNap(120)
      inp.blur()
      return 'ok'
    }

    return 'not_found'
  }

  if (parts[0] === 'WF_STAGE') {
    const [, si, key] = parts
    await wfEnsureMounted(wfStageProps)
    const rail = wfRail()
    if (!rail[Number(si)]) return 'not_found'
    rail[Number(si)].click()
    await wfNap(320)

    if (key === 'name' || key === 'sla') {
      const host = wfStageField(key === 'name' ? 'Nama Tahapan' : 'Batas Waktu (SLA)')
      const inp = host && host.querySelector('input')
      if (!inp) return 'not_found'
      wfSetNativeValue(inp, String(value))
      await wfNap(120)
      inp.blur()
      return 'ok'
    }

    /* display → stepType → stepRule is the only safe write order: Tampilan
       re-settles Jenis Tahapan when the current pick becomes illegal, and Jenis
       Tahapan re-settles the rule. The caller is responsible for that order;
       each write here is independent. */
    if (key === 'display') {
      const host = wfStageField('Tampilan')
      const b = host && [...host.querySelectorAll('button')].find(x => x.textContent.trim() === WF_DISPLAY[value])
      if (!b) return 'not_found'
      b.click()
      await wfNap(260)
      return 'ok'
    }

    if (key === 'stepType' || key === 'stepRule') {
      const host = wfStageField(key === 'stepType' ? 'Jenis Tahapan' : 'Aturan Penyelesaian')
      const map = key === 'stepType' ? WF_TYPE : WF_RULE
      return wfPickOption(host && host.querySelector('button'), map[value] || value)
    }

    if (key === 'allowUpdateData' || key === 'allowCommittee') {
      const host = wfStageField(key === 'allowUpdateData' ? 'Boleh mengubah data pengajuan' : 'Tahapan komite')
      const b = host && [...host.querySelectorAll('button')].find(x => x.textContent.trim() === (value ? 'Ya' : 'Tidak'))
      if (!b) return 'not_found'
      b.click()
      await wfNap(200)
      return 'ok'
    }

    return 'not_found'
  }

  return null   // not a workflow field — let the caller fall through
}

/**
 * Returned when the addressed block exists in the form but is not currently
 * MOUNTED, because its tab is not the active one.
 *
 * 🔴 Not cosmetic. Only the active tab panel is mounted, so reading
 * `WF_COND.0.0.param` while the Tahapan tab is open used to yield `''` — which
 * is exactly what a genuinely empty field returns. A verification pass would
 * report every condition as unfilled and a fill loop would rewrite values that
 * were already correct. A sentinel that cannot be mistaken for a value is the
 * whole point; `read()` is synchronous and so cannot switch tabs itself.
 */
const WF_NOT_MOUNTED = '__NOT_MOUNTED__'

/** Read synthetic workflow fields straight out of the current fiber tree. */
function wfReadBlock(name) {
  const parts = name.split('.')

  if (parts[0] === 'WF_COND') {
    const cond = wfConditionProps()
    if (!cond) return WF_NOT_MOUNTED
    const row = (cond.groups[Number(parts[1])] || { rows: [] }).rows[Number(parts[2])]
    if (!row) return undefined
    if (parts[3] === 'param') return row.fieldCode
    if (parts[3] === 'operand') return row.operand
    if (parts[3] === 'value') return row.values && row.values.length ? row.values : row.value
    return undefined
  }

  if (parts[0] === 'WF_STAGE') {
    const stg = wfStageProps()
    if (!stg) return WF_NOT_MOUNTED
    const stage = stg.stages[Number(parts[1])]
    if (!stage) return undefined
    const map = {
      name: stage.name,
      sla: stage.sla,
      display: stage.displaySource,
      stepType: stage.stepType,
      stepRule: stage.stepRule,
      allowUpdateData: stage.allowUpdateData,
      allowCommittee: stage.allowApprovalCommittee
    }
    return map[parts[2]]
  }

  return undefined
}

// ─── Fill one field ───────────────────────────────────────────────────────────
// Regroups from scratch on every call: React re-renders between fields and any
// element reference captured during detect is stale by now.
// Returns 'ok' | 'not_found' | 'skipped_disabled' | 'skipped_filled' | 'skipped_optional'.
async function v2FillField(name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, isOptional) {
  /* The controlled-by-props blocks are addressed by synthetic name and have no
     Controller to look up, so they short-circuit everything below. `null` means
     "not one of mine" — anything else is a real status. `typeof` guard: see the
     note at the end of v2Detect — this function is serialised alone. */
  if (/^WF_(COND|STAGE)\./.test(name) && typeof wfFillBlock === 'function') {
    const wfStatus = await wfFillBlock(name, value)
    if (wfStatus !== null) return wfStatus
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = (fn, ms = 1400) => new Promise(res => {
    const end = Date.now() + ms
    const t = () => { const r = fn(); if (r) return res(r); if (Date.now() > end) return res(null); setTimeout(t, 40) }
    t()
  })

  const root = document.querySelector('[role="dialog"]')
    || document.querySelector('[data-m="stepcard"]')
    || document.body

  function fiberName(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 200) {
      const p = f.memoizedProps
      if (p && p.control && typeof p.name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(p.name)) return p.name
      f = f.return
    }
    return null
  }

  function fiberControl(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 200) {
      const p = f.memoizedProps
      if (p && p.control && typeof p.name === 'string') return p.control
      f = f.return
    }
    return null
  }

  function visible(el) {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return false
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden'
  }

  function inPanel(el) {
    let n = el
    while (n && n !== root && n !== document.body) {
      if (getComputedStyle(n).position === 'fixed') return true
      n = n.parentElement
    }
    return false
  }

  function classify(els) {
    if (els.some(e => e.tagName === 'TEXTAREA')) return 'textarea'
    const inputs = els.filter(e => e.tagName === 'INPUT')
    const buttons = els.filter(e => e.tagName === 'BUTTON')
    if (inputs.length) {
      const inp = inputs[0]
      if (inp.type === 'checkbox' || inp.type === 'radio') return inp.type
      if (/^cari\b/i.test(inp.placeholder || '')) return 'multiselect'
      if (inp.type === 'password') return 'password'
      // `datetext`, not `date`: v2's DateField is a TYPED box, whereas v1's
      // `date` is a native <input type="date"> that needs ISO. Sharing the name
      // would hand one of them the other's format.
      if (/dd\/mm\/yyyy|mmm yyyy/i.test(inp.placeholder || '')) return 'datetext'
      return 'text'
    }
    if (buttons.length) {
      if (buttons.some(b => b.closest('[role="group"]'))) return 'toggle'
      if (buttons.some(b => b.querySelector('svg'))) return 'select'
      return 'pills'
    }
    return null
  }

  // Write through React's own setter. Assigning `el.value` does nothing: React
  // tracks the value on its own descriptor and ignores the assignment, leaving
  // a field that LOOKS filled while form state stayed empty. A textarea needs
  // its own prototype's descriptor — the input one silently no-ops on it.
  function setNative(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    el.focus()
    setter.call(el, String(v))
    if (el._valueTracker) { try { el._valueTracker.setValue('') } catch (_) { /* not tracked */ } }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function closePanels() {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await sleep(90)
  }

  async function fillPanel(opener, want) {
    if (!opener || opener.disabled) return false
    const box = opener.parentElement
    if (!box) return false
    const findPanel = () => Array.from(box.children)
      .find(c => c !== opener && getComputedStyle(c).position === 'fixed') || null

    if (opener.tagName === 'BUTTON') opener.click()
    else { opener.focus(); opener.dispatchEvent(new Event('focus', { bubbles: true })) }

    const panel = await waitFor(findPanel, 1200)
    if (!panel) { await closePanels(); return false }

    const opts = Array.from(panel.querySelectorAll('button')).filter(b => b.textContent.trim())
    const str = String(want == null ? '' : want)
    const target = str
      ? (opts.find(b => b.textContent.trim() === str) || opts[0])
      : opts[0]

    if (!target) { await closePanels(); return false }
    target.click()
    await sleep(120)
    await closePanels()
    await sleep(delayMs > 200 ? 0 : 150)
    return true
  }

  const groups = new Map()
  for (const el of root.querySelectorAll('input, textarea, button')) {
    if (!visible(el) || inPanel(el)) continue
    const n = fiberName(el)
    if (!n) continue
    let g = groups.get(n)
    if (!g) { g = { name: n, els: [] }; groups.set(n, g) }
    g.els.push(el)
  }

  const group = groups.get(name)
  if (!group) return 'not_found'

  const type = classify(group.els)
  if (!type) return 'not_found'

  const primary = group.els.find(e => e.tagName !== 'BUTTON') || group.els[0]

  if (ignoreDisabled && primary.disabled) return 'skipped_disabled'
  if (skipOptional && isOptional) return 'skipped_optional'

  if (skipFilled) {
    // Toggles and pills always hold a value, so "already filled" is meaningless
    // for them — treat them as never-skipped, matching v1's checkbox handling.
    if (type !== 'toggle' && type !== 'pills') {
      const control = fiberControl(primary)
      let cur = ''
      if (control && control._formValues) {
        const stored = name.split('.').reduce((o, k) => (o == null ? o : o[k]), control._formValues)
        if (stored !== undefined && stored !== null) cur = stored
      } else if (primary.value != null) {
        cur = primary.value
      }
      const empty = cur === '' || cur === false || (Array.isArray(cur) && cur.length === 0)
      if (!empty) return 'skipped_filled'
    }
  }

  if (type === 'select') {
    return (await fillPanel(group.els.find(e => e.tagName === 'BUTTON'), value)) ? 'ok' : 'not_found'
  }

  if (type === 'multiselect') {
    // The list filters as you type and the box clears itself after a pick, so
    // there is nothing to read back from the input. Seed it with one character
    // and take the first offer — the same approach the skill's addTag uses.
    const box = group.els.find(e => e.tagName === 'INPUT')
    if (!box || box.disabled) return 'not_found'
    const seed = String(value == null ? '' : value).trim().slice(0, 1) || 'a'
    setNative(box, seed)
    await sleep(300)
    return (await fillPanel(box, value)) ? 'ok' : 'not_found'
  }

  if (type === 'toggle' || type === 'pills' || type === 'radio') {
    const buttons = group.els.filter(e => e.tagName === 'BUTTON' && e.textContent.trim())
    if (!buttons.length) return 'not_found'
    let target = null
    if (typeof value === 'boolean') {
      // A CHECKBOX descriptor renders as a two-segment Tidak/Ya toggle: index 0
      // is off, index 1 is on.
      target = value ? buttons[buttons.length - 1] : buttons[0]
    } else {
      const str = String(value == null ? '' : value)
      target = (str && buttons.find(b => b.textContent.trim() === str)) || buttons[0]
    }
    target.click()
    await sleep(100)
    return 'ok'
  }

  if (type === 'checkbox') {
    const el = group.els.find(e => e.tagName === 'INPUT')
    if (!el) return 'not_found'
    if (el.checked !== Boolean(value)) { el.click(); await sleep(80) }
    return 'ok'
  }

  // text, textarea, password, date, and the masked/currency inputs — all take a
  // typed string. DateField strips non-digits from what it receives, so the
  // DD-MM-YYYY the smart defaults emit lands correctly without conversion.
  if (!primary || (primary.tagName !== 'INPUT' && primary.tagName !== 'TEXTAREA')) return 'not_found'
  setNative(primary, value == null ? '' : value)
  await sleep(120)

  /**
   * 🔴 Re-sync after a MASKED write, or the store keeps an over-length value the
   * screen does not show.
   *
   * `setNative` writes through the prototype setter and fires a synthetic
   * `input`, which bypasses Cleave's keystroke pipeline: Cleave reformats and
   * TRUNCATES the visible value to the mask's capacity, but react-hook-form has
   * already captured the raw string we wrote. The two then disagree, and the
   * form looks correct while holding something the API will reject.
   *
   * Measured on the debtor form 2026-08-11, with a smart-default NIB and NPWP:
   *
   *   NIB   RHF "91202065083971"       (14 digits)  · shown 13 digits
   *   NPWP  RHF "75136717010451433267" (20 digits)  · shown 16 digits
   *
   * The only visible symptom was the field's own `13/13`-style counter reading
   * 14/13 and 20/16 — it counts the STORED value, so it was right and everything
   * else looked fine. Nothing else flagged it, and the driver reported 'ok'.
   *
   * Writing the digits BACK converges: the mask reformats an already-short value
   * to the same display, so RHF ends up matching the screen. A write that was
   * not truncated leaves the digit counts equal and this is a no-op — which is
   * why it is safe for dates ("28-06-1976" → "28/06/1976") and currency
   * ("5000000000" → "5.000.000.000"), where only the separators differ.
   */
  const digitsOf = s => String(s == null ? '' : s).replace(/\D/g, '')
  const wrote = digitsOf(value)
  const shown = digitsOf(primary.value)
  if (wrote.length > shown.length && shown.length > 0) {
    setNative(primary, shown)
    await sleep(120)
  }

  primary.blur()
  await sleep(60)
  return 'ok'
}

// ─── Financial tables ─────────────────────────────────────────────────────────
// Deliberately not implemented for v2 (scope: generic fields + stepper).
// v2's financial tables are a different component from v1's — see
// app-v2/credit-application/create/FinancialTable.tsx — and the skill records
// that a Neraca will not save unless it BALANCES, so porting this needs its own
// verification pass rather than a reused heuristic. Returning 0 keeps the
// driver contract uniform so popup.js does not need to special-case v2.
async function v2FillTables() {
  return 0
}

// ─── Read values back ─────────────────────────────────────────────────────────
// One fiber walk yields the whole RHF store, which is both cheaper and more
// accurate than scraping: it returns the stored codes rather than the labels
// the selects display.
function v2ReadValues(fieldNames) {
  const root = document.querySelector('[role="dialog"]')
    || document.querySelector('[data-m="stepcard"]')
    || document.body

  function fiberControl(el) {
    const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))
    if (!key) return null
    let f = el[key], d = 0
    while (f && d++ < 200) {
      const p = f.memoizedProps
      if (p && p.control && typeof p.name === 'string') return p.control
      f = f.return
    }
    return null
  }

  let store = null
  for (const el of root.querySelectorAll('input, textarea, button')) {
    const c = fiberControl(el)
    if (c && c._formValues) { store = c._formValues; break }
  }

  const out = {}
  for (const n of fieldNames) {
    if (/^WF_(COND|STAGE)\./.test(n) && typeof wfReadBlock === 'function') {
      const wfValue = wfReadBlock(n)
      out[n] = wfValue === undefined || wfValue === null ? '' : wfValue
      continue
    }
    const v = store ? n.split('.').reduce((o, k) => (o == null ? o : o[k]), store) : undefined
    out[n] = v === undefined || v === null ? '' : v
  }
  return out
}

// ─── Wizard navigation ────────────────────────────────────────────────────────
// The rail is StepRail's `[data-m="railstep"]` buttons. Its onSelect (`goTo` in
// CustomFormWizard/index.tsx) only checks `isStepDisabled` — it does NOT
// validate — so scanning by rail click cannot be blocked by an incomplete step.
// That mirrors why v1 navigates by MuiStepLabel rather than the Next button.
//
// The active step carries no class, no aria-current and no data attribute; it
// is distinguished only by an inline `borderLeft` in the accent colour, which
// every inactive step leaves `transparent`.
function v2ActiveStepIndex() {
  const steps = Array.from(document.querySelectorAll('[data-m="railstep"]'))
  for (let i = 0; i < steps.length; i++) {
    const c = getComputedStyle(steps[i]).borderLeftColor
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return i
  }
  return -1
}

// Returns -1 when a modal is open, so the scan loop treats the modal as a
// single-step form instead of navigating the wizard behind it.
//
// ⚠️ A v2 form does not always use the RAIL. The workflow builder steps through
// `[role="tab"]` instead, and this used to fall through to `return 0` on it —
// reporting "on step 1 of a rail wizard" for a form that has no rail at all. A
// scan loop then advanced by clicking rail steps that do not exist, found no
// next, and concluded the form was one step long. Tabs are checked as a second
// dialect rather than defaulted over.
function v2CurrentStep() {
  if (document.querySelector('[role="dialog"]')) return -1

  const steps = Array.from(document.querySelectorAll('[data-m="railstep"]'))
  for (let i = 0; i < steps.length; i++) {
    const c = getComputedStyle(steps[i]).borderLeftColor
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return i
  }
  if (steps.length) return 0

  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  if (tabs.length) {
    const active = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true')
    return active >= 0 ? active : 0
  }

  return 0
}

function v2GoToStep(idx) {
  const steps = document.querySelectorAll('[data-m="railstep"]')
  if (steps[idx]) { steps[idx].click(); return true }

  const tabs = document.querySelectorAll('[role="tab"]')
  if (tabs[idx]) { tabs[idx].click(); return true }

  return false
}

// Returns 'clicked' or 'no_next'.
function v2AdvanceStep() {
  if (document.querySelector('[role="dialog"]')) return 'no_next'

  const steps = Array.from(document.querySelectorAll('[data-m="railstep"]'))
  if (steps.length) {
    let cur = -1
    for (let i = 0; i < steps.length; i++) {
      const c = getComputedStyle(steps[i]).borderLeftColor
      if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') { cur = i; break }
    }
    if (cur >= 0) {
      /**
       * Skip DISABLED rail steps instead of clicking one and reporting success.
       *
       * 🔴 `isStepDisabled` gates real steps: on the credit application with a
       * fresh COMPANY_PRODUCTIVE / NEW application, rail 5 (Penilaian Kredit)
       * and 6 (Tahapan Pengajuan) are disabled while 7 (Data Pendukung) and
       * 8 (Log Aktivitas) are NOT. Clicking the immediate next step therefore
       * did nothing, returned 'clicked' anyway, and the scan loop's
       * no-movement guard ended the sweep at step 4 — silently missing two
       * reachable steps and reporting the form as five steps long.
       *
       * A disabled step is opacity-dimmed and carries `disabled` / the
       * aria attribute, so it is cheap to detect. Measured 2026-08-11.
       */
      for (let i = cur + 1; i < steps.length; i++) {
        const s = steps[i]
        const off = s.disabled === true || s.getAttribute('aria-disabled') === 'true'
        if (off) continue
        s.click()
        return 'clicked'
      }
      return 'no_next'
    }
  }

  // Tabbed forms (the workflow builder) — same idea, different dialect.
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  if (tabs.length) {
    const cur = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true')
    const next = tabs[(cur < 0 ? 0 : cur) + 1]
    if (!next) return 'no_next'
    next.click()
    return 'clicked'
  }

  // An embedded wizard renders no rail — fall back to the footer's primary
  // button. This one DOES validate, so it can legitimately refuse to advance.
  const footer = document.querySelector('[data-m="footerprimary"]') || document
  const NEXT_RE = /\b(selanjutnya|lanjutkan|lanjut|berikutnya|next|continue|proceed)\b/i
  for (const btn of footer.querySelectorAll('button:not([disabled])')) {
    const text = (btn.textContent || '').trim()
    if (NEXT_RE.test(text) && text.length < 40) { btn.click(); return 'clicked' }
  }
  return 'no_next'
}

// ─── Public API ───────────────────────────────────────────────────────────────
window.__autofill = {
  detect: v2Detect,
  fill: v2FillField,
  read: v2ReadValues,
  smartDefault,
  step: { current: v2CurrentStep, goTo: v2GoToStep, advance: v2AdvanceStep },

  /**
   * The controlled-by-props blocks (Konfigurasi → Workflow Engine).
   *
   * `detect`/`fill`/`read` above already cover these via their WF_COND.* /
   * WF_STAGE.* synthetic names — this is the direct handle for the structural
   * operations that have no field name at all: adding a group, a parameter row,
   * a stage, or a respondent.
   */
  wf: {
    conditions: wfConditionProps,
    stages: wfStageProps,
    rows: wfRows,
    rail: wfRail,
    stageField: wfStageField,
    pick: wfPickOption,
    panel: wfPanel,
    closePanel: wfClosePanel,
    labelFor: wfLabelFor,
    setNative: wfSetNativeValue,
    DISPLAY: WF_DISPLAY,
    TYPE: WF_TYPE,
    RULE: WF_RULE,

    /** Click a named page-level button, e.g. 'Tambah Kelompok'. */
    btn: text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text),

    /**
     * Add one respondent to the ACTIVE stage.
     *
     * ⚠️ The row's commit control is a `Pilih ›` SPAN, not a button — a driver
     * that only clicks buttons finds the modal, finds the row, and silently does
     * nothing. The modal closes after ONE pick, so this is one call per person,
     * and searching first is not optional: the list is 14 pages deep.
     */
    async addPerson(query, opener = 'Tambah responden') {
      const nap = ms => new Promise(r => setTimeout(r, ms))
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === opener)
      if (!b) return 'no_opener'
      b.click()
      await nap(900)
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg) return 'no_dialog'
      const inp = dlg.querySelector('input')
      if (!inp) return 'no_search'
      wfSetNativeValue(inp, query)
      await nap(1100)
      const live = document.querySelector('[role="dialog"]') || dlg
      const pick = [...live.querySelectorAll('span,div,a')].find(
        e => e.children.length === 0 && /^Pilih/.test(e.textContent.trim())
      )
      if (!pick) {
        const close = [...live.querySelectorAll('button')].find(x => x.textContent.trim() === 'Tutup')
        if (close) close.click()
        return 'no_match:' + query
      }
      pick.click()
      await nap(600)
      return 'ok'
    }
  },

  /**
   * Detect the current step (or open modal) and fill it.
   *
   * Returns per-field statuses AND a `values` read-back, because a fill helper
   * that reports success without reading the value back is worthless — that is
   * how five labels once resolved to one input while every call returned true.
   */
  async run({ delayMs = 120, skipFilled = false, skipOptional = false, ignoreDisabled = true, only = null, values = {} } = {}) {
    const nap = ms => new Promise(r => setTimeout(r, ms))
    let fields = await v2Detect()
    if (only) fields = fields.filter(f => only.includes(f.name))

    const status = {}
    for (const f of fields) {
      const value = f.name in values ? values[f.name] : smartDefault(f.name, f.label, f.type, f.options)
      try {
        status[f.name] = await v2FillField(f.name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, Boolean(f.optional))
      } catch (e) {
        status[f.name] = 'error: ' + e.message
      }
      await nap(delayMs)
    }

    const after = v2ReadValues(fields.map(f => f.name))
    const stillEmpty = fields
      .filter(f => { const v = after[f.name]; return v === '' || v === false || (Array.isArray(v) && !v.length) })
      .map(f => f.label || f.name)

    return { filled: fields.length, status, values: after, stillEmpty }
  }
}
