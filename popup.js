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
const delayInput       = document.getElementById('delayInput')
const allStepsCb       = document.getElementById('allStepsCb')

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

const fillModalCb      = document.getElementById('fillModalCb')
const tickCheckboxesCb = document.getElementById('tickCheckboxesCb')

/**
 * Four settings were removed from the UI and fixed ON, because none of them had
 * a defensible "off" — an option whose wrong setting silently produces a worse
 * result is a trap, not a choice (user, 2026-08-11: "I'm afraid it will be
 * information overload").
 *
 * · ALWAYS_SKIP_DISABLED — a disabled input cannot be written to. Off just
 *   spends a round trip per field to be told so.
 * · ALWAYS_REVEAL_GATED  — off silently UNDER-REPORTS. A gated section is
 *   absent from the DOM, not hidden, so leaving the gate shut is
 *   indistinguishable from the section not existing. That is the bug the
 *   setting was added to fix, so shipping it turn-off-able reintroduced it.
 * · ALWAYS_DOUBLE_CHECK  — a re-scan can only ever find MORE fields. The cost
 *   is one extra scan when nothing new appeared.
 * · Detect-modals is gone entirely: it was a read-only subset of Fill modals,
 *   and its single detect pass under-counted anything that mounts fields after
 *   a select — an honest-looking number that was always low.
 */
const ALWAYS_SKIP_DISABLED = true
const ALWAYS_REVEAL_GATED  = true
const ALWAYS_DOUBLE_CHECK  = true

/**
 * Mirror the execute-side checkbox into the module flag `smartDefault` reads.
 *
 * ⚠️ DEFINED here, but not CALLED here. `TICK_CHECKBOXES` is declared further
 * down, inside the block `build-bundle.sh` extracts, and `let` has no hoisting —
 * so calling this during the top-level run threw
 * `Cannot access 'TICK_CHECKBOXES' before initialization`, popup.js aborted
 * mid-evaluation, and NO handler ever bound. Every button was dead, which
 * presents as "Quick Fill stopped working" rather than as a load error nobody
 * opens the console to see. The call lives in the init block at the bottom.
 */
const syncTickCheckboxes = () => { TICK_CHECKBOXES = Boolean(tickCheckboxesCb && tickCheckboxesCb.checked) }

/** DETECT-side: open gates before reading, so hidden fields are counted. */
const shouldReveal = () => ALWAYS_REVEAL_GATED

/**
 * May the run click a CHECKBOX — in the reveal pass as well as the fill?
 *
 * 🔴 This is the whole of "Tick checkboxes", and it used to govern only half the
 * run. `shouldReveal()` reads a hardcoded constant, so the reveal pass ticked
 * gate checkboxes whatever this option said; the fill then skipped them
 * (correctly, see below) and the tick was LEFT ON SCREEN. The user turned the
 * option off and watched a checkbox get ticked anyway — confirmed on v1
 * 2026-08-11, "Menggunakan Referensi Pengajuan Kredit" unticked → TICKED.
 *
 * It now gates BOTH passes: off means no checkbox is clicked anywhere.
 *
 * ⚠️ The honest cost, so nobody "fixes" this back: a section gated behind a
 * checkbox is ABSENT from the DOM rather than hidden, so with this off it is
 * neither detected nor filled and the run's field count is genuinely lower.
 * That trade is what the option exists to offer. Ya/Tidak radio gates are still
 * opened — they are not checkboxes and the user did not opt out of them.
 */
const mayClickCheckboxes = () => Boolean(tickCheckboxesCb && tickCheckboxesCb.checked)

/**
 * Should the fill leave checkbox-ish fields ALONE?
 *
 * Yes whenever the option is off — and note it SKIPS rather than writing false.
 * "Do not tick" means do not tick; it does not mean untick. Writing false would
 * also close any gate the user opened BY HAND, taking that section's fields with
 * it, after which every later fill reports not_found and reads as a broken
 * driver rather than as the run closing its own door.
 */
const shouldSkipCheckboxFills = () => !mayClickCheckboxes()

const isCheckboxField = f =>
  f && (f.type === 'checkbox' || f.type === 'checkbox_group' || f.type === 'toggle')

/**
 * Fields the run must NEVER answer, whatever the options say.
 *
 * 🔴 "Menggunakan Referensi Pengajuan Kredit" is a BUSINESS QUESTION wearing a
 * gate's clothes (B53 #1, user, 2026-08-16). Turning it on puts step 1 into
 * reference mode, which makes a reference picker REQUIRED — so a Quick Fill run
 * finished on a form that could not be submitted, having answered a question
 * only the user can answer. Revealing a hidden section and answering a business
 * question are two jobs, and they were sharing one switch.
 *
 * ⚠️ v1's reveal already tried to catch this by COUNTING live inputs before and
 * after, and its own comment (`driver-v1.js:1342`) records that the count RISES
 * here — 6 → 8, because reference mode ADDS a picker while removing the
 * facility section — so the heuristic kept the tick on the very control it
 * cites. A count cannot tell a gate from a mode switch. This names them.
 *
 * ⚠️ `HAS_AVALIST` joined them 2026-08-17 (user). It is not a reference switch
 * but it is the same KIND of control: turning it Ya makes Kode Avalis required,
 * and choosing an avalis is a two-click picker the user would rather do
 * themselves than have a run guess at. The test is "would a wrong answer here
 * cost the user more than an unanswered one" — for a gate that opens a required
 * picker, it always does.
 *
 * Keyed on the SHAPE rather than one field: `*USE_REFERENCE*` and
 * `*USING_REFERENCE*` all mean "reuse another record instead of filling this
 * one" — today `CREDIT_APPLICATION_REFERENCE_DATA_USE_REFERENCE`,
 * `DEBTOR_GENERAL_DATA_IS_USING_REFERENCE_DEBTOR` and
 * `CREDIT_APPLICATION_APPLICATION_DATA_RESTRUCT_OR_EXTENSION_USE_REFERENCE`.
 * The asymmetry favours skipping: leaving one OFF keeps the form in its normal
 * mode, turning one ON is what breaks validation.
 *
 * SKIPPED, never written false — writing false would close a gate the user
 * opened BY HAND and take that section's fields with it, the same reasoning as
 * `shouldSkipCheckboxFills` above.
 */
const isUserGate = f => Boolean(f && /USE_REFERENCE|USING_REFERENCE|HAS_AVALIST/.test(f.name || ''))

/**
 * The ONE predicate every fill site filters on.
 *
 * ⚠️ There are three of them, and "a filter applied to one branch of a
 * two-branch fill is not applied" is a trap this extension has already paid for
 * (2026-08-15: "reveal on, tick off" still answered every gate, because the
 * filter fed only the single-step path while the multi-step path iterated raw
 * buckets). Adding a rule to one site and not the others is how that recurs.
 */
const skipField = f => isUserGate(f) || (shouldSkipCheckboxFills() && isCheckboxField(f))

/**
 * Run the reveal and wait only as long as it actually needs.
 *
 * A flat sleep here was 600ms on EVERY step — paid in full on the steps with no
 * gates at all, which is most of them. `v1RevealGated` already awaits ~260ms
 * after each click it makes, so React has settled by the time it returns; it
 * also reports WHAT it flipped. Nothing flipped means nothing to wait for.
 *
 * On the v1 credit application only step 4 has gates, so across a 7-step sweep
 * this drops roughly 4.2s of dead time to about 0.2s.
 */
/**
 * ⚠️ `args` is the ONLY way to get a value into `func`. It is serialised with
 * `Function.toString()` and re-evaluated in the page, so it closes over nothing
 * from this file — reading `mayClickCheckboxes()` inside it would throw.
 */
async function revealAndSettle(driver, tabId) {
  const [{ result: flipped }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func: driver.reveal, args: [mayClickCheckboxes()]
  })
  if (Array.isArray(flipped) && flipped.length) await sleep(200)
  return flipped || []
}
const statusBar      = document.getElementById('statusBar')
const statusText     = document.getElementById('statusText')

/**
 * How far a run reaches into the "Tambah …" record modals: 'page' | 'fill'.
 *
 * Fill is the default: a page-only run silently UNDER-REPORTS, because
 * v1Detect scopes itself to an open dialog and nothing else opens one. On the
 * v1 credit application that is 84 fields versus 179.
 *
 * A read-only 'detect' scope existed briefly and was dropped — it was a subset
 * of this one whose single pass under-counted every modal that mounts fields
 * after a select, which is most of them.
 */
const currentScope = () => {
  if (fillModalCb && fillModalCb.checked) return 'fill'
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
  statusBar.classList.toggle('is-idle',  !text)
  statusBar.classList.toggle('is-done',  state === 'done')
  statusBar.classList.toggle('is-error', state === 'error')
  statusText.textContent = text || 'Ready'
  logEvent('status', { text, state })
}

// ── Run log ───────────────────────────────────────────────────────────────────
/**
 * A structured account of one run, because the status bar is a SUMMARY and a
 * summary cannot be debugged.
 *
 * 🔴 The specific failure that forced this: the user reported the reference
 * gate switched on after a run. The driver refuses gate-shaped names outright
 * (`driver-v2.js` → `skipped_user_gate`), so "the toggle is on" is consistent
 * with TWO opposite stories — the driver leaked, or the toggle was already on
 * and `skipFilled` correctly left it. A screenshot cannot separate them and a
 * one-line status never could. `gates-before` / `gates-after` can, in one run.
 *
 * ⚠️ Kept in memory AND mirrored to `chrome.storage.local`, because the popup
 * is destroyed on close and an unrecorded run is unrecoverable — the same
 * reason the popup now stays open on failure.
 */
let runLog = []

/**
 * What each field was actually WRITTEN WITH — not just how it went.
 *
 * 🔴 The status map alone cannot explain the failure it was built for. A run
 * whose plan asked for "Kredit Badan Usaha - Produktif" ended on
 * "Kredit Perorangan - Konsumtif" with the field reported `ok`, and both that
 * field and Jenis Pengajuan landed on the FIRST option of their control — which
 * is exactly what `smartDefault` returns when `simOverride` yields nothing.
 * Whether the plan's value reached the fill is therefore the question, and only
 * the value can answer it.
 *
 * `deliberate` is the discriminator: true means the value came from the plan or
 * a manual override (and so bypassed `skipFilled`), false means it was invented
 * by `smartDefault`. A deliberate value that did not land is an app or driver
 * bug; a non-deliberate one on a planned field means the plan never arrived.
 */
let fieldDetail = {}

const recordFieldDetail = (field, value, deliberate, status) => {
  try {
    fieldDetail[field.name] = {
      label: field.label,
      type: field.type,
      wrote: typeof value === 'string' ? value.slice(0, 120) : value,
      deliberate,
      status
    }
  } catch (_) { /* never let logging break a run */ }
}

const logEvent = (kind, data) => {
  try {
    runLog.push({ t: Date.now(), kind, data })
  } catch (_) {
    /* never let logging break a run */
  }
}

const persistRunLog = () => {
  try {
    chrome.storage.local.set({ last_run_log: JSON.stringify(runLog) })
  } catch (_) { /* quota or context gone — the in-memory copy still serves the button */ }

  const btn = document.getElementById('copyLogBtn')

  if (btn) btn.classList.remove('hidden')
}

/**
 * Read every user-gate control's CURRENT on-screen state.
 *
 * ⚠️ Self-contained on purpose: `chrome.scripting.executeScript` serialises this
 * function ALONE via `Function.toString()`, so anything it calls from module
 * scope is `undefined` in the page. That trap has cost this repo a whole
 * afternoon of green harnesses over code that would have thrown on every fill.
 *
 * Reports RAW signal rather than a verdict — aria state, text, and the selected
 * option per control — because the point of a log is to be re-read later by
 * someone testing a hypothesis this function did not anticipate.
 */
function readGateState() {
  const GATE = /Referensi Pengajuan Kredit|Memiliki Avalis|Menggunakan Referensi/i
  const out = []
  const seen = new Set()

  /* 🔴 A LEAF SWEEP, not `label, [class*="label"]`. The first version used that
     selector and returned [] on every run — the v2 gate label is a BARE <span>
     with no class at all, so it matched nothing and the snapshot silently
     answered nothing on the one question it exists for. Measured live
     2026-08-18 before this version shipped. */
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length !== 0) return

    const text = (el.textContent || '').trim()

    if (!GATE.test(text) || text.length > 80 || seen.has(text)) return

    // The pill group is a sibling of the label inside the field wrapper; climb
    // until an ancestor holds buttons, bounded so a miss cannot reach <body>.
    let host = el.parentElement
    let hops = 0

    while (host && hops < 5 && host.querySelectorAll('button').length === 0) {
      host = host.parentElement
      hops++
    }

    const buttons = host ? [...host.querySelectorAll('button')] : []

    /* A gate is a Ya/Tidak pair. More than four buttons means the climb
       overshot into a section, which is how the "Data Referensi Pengajuan
       Kredit" HEADING first came back carrying six unrelated controls. */
    if (!buttons.length || buttons.length > 4) return

    seen.add(text)

    const options = buttons.map(b => ({
      text: (b.innerText || '').trim(),
      ariaPressed: b.getAttribute('aria-pressed'),
      ariaChecked: b.getAttribute('aria-checked'),
      dataState: b.getAttribute('data-state'),
      disabled: b.disabled,
      bg: getComputedStyle(b).backgroundColor,
      color: getComputedStyle(b).color
    }))

    /* ⚠️ These pills carry NO aria state — measured, all null. So selection is
       only visible in the paint: the chosen option gets an opaque background,
       the other is transparent. Derived here for readability, with every raw
       value kept beside it, because a log is re-read later by someone testing
       a hypothesis this function did not anticipate. */
    const chosen = options.find(o => o.bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(o.bg))

    out.push({ label: text, selected: chosen ? chosen.text : null, options })
  })

  return out
}

async function snapshotGates(phase) {
  try {
    const tab = await getActiveTab()

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: readGateState
    })

    logEvent('gates-' + phase, result)

    return result
  } catch (err) {
    logEvent('gates-' + phase, { error: String((err && err.message) || err) })

    return null
  }
}
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
const variantHint      = document.getElementById('variantHint')

// ─── Driver selection ─────────────────────────────────────────────────────────
// 'auto' probes the page; 'v1'/'v2' force a dialect. Forcing matters during the
// migration: a v2 route hosting a legacy MUI modal probes as v2, and the v1
// driver is the one that can actually read that modal.
/* Always auto. The dialect is a property of the PAGE, not a preference — the
   probe reads the DOM and is right by construction, while a manual override is
   only ever right until you navigate. It shipped as a select, was never a real
   decision, and a wrong forced value produces "0 fields" with no explanation
   (user, 2026-08-11). The detected value is still SHOWN, next to the buttons. */
let activeVariant = null      // what the last resolve() actually settled on

async function resolveDriver() {
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
  variantHint.textContent = activeVariant ? DRIVERS[activeVariant].label : ''
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

/**
 * Answer `true` for checkboxes and Ya/Tidak toggles instead of `false`.
 *
 * 🔴 The honest default for a blank create form is OFF — nothing has been opted
 * into. But this app uses those same controls as GATES, and a field that only
 * exists once its checkbox is ticked is invisible to a scan that faithfully
 * leaves it alone: step 4's Agunan and Underlying tables, their Tambah buttons,
 * and every field inside them do not exist in the DOM until the box says Ya.
 *
 * So a run that fills correctly REPORTS LESS than a run that ticks first, and
 * the difference reads as "those fields aren't there" rather than "they are
 * behind a gate". Turning this on trades fidelity for reach, deliberately.
 *
 * Declared inside the extracted smart-default block so `autofill-bundle.js`
 * carries it too; the popup overwrites it from its own checkbox.
 *
 * 🔴 KEEP THIS BELOW THE `Smart default generator` MARKER. `build-bundle.sh`
 * extracts from that line down, so a declaration ABOVE it is left out of the
 * bundle while its USE is carried in — `__autofill.run()` then dies with
 * `TICK_CHECKBOXES is not defined` on the first toggle or checkbox it meets.
 * It sat two lines too high until 2026-08-20, while this comment and the one
 * on `syncTickCheckboxes` both already claimed it was inside.
 */
let TICK_CHECKBOXES = false
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

/* Added 2026-08-11 from a measured gap: 28 of 99 text fields on the v1 credit
   application were falling through to the generic "<label> <today>" fallback.
   That is neither realistic nor varied, and through a currency mask it became a
   rupiah figure derived from the date. Every list below exists because a
   specific field was landing there. */
const _BANKS       = ['Bank Mandiri', 'Bank BCA', 'Bank BRI', 'Bank BNI', 'Bank CIMB Niaga', 'Bank Danamon',
                      'Bank Permata', 'Bank OCBC NISP', 'Bank Panin', 'BPR Kirana Sejahtera']
const _PROJECTS    = ['Pengembangan Gudang Distribusi', 'Penambahan Armada Operasional', 'Modal Kerja Musiman',
                      'Renovasi Gerai Cabang', 'Pembelian Mesin Produksi', 'Ekspansi Outlet Baru',
                      'Peremajaan Peralatan Produksi', 'Pengadaan Bahan Baku']
const _PURPOSES    = ['Menambah modal kerja untuk memenuhi pesanan yang meningkat',
                      'Membiayai pembelian peralatan produksi baru',
                      'Memperluas kapasitas gudang dan jalur distribusi',
                      'Menutup kebutuhan modal kerja musiman',
                      'Melakukan renovasi tempat usaha',
                      'Menambah armada kendaraan operasional']
const _OCCUPATIONS = ['Wiraswasta', 'Karyawan Swasta', 'Pegawai Negeri Sipil', 'Pedagang', 'Petani',
                      'Guru', 'Dokter', 'Konsultan', 'Kontraktor', 'Pensiunan']
const _RELATIONS   = ['Istri', 'Suami', 'Anak', 'Orang Tua', 'Saudara Kandung', 'Kerabat', 'Rekan Kerja']
const _FINDINGS    = ['Lokasi usaha sesuai dengan dokumen yang dilampirkan',
                      'Kegiatan usaha berjalan normal saat kunjungan',
                      'Stok barang tersedia dan tertata rapi',
                      'Tempat usaha ramai dan mudah dijangkau',
                      'Peralatan produksi dalam kondisi terawat']
const _FOLLOWUPS   = ['Direkomendasikan untuk diproses ke tahap berikutnya',
                      'Perlu verifikasi tambahan atas dokumen legalitas',
                      'Disarankan menambah agunan pendukung',
                      'Direkomendasikan dengan catatan pemantauan berkala',
                      'Perlu konfirmasi ulang atas data keuangan']
const _NOTES       = ['Tidak ada keterangan', 'Data telah diverifikasi', 'Sesuai dokumen pendukung',
                      'Menunggu konfirmasi lanjutan', 'Tidak ada catatan khusus']
const _GROUPS      = ['Kelompok Usaha Mandiri', 'Koperasi Sejahtera', 'Paguyuban Niaga', 'Kelompok Tani Makmur']

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
  [/\b(plafon|plafond|jumlah pinjaman|loan amount)\b/,   () => _RAMT(50000000, 500000000, 10000000)],
  [/\b(tenor|jangka waktu)\b/,                           () => _PICK(_TENORS)],
  [/\bnomor sk\b/,                                       () => 'AHU-' + _R6() + '.AH.01.01.' + (2015 + Math.floor(Math.random() * 10))],
  [/\bnomor akta\b/,                                     () => String(1 + Math.floor(Math.random() * 99)).padStart(2, '0')],
  [/\bnotaris\b/,                                                   'Budi Notaris, SH'],
  // ── Added 2026-08-11: each of these was measured landing on the generic
  //    "<label> <today>" fallback on the v1 credit application.
  [/\b(suku bunga|interest rate)\b/,                    () => String(8 + Math.floor(Math.random() * 11))],
  [/\bangsuran\b/,                                      () => _RAMT(1000000, 15000000, 500000)],
  [/\bsisa (pinjaman|pokok|bunga)\b/,                    () => _RAMT(5000000, 200000000, 5000000)],
  [/\b(nama penyedia pinjaman|nama bank|bank name)\b/,   () => _PICK(_BANKS)],
  [/\bnama pemilik rekening\b/,                          () => _PICK(_NAMES_DEBTOR)],
  [/\b(nama proyek|project name)\b/,                     () => _PICK(_PROJECTS)],
  [/\b(tujuan peminjaman|tujuan kredit|loan purpose)\b/, () => _PICK(_PURPOSES)],
  [/\bpekerjaan\b/,                                      () => _PICK(_OCCUPATIONS)],
  [/\bhubungan\b/,                                       () => _PICK(_RELATIONS)],
  [/\bfrekuensi\b/,                                      () => String(Math.floor(Math.random() * 3))],
  [/\b(temuan|findings)\b/,                              () => _PICK(_FINDINGS)],
  [/\b(rekomendasi|tindak lanjut|follow up)\b/,          () => _PICK(_FOLLOWUPS)],
  [/\b(peserta|participant)\b/,                          () => _PICK(_NAMES_DEBTOR)],
  [/\bkelompok\b/,                                       () => _PICK(_GROUPS)],
  [/\b(durasi|lama bekerja|employment duration)\b/,      () => String(1 + Math.floor(Math.random() * 20))],

  [/\b(catatan|keterangan|deskripsi|description|note)\b/, () => _PICK(_NOTES)],
  // year-only picker fields (e.g. "Periode Tahun", "FR_REPORT_PERIOD_YEAR")
  [/\b(periode tahun|period year|tahun buku|fiscal year|report.*year|year.*report)\b/, () => String(new Date().getFullYear() - 1)],
  // numeric-hint catch: return '000' before general text fallback
  /* Last resorts, deliberately after every specific rule above: a bare "Nama"
     or "Tanggal" carries no other clue, and a person name or a real date beats
     "<label> <today>" in either case. */
  [/\bnama\b/,                                           () => _PICK(_NAMES_DEBTOR)],
  [/\btanggal\b/,                                        () => { const y = 2020 + Math.floor(Math.random() * 6); const m = String(1+Math.floor(Math.random()*12)).padStart(2,'0'); const d = String(1+Math.floor(Math.random()*28)).padStart(2,'0'); return d+'-'+m+'-'+y }],
  [/\b(nomor|number|no\.)\b/,                                       '000'],
]

// Returns smart default for a field.
// '' for selects means "pick first live option during fill" (handles cascade-disabled fields).
/**
 * Values the simulation panel decides, keyed by the field's visible LABEL.
 *
 * Captured once per run (`activePlan`) rather than recomputed per field, so
 * every generated name in one run carries the same timestamp — resolving
 * per-field would stamp a five-minute run with five different minutes.
 *
 * Returns undefined when no panel is active, which is every route except the
 * credit-application create form.
 */
let activePlan = null

function simOverride(label) {
  if (!activePlan) return undefined

  const key = String(label || '').replace(/\s*\*\s*$/, '').trim().toLowerCase()

  return {
    'nama proyek kredit': activePlan.projectName,
    'jenis kredit': activePlan.creditType,
    'jenis pengajuan': activePlan.applicationType,

    /* 🔴 `debtorType` was produced by `plan()` and read by NOTHING — grep found
       only the line creating it. So the Debitur pill (BU / I) did not set the
       form's debtor type at all; it only altered the generated project and
       collateral NAME strings, which made a run labelled "…BU-P" perfectly
       able to build a Perorangan application. Wired 2026-08-15.
       ⚠️ Step 2's field, `DEBTOR_GENERAL_DATA_DEBTOR_TYPE`
       (creditApplication.json:621). */
    'jenis calon debitur': activePlan.debtorType
  }[key]
}

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
  // See TICK_CHECKBOXES above: off is the honest default, on is the one that
  // reaches gated fields.
  if (type === 'checkbox' || type === 'checkbox_group' || type === 'toggle') return TICK_CHECKBOXES
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

        /* Open the gates BEFORE reading the step, or the scan counts only what
           happens to be visible. A gated section is ABSENT from the DOM, not
           hidden, so it is indistinguishable from one that does not exist —
           which is how step 4 read as having no tables at all. This writes to
           the form, hence the opt-in checkbox. */
        if (driver.reveal && shouldReveal()) await revealAndSettle(driver, tab.id)

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
  const ignoreDisabled = ALWAYS_SKIP_DISABLED
  const skipFilled     = skipFilledCb.checked
  const skipOptional   = skipOptionalCb.checked

  /**
   * 🔴 B56 — THE SCENARIO PANEL WAS INERT, AND THIS BLOCK IS WHY.
   *
   * This used to pre-fill `data` with `smartDefault` for EVERY detected field
   * whenever the JSON editor was empty. Both fill sites resolve a value as
   * `data[f.name] ?? simOverride(f.label)`, so a populated `data` meant the
   * left side always won and `simOverride` was UNREACHABLE — on both the
   * single-step and the all-steps branch. Measured from the v1.0.61 value log:
   * the panel asked for `Kredit Badan Usaha - Produktif` / `Restrukturisasi`
   * and the driver wrote `Kredit Perorangan - Konsumtif` / `Baru`, which is
   * exactly what `smartDefault` answers (the first option, every time).
   *
   * 🔑 The fallback was never lost by removing it — `valueFor` below already
   * ends in `smartDefault`. The pre-fill only ever moved that same call
   * EARLIER, to a place where it outranked the two deliberate sources.
   *
   * ⚠️ It also killed a second feature silently: `extra` (below) exists to fill
   * names the user typed that the scan did not detect, and it filters `data` by
   * `!detectedNames.includes(n)`. Pre-filled with exactly the detected names,
   * that filter could never match, so `extra` was permanently empty.
   */
  const data = parseJSON() || {}

  const detectedNames = lastDetectedFields.map(f => f.name)

  /* Reveal-on + tick-off means "open the gates, then leave them alone" — so
     checkbox fields drop out of the fill entirely rather than being answered
     No, which would close what the scan just opened. See
     shouldSkipCheckboxFills. `skipField` also drops the reference gates, which
     no option may switch on. */
  const fillable = lastDetectedFields.filter(f => !skipField(f))

  /**
   * 🔑 A DELIBERATE value must beat an already-filled field; an INVENTED one
   * must not.
   *
   * `runAllWizardSteps` forces `skipFilled` on for the whole run, which is
   * right for smart defaults — they exist to populate blanks, not to overwrite
   * a real record. It was wrong for the two explicit sources: a per-field JSON
   * override and the simulation panel's own picks were silently discarded the
   * moment the field already held anything, so choosing "Restrukturisasi" in
   * the panel did nothing on a form whose Jenis Pengajuan was already set —
   * and the run still reported success naming the value it had not written.
   *
   * ⚠️ `simOverride` was also missing from THIS branch entirely, so with "All
   * steps" unticked the panel contributed nothing to any field at all.
   */
  const valueFor = f => {
    const explicit = data[f.name] ?? simOverride(f.label)

    return explicit !== undefined
      ? { value: explicit, deliberate: true }
      : { value: smartDefault(f.name, f.label, f.type, f.options), deliberate: false }
  }

  const inOrder    = fillable.map(f => { const { value, deliberate } = valueFor(f); return [f.name, value, deliberate] })
  const extra      = Object.entries(data).filter(([n]) => !detectedNames.includes(n)).map(([n, v]) => [n, v, true])
  const fieldOrder = [...inOrder, ...extra]

  const lockUI = () => {
    detectBtn.disabled = true
    quickFillBtn.disabled = true
    allStepsCb.disabled = true
    executeBtn.disabled = true
    buildJsonBtn.disabled = true
    delayInput.disabled = true
    skipFilledCb.disabled = true
    skipOptionalCb.disabled = true
  }
  const unlockUI = () => {
    detectBtn.disabled = false
    quickFillBtn.disabled = false
    allStepsCb.disabled = false
    executeBtn.disabled = false
    delayInput.disabled = false
    skipFilledCb.disabled = false
    skipOptionalCb.disabled = false
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

        /* 🔴 The checkbox filter had to be applied HERE too, and was not.
           `shouldSkipCheckboxFills()` fed only the single-step branch's
           `fillable` list; this branch iterates the raw detected buckets, so
           "reveal on, tick off" still answered every gate. Worse than it
           sounds: a v2 CHECKBOX renders as a Tidak/Ya toggle, toggles are
           exempt from the skipFilled guard (driver-v2.js:1002), and the toggle
           path clicks its off segment with no state check — so a gate the user
           had set to Ya was clicked back to Tidak, taking its whole gated
           section with it. */
        if (skipField(f)) continue

        /* Precedence: an explicit per-field override, then the simulation plan
           (the scenario pills and the generated project name), then the smart
           default. The plan sits ABOVE smartDefault because its values are
           chosen deliberately for this run; it sits BELOW `data` so a manual
           override still wins. */
        const explicit = data[f.name] ?? simOverride(f.label)
        const deliberate = explicit !== undefined
        const value = deliberate ? explicit : smartDefault(f.name, f.label, f.type, f.options)
        const isOptional = !!f.optional

        progressFill.style.width = Math.round((filled / totalFields) * 100) + '%'
        progressLabel.textContent = `${stepLabel}  (${i + 1}/${stepFields.length})  ${f.name}…`

        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN',
            func: driver.fill,
            args: [f.name, value, delayMs, ignoreDisabled, skipFilled && !deliberate, skipOptional, isOptional]
          })
          results[f.name] = result || 'error'
          recordFieldDetail(f, value, deliberate, result || 'error')
        } catch (e) {
          results[f.name] = 'error'
          recordFieldDetail(f, value, deliberate, 'error')
        }

        /**
         * 🔴 ANSWER A CONFIRMATION THE WRITE MAY HAVE RAISED — the step path
         * never did, only the modal walk (below) ever called these.
         *
         * Writing a field that already holds a different value raises
         * "Konfirmasi Ganti Jenis Kredit", which offers to empty the whole
         * application. Left unanswered it sits over the form and every
         * SUBSEQUENT field reports `not_found` — so one planned field could
         * silently cost the rest of the run, and the value never changed
         * either, making the panel's setting look ignored.
         *
         * REFUSED, not accepted: Quick Fill means "fill what is empty", and
         * clearing an application the user had already filled is not a repair
         * this button is entitled to make. The refusal is logged so a setting
         * that did not apply is visible rather than silent.
         */
        if (driver.pendingConfirm && driver.answerConfirm) {
          try {
            const [{ result: raised }] = await chrome.scripting.executeScript({
              target: { tabId: tab.id }, world: 'MAIN', func: driver.pendingConfirm
            })

            if (raised) {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id }, world: 'MAIN', func: driver.answerConfirm, args: [false]
              })
              results[f.name] = 'declined_confirm'
              logEvent('confirm-declined', { field: f.name, label: f.label, wanted: value, text: raised.text.slice(0, 120) })
            }
          } catch (err) {
            logEvent('confirm-check-failed', { field: f.name, error: err.message })
          }
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
      const [name, value, deliberate] = fieldOrder[i]
      const pct = Math.round((i / fieldOrder.length) * 100)
      progressFill.style.width = pct + '%'
      progressLabel.textContent = `(${i + 1}/${fieldOrder.length})  ${name}…`

      const fieldMeta = lastDetectedFields.find(f => f.name === name)
      const isOptional = fieldMeta ? !!fieldMeta.optional : true

      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: driver.fill,
          args: [name, value, delayMs, ignoreDisabled, skipFilled && !deliberate, skipOptional, isOptional]
        })
        results[name] = result || 'error'
        recordFieldDetail(fieldMeta || { name }, value, deliberate, result || 'error')
      } catch (e) {
        results[name] = 'error'
        recordFieldDetail(fieldMeta || { name }, value, deliberate, 'error')
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
    /* Straight to the clipboard: there is no preview any more, so a capture
       that only filled a hidden textarea would look like it did nothing. Still
       written to jsonInput, which doubles as the replay input. */
    const text = prettyJSON(json)
    jsonInput.value = text
    markStepDone(3)

    let copied = true
    try { await navigator.clipboard.writeText(text) } catch { copied = false }

    showToast(
      copied ? `Copied ${Object.keys(json).length} fields to clipboard`
             : 'Captured, but the clipboard was blocked',
      copied ? '#059669' : '#d97706'
    )
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

// ─── Results ──────────────────────────────────────────────────────────────────
function renderResults(results) {
  /* 🔑 The whole per-field map, not the counts. `skipped_user_gate` appearing
     here is the driver's own record that it REFUSED a gate — the other half of
     the before/after snapshot, and the only way to tell a refusal from a field
     the run never reached. */
  logEvent('fields', results)

  /* Values, keyed the same way, so a status and what produced it sit together.
     Logged as its own event rather than merged into `results`, which
     renderResults counts by string identity. */
  logEvent('fieldValues', fieldDetail)

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
/**
 * Every checkbox persists, table-driven so a new one cannot be forgotten.
 *
 * ⚠️ It WAS forgotten. `fillModalCb` and `tickCheckboxesCb` were added to the
 * markup and wired to the run, but not to storage — so they reset on every open
 * while the five boxes sitting beside them remembered. That is the worst shape
 * for this bug: the row looks uniform and only part of it behaves. Adding a
 * checkbox now means adding one line here, which wires load AND save together.
 *
 * A missing pref leaves the markup's own `checked` in place, so an untouched
 * box keeps its declared default.
 */
const PERSISTED_CHECKBOXES = [
  ['pref_allSteps',       allStepsCb],
  ['pref_skipFilled',     skipFilledCb],
  ['pref_skipOptional',   skipOptionalCb],
  ['pref_fillModal',      fillModalCb],
  ['pref_tickCheckboxes', tickCheckboxesCb]
]

;(async () => {
  const prefs = await chrome.storage.local.get(PERSISTED_CHECKBOXES.map(([key]) => key))
  for (const [key, box] of PERSISTED_CHECKBOXES) {
    if (box && prefs[key] !== undefined) box.checked = prefs[key]
  }
  // The restored value has to reach the flag too, or a persisted "off" would be
  // ignored until the box is touched.
  syncTickCheckboxes()
})()

for (const [key, box] of PERSISTED_CHECKBOXES) {
  if (box) box.addEventListener('change', () => chrome.storage.local.set({ [key]: box.checked }))
}

/* Safe here: TICK_CHECKBOXES is declared above this point. See the note on
   syncTickCheckboxes for why it cannot be called where it is defined. */
syncTickCheckboxes()
if (tickCheckboxesCb) tickCheckboxesCb.addEventListener('change', syncTickCheckboxes)

// The form dialect is detected per run by resolveDriver(); there is nothing to
// initialise or persist. renderVariantHint() reports what it settled on.

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
async function walkRecordModals(driver, tabId, { delayMs = 120, onStep } = {}) {
  if (!driver.listModals) return null

  const run = (func, args = []) =>
    chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args })
      .then(r => r[0] && r[0].result)

  const report = []

  if (driver.reveal && shouldReveal()) await revealAndSettle(driver, tabId)

  const list = (await run(driver.listModals)) || []

  for (let i = 0; i < list.length; i++) {
    const label = list[i].label

    if (onStep) onStep(`Modal: ${label}`)

    /* openModal PROBES: it clicks, and if no dialog appears it puts back the row
       the click added. Nothing in the markup can tell a repeater from a modal
       opener beforehand, so this is the only way to find out — and
       `reverted: false` is the case worth surfacing, because it means the form
       was left with a row the run cannot remove. */
    const opened = await run(driver.openModal, [i])
    if (!opened || !opened.isModal) {
      const note = !opened ? 'no modal opened'
        : opened.reason === 'repeater_reverted' ? 'row repeater — reverted'
        : opened.reason === 'repeater_NOT_reverted' ? `⚠ repeater left ${opened.addedInputs} field(s) behind`
        : 'no modal opened'
      report.push({ label, note })
      continue
    }

    if (driver.reveal && shouldReveal()) await revealAndSettle(driver, tabId)

    const entry = { label, title: opened.title, seen: 0, filled: 0, failed: [] }
    const seen = new Set()

    /* Re-detect until stable: these modals mount most of themselves after one
       select (Pemegang Saham 2 -> 18 fields, Fasilitas 8 -> 20), so a single
       pass fills the gate and stops. */
    for (let round = 0; round < 6; round++) {
      const fields = ((await run(driver.detect)) || [])
        .filter(f => !seen.has(f.name))
        .filter(f => !skipField(f))
      if (!fields.length) break

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

    entry.saved = await run(driver.saveModal)
    if (entry.saved !== 'saved') await run(driver.closeModal)

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
  if (ALWAYS_DOUBLE_CHECK) {
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
          onStep
        })
        if (r && r.length) modalReport.push({ step: stepIdx, modals: r })
      }

      if (modalReport.length) {
        const all = modalReport.flatMap(s => s.modals).filter(m => !m.note)
        const fields = all.reduce((n, m) => n + (m.seen || 0), 0)

        const saved = all.filter(m => m.saved === 'saved').length
        showToast(`Modals: ${saved}/${all.length} saved · ${fields} fields`,
          saved === all.length ? '#059669' : '#d97706')
      }
    }
  }

  return lastResults
}

// ── Quick Fill button ─────────────────────────────────────────────────────────
const quickFillBtn = document.getElementById('quickFillBtn')
/**
 * The ONE entry point (user, 2026-08-15: "no need for the 'Isi formulir'
 * button, as we will use the quick fill for centralized one").
 *
 * The panel's own button was removed rather than kept as a second door: two
 * controls that fill the same form, differing only in whether they honour the
 * config sitting directly above them, is a question the user should never have
 * to answer. Quick Fill now IS the panel's run whenever the panel is mounted —
 * it captures the plan first, and afterwards adds the planned rows and agunan.
 */
/**
 * The whole of Quick Fill, callable by BOTH entry points.
 *
 * 🔴 Extracted 2026-08-17 because the auto-run block at the bottom of this file
 * was a STALE COPY of this logic: it called `runAllWizardSteps()` alone, with no
 * `SIM.plan()` capture and no `runPlannedExtras()`. So an auto-run filled the
 * wizard and then skipped the agunan, rows, mutation and facility passes
 * entirely before closing the popup — presenting as "Quick Fill ran and did
 * half the job", with nothing to say why.
 *
 * Nobody noticed because the auto-run path was UNREACHABLE on the only route
 * that has extras (see the auto-run block's own note). Fixing the reachability
 * without collapsing the duplicate would have shipped the degraded run instead.
 * Two code paths for one action, one of them not kept up to date, is a shape
 * this repo has now paid for three times.
 *
 * @returns true when the run completed, false when it threw.
 */
async function runQuickFill() {
  /* A fresh log per run. Reset BEFORE the first setStatus, which logs. */
  runLog = []
  fieldDetail = {}

  setStatus('Starting…')

  /* Mounted only on the credit-application create route, so everywhere else
     this stays false and Quick Fill behaves exactly as it always did. */
  const planned = isSimulationMounted()

  if (planned) activePlan = SIM.plan()

  logEvent('run-start', {
    planned,
    plan: planned ? activePlan : null,
    scope: currentScope(),
    prefs: {
      skipFilled: skipFilledCb ? skipFilledCb.checked : null,
      skipOptional: skipOptionalCb ? skipOptionalCb.checked : null,
      delay: typeof delayValue === 'function' ? delayValue() : undefined
    }
  })

  /* 🔴 THE DISCRIMINATOR. Taken before a single field is written, so a gate
     found ON afterwards can be attributed rather than argued about. */
  await snapshotGates('before')

  /* The nav spy arms before the first fill: any "Leave site?" during the run
     lands in the log with the exact clicks that preceded it — see v2NavSpy. */
  try {
    const tab = await getActiveTab()

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: v2NavSpy, args: ['arm'] })
  } catch (e) { /* page not scriptable — the run proceeds unspied */ }

  try {
    await runAllWizardSteps({ onStep: n => setStatus(String(n)) })

    if (!planned) {
      /* The scope decides what "done" can even mean, so say which one ran
         rather than a bare "Done" that reads the same whether modals were
         touched. */
      const scope = currentScope()

      setStatus(scope === 'fill' ? 'Done — page + modals filled' : 'Done — page only', 'done')

      return true
    }

    await runPlannedExtras()

    return true
  } catch (err) {
    logEvent('run-error', { message: String((err && err.message) || err), stack: err && err.stack })
    setStatus('Failed: ' + (err && err.message ? err.message : String(err)), 'error')

    return false
  } finally {
    /* In `finally` so a crashed run is still analysable — a run that throws is
       exactly the one whose log is worth having. */
    await snapshotGates('after')

    /* Read the spy LAST: unloads > 0 means the page tried to navigate during
       the run, and lastClicks names what was pressed just before. */
    try {
      const tab = await getActiveTab()
      const [{ result: navspy }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: v2NavSpy, args: ['read'] })

      logEvent('navspy', navspy)
    } catch (e) { /* page gone — nothing to read */ }
    logEvent('run-end', {})
    persistRunLog()
  }
}

quickFillBtn.addEventListener('click', async () => {
  quickFillBtn.disabled = true

  try {
    await runQuickFill()
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

/**
 * Drive the Agunan modal once per planned collateral.
 *
 * Feature-tested rather than assumed: only the v2 driver has `collaterals`, and
 * a v1 page reaching this would otherwise throw on an undefined function rather
 * than simply skipping a capability it does not have.
 */
/**
 * Bring `opener` on screen by walking the rail until a button carrying that
 * exact label exists. Returns the step index it landed on, `-1` if the opener
 * was already there, or `null` if no step has it.
 *
 * 🔴 THE BUG THIS EXISTS FOR (B53 #2, 2026-08-16). All three passes below
 * search `document` for their opener, and all three run AFTER
 * `runAllWizardSteps` has walked to the LAST step. "Tambah Fasilitas" exists on
 * step 1 ONLY, so the facility pass reported
 * `no "Tambah Fasilitas" — is a Jenis Kredit chosen?` on a form that had one,
 * on every real run — a question about a GATE for a fault that was ORDERING.
 * "Tambah Agunan" and every row opener have exactly the same shape; the
 * collateral pass only ever appeared to work because it was verified by calling
 * the driver directly, with the form already parked on the right step.
 *
 * Walks rather than carrying a step index per table: eleven hardcoded indices
 * would rot the first time a table moves between steps, and the walk opens with
 * "is it already here?", so it costs one probe on the common path.
 */
async function goToOpener(driver, tabId, opener, maxSteps = 10) {
  const hasOpener = label =>
    [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === label)

  const present = async () => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: hasOpener, args: [opener]
    })

    return Boolean(result)
  }

  if (await present()) return -1
  if (typeof driver.goTo !== 'function') return null

  for (let i = 0; i < maxSteps; i++) {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: driver.goTo, args: [i]
    })
    await sleep(700)

    if (await present()) return i
  }

  return null
}

/**
 * Add the planned extra rows to each repeatable table.
 *
 * ⚠️ Runs BEFORE the collateral pass and AFTER the wizard fill: the wizard fill
 * already creates one row in most tables, so these counts are read as a TARGET
 * and the driver adds the difference — asking for 2 pemegang saham on a form
 * that already has 1 must not produce 3.
 */
async function fillPlannedRows() {
  if (!activePlan || !activePlan.tables || !activePlan.tables.length) return []

  const driver = await resolveDriver()

  if (!driver || typeof driver.addRows !== 'function') return []

  /**
   * The wizard pass seeds one row in each table it touches, so ask for one
   * fewer. Never below zero — a count of 1 means "the one that already exists".
   *
   * ⚠️ THIS ASSUMES A FRESH FORM, which is the panel's documented job ("build
   * the record I just described"). On a form that ALREADY had rows the wizard
   * seeded nothing, so the target is undershot by one; on a table that already
   * held three, a plan of two still adds one and overshoots to four. Nothing
   * here reconciles against the live row count, because the tables are CSS-grid
   * `FlushTable`s with no countable `<tr>` — a generic counter would be a
   * heuristic keyed on section-heading text, and a wrong count is worse than a
   * stated assumption.
   *
   * `target` is carried through so the caller can report what was ASKED FOR
   * rather than what was asked of the driver — the two differ by exactly this
   * assumption, and hiding that is how "Done" got printed over a short table.
   */
  const specs = activePlan.tables
    /* Tables with their own driver capability are handled elsewhere — the
       facility modal needs a ~3s wait for its product's find-one, which a
       uniform opener/fill/save loop cannot express. */
    .filter(t => !t.isOwnCapability)
    /* 🔴 SUBTRACT WHAT THE FORM ACTUALLY SEEDS, not a flat 1.
       This was `t.count - 1` for EVERY table, on the assumption that the wizard
       fill has already populated row 1. True for tables that mount with a row;
       FALSE for Data Kunjungan, which starts at (0) — so its default of 1
       became 0, the filter below discarded the spec, and the table was never
       attempted at all. Its opener label was corrected the same day and could
       not take effect, because this line dropped the row before the opener was
       ever read. Measured on the user's own run: "DATA KUNJUNGAN CALON DEBITUR
       (0)" after a complete Quick Fill. */
    .map(t => ({ opener: t.opener, count: Math.max(0, t.count - (t.seeded ?? 1)), target: t.count }))
    .filter(t => t.count > 0)

  if (!specs.length) return []

  const tab = await getActiveTab()

  setStatus(`Baris tambahan (${specs.length} tabel)…`)

  /* ONE INJECTION PER SPEC, because each opener lives on a different step and
     the rail has to move between them. The single batched call this replaced
     could only ever reach the tables that happened to be on whichever step the
     wizard fill ended on — every other spec broke out of the driver's loop at
     `no opener "…"` and reported a table that was simply off screen. */
  const out = []

  for (const spec of specs) {
    try {
      if ((await goToOpener(driver, tab.id, spec.opener)) === null) {
        out.push({ table: spec.opener, added: 0, wanted: spec.count, target: spec.target,
          error: `no opener "${spec.opener}" on any step` })
        continue
      }

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: driver.addRows,
        args: [[{ opener: spec.opener, count: spec.count }]]
      })

      /* Re-attach the target the driver never saw, so a shortfall is reported
         against what the USER asked for. */
      out.push(...(result || []).map(r => ({ ...r, target: spec.target })))
    } catch (e) {
      out.push({ table: spec.opener, error: e && e.message ? e.message : String(e), target: spec.target })
    }
  }

  return out
}

/**
 * Step 1's credit facilities, through the driver's own facility capability.
 *
 * 🔴 Runs FIRST of the three passes, and before the wizard leaves step 1 is not
 * enough — it must run while a Jenis Kredit is set, because "Tambah Fasilitas"
 * does not exist until then. It also gates everything downstream: an
 * application with no facility cannot be submitted at all
 * ("Minimal satu fasilitas kredit wajib ditambahkan").
 */
async function fillPlannedFacilities() {
  if (!activePlan || !activePlan.tables) return []

  const wanted = activePlan.tables.find(t => t.key === 'facility')

  if (!wanted || !wanted.count) return []

  const driver = await resolveDriver()

  if (!driver || typeof driver.facilities !== 'function') return []

  const tab = await getActiveTab()

  setStatus(`Fasilitas kredit (${wanted.count})…`)

  /* Step 1's opener, and this pass runs after the wizard walked past it. */
  if ((await goToOpener(driver, tab.id, wanted.opener)) === null) {
    return [{ ok: false, step: 'open', reason: `no "${wanted.opener}" on any step` }]
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.facilities, args: [{ count: wanted.count }]
    })

    return result || []
  } catch (e) {
    return [{ ok: false, step: 'inject', reason: e && e.message ? e.message : String(e) }]
  }
}

async function fillPlannedCollaterals() {
  if (!activePlan || !activePlan.collaterals || !activePlan.collaterals.length) return []

  const driver = await resolveDriver()

  if (!driver || typeof driver.collaterals !== 'function') return []

  const tab = await getActiveTab()

  setStatus(`Agunan (${activePlan.collaterals.length})…`)

  /* Step 4's opener — same ordering fault as the facility pass above. */
  if ((await goToOpener(driver, tab.id, 'Tambah Agunan')) === null) {
    return activePlan.collaterals.map(item => ({
      name: item.name, ok: false, step: 'open', reason: 'no "Tambah Agunan" on any step'
    }))
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: driver.collaterals,
      args: [activePlan.collaterals]
    })

    /* Every agunan is saved by now, so the table's per-row facility select
       exists and can be linked. Feature-tested: a driver without the capability
       simply skips it rather than throwing.

       🔴 The result is CAPTURED and returned, not discarded. This call was
       `await`ed with nothing reading its result, so when the DataTable
       migration broke its row detection the pass failed for days with every
       status line green — the exact "pass whose result reaches no status
       line" failure runPlannedExtras warns about (user run, 2026-08-20:
       every Pilih Fasilitas select empty, log silent). */
    let assigned = null

    if (typeof driver.assignFacilities === 'function') {
      const [{ result: linkResult }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: driver.assignFacilities, args: [700]
      })

      assigned = linkResult || []
    }

    return { collaterals: result || [], assigned }
  } catch (e) {
    return [{ ok: false, step: 'inject', reason: e && e.message ? e.message : String(e) }]
  }
}

// ── Simulation panel ──────────────────────────────────────────────────────────
/**
 * On the credit-application CREATE route the popup asks before it acts.
 *
 * 🔴 This SUPPRESSES the auto-run below, and that is the point of the feature.
 * Auto-run is right everywhere else — open the popup, the form fills — but on
 * the create form the run is a fixture with a shape (how many facilities, which
 * collateral branches, what the record is called), and a run that starts before
 * the user can say any of that is a run they have to undo. Undoing means a real
 * row in shared staging.
 *
 * Everywhere else this returns false in one URL test and nothing changes.
 */
const simPanel = document.getElementById('simPanel')

/**
 * The signed-in user's name, from the app's own session store.
 *
 * 🔑 The key is `USER_DATA`, NOT `userData` — the wrong casing returns null and
 * reads exactly like "nobody is logged in". The name is at `.name`; measured
 * 2026-08-15, the object also carries `user_id`, `email`, `office_code` and the
 * permission list.
 *
 * Returns null rather than throwing where injection is blocked or no session
 * exists — the panel then falls back to its placeholder, which is the same
 * behaviour it had before this existed.
 */
async function loggedInUserName(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          return JSON.parse(localStorage.getItem('USER_DATA') || '{}').name || null
        } catch (_) {
          return null
        }
      }
    })

    return result || null
  } catch (_) {
    return null
  }
}

/**
 * What the form's project-name field actually holds, read back through the
 * driver's own RHF-store reader — the same route `read` uses, so it returns the
 * stored value rather than a rendered label.
 *
 * Returns null on any failure: this only decorates a status line, and a broken
 * read must not turn a successful run into a reported one.
 */
async function readProjectName() {
  const FIELD = 'CREDIT_APPLICATION_APPLICATION_DATA_PROJECT_NAME'

  try {
    const tab = await getActiveTab()
    const driver = DRIVERS[activeVariant] || DRIVERS.v2

    if (!tab || !driver || !driver.read) return null

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.read, args: [[FIELD]]
    })

    const value = result && result[FIELD]

    return value ? String(value) : null
  } catch (_) {
    return null
  }
}

async function mountSimulation() {
  const tab = await getActiveTab()

  if (!tab || !SIM.isCreditApplication(tab.url)) return false

  /* `mount` applies this only when the stored name is empty, so a name the user
     typed themselves always wins over the session's. */
  await SIMUI.mount(simPanel, { onChange: () => {}, defaultUserName: await loggedInUserName(tab.id) })

  /* ⚠️ NO run button here. Quick Fill is the single entry point (user,
     2026-08-15) — it detects the mounted panel and runs the plan itself. */
  return true
}

/** Whether the config panel is mounted, i.e. whether Quick Fill should honour
 *  a plan. Keyed on the panel's own body rather than a flag, so it cannot fall
 *  out of step with what is actually on screen. */
function isSimulationMounted() {
  return Boolean(simPanel && !simPanel.classList.contains('hidden') && simPanel.querySelector('.sim-body'))
}

/**
 * The planned rows and agunan, plus the honest report — everything Quick Fill
 * does BEYOND the wizard fill when a plan is active.
 *
 * Both passes come AFTER the wizard fill: the Agunan modal refuses to open
 * until a debtor is set on step 2, so running either first fails on every item
 * for the same reason. Rows run first so a shortfall there is not confused
 * with anything the collateral pass did.
 */
/**
 * Step 5's account mutations — 2 accounts x 3 months by default (user,
 * 2026-08-17: "Data Mutasi Rekening needs to have 3 months, 2 account").
 *
 * 🔑 Navigates first, like every other extras pass: its opener lives on step 5
 * and `runPlannedExtras` runs after the wizard has walked past it.
 */
async function fillPlannedMutations() {
  const driver = await resolveDriver()

  if (!driver || typeof driver.mutations !== 'function') return []

  const tab = await getActiveTab()

  setStatus('Mutasi rekening (2 rekening x 3 bulan)…')

  if ((await goToOpener(driver, tab.id, 'Tambah Data Mutasi Rekening')) === null) {
    return [{ ok: false, step: 'open', reason: 'no "Tambah Data Mutasi Rekening" on any step' }]
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.mutations,
      args: [{ accounts: 2, months: 3, rowsPerMonth: 2 }, 800]
    })

    return result ? [result] : []
  } catch (e) {
    return [{ ok: false, step: 'inject', reason: e && e.message ? e.message : String(e) }]
  }
}

/**
 * Laporan Keuangan — its own pass since 2026-08-20: the generic row-adder saved
 * one all-zero report and blocked on the rest ("Neraca Tidak Seimbang"). The
 * driver owns the YEAR LADDER; this pass only hands it the configured count.
 */
async function fillPlannedFinancialReports() {
  const driver = await resolveDriver()

  if (!driver || typeof driver.financialReports !== 'function') return null

  const wanted = (activePlan.tables || []).find(t => t.key === 'financialReport')

  if (!wanted || !wanted.count) return null

  const tab = await getActiveTab()

  setStatus(`Laporan keuangan (${wanted.count})…`)

  if ((await goToOpener(driver, tab.id, 'Tambah Laporan Keuangan')) === null) {
    return { ok: false, step: 'open', reason: 'no "Tambah Laporan Keuangan" on any step' }
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.financialReports,
      args: [{ count: wanted.count }, 900]
    })

    return result || null
  } catch (e) {
    return { ok: false, step: 'inject', reason: e && e.message ? e.message : String(e) }
  }
}

/**
 * Step 8's documents — every mandatory row on Dokumen Pengajuan Kredit, one
 * optional Dokumen Calon Debitur, and the SLIK attachment (user, 2026-08-17).
 *
 * 🔑 Navigates first, like every other extras pass: all three live on step 8
 * and `runPlannedExtras` runs after the wizard has walked past it.
 *
 * ⚠️ Navigates on "Upload Dokumen", which is the label BOTH document blocks
 * use. That ambiguity is fine for finding the STEP and fatal for choosing a
 * block, which is why the driver scopes by `data-block` rather than by label.
 */
async function fillPlannedDocuments() {
  const driver = await resolveDriver()

  if (!driver || typeof driver.documents !== 'function') return null

  const tab = await getActiveTab()

  setStatus('Dokumen pendukung (wajib + SLIK)…')

  if ((await goToOpener(driver, tab.id, 'Upload Dokumen')) === null) {
    return { ok: false, step: 'open', reason: 'no "Upload Dokumen" on any step' }
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.documents,
      args: [{ required: true, optional: 1, slik: true }, 900]
    })

    return result || null
  } catch (e) {
    return { ok: false, step: 'inject', reason: e && e.message ? e.message : String(e) }
  }
}

/**
 * Step 5's Data Kualitatif — all 16 analyst narratives.
 *
 * ⚠️ Cannot use `goToOpener`: that helper walks the rail looking for a button
 * whose TEXT matches, and this table has no "Tambah" at all — every row opens
 * by an icon-only pencil. So the step is found by looking for the BLOCK.
 */
async function fillPlannedQualitative() {
  const driver = await resolveDriver()

  if (!driver || typeof driver.qualitative !== 'function') return null

  const tab = await getActiveTab()

  setStatus('Data kualitatif (16 analisa)…')

  const onScreen = async () => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => Boolean(document.querySelector('[data-block="v2QualitativeBlock"] button[aria-label^="Ubah analisa"]'))
    })

    return result
  }

  if (!(await onScreen())) {
    for (let step = 0; step < 9; step++) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: driver.goTo, args: [step]
      })
      await new Promise(r => setTimeout(r, 700))
      if (await onScreen()) break
    }
  }

  if (!(await onScreen())) return [{ ok: false, reason: 'Data Kualitatif block not reachable on any step' }]

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: driver.qualitative,
      args: [{ limit: 16 }, 900]
    })

    return result || null
  } catch (e) {
    return [{ ok: false, reason: e && e.message ? e.message : String(e) }]
  }
}

async function runPlannedExtras() {
  const facilities = await fillPlannedFacilities()
  const rows = await fillPlannedRows()
  const agunanRun = await fillPlannedCollaterals()
  const agunan = Array.isArray(agunanRun) ? agunanRun : agunanRun.collaterals
  const facilityLinks = Array.isArray(agunanRun) ? null : agunanRun.assigned
  const mutations = await fillPlannedMutations()
  const financialReports = await fillPlannedFinancialReports()
  const documents = await fillPlannedDocuments()
  const qualitative = await fillPlannedQualitative()

  /* Every pass's RAW return, before it is compressed into `problems`. The
     status line says "3 tabel kurang baris"; this says which three, how many
     rows each wanted, and what each reported going wrong. */
  logEvent('extras', { facilities, rows, agunan, facilityLinks, mutations, financialReports, documents, qualitative })

  /* `wanted` is the driver's own spec count, already reduced by the
     wizard-seeded row; `target` is what the user actually asked for. A
     shortfall against `wanted` is a real failure — the driver could not add a
     row it tried to add. */
  const shortRows = rows.filter(r => r.error || (r.added ?? 0) < (r.wanted ?? 0))
  const failed = agunan.filter(r => !r.ok)

  const noFacility = facilities.filter(f => !f.ok)

  const problems = []

  /* Reported FIRST because it is the one that blocks submission outright. */
  if (noFacility.length) problems.push(`${noFacility.length}/${facilities.length} fasilitas (${noFacility[0].step || '?'})`)
  if (failed.length) problems.push(`${failed.length}/${agunan.length} agunan`)

  /* The facility LINKS on the agunan/underlying rows — the pass that failed
     silently for days because nothing consumed its result. `null` means the
     capability was absent; an empty array on a table with rows means the pass
     found nothing pending, which after the DataTable migration was itself the
     bug — so a run that saved agunan but linked none says so. */
  if (facilityLinks !== null) {
    /* v2AssignCollateralFacilities answers { assigned, remaining, results } —
       the per-link rows live in .results. A bare array is the older driver's
       shape; accept both, so the roll-up can never crash the run it is
       summarising (measured 2026-08-20: facilityLinks.filter threw at the END
       of an otherwise-complete run and labelled the whole thing Failed). */
    const linkRows = Array.isArray(facilityLinks) ? facilityLinks : (facilityLinks.results || [])
    const linked = linkRows.filter(r => r.ok).length
    const linkFails = linkRows.filter(r => !r.ok)

    if (linkFails.length) problems.push(`${linkFails.length} tautan fasilitas gagal`)
    else if (!linked && agunan.some(r => r.ok)) problems.push('0 agunan tertaut fasilitas')
  }
  if (shortRows.length) problems.push(`${shortRows.length} tabel kurang baris`)

  /* 🔴 REPORTED, not merely computed. A pass whose result reaches no status
     line is the shape this extension has already shipped three times — a value
     produced and never consumed reads to the user as success. */
  const mutationRun = mutations[0]

  if (mutationRun && typeof mutationRun.wanted === 'number' && mutationRun.saved < mutationRun.wanted) {
    problems.push(`${mutationRun.saved}/${mutationRun.wanted} mutasi rekening`)
  } else if (mutationRun && mutationRun.ok === false) {
    problems.push(`mutasi: ${mutationRun.reason || 'gagal'}`)
  }

  /* Same rule for the financial-report pass — produced AND consumed. */
  if (financialReports) {
    if (financialReports.ok === false) {
      problems.push(`laporan keuangan: ${financialReports.reason || 'gagal'}`)
    } else if (typeof financialReports.wanted === 'number' && financialReports.saved < financialReports.wanted) {
      problems.push(`${financialReports.saved}/${financialReports.wanted} laporan keuangan`)
    }
  }

  /* Same rule for the document pass. Its report is a SHAPE, not a count —
     `{required: [...], optional: [...], slik: {...}}` — and every entry whose
     outcome is not the string 'saved' is a row the user must finish by hand,
     so an unreported shortfall here means a submit blocked on a mandatory
     document with a green "Done" above it. */
  if (documents) {
    if (documents.ok === false) {
      problems.push(`dokumen: ${documents.reason || 'gagal'}`)
    } else {
      const unsaved = [...(documents.required || []), ...(documents.optional || [])]
        .filter(d => d.outcome !== 'saved')

      if (unsaved.length) problems.push(`${unsaved.length} dokumen belum tersimpan`)
      /* Not a failure when the field pass already attached SLIK: the BU form
         renders SLIK as per-variant FILE FIELDS (…_COMPANY / …_SHAREHOLDER)
         which the generic fill covers, and the docs pass's dropzone hunt then
         reports a control that simply does not exist on this branch (user run,
         2026-08-20: both variants 'ok', status still said "lampiran SLIK
         gagal"). */
      const slikFieldOk = Object.entries(fieldDetail || {})
        .some(([n, d]) => /SLIK.*FILE/i.test(n) && d && d.status === 'ok')

      if (documents.slik && documents.slik.ok === false && !slikFieldOk) problems.push('lampiran SLIK gagal')
    }
  }

  /* Same rule again for the qualitative pass — an unreported shortfall here
     leaves the analyst's own narratives blank under a green "Done". */
  if (Array.isArray(qualitative)) {
    const failed = qualitative.filter(r => !r.ok)

    if (failed.length) problems.push(`${failed.length}/${qualitative.length} data kualitatif`)
  }

  /**
   * 🔴 Report the name the FORM ended up with, not the one we planned.
   *
   * This used to print `'Done — ' + activePlan.projectName` unconditionally,
   * which on a pre-filled form named a project the run had never written — a
   * green "Done — Testing Yusti N BU-P …" over an application still called
   * something else. Deliberate values now bypass skipFilled so the two usually
   * agree, but a disabled field still cannot be written, and a status line must
   * never assert something it has not checked.
   */
  const actualName = await readProjectName()
  const nameMismatch = actualName && activePlan.projectName && actualName !== activePlan.projectName

  if (nameMismatch) problems.push(`nama proyek tetap "${actualName}"`)

  setStatus(
    problems.length ? 'Done, ' + problems.join(' · ') : 'Done — ' + (actualName || activePlan.projectName),
    problems.length ? 'error' : 'done'
  )
}

// ── Auto-run on popup open ────────────────────────────────────────────────────
/**
 * If the user chose "Quick Fill", run and close when done. If they chose
 * "Open Popup", just show the panel for manual use.
 *
 * 🔴 THIS USED TO `return` THE MOMENT THE PANEL MOUNTED, which made the setting
 * dead on the ONLY route it matters on. `mountSimulation()` answers false off
 * the credit-application create route and TRUE on it, and the old code read
 * that as "handled — stop here", so `pref_onOpen` was never even fetched on the
 * create form. The preference worked everywhere it was useless and did nothing
 * where it was wanted (user, 2026-08-17: "'On open: Quick Fill' not working,
 * must click manually").
 *
 * 🔑 The panel still MOUNTS first — `runQuickFill` reads the plan off it via
 * `isSimulationMounted()`, so mounting is a precondition of a planned run, not
 * an alternative to one.
 *
 * ⚠️ The gate that was lost is the one the user already has: "Open Popup" IS
 * the review setting. Adding a second condition on top (only auto-run once a
 * plan has been saved) was considered and rejected — it would leave the first
 * open on every create form doing nothing, which is indistinguishable from the
 * bug being reported here.
 */
;(async () => {
  // Mounts the config panel on the create route; false everywhere else.
  await mountSimulation()

  const { pref_onOpen } = await chrome.storage.local.get('pref_onOpen')
  if (pref_onOpen === 'popup') return

  await sleep(300)

  /* The SAME function the button calls — never a second copy. The previous
     version called `runAllWizardSteps()` bare, so it skipped every extras pass
     (agunan, rows, mutations, facilities). */
  const ok = await runQuickFill()

  await sleep(900)

  /* Leave the popup OPEN on failure, or the only report of what went wrong is
     destroyed by the very act of finishing — the same "capture state before
     anything closes" rule the driver's failure reports were rebuilt around. */
  if (ok) window.close()
})()


// ── Version, from the manifest ────────────────────────────────────────────────
/**
 * Shown so a reload can be CONFIRMED rather than assumed.
 *
 * 🔑 This is not cosmetic. Every "is v1.0.5x the right one?" question this
 * project has hit came from the version being invisible where the user was
 * working — and `git log` is not a substitute: `4074334`'s subject says v1.0.56
 * over a manifest reading 1.0.57, because it was written from the pre-bump
 * value. The manifest is the only honest source, so it is read directly.
 */
;(() => {
  const tag = document.getElementById('versionTag')

  if (!tag) return

  try {
    tag.textContent = 'v' + chrome.runtime.getManifest().version
  } catch (_) {
    /* Outside an extension context (the check harness), leave it blank rather
       than printing a guess. */
  }
})()

// ── Copy the last run's log ───────────────────────────────────────────────────
/**
 * The popup is destroyed on close, so the in-memory log dies with it. The
 * button therefore prefers `chrome.storage.local`, which survives — reopening
 * the popup after a run still yields the evidence.
 */
;(() => {
  const btn = document.getElementById('copyLogBtn')

  if (!btn) return

  // Show it if a PREVIOUS run left a log behind, not only after one runs now.
  chrome.storage.local.get('last_run_log', got => {
    if (got && got.last_run_log) btn.classList.remove('hidden')
  })

  btn.addEventListener('click', async () => {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get('last_run_log', got => resolve(got && got.last_run_log))
    )

    const text = stored || JSON.stringify(runLog)

    try {
      await navigator.clipboard.writeText(text)
      btn.textContent = 'Tersalin ✓'
    } catch (_) {
      /* Clipboard can be refused when the popup is not focused. A textarea +
         execCommand still works there, and silently failing to copy the one
         artefact the user came for is the worst outcome. */
      const ta = document.createElement('textarea')

      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      btn.textContent = 'Tersalin ✓'
    }

    setTimeout(() => { btn.textContent = 'Salin log' }, 1800)
  })
})()
