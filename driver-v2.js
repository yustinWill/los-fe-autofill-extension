'use strict'

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

  /**
   * A chosen value's `×`, not a chooser.
   *
   * `SearchableMultiSelect` renders each selection as a chip whose remove
   * control is a BUTTON carrying an svg and an `aria-label` of `Hapus {label}`.
   * Every routine that hunts for a control to CLICK has to exclude these, or it
   * deletes the value it was trying to read.
   */
  const isChipRemove = el =>
    el.tagName === 'BUTTON' && /^hapus\b/i.test((el.getAttribute('aria-label') || el.textContent || '').trim())

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
      /**
       * SearchableSelect's trigger is the only chooser carrying a chevron.
       * Count alone would misread a one-option PillGroup as a select.
       *
       * 🔴 `isChipRemove` is load-bearing: a chip's `×` is an svg too, so this
       * test matched a control whose ONLY svg was a remove icon. `peekOptions`
       * then took the first button as the opener and clicked it — deleting that
       * selection. Measured on Produk Kredit 2026-08-14 by instrumenting
       * `HTMLElement.click`: detect clicked "Hapus 001 - Main Branch", "Hapus
       * Reguler" and "Hapus Anuitas", taking `["001"]` to `[]` and
       * `["REGULAR","BULLET_PRINCIPAL_INTEREST"]` to
       * `["BULLET_PRINCIPAL_INTEREST"]`. Running Quick Fill against a POPULATED
       * record silently dropped one value from every multi-select before it
       * filled anything.
       */
      if (buttons.some(b => !isChipRemove(b) && b.querySelector('svg'))) return 'select'
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
      /* Belt and braces with `classify` above: even where a control is
         correctly a select, its chips come FIRST in document order, so `find`
         would hand `peekOptions` a remove button to click. */
      const opener = type === 'select'
        ? g.els.find(e => e.tagName === 'BUTTON' && !isChipRemove(e))
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

/**
 * Add collateral rows to step 4's Agunan table — one modal per item.
 *
 * 🔴 The extension has never driven this modal. `popup.js` has always skipped
 * step 4's tables, so a Quick Fill produced an application with no agunan at
 * all. The field sets below are ported from
 * `los/.claude/skills/los-create-autofill/scripts/step4.js`, which drove them
 * for real, rather than rediscovered — so the extension exercises what the
 * scripted runs already proved.
 *
 * ⚠️ Serialised alone by chrome.scripting, like every driver function here, so
 * every helper is inline and nothing may close over module scope.
 *
 * @param items [{ jenis, name }] — `jenis` is the DROPDOWN OPTION LABEL.
 */
async function v2FillCollaterals(items, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  /* 🔴 The LAST paper whose root is not aria-hidden. MUI leaves earlier dialogs
     mounted and both keep a non-zero box, so size and visibility do not
     separate them — reading paper 0 finds an empty shell and looks exactly like
     a modal that failed to load. */
  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')]
      .filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement

    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /**
   * Fills EVERY matching field, not the first.
   *
   * 🔴 The modal carries the address block TWICE — once for where the
   * collateral is, once for its owner — with identical placeholders ("Isi
   * Alamat", "Isi Kode Pos", "Isi RW", "Isi RT"). A `.find()` filled the
   * collateral's and left the owner's empty, and the save then blocked on a
   * bare "Field ini wajib diisi" with no clue which of two identical fields it
   * meant. Measured 2026-08-15 on the logam-mulia branch.
   *
   * Filling both with the same value is right here: these are fixture records,
   * and an owner at the collateral's address is a legitimate shape.
   */
  const fillByPlaceholder = (needle, value) => {
    const scope = dialog() || document
    const fields = [...scope.querySelectorAll('input, textarea')]
      .filter(i => (i.placeholder || '').toLowerCase().includes(String(needle).toLowerCase()) && !i.disabled)

    fields.forEach(f => setNative(f, value))

    return fields.length > 0
  }

  /* A Kairos select is a trigger button over an INLINE panel of plain buttons —
     no role="option", not portalled. ⚠️ The trigger TOGGLES: clicking one that
     is already open closes it, which reads as "no options exist". */
  const choose = async (placeholderOrLabel, optionText) => {
    const scope = dialog() || document
    const trigger = [...scope.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim().toLowerCase().includes(String(placeholderOrLabel).toLowerCase()))

    if (!trigger) return { ok: false, reason: 'no trigger for ' + placeholderOrLabel }

    /* 🔴 Take the options from a BEFORE/AFTER DIFF, not from the dialog's whole
       button list. The panel renders inline among controls that are also
       <button>s, so "first button that is not Batal" picked the Jenis Rekening
       PILL — re-clicking a pill instead of choosing a province, and leaving
       every geo select unset. Measured 2026-08-15: the Deposito branch failed
       to save with no visible error for exactly this reason. */
    const before = new Set([...(dialog() || document).querySelectorAll('button')])

    trigger.click()
    await wait(openWait)

    const options = [...(dialog() || document).querySelectorAll('button')]
      .filter(b => b !== trigger && !before.has(b) && (b.textContent || '').trim())

    const hit = optionText
      ? options.find(b => (b.textContent || '').trim() === optionText)
        || options.find(b => (b.textContent || '').trim().includes(optionText))
      : options.find(b => !/^(Batal|Tutup|Simpan|Tambah)/.test((b.textContent || '').trim()))

    if (!hit) { trigger.click(); return { ok: false, reason: 'no option "' + optionText + '"' } }

    const chosen = hit.textContent.trim()

    hit.click()
    await wait(400)

    return { ok: true, chosen }
  }

  /* Every small closed option set is a row of <button>s. ⚠️ Scope to the pill's
     OWN label — "Deposito" also appears as a Jenis Agunan option, and a
     document-wide search hits that one first. */
  /**
   * 🔴 The smallest element containing the label is the LABEL, and it holds no
   * buttons.
   *
   * Picking it by text length alone found `<label>Jenis Rekening *</label>` and
   * reported "no pill group" — so the branch's detail block never rendered, its
   * fields never existed, and the save was blocked by a required section the
   * driver had not even seen. Measured 2026-08-15: this one bug failed EVERY
   * branch, and presented differently on each (Kendaraan complained about a
   * type-specific field, Deposito said nothing at all).
   *
   * The group is the smallest element that contains the label AND the option
   * button — never one without the other.
   */
  const pill = (label, text) => {
    const scope = dialog() || document
    const holder = [...scope.querySelectorAll('*')]
      .filter(e => {
        const t = e.textContent || ''

        if (!t.includes(label)) return false

        return [...e.querySelectorAll('button')].some(b => (b.textContent || '').trim() === text)
      })
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]

    if (!holder) return { ok: false, reason: 'no pill group "' + label + '" offering "' + text + '"' }

    const hit = [...holder.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim() === text)

    hit.click()

    return { ok: true }
  }

  const answerConfirm = async (word = 'Ya') => {
    const box = dialog()

    if (!box) return false

    const btn = [...box.querySelectorAll('button')].find(b => (b.textContent || '').trim() === word)

    if (!btn) return false
    btn.click()
    await wait(500)

    return true
  }

  /* Every "Pilih …" trigger still showing its placeholder — the geo cascades
     resolve themselves because Provinsi precedes Kota precedes Kecamatan in the
     DOM, so taking the first option of each in order is sufficient. */
  /**
   * 🔴 "Pilih File" is NOT a select, and it is why this used to leave the whole
   * address empty.
   *
   * The upload control's trigger reads "Pilih File", which matches `^Pilih\s`
   * exactly like a real select. Worse, the loop used to RETURN on the first
   * failure — so hitting the upload trigger aborted the run before the four
   * geo selects were touched, and the modal then failed validation with an
   * empty address and no obvious cause. Measured 2026-08-15 on the Deposito
   * branch, which reported a blocked save and zero errors.
   *
   * Two fixes: skip upload triggers by name, and treat a failure as "move on"
   * rather than "stop", so one unresolvable control cannot strand the rest.
   */
  const resolveRemainingSelects = async (rounds = 10) => {
    const tried = new Set()

    for (let i = 0; i < rounds; i++) {
      const scope = dialog()

      if (!scope) return

      const pending = [...scope.querySelectorAll('button')]
        .map(b => (b.textContent || '').trim())
        .find(t => /^Pilih\s/.test(t) && !/^Pilih File/i.test(t) && !tried.has(t))

      if (!pending) return
      tried.add(pending)
      await choose(pending, null)
    }
  }

  /* ⚠️ Reports only real validation messages. Matching any text containing
     "harus" also catches the dropzones' FORMAT HINTS — "• Format gambar harus
     .jpg, .jpeg, atau .png" is permanent helper copy, not a failure — and a
     failure report full of hints sends the reader after the wrong thing.
     Measured 2026-08-15: the first run of this driver reported two hints as
     errors on a modal whose real blocker was a missing owner relation. */
  const dialogErrors = () => {
    const box = dialog()

    if (!box) return []

    return [...new Set(
      [...box.querySelectorAll('*')]
        .filter(e => !e.children.length)
        .map(e => (e.textContent || '').trim())
        .filter(t => /wajib|tidak boleh/i.test(t) && !/^•/.test(t) && !/^Format /i.test(t))
    )].slice(0, 6)
  }

  /** A <2KB PDF and a 1x1 PNG, each carrying its own name so a file picked out
   *  of a failure is identifiable. Inline because this function is serialised
   *  alone and cannot import the seed helpers. */
  const makePdf = name =>
    new File([new Blob([`%PDF-1.4\n% ${name}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`],
      { type: 'application/pdf' })], name, { type: 'application/pdf' })

  const makePng = name => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)

    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    return new File([new Blob([bytes], { type: 'image/png' })], name, { type: 'image/png' })
  }

  /* Every dropzone in the modal gets a file of the type its own hint demands —
     the hint is the only thing distinguishing an image dropzone from a document
     one, since both render the same control. */
  const attachAll = async () => {
    const box = dialog()

    if (!box) return 0

    const inputs = [...box.querySelectorAll('input[type=file]')]
    let done = 0

    for (const input of inputs) {
      const accept = (input.getAttribute('accept') || '').toLowerCase()
      const wantsImage = /image|png|jpe?g/.test(accept)
      const file = wantsImage ? makePng('agunan.png') : makePdf('agunan.pdf')
      const transfer = new DataTransfer()

      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      done++
      await wait(1800)
    }

    return done
  }

  /**
   * 🔴 v2's agunan table is a `FlushTable` — a CSS GRID of divs, not a
   * `<table>`. Counting `tbody tr` returned 0 unconditionally, which made
   * `rowCount() > before` false even on a save that worked. Measured
   * 2026-08-15.
   *
   * There is no stable row hook to count, so this reads the section's own
   * summary line ("Total Nilai Agunan · 2 agunan"), which the block renders
   * from the array it is iterating. Returns null when it cannot tell, and the
   * caller treats null as "unknown" rather than "zero".
   */
  const rowCount = () => {
    const summary = [...document.querySelectorAll('*')]
      .filter(e => !e.children.length && /\d+\s*agunan/i.test(e.textContent || ''))
      .map(e => (e.textContent.match(/(\d+)\s*agunan/i) || [])[1])
      .find(Boolean)

    return summary === undefined ? null : Number(summary)
  }

  /**
   * The six branches. `pills` run BEFORE `text`: a pill decides which fields
   * exist below it, so filling text first writes into inputs that are about to
   * be replaced.
   *
   * ⚠️ `general` (Mesin) has NO detail block — the shared fields are the whole
   * form. It is not a mistake that its entry is almost empty; that branch is
   * worth running precisely because "nothing appeared" is the one most easily
   * read as a failure.
   */
  /**
   * The six branches, ported in FULL from
   * `los-create-autofill/scripts/step4.js`.
   *
   * ⚠️ The first version of this table was a COMPACTED port — a few
   * representative fields per branch — and every branch failed to save because
   * of what it left out. Deposito wanted `Nama Pemilik` and `Tanggal Jatuh
   * Tempo`; vehicle wanted a year picker. A partial port of a required-field
   * set is not a smaller version of the feature, it is a broken one.
   *
   * `pills` run BEFORE `selects` and `text`: a pill decides which fields exist
   * below it, so filling first writes into inputs that are about to be replaced.
   *
   * ⚠️ `general` (Mesin) has NO detail block — the shared fields are the whole
   * form. Not a mistake that its entry is empty; that branch is worth running
   * precisely because "nothing appeared" reads as a failure.
   */
  const BRANCHES = {
    'Rumah': {
      pills: [['Tanah / Bangunan', 'Tanah'], ['Jenis', 'SHM'], ['Jenis Surat', 'SU']],
      text: {
        'Nomor SHM': 'SHM-1234',
        'Nomor SU': 'SU-5678',
        'Tanggal SU': '15/01/2020',
        'Nomor NIB': '1234567890123',
        'Nomor IMB': 'IMB-2020-0451',
        'Nama Pemilik': 'Budi Santoso',
        'Nomor AJB': 'AJB-2020-118',
        'Tanggal AJB': '20/01/2020',
        'Luas Tanah': '250',
        'Luas Bangunan': '180',
        'Batas Tanah Utara': 'Jl. Melati',
        'Batas Tanah Selatan': 'Rumah No. 12',
        'Batas Tanah Timur': 'Saluran air',
        'Batas Tanah Barat': 'Rumah No. 8'
      }
    },

    'Kendaraan': {
      pills: [['Jenis Kendaraan', 'Mobil'], ['Transmisi', 'Automatic']],

      /* ⚠️ Tahun Produksi is a YEAR PICKER, not a text field (dateViewMode:
         YEAR_ONLY), so its placeholder reads "Pilih …" and typing into it does
         nothing. It is the one required vehicle field a placeholder fill
         silently skips — and the save then blocks on it. */
      selects: {
        'Pilih Merk Kendaraan': null,
        'Pilih Tipe Kendaraan': null,
        'Pilih Varian Kendaraan': null,
        'Pilih Jenis Bahan Bakar': null,
        'Pilih Tahun Produksi': '2022'
      },
      text: {
        'Nomor Polisi': 'D 1234 ABC',
        'Nomor Rangka': 'MHFXW42G5N1234567',
        'Nomor Mesin': '2NZX1234567',
        'Nomor BPKB': 'BPKB-9988776',
        'Nomor STNK': 'STNK-1122334',
        'Kapasitas Mesin': '1500',
        'Masa Berlaku STNK': '15/06/2027',
        'Warna Kendaraan Sesuai STNK': 'Putih',
        'Warna Kendaraan Saat Ini': 'Putih'
      }
    },

    'Tabungan': {
      pills: [['Jenis Rekening', 'Tabungan']],
      selects: { 'Pilih Bank Pemilik Rekening': null },
      text: {
        'Nomor Rekening': '1234567890',
        'Nama Pemilik': 'Pemilik Rekening',
        'Nominal Tabungan': '250000000'
      }
    },

    'Deposito': {
      pills: [['Jenis Rekening', 'Deposito']],
      selects: { 'Pilih Bank Pemilik Rekening': null },
      text: {
        'Nomor Bilyet': 'BLY-2026-0771',
        'Nomor Rekening': '9876543210',
        'Nama Pemilik': 'Pemilik Rekening',
        'Nominal Deposito': '500000000',
        'Tanggal Jatuh Tempo': '31/12/2026'
      }
    },

    'Emas dan mata uang emas': {
      pills: [['Memiliki Sertifikat', 'Ya']],
      selects: { 'Pilih Jenis Logam Mulia': null, 'Pilih Bentuk Fisik': null },
      text: {
        'Jumlah': '10',
        'Berat': '100',
        'Kadar / Karat': '24K',
        'Nomor Sertifikat': 'ANTAM-0099887',
        'Tempat Penyimpanan': 'Safe Deposit Box Cabang Bandung'
      }
    },

    'Mesin': { pills: [], selects: {}, text: {} }
  }

  const SHARED = {
    'Deskripsi Agunan': 'Objek agunan untuk pengajuan ini.',
    'Catatan': 'Dokumen fisik tersimpan di cabang.',
    'Perkiraaan Nilai Agunan': '2500000000',
    'Nama Pemilik Agunan': 'Pemilik Agunan',
    /* 🔴 Dropped on the first pass and it is what blocked every save: "Hubungan
       dengan Calon Debitur wajib diisi apabila Data Pemilik Agunan tidak sama
       dengan Calon Debitur". Setting an owner name makes this one required. */
    'Hubungan dengan Calon Debitur': 'Debitur Sendiri',
    'Alamat': 'Jl. Raya Bekasi Km. 21 No. 45',
    'Kode Pos': '17530',
    'RW': '007',
    'RT': '004',
    'Keterangan': 'Berada di kawasan industri.'
  }

  const results = []

  for (const item of items || []) {
    const before = rowCount()
    const branch = BRANCHES[item.jenis] || { pills: [], text: {} }

    const opener = [...document.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim() === 'Tambah Agunan')

    if (!opener) {
      results.push({ name: item.name, ok: false, step: 'open', reason: 'no "Tambah Agunan" — is the Agunan toggle Ya, and is a debtor set on step 2?' })
      break
    }

    opener.click()
    await wait(1000)

    if (!dialog()) { results.push({ name: item.name, ok: false, step: 'open', reason: 'modal did not appear' }); continue }

    // The TYPE first: it decides which fields exist below it.
    const jenis = await choose('Pilih Jenis Agunan', item.jenis)

    if (!jenis.ok) { results.push({ name: item.name, ok: false, step: 'jenis', reason: jenis.reason }); continue }

    /* Silent on a fresh modal — the confirm only fires when the block already
       held something — so no popup here is correct, not a miss. */
    await answerConfirm('Ya')
    await wait(600)

    for (const [label, text] of branch.pills) { pill(label, text); await wait(450) }

    /* Named selects BEFORE the generic sweep: some carry a required VALUE
       (Tahun Produksi) that "take the first option" would get wrong. */
    for (const [label, want] of Object.entries(branch.selects || {})) {
      await choose(label, want)
      await wait(250)
    }

    /* The NAME is the whole point of the panel's list, so it is set explicitly
       rather than left to a default. */
    fillByPlaceholder('Nama Agunan', item.name)

    for (const [label, value] of Object.entries({ ...SHARED, ...branch.text })) fillByPlaceholder(label, value)

    await wait(300)
    await resolveRemainingSelects()
    await wait(300)

    const attached = await attachAll()

    await wait(400)

    /* ⚠️ The SAVE button carries the SAME label as the opener — "Tambah
       Agunan" — and is told apart only by being inside the dialog. Searching
       the document would re-click the opener. */
    const save = [...(dialog() || document).querySelectorAll('button')]
      .find(b => (b.textContent || '').trim() === 'Tambah Agunan')

    save?.click()
    await wait(800)
    await answerConfirm('Ya')
    await wait(1200)

    /* 🔴 Success is the modal CLOSING and a row appearing — never the save
       click landing. A blocked save clicks perfectly well and changes nothing. */
    if (dialog()) {
      results.push({ name: item.name, ok: false, step: 'submit', errors: dialogErrors() })

      const cancel = [...(dialog() || document).querySelectorAll('button')]
        .find(b => /^(Batal|Tutup)$/.test((b.textContent || '').trim()))

      cancel?.click()
      await wait(600)
      continue
    }

    /* 🔴 Success is the modal CLOSING. The row count is reported when it can be
       read but never gates the verdict — a save that works on a table this
       cannot count would otherwise be filed as a failure. */
    const after = rowCount()

    results.push({ name: item.name, ok: true, jenis: jenis.chosen, attached, before, after })
  }

  return results
}


/**
 * Add N rows to a repeatable table, generically.
 *
 * The collateral driver above needs a per-branch field table because the Agunan
 * modal branches on type. Every OTHER repeatable table is uniform: one opener,
 * one modal, one save. So this fills whatever the modal happens to contain
 * rather than carrying a map per table — which is what makes it survive a field
 * being added to any of them.
 *
 * ⚠️ Serialised alone, like every driver function here.
 *
 * @param specs [{ opener, count }] — `opener` is the button's exact label.
 */
async function v2AddRows(specs, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')]
      .filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  /**
   * 🔴 `input` only, then VERIFY — and re-set if the field did not take it.
   *
   * A Cleave-masked currency input collapses to "0" when a `change` event
   * follows the `input` one: the mask re-reads the raw value mid-format and
   * lands on zero. The field then holds a legal value, so nothing reports it as
   * missing — the save is simply refused with NO message anywhere in the dialog.
   *
   * Measured 2026-08-15 by diffing the filler's output against a manual fill
   * that saved: `Isi Nominal Underlying` read "0" after the filler and
   * "100.000.000" after the manual set. Three earlier hypotheses (date format,
   * close timing, upload settling) were all wrong, and only the value diff
   * found it.
   *
   * The re-set is belt and braces: masks differ per field, and a value that
   * silently became 0 is the worst kind of failure — plausible, legal, and
   * invisible.
   */
  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const write = v => {
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }

    write(value)
  }

  /**
   * Re-set anything the mask ate. MUST run after a delay: the collapse is
   * ASYNCHRONOUS, so a check in the same tick as the write still sees the good
   * value and passes. Measured 2026-08-15 — a synchronous verify shipped and
   * changed nothing, and the field still read 0 at save time.
   */
  const repairMasked = async (written, waitFor) => {
    await waitFor(600)

    for (const [el, value] of written) {
      const want = String(value).replace(/\D/g, '')
      const got = String(el.value || '').replace(/\D/g, '')

      if (!want || want === '0' || got === want) continue
      if (got && want.startsWith(got.slice(0, Math.min(3, got.length))) && got.length >= 3) continue

      Object.getOwnPropertyDescriptor(
        (el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement).prototype, 'value'
      ).set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await waitFor(150)
    }
  }

  /**
   * A plausible value from the field's own placeholder.
   *
   * Deliberately heuristic rather than a per-table map: the point of this
   * routine is that adding a field to any modal does not require touching the
   * driver. Order matters — "Nomor Rekening" must match the number rule before
   * the generic text rule.
   */
  const guess = (placeholder, index) => {
    const p = String(placeholder || '').toLowerCase()

    /* 🔴 DASHES, not slashes. v2's DateField parses dd-MM-yyyy; a slashed value
       is accepted by the input and then fails validation, so the save is blocked
       with no message against the date itself. Measured 2026-08-15: the same
       underlying modal refused '15/01/2026' and saved on '15-01-2026'. */
    if (/tanggal|tgl|jatuh tempo|masa berlaku/.test(p)) return '15-01-2026'
    if (/kode pos/.test(p)) return '17530'
    if (/^isi (rw|rt)|[\s(]rw|[\s(]rt/.test(p)) return '007'
    if (/email/.test(p)) return 'uji' + index + '@contoh.co.id'
    if (/telepon|nomor hp|handphone|whatsapp/.test(p)) return '0812' + String(10000000 + index)
    if (/npwp|nik|ktp|nomor induk/.test(p)) return String(320000000000000 + index)
    if (/nilai|nominal|jumlah|plafon|harga|limit|angsuran|saldo|omzet|pendapatan/.test(p)) return '100000000'
    if (/persen|rate|bunga|suku/.test(p)) return '12'
    if (/jangka waktu|tenor|periode|lama/.test(p)) return '12'
    if (/nomor|no\./.test(p)) return 'UJI-' + String(1000 + index)

    return 'Uji ' + String(placeholder || 'Data').replace(/^Isi\s+/i, '').slice(0, 28) + ' ' + index
  }

  /* Options come from a BEFORE/AFTER DIFF of the button set — the panel renders
     inline among controls that are also buttons, so "first button that is not
     Batal" picks a pill. Same trap the collateral driver paid for. */
  const chooseFirst = async label => {
    const scope = dialog()

    if (!scope) return false

    const trigger = [...scope.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim() === label)

    if (!trigger) return false

    const before = new Set([...scope.querySelectorAll('button')])

    trigger.click()
    await wait(openWait)

    const option = [...(dialog() || document).querySelectorAll('button')]
      .filter(b => b !== trigger && !before.has(b) && (b.textContent || '').trim())
      .find(b => !/^(Batal|Tutup|Simpan|Tambah)/.test((b.textContent || '').trim()))

    if (!option) { trigger.click(); return false }

    option.click()
    await wait(350)

    return true
  }

  const makePdf = name =>
    new File([new Blob([`%PDF-1.4\n% ${name}\nendobj\n%%EOF`], { type: 'application/pdf' })], name, { type: 'application/pdf' })

  const results = []

  for (const spec of specs || []) {
    const count = Math.max(0, Number(spec.count) || 0)
    let added = 0
    let lastError = null

    for (let n = 0; n < count; n++) {
      const opener = [...document.querySelectorAll('button')]
        .find(b => (b.textContent || '').trim() === spec.opener)

      if (!opener) { lastError = 'no opener "' + spec.opener + '"'; break }

      opener.click()
      await wait(1000)

      const box = dialog()

      /* No modal means this is an INLINE repeater — the row is already appended
         and there is nothing to save. Counting it as added is correct. */
      if (!box) { added++; continue }

      /* Selects first: several modals gate later fields on an earlier choice,
         and a text pass before them writes into inputs about to be replaced. */
      for (let i = 0; i < 10; i++) {
        const pending = [...(dialog() || document).querySelectorAll('button')]
          .map(b => (b.textContent || '').trim())
          .find(t => /^Pilih\s/.test(t) && !/^Pilih File/i.test(t))

        if (!pending) break
        if (!(await chooseFirst(pending))) break
      }

      const scope = dialog()

      if (scope) {
        const written = []

        ;[...scope.querySelectorAll('input, textarea')]
          .filter(i => i.type !== 'file' && !i.value && !i.disabled && !i.readOnly)
          .forEach((input, i) => {
            const value = guess(input.placeholder, n + 1 + i)

            setNative(input, value)
            written.push([input, value])
          })

        await repairMasked(written, wait)

        for (const input of [...scope.querySelectorAll('input[type=file]')]) {
          const transfer = new DataTransfer()

          transfer.items.add(makePdf('uji.pdf'))
          input.files = transfer.files
          input.dispatchEvent(new Event('change', { bubbles: true }))

          /* 🔴 3200ms, the number run-case.js uses. The dropzone UPLOADS to the
             DMS temp store on change, so this is a real network round trip —
             saving before it settles leaves the form holding no document and
             the modal simply does not close, with NO validation message to say
             why. Measured 2026-08-15: at 1500ms every add reported "save
             blocked: no message in the dialog". */
          await wait(3200)
        }
      }

      await wait(400)

      /* ⚠️ The save carries the SAME label as the opener in these modals and is
         told apart only by living inside the dialog — searching the document
         would re-click the opener. */
      const box2 = dialog()
      const save = box2 && ([...box2.querySelectorAll('button')].find(b => (b.textContent || '').trim() === spec.opener)
        || [...box2.querySelectorAll('button')].find(b => /^Simpan/.test((b.textContent || '').trim())))

      save?.click()
      await wait(1400)

      const confirmBtn = dialog() && [...dialog().querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Ya')

      if (confirmBtn) { confirmBtn.click(); await wait(1200) }

      /* 🔴 Give the close time to happen before judging it.
         The verdict is "did the modal close", so a wait shorter than the close
         animation reports a SUCCESSFUL save as blocked — measured 2026-08-15:
         900ms called the underlying modal blocked while the same sequence at
         1800ms saved and the row appeared. Poll rather than guess a single
         number, so a fast close is not paid for by everyone. */
      for (let i = 0; i < 12 && dialog(); i++) await wait(200)

      if (dialog()) {
        /* Report WHAT blocked it, not merely that something did. A bare "save
           blocked" sent two rounds of guessing after date formats and timing
           before anyone asked the form. */
        const box3 = dialog()

        /* The VALUES at the moment of refusal. A message-only report cost four
           wrong hypotheses; the values named the cause in one run. */
        lastError = 'save blocked | fields: ' + [...box3.querySelectorAll('input, textarea')]
          .filter(i => i.type !== 'file')
          .map(i => (i.placeholder || '?').replace(/^Isi\s+/, '') + '=' + (i.value || '∅'))
          .join(', ') + ' | msg: ' + ([...new Set(
          [...box3.querySelectorAll('*')]
            .filter(e => !e.children.length)
            .map(e => (e.textContent || '').trim())
            .filter(t => /wajib|tidak boleh/i.test(t) && !/^•/.test(t) && !/^Format /i.test(t))
        )].slice(0, 4).join(' | ') || 'no message in the dialog')

        const cancel = [...box3.querySelectorAll('button')]
          .find(b => /^(Batal|Tutup)$/.test((b.textContent || '').trim()))

        cancel?.click()
        await wait(700)
        break
      }

      added++
    }

    results.push({ table: spec.opener, wanted: count, added, error: lastError })
  }

  return results
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
