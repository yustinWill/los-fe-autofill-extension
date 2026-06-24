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
const LABEL_DEFAULTS = {
  // ── Identitas ──────────────────────────────────────────────────────────────
  'nama lengkap':                              'Budi Santoso',
  'nama alias':                                'Budi',
  'nomor ktp':                                 '3201012345670001',
  'nomor npwp':                                '1234567890123456',
  'nomor nib':                                 '1234567890123',
  'id privy':                                  'PRV123456',

  // ── Kontak ─────────────────────────────────────────────────────────────────
  'nomor handphone':                           '08123456789',
  'nomor telepon rumah':                       '02112345678',
  'nomor telepon perusahaan':                  '02112345678',
  'alamat email':                              'budi.santoso@example.com',

  // ── Lahir / pendirian ──────────────────────────────────────────────────────
  'tanggal lahir':                             '15-01-1990',
  'tanggal pendirian':                         '20-05-2010',

  // ── Alamat ─────────────────────────────────────────────────────────────────
  'alamat tempat tinggal (sesuai ktp)':        'Jl. Sudirman No. 1',
  'alamat tempat tinggal (domisili)':          'Jl. Sudirman No. 1',
  'alamat perusahaan':                         'Jl. Thamrin No. 10',
  'kode pos':                                  '10310',
  'rw':                                        '002',
  'rt':                                        '001',

  // ── Keluarga ───────────────────────────────────────────────────────────────
  'nama ayah kandung':                         'Slamet Riyadi',
  'nama ibu kandung':                          'Siti Aminah',
  'nama pasangan':                             'Dewi Santoso',
  'jumlah saudara kandung':                    '2',
  'jumlah tanggungan':                         '1',
  'nomor kartu keluarga':                      '3201011234560001',

  // ── Pekerjaan ──────────────────────────────────────────────────────────────
  'jabatan':                                   'Staff',
  'lama bekerja':                              '5',
  'nama perusahaan':                           'PT Maju Sejahtera',
  'nama dagang perusahaan':                    'Maju Sejahtera',

  // ── Keuangan ───────────────────────────────────────────────────────────────
  'nominal pendapatan':                        '5000000',
  'nominal pengeluaran':                       '2000000',
  'total pendapatan':                          '5000000',
  'total pengeluaran':                         '2000000',
  'plafond':                                   '50000000',
  'tenor':                                     '24',

  // ── Perusahaan / legal ─────────────────────────────────────────────────────
  'nama notaris':                              'Budi Notaris, SH',
  'nomor akta':                                '01',
  'nomor sk':                                  'AHU-12345.AH.01.01.2020',
  'nomor nib perusahaan':                      '9120205012345',
}

// Pattern-based fallback — searched against "FIELD_NAME label" lowercased.
const SMART_RULES = [
  [/\b(ibu kandung|mother name|nama ibu)\b/,                        'Siti Aminah'],
  [/\b(ayah kandung|father name|nama ayah)\b/,                      'Slamet Riyadi'],
  [/\b(nama alias|alias name|panggilan)\b/,                         'Budi'],
  [/\b(nama pasangan|spouse name)\b/,                               'Dewi Santoso'],
  [/\b(nama lengkap|full name|debtor.*full)\b/,                     'Budi Santoso'],
  [/\b(nama perusahaan|company name)\b/,                            'PT Maju Sejahtera'],
  [/\b(nama dagang|trade name)\b/,                                  'Maju Sejahtera'],
  [/\bnomor ktp\b/,                                                 '3201012345670001'],
  [/\bnomor npwp\b/,                                                '1234567890123456'],
  [/\bnomor nib\b/,                                                 '1234567890123'],
  [/\b(passport|paspor)\b/,                                         'A1234567'],
  [/\b(kartu keluarga|family card)\b/,                              '3201011234560001'],
  [/\bprivy\b/,                                                     'PRV123456'],
  [/\bemail\b/,                                                     'budi.santoso@example.com'],
  [/\b(handphone|mobile phone|no hp)\b/,                            '08123456789'],
  [/\b(telepon rumah|home phone)\b/,                                '02112345678'],
  [/\b(telepon perusahaan|company phone|nomor telepon)\b/,          '02112345678'],
  [/\bfax\b/,                                                       '02112345679'],
  [/\b(website|url)\b/,                                             'https://example.com'],
  [/\b(alamat|full address|address)\b/,                             'Jl. Sudirman No. 1'],
  [/\b(kelurahan|sub district)\b/,                                  'Menteng'],
  [/\b(kecamatan|district)\b/,                                      'Menteng'],
  [/\b(kota|city|kabupaten)\b/,                                     'Jakarta Pusat'],
  [/\b(provinsi|province)\b/,                                       'DKI Jakarta'],
  [/\b(kode pos|postal code)\b/,                                    '10310'],
  [/\b(negara|country)\b/,                                          'Indonesia'],
  [/(^| )rw( |$)/,                                                  '002'],
  [/(^| )rt( |$)/,                                                  '001'],
  [/\b(tempat lahir|birth place|tempat pendirian)\b/,               'Bandung'],
  [/\b(tanggal lahir|birth date|tanggal pendirian)\b/,              '15-01-1990'],
  [/\bjabatan\b/,                                                   'Staff'],
  [/\b(lama bekerja|work duration)\b/,                              '5'],
  [/\b(jumlah saudara|sibling count)\b/,                            '2'],
  [/\b(jumlah tanggungan|dependent count)\b/,                       '1'],
  [/\b(nominal pendapatan|income amount)\b/,                        '5000000'],
  [/\b(nominal pengeluaran|expense amount)\b/,                      '2000000'],
  [/\btotal pendapatan\b/,                                          '5000000'],
  [/\btotal pengeluaran\b/,                                         '2000000'],
  [/\b(plafond|jumlah pinjaman|loan amount)\b/,                     '50000000'],
  [/\b(tenor|jangka waktu)\b/,                                      '24'],
  [/\bnomor sk\b/,                                                  'AHU-12345.AH.01.01.2020'],
  [/\bnomor akta\b/,                                                '01'],
  [/\bnotaris\b/,                                                   'Budi Notaris, SH'],
  [/\b(catatan|keterangan|deskripsi|description|note)\b/,           'Tidak ada keterangan'],
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

  // 1. Exact label match (highest priority)
  const normLabel = label.replace(/\s*\*\s*$/, '').trim().toLowerCase()
  if (normLabel && normLabel in LABEL_DEFAULTS) return LABEL_DEFAULTS[normLabel]

  const searchKey = (name + ' ' + label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  // 2. Native date input (type='date') — ISO format required
  if (type === 'date') {
    if (/\b(lahir|birth|dob|pendirian|establishment)\b/.test(searchKey)) return '1990-01-15'
    return ''
  }

  // 3. Regex pattern rules
  for (const [pattern, defaultVal] of SMART_RULES) {
    if (pattern.test(searchKey)) return defaultVal
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

  // If one or more MUI dialogs are open, scope field discovery to the topmost visible one.
  // MUI marks background dialogs with aria-hidden="true" on their root container — the
  // active (topmost) dialog has no such ancestor. Use .MuiDialog-paper to avoid matching
  // the react-datepicker calendar which also has role="dialog" aria-modal="true".
  // Listbox portals always use document directly (they render outside the dialog tree).
  const allDialogs = Array.from(document.querySelectorAll('.MuiDialog-paper[role="dialog"][aria-modal="true"]'))
  const modalRoot = allDialogs.find(d => !d.closest('[aria-hidden="true"]')) || null
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
    if (document.querySelector('[role="listbox"]')) await closeListbox(btn)
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
    if (!lb) {
      await closeListbox(trigger)
      return []
    }
    const opts = Array.from(lb.querySelectorAll('[role="option"]')).map(o => ({ value: o.getAttribute('data-value') || o.textContent.trim(), label: o.textContent.trim() }))
    await closeListbox(trigger)
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
    const m = strVal.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/)
    if (!m) return false

    const targetDay   = +m[1]
    const targetMonth = +m[2]  // 1-12
    const targetYear  = +m[3]
    const dateObj     = new Date(targetYear, targetMonth - 1, targetDay)

    const inp = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
    if (!inp) return false

    // ── Find the DatePicker class instance via fiber walk ─────────────────────
    // DatePicker has both setOpen() and setSelected(). Walking from the input
    // fiber upward finds it regardless of portal/dialog boundaries.
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
function getCurrentStepIndex() {
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
  for (const f of fields) {
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
  summary.textContent = `${ok} / ${entries.length - totalSkip}`
  resultStrip.appendChild(summary)

  for (const [name, status] of entries) {
    const b = document.createElement('span')
    if (status === 'ok') {
      b.className = 'badge badge-ok'
      b.innerHTML = `<span style="flex-shrink:0">✓</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>`
    } else if (status === 'skipped_disabled') {
      b.className = 'badge badge-skip'
      b.title = 'Skipped (disabled)'
      b.innerHTML = `<span style="flex-shrink:0">—</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>`
    } else if (status === 'skipped_filled') {
      b.className = 'badge badge-skip'
      b.title = 'Skipped (already filled)'
      b.innerHTML = `<span style="flex-shrink:0">·</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>`
    } else if (status === 'skipped_optional') {
      b.className = 'badge badge-skip'
      b.title = 'Skipped (optional)'
      b.innerHTML = `<span style="flex-shrink:0">○</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>`
    } else {
      b.className = 'badge badge-err'
      b.title = 'Not found on page'
      b.innerHTML = `<span style="flex-shrink:0">✗</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span>`
    }
    resultStrip.appendChild(b)
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setStepActive(1)

// ── Persist checkbox prefs ────────────────────────────────────────────────────
;(async () => {
  const prefs = await chrome.storage.local.get(['pref_allSteps', 'pref_ignoreDisabled', 'pref_skipFilled', 'pref_skipOptional'])
  if (prefs.pref_allSteps      !== undefined) allStepsCb.checked      = prefs.pref_allSteps
  if (prefs.pref_ignoreDisabled !== undefined) ignoreDisabledCb.checked = prefs.pref_ignoreDisabled
  if (prefs.pref_skipFilled    !== undefined) skipFilledCb.checked    = prefs.pref_skipFilled
  if (prefs.pref_skipOptional  !== undefined) skipOptionalCb.checked  = prefs.pref_skipOptional
})()

allStepsCb.addEventListener('change',      () => chrome.storage.local.set({ pref_allSteps:      allStepsCb.checked }))
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

// ── Quick Fill auto-run ───────────────────────────────────────────────────────
// Default left-click opens the popup and auto-runs the full wizard loop.
// Right-click "Open Panel" sets suppressAutoRun so we skip it.
;(async () => {
  const { suppressAutoRun } = await chrome.storage.session.get('suppressAutoRun')
  await chrome.storage.session.remove('suppressAutoRun')
  if (suppressAutoRun) return

  await sleep(300)
  await runAllWizardSteps()
  await sleep(900)
  window.close()
})()
