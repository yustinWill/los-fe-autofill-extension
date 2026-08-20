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
      /* 🔴 The trailing group is what makes REPEATER ROWS visible. `expandFieldArrays`
         names every row control `${ARRAY}.${index}.${member}` — e.g.
         `CREDIT_APPLICATION_FINANCIAL_DATA_INCOME.0.type` — and the old
         uppercase-only pattern rejected every one of them, so NO v2 repeater row
         was fillable on any step. Measured 2026-08-17: the DOM had all four of
         step 3's income/expense fields and the driver saw zero.
         ⚠️ Inlined, not a shared const: these functions are serialised with
         Function.toString() and must stay self-contained (see this file's header). */
      if (p && p.control && typeof p.name === 'string' &&
          /^[A-Z][A-Z0-9_]+(\.\d+\.[A-Za-z0-9_]+)?$/.test(p.name)) return p.name
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

  /**
   * The ProseMirror node belonging to THIS control, or null.
   *
   * 🔴 SCOPED TO THE FIELD'S OWN CELL. A bare "walk up 5 levels and look for a
   * ProseMirror" reaches a NEIGHBOURING field's editor: measured 2026-08-17,
   * step 5's `QUALITATIVE_DATA_DEBTOR_TYPE` — a pill group with no editable
   * node of its own — was classified `editor` because a Catatan field sat
   * nearby. `[data-field]` is the boundary the renderer already draws around
   * every named control, so the search stops there.
   *
   * ⚠️ A rich-text field is reached through its TOOLBAR BUTTONS; the editable
   * node itself carries no React fiber (ProseMirror builds it outside React),
   * so it never appears in `els`.
   */
  const editorHost = el => {
    const cell = el.closest && el.closest('[data-field]')

    if (!cell) return null

    return cell.querySelector('.ProseMirror, [contenteditable="true"]')
  }

  // Shape → kind. Ordered most-specific first; each test rules out the next.
  function classify(els) {
    /**
     * 🔴 RICH TEXT FIRST, because it looks like a select to every later test.
     *
     * A Tiptap editor ships a 21-button toolbar (Batalkan, Ulangi, Judul 1…),
     * so the `buttons.length` branch below classified it `select`; the driver
     * then opened a panel that does not exist, found no options, and moved on.
     * Step 5's "Catatan Data Pinjaman" and "Catatan Data Mutasi Rekening" were
     * never written by any run. Measured 2026-08-17: both cells report
     * `contentEditable: 1`, `ProseMirror: 1`, `buttons: 21`.
     */
    if (els.some(e => Boolean(editorHost(e)))) return 'editor'

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
  /* ⚠️ Do NOT add `[contenteditable]` here. ProseMirror builds its own DOM
     OUTSIDE React, so that node carries no `__reactFiber$` key at all
     (measured 2026-08-17) and can never resolve to a field name — it would be
     swept up and then dropped. A rich-text field is reached through its TOOLBAR
     BUTTONS, which do carry the Controller; `classify` recognises it from
     there. */
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
  /**
   * 🔴 THE GATE IS REFUSED HERE, NOT ONLY FILTERED IN THE POPUP.
   *
   * The user reports "Menggunakan Referensi Pengajuan Kredit" arriving ON after
   * a run, on v1.0.55, where the popup's `skipField` should have dropped it.
   * Reading found nothing: all three fill sites filter, the double-check pass
   * reuses the same filtered path, v2FillTables is a no-op, v2 registers no
   * `reveal`, both confirm helpers are scoped to [role=dialog], and filling the
   * reference NUMBER does not flip the toggle (all measured).
   *
   * So the write came from a path none of that covers, and hunting it produced
   * three wrong guesses. The fix is to stop relying on finding the caller:
   * popup.js's `skipField` is a POLICY that any one call site can forget, while
   * a refusal here is an INVARIANT, because every write of a named field goes
   * through this function. Whatever the missing path is, it now cannot answer a
   * business question on the user's behalf.
   *
   * ⚠️ The stack is still logged, deliberately. If the toggle is EVER seen on
   * after a run with no "gate refused" line in the page console, that proves
   * the write did not come through the driver at all — which is the one
   * remaining possibility and worth being able to distinguish.
   */
  if (/USE_REFERENCE|USING_REFERENCE|HAS_AVALIST/.test(name || '')) {
    try {
      console.warn('[autofill] gate refused:', name, '=', value, '\n', new Error('caller').stack)
    } catch (e) { /* console unavailable */ }

    return 'skipped_user_gate'
  }
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
      /* 🔴 The trailing group is what makes REPEATER ROWS visible. `expandFieldArrays`
         names every row control `${ARRAY}.${index}.${member}` — e.g.
         `CREDIT_APPLICATION_FINANCIAL_DATA_INCOME.0.type` — and the old
         uppercase-only pattern rejected every one of them, so NO v2 repeater row
         was fillable on any step. Measured 2026-08-17: the DOM had all four of
         step 3's income/expense fields and the driver saw zero.
         ⚠️ Inlined, not a shared const: these functions are serialised with
         Function.toString() and must stay self-contained (see this file's header). */
      if (p && p.control && typeof p.name === 'string' &&
          /^[A-Z][A-Z0-9_]+(\.\d+\.[A-Za-z0-9_]+)?$/.test(p.name)) return p.name
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

  /**
   * ⚠️ DUPLICATED FROM `v2Detect` ON PURPOSE. Each driver function is injected
   * on its own via `Function.toString()`, so a helper declared in one is
   * `undefined` in the other — this file's header says so, and it is the same
   * trap `answerConfirm` paid for. Keep the two copies identical.
   *
   * Scoped to the field's own `[data-field]` cell: an unbounded upward search
   * finds a NEIGHBOURING field's editor and misclassifies a pill group.
   */
  const editorHost = el => {
    const cell = el.closest && el.closest('[data-field]')

    if (!cell) return null

    return cell.querySelector('.ProseMirror, [contenteditable="true"]')
  }
  function classify(els) {
    /**
     * 🔴 RICH TEXT FIRST, because it looks like a select to every later test.
     *
     * A Tiptap editor ships a 21-button toolbar (Batalkan, Ulangi, Judul 1…),
     * so the `buttons.length` branch below classified it `select`; the driver
     * then opened a panel that does not exist, found no options, and moved on.
     * Step 5's "Catatan Data Pinjaman" and "Catatan Data Mutasi Rekening" were
     * never written by any run. Measured 2026-08-17: both cells report
     * `contentEditable: 1`, `ProseMirror: 1`, `buttons: 21`.
     */
    if (els.some(e => Boolean(editorHost(e)))) return 'editor'

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
  /* ⚠️ Do NOT add `[contenteditable]` here. ProseMirror builds its own DOM
     OUTSIDE React, so that node carries no `__reactFiber$` key at all
     (measured 2026-08-17) and can never resolve to a field name — it would be
     swept up and then dropped. A rich-text field is reached through its TOOLBAR
     BUTTONS, which do carry the Controller; `classify` recognises it from
     there. */
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

  /**
   * SCROLL THE FIELD INTO VIEW BEFORE TOUCHING IT (user, 2026-08-17: "simulate
   * the user behaviour of navigating and filling the page instead of only
   * detecting by DOM").
   *
   * 🔑 Not cosmetic. A DOM-only sweep writes into nodes the viewport has never
   * shown, so anything that initialises on VISIBILITY is never exercised by a
   * run and its bugs survive every "verified" pass — lazily mounted sections,
   * IntersectionObserver-gated blocks, controls that measure themselves on
   * first paint. Filling the way a person does is what makes a run evidence
   * about the APP rather than evidence about the fill.
   *
   * ⚠️ `behavior: 'auto'`, deliberately, NOT 'smooth'. Smooth scrolling is
   * driven by the compositor, which is PAUSED in a hidden or backgrounded tab —
   * measured 2026-08-17: `scrollIntoView({behavior:'smooth'})` moved nothing at
   * all there, while 'auto' moved the same element from 1110 to 165. A fill
   * that silently stops scrolling the moment the tab loses focus is worse than
   * one that never scrolled, because the run still reports success.
   *
   * ⚠️ Guarded: a node detached between detection and fill must be a skip, not
   * an exception that takes the whole run with it.
   */
  try {
    if (primary && typeof primary.scrollIntoView === 'function') {
      primary.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      await sleep(45)
    }
  } catch (err) { /* detached between detect and fill — the branches below report it */ }

  /**
   * Rich text — write into the ProseMirror node, not into any input.
   *
   * 🔑 `execCommand('insertText')` rather than setting `innerHTML`: Tiptap owns
   * this node through ProseMirror's own state, and markup written behind its
   * back is either reverted on the next transaction or never reaches the form
   * at all. `insertText` goes through the browser's editing pipeline, which
   * ProseMirror observes, so the change lands in the document AND fires the
   * `onChange` the form is listening to. Deprecated, and still the only thing
   * that works from outside the editor.
   *
   * ⚠️ selectAll first, so a re-run replaces rather than appends — the fill can
   * run twice (the double-check pass) and two copies of a memo is worse than
   * none.
   */
  if (type === 'editor') {
    /* Same cell-scoped lookup `classify` used to recognise it. */
    const host = group.els.map(editorHost).find(Boolean)

    if (!host) return 'not_found'

    host.focus()
    await sleep(60)
    document.execCommand('selectAll', false, null)
    document.execCommand('insertText', false, String(value == null ? '' : value))
    host.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(80)

    return (host.textContent || '').trim() ? 'ok' : 'not_found'
  }

  if (type === 'select') {
    const trigger = group.els.find(e => e.tagName === 'BUTTON')

    /**
     * 🔴 A NO-OP WRITE IS NOT FREE ON THIS APP.
     *
     * Re-picking the value a select ALREADY shows raises "Konfirmasi Ganti
     * Jenis Kredit — Mengganti Jenis Kredit akan mengosongkan seluruh data yang
     * sudah diisi", offering to empty the whole application. Quick Fill reaches
     * here with `skipFilled` deliberately bypassed for planned fields, so the
     * emptiness guard above does not catch it and every run re-picked the same
     * value and provoked that dialog.
     *
     * Compared against the TRIGGER'S TEXT, not the stored value: the store
     * holds an enum (`COMPANY_PRODUCTIVE`) while the plan and the option list
     * both speak the label ("Kredit Badan Usaha - Produktif"), so a
     * stored-value comparison never matches and would skip nothing.
     */
    const want = String(value == null ? '' : value).trim()

    if (trigger && want && trigger.textContent.trim() === want) return 'skipped_filled'

    return (await fillPanel(trigger, value)) ? 'ok' : 'not_found'
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

      /* ⚠️ NO no-op guard here, deliberately — unlike `select` above.
         Re-clicking the pill that is already active is HARMLESS on this form:
         measured 2026-08-20, it returns without raising the "Ganti Jenis"
         confirmation that the select provokes. And it could not be guarded the
         same way anyway: the store holds an ENUM (`NEW`) while the buttons and
         the plan both speak the label ("Baru"), and pills carry no
         aria-pressed or data-state to read the active one from — only a
         computed background, which is styling, not a contract. A guard keyed
         on that would be a comparison that silently never matches. */
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

  /**
   * ⚡ SETTLE TIME IS TYPE-AWARE (user, 2026-08-17: "is there any way to speed
   * things up on filling it? while mocking the way user behaves").
   *
   * 🔑 The 200ms `delayMs` the popup passes was never the cost here — measured
   * 2026-08-17, `delayMs` is consumed exactly ONCE in this whole function, in
   * the select branch. What a text field actually paid was this flat 120ms plus
   * another 120 on the mask re-sync and 60 on blur — ~300ms each, on a form
   * with roughly 200 of them.
   *
   * A plain text write needs only one React commit to land, and React commits
   * synchronously on the `input` event `setNative` fires. MASKED fields are the
   * exception that earned the original number: Cleave reformats
   * ASYNCHRONOUSLY, so the re-sync below genuinely needs the pause — which is
   * why the cut is keyed on whether a mask is present rather than applied flat.
   */
  const masked = Boolean(primary.dataset && (primary.dataset.cleave || primary.className.includes('cleave')))
    || /[.,]/.test(primary.value || '')

  await sleep(masked ? 120 : 30)

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

  /* Blur fires validation and any onBlur formatting. 60ms was a guess; 20 is
     enough for a synchronous handler and saves ~8s across a full form. Masked
     fields keep the longer pause for the reason above. */
  await sleep(masked ? 60 : 20)

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
  const choose = async (placeholderOrLabel, optionText, exact = false) => {
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

    const usable = options.filter(b => !/^(Batal|Tutup|Simpan|Tambah)/.test((b.textContent || '').trim()))

    const named = optionText
      ? options.find(b => (b.textContent || '').trim() === optionText)
        || options.find(b => (b.textContent || '').trim().includes(optionText))
      : null

    /**
     * 🔴 Seed value not offered → TAKE THE FIRST (user, 2026-08-16). A required
     * select left empty because a mock value was unavailable fails the whole
     * record over a detail no fixture cares about.
     *
     * ⚠️ `exact` opts OUT, and exactly one caller uses it: **Jenis Agunan**.
     * That choice DECIDES WHICH BRANCH runs, and the branch table then fills
     * fields belonging to the type it thinks it picked — so substituting there
     * would quietly build a deposito while filling a vehicle's fields. A
     * branch-selecting choice must fail loudly; every value INSIDE a branch may
     * fall back.
     */
    const hit = named || (exact ? null : usable[0])

    if (!hit) { trigger.click(); return { ok: false, reason: 'no option "' + optionText + '"' } }

    const chosen = hit.textContent.trim()

    hit.click()
    await wait(400)

    return { ok: true, chosen, fellBack: Boolean(optionText) && !named }
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
  /**
   * 🔴 Blocklist FAILURES, not attempts. The modal carries the address block
   * TWICE (collateral + owner) with IDENTICAL trigger labels, and a `tried` set
   * keyed on the label meant the owner's whole cascade was skipped the moment
   * the collateral's had run — so `OWNER_DATA_PROVINCE_CODE` and its three
   * children were required and permanently empty, and the save was refused on
   * a section the sweep believed it had finished. Measured 2026-08-15 on the
   * logam-mulia branch (the RHF-store report named the four fields in one run).
   *
   * A SUCCESSFUL choose changes the trigger's label to the chosen value, so on
   * the next round the first "Pilih Provinsi" match IS the owner's — duplicate
   * labels resolve themselves as long as only failures are retired. The `tried`
   * set still exists for its original job: a trigger whose choose FAILS keeps
   * its label forever and would otherwise loop.
   *
   * ⚠️ The five branches that saved before this fix did so on RESIDUAL modal
   * state — this modal keeps its RHF values across open/cancel — not because
   * the sweep reached the owner block. A fresh page fails every two-cascade
   * branch without this.
   */
  const resolveRemainingSelects = async (rounds = 20) => {
    const tried = new Set()

    for (let i = 0; i < rounds; i++) {
      const scope = dialog()

      if (!scope) return

      const pending = [...scope.querySelectorAll('button')]
        .map(b => (b.textContent || '').trim())
        .find(t => /^Pilih\s/.test(t) && !/^Pilih File/i.test(t) && !tried.has(t))

      if (!pending) return

      const result = await choose(pending, null)

      if (!result.ok) tried.add(pending)
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

  /**
   * Valuation PER COLLATERAL TYPE (user, 2026-08-17: "it also needs a valuation
   * value variants matching the normal context").
   *
   * 🔴 This used to be one shared `2500000000`, so a run produced six agunan of
   * six different kinds all valued at exactly Rp 2.500.000.000 — a deposit book
   * worth the same as a factory. That is not merely untidy: the total drives the
   * Loan-to-Value ratio the step exists to compute, so a uniform figure makes
   * every LTV in the fixture meaningless.
   *
   * ⚠️ Spread deliberately AROUND the plafon rather than all above it, so a
   * fixture exercises both a comfortable and a thin LTV instead of always the
   * same one. Keyed on the Jenis Agunan label, falling back for any branch added
   * later.
   */
  const VALUE_BY_TYPE = {
    'Rumah': '2500000000',
    'Kendaraan': '385000000',
    'Tabungan': '175000000',
    'Deposito': '600000000',
    'Emas dan mata uang emas': '1250000000',
    'Mesin': '850000000'
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

    /**
     * 🔴 "Tambah Agunan" OPENS TWO DIFFERENT MODALS, and this branch was missing.
     *
     * With a debtor set on step 2 — which every real run has, because a
     * collateral must belong to someone — the button opens **Daftar Agunan**, a
     * PICKER of that debtor's already-registered collaterals, not the
     * registration form. The driver assumed registration and died at
     * `no trigger for Pilih Jenis Agunan`, which reads like a broken selector
     * rather than the wrong modal. Measured 2026-08-17 on a debtor with no
     * collaterals: the picker says "Calon debitur ini belum punya agunan
     * terdaftar. Gunakan Daftarkan Agunan untuk menambahkannya."
     *
     * "Daftarkan Agunan" REPLACES the picker in place (the dialog count stays
     * 1), so this is a branch, not a stack — after clicking it the same
     * `dialog()` is the registration form.
     *
     * ⚠️ Detected by the ABSENCE of the type trigger rather than by the modal's
     * title: a v2 dialog has no heading element (its title is a plain div), a
     * trap this file already carries for `v2OpenModal`.
     */
    const hasTypeTrigger = () =>
      [...(dialog() || document).querySelectorAll('button')]
        .some(b => /Pilih Jenis Agunan/.test(b.textContent || ''))

    if (!hasTypeTrigger()) {
      const register = [...(dialog() || document).querySelectorAll('button')]
        .find(b => /^Daftarkan Agunan$/.test((b.textContent || '').trim()))

      if (register) {
        register.click()
        await wait(1600)
      }
    }

    // The TYPE first: it decides which fields exist below it.
    /* `exact` — this choice DECIDES THE BRANCH. Substituting a different type
       here would fill a deposito's fields into a vehicle, so it must fail
       loudly rather than fall back. Every value inside a branch may substitute. */
    const jenis = await choose('Pilih Jenis Agunan', item.jenis, true)

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

    /* The type's own valuation overrides SHARED's placeholder figure; a branch's
       own `text` still wins over both, so a fixture can pin an exact number. */
    const shared = { ...SHARED, 'Perkiraaan Nilai Agunan': VALUE_BY_TYPE[item.jenis] || SHARED['Perkiraaan Nilai Agunan'] }

    for (const [label, value] of Object.entries({ ...shared, ...branch.text })) fillByPlaceholder(label, value)

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
      /* The resolver's own verdict, not just the DOM's. These modals refuse a
         save SILENTLY through handleSubmit, and a field whose error draws no
         helper text leaves dialogErrors() empty on a loudly invalid form —
         exactly how the add-rows blocker hid for six hypotheses. Naming the
         FIELD KEY beats a generic "Field ini wajib diisi" every time. */
      const rhfErrors = (() => {
        for (const el of dialog().querySelectorAll('input, textarea, button')) {
          const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))

          if (!key) continue

          let fiber = el[key]
          let depth = 0

          while (fiber && depth++ < 200) {
            const props = fiber.memoizedProps

            if (props && props.control && typeof props.name === 'string') {
              const flat = (obj, path = []) =>
                Object.entries(obj || {}).flatMap(([k, v]) =>
                  v && typeof v === 'object' && !v.message ? flat(v, [...path, k]) : [[...path, k].join('.') + ': ' + (v?.message ?? v)]
                )

              return flat(props.control._formState?.errors)
            }
            fiber = fiber.return
          }
        }

        return null
      })()

      results.push({ name: item.name, ok: false, step: 'submit', errors: dialogErrors(), rhfErrors })

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
/**
 * Step 5's "Tambah Data Mutasi Rekening" — the THIRD `useState` modal in v2.
 *
 * 🔴 IT NEEDS ITS OWN CAPABILITY, like the facility and agunan modals, and for
 * the same reason: none of its inputs is an RHF `<Controller>`. Measured
 * 2026-08-17 — all six resolve to NO_CONTROLLER, so `v2Detect` reports ZERO
 * fields inside a modal that plainly has six. Treat "v2Detect sees 0 fields in
 * an OPEN modal" as the tell for this shape.
 *
 * 🔑 ONE MODAL IS ONE ACCOUNT FOR ONE MONTH. The header takes the account and a
 * single `Periode`; the Detail Transaksi table inside takes that month's rows.
 * So "3 months across 2 accounts" is SIX saves, not two.
 *
 * Layout, measured (row inputs carry NO placeholders, so they are anchored on
 * the row's `dd/mm/yyyy` date box and read positionally from there):
 *   header  Bank(select) · Nomor Rekening · Nama Pemilik · Periode · Saldo Awal
 *   row     Tanggal · Nama Nasabah · Keterangan · Debit · Kredit
 *
 * ⚠️ A row must carry a Debit OR a Kredit — the modal says so itself ("Baris 1
 * harus diisi salah satu"). Rows alternate so a fixture exercises both sides.
 */
async function v2AddMutations(plan, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const spec = Object.assign({ accounts: 2, months: 3, rowsPerMonth: 2 }, plan || {})

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')
    return open[open.length - 1] || null
  }

  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const byPlaceholder = needle =>
    [...(dialog() || document).querySelectorAll('input')].find(i => (i.placeholder || '').toLowerCase().includes(needle.toLowerCase()))

  /* Options render INLINE among buttons, so a before/after diff is the only
     reliable read — and a trigger click TOGGLES, so an already open panel gives
     an empty diff. Retried once for exactly that. */
  const chooseBank = async (label, bankIndex) => {
    const open = async () => {
      const trigger = [...(dialog() || document).querySelectorAll('button')].find(b => /Pilih bank/i.test(b.textContent || ''))
      if (!trigger) return []
      const before = new Set([...document.querySelectorAll('button')])
      trigger.click()
      await wait(openWait)
      return [...document.querySelectorAll('button')].filter(b => !before.has(b) && (b.textContent || '').trim())
    }
    let options = await open()
    if (!options.length) options = await open()
    if (!options.length) return null
    /* ⚠️ Falls back by INDEX, not to options[0]. The seeded names are unlikely
       to match this deployment's bank master data, and sending every account to
       the first option gives a fixture two "different" accounts at the SAME
       bank — the same uniformity the agunan valuation fix removed. `bankIndex`
       is the account's ordinal, so accounts land on different banks. */
    const hit = options.find(o => (o.textContent || '').trim() === label) ||
      options[(bankIndex || 0) % options.length]
    const chosen = (hit.textContent || '').trim()
    hit.click()
    await wait(300)
    return chosen
  }

  const ACCOUNTS = [
    { bank: 'BANK CENTRAL ASIA', nomor: '1180457723', nama: 'Budi Santoso' },
    { bank: 'BANK MANDIRI', nomor: '1400089912345', nama: 'Budi Santoso' }
  ]
  const MONTHS = ['Jun 2026', 'Jul 2026', 'Agu 2026']
  const results = []

  for (let a = 0; a < spec.accounts; a++) {
    const account = ACCOUNTS[a % ACCOUNTS.length]

    for (let m = 0; m < spec.months; m++) {
      const period = MONTHS[m % MONTHS.length]
      const opener = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Tambah Data Mutasi Rekening')

      if (!opener) { results.push({ account: account.nomor, period, ok: false, step: 'open', reason: 'no opener — is step 5 current?' }); break }

      opener.click()
      await wait(openWait + 400)
      if (!dialog()) { results.push({ account: account.nomor, period, ok: false, step: 'open', reason: 'modal did not appear' }); continue }

      const bank = await chooseBank(account.bank, a)
      const nomor = byPlaceholder('nomor rekening')
      const nama = byPlaceholder('nama pemilik')
      const periode = byPlaceholder('MMM YYYY')

      if (nomor) setNative(nomor, account.nomor)
      if (nama) setNative(nama, account.nama)

      /**
       * 🔴 PERIODE IS READ-ONLY — it can only be set through its PICKER.
       * `DateField.tsx:287` sets `readOnly={isMonth}` on purpose ("Apr 2026 has
       * no sane partial-typing behaviour"), so a native write reverts and the
       * field submits EMPTY. Measured 2026-08-17: every other field on the
       * modal filled and the save still refused with "Field ini wajib diisi"
       * against `MMM YYYY=`.
       *
       * ⚠️ The trigger is a SPAN with `role="button"` and
       * `aria-label="Pilih tanggal"` — not the input, and not the first span in
       * the wrapper (the Input renders its own). Clicking either of those does
       * nothing at all, which reads as a dead control.
       */
      const setPeriode = async label => {
        const month = String(label).split(' ')[0]
        const box = byPlaceholder('MMM YYYY')

        if (!box) return null

        let node = box
        let trigger = null

        for (let up = 0; up < 4 && node && !trigger; up++) {
          node = node.parentElement
          trigger = node && node.querySelector('[aria-label="Pilih tanggal"]')
        }

        if (!trigger) return null

        trigger.click()
        await wait(openWait)

        const pick = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === month)

        if (!pick) return null

        pick.click()
        await wait(500)

        return box.value
      }

      const periodeSet = periode ? await setPeriode(period) : null

      /* Saldo Awal is the first decimal box: the row decimals do not exist
         until a row has been added, which has not happened yet. */
      const saldo = [...dialog().querySelectorAll('input')].find(i => i.getAttribute('inputmode') === 'decimal')
      if (saldo) setNative(saldo, String(50000000 + a * 25000000))
      await wait(300)

      const rowDates = () => [...dialog().querySelectorAll('input')].filter(i => (i.placeholder || '').includes('dd/mm/yyyy'))

      for (let r = rowDates().length; r < spec.rowsPerMonth; r++) {
        const add = [...dialog().querySelectorAll('button')].find(b => /Tambah Baris/i.test(b.textContent || ''))
        if (!add) break
        add.click()
        await wait(500)
      }

      const inputs = [...dialog().querySelectorAll('input')]

      rowDates().forEach((dateBox, r) => {
        const at = inputs.indexOf(dateBox)
        const nasabah = inputs[at + 1]
        const keterangan = inputs[at + 2]
        const debit = inputs[at + 3]
        const kredit = inputs[at + 4]
        const day = String(5 + r * 7).padStart(2, '0')
        const monthNo = String(6 + (m % 3)).padStart(2, '0')

        setNative(dateBox, day + '/' + monthNo + '/2026')
        if (nasabah) setNative(nasabah, r % 2 === 0 ? 'PT Sumber Rejeki' : 'CV Mitra Abadi')
        if (keterangan) setNative(keterangan, r % 2 === 0 ? 'Transfer masuk penjualan' : 'Pembayaran supplier')
        if (r % 2 === 0 && kredit) setNative(kredit, String(12000000 + r * 1500000))
        if (r % 2 === 1 && debit) setNative(debit, String(4500000 + r * 900000))
      })

      await wait(400)
      const save = [...dialog().querySelectorAll('button')].find(b => /^Simpan$/.test((b.textContent || '').trim()))
      if (!save) { results.push({ account: account.nomor, period, ok: false, step: 'save', reason: 'no Simpan' }); continue }

      save.click()
      await wait(openWait + 600)
      const closed = !dialog()

      /**
       * 🔴 CAPTURE THE STATE AT THE MOMENT OF REFUSAL, before anything closes
       * the modal. "Save blocked" with no detail cost four rounds on the
       * collateral modal — and this function MUST cancel to reach the next row,
       * which destroys the evidence a moment later.
       *
       * ⚠️ Scraped by COLOUR, not by text: this modal is `useState`, so there is
       * no RHF `_formState.errors` to read, and matching "wajib"/"harus" over
       * text with no sentence breaks swallows the entire dialog — which is
       * exactly what the first version reported.
       */
      const refusal = closed ? null : (() => {
        const box = dialog()
        const red = [...box.querySelectorAll('*')]
          .filter(e => !e.children.length && (e.textContent || '').trim() &&
            /^rgb\(2[0-9]{2},\s*[0-9]{1,2},\s*[0-9]{1,2}\)$/.test(getComputedStyle(e).color))
          .map(e => (e.textContent || '').trim())

        return {
          errors: [...new Set(red)].slice(0, 6),
          values: [...box.querySelectorAll('input')].map(i => ((i.placeholder || '?') + '=' + i.value).slice(0, 42))
        }
      })()

      results.push({
        account: account.nomor, period, periodeSet, bank, ok: closed,
        step: closed ? 'saved' : 'save', refusal: refusal || undefined
      })

      if (!closed) {
        const cancel = [...dialog().querySelectorAll('button')].find(b => /^Batal$/.test((b.textContent || '').trim()))
        if (cancel) { cancel.click(); await wait(600) }
        const yes = [...(dialog() || document).querySelectorAll('button')].find(b => /^Ya$/.test((b.textContent || '').trim()))
        if (yes) { yes.click(); await wait(600) }
      }
    }
  }

  return { saved: results.filter(r => r.ok).length, wanted: spec.accounts * spec.months, results }
}

/**
 * Link every agunan row to a credit facility (user, 2026-08-17: "it also needs
 * to check the 'Pilih Fasilitas Kredit' one as currently all of it not
 * assigned, it should be assigned to our created Facility").
 *
 * 🔴 Registering a collateral does NOT attach it to anything. The agunan TABLE
 * carries a per-row "Pilih Fasilitas Kredit" select that nothing in the run
 * touched, so every fixture ended with collaterals floating free of the
 * facility they are supposed to secure — the record looked populated and was
 * incoherent.
 *
 * Takes the FIRST offered option per row rather than matching a name: the
 * options are the facilities THIS application created, and a fixture with one
 * facility has exactly one to choose. ⚠️ With several facilities this spreads
 * nothing — every agunan lands on the first. Fine for a fixture, and stated
 * here rather than discovered later.
 *
 * 🔑 Re-querying by the PLACEHOLDER is what makes this idempotent: a row that
 * has been assigned no longer reads "Pilih Fasilitas Kredit", so a second run
 * finds only what is still unassigned and cannot double-click a select shut.
 */
async function v2AssignCollateralFacilities(delayMs = 700) {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  /**
   * 🔴 THE CONTROL IS A `SearchableMultiSelect`, NOT A SELECT, and that decides
   * what "already assigned" looks like. It keeps the PLACEHOLDER on its trigger
   * for ever and renders chosen values as CHIPS in their own row above the
   * input (`controls.tsx:620`). So "the trigger still says Pilih Fasilitas
   * Kredit" is TRUE of an assigned row and is the wrong success test — using it
   * made the driver report an assignment it had genuinely made and then count
   * the same row as still pending, which would loop until the guard tripped.
   *
   * The honest test is whether the CELL carries a chip, i.e. any text besides
   * the placeholder.
   */
  /**
   * ⚠️ BOUNDED BY LENGTH, because "the nearest ancestor with other text" climbs
   * straight past the cell into the ROW — whose text always contains the agunan
   * name and its rupiah value, so every row read as assigned and the pass did
   * nothing. A facility cell holds a placeholder plus at most a chip or two;
   * anything longer is the row.
   */
  /**
   * 🔴 STRUCTURAL BOUNDARY, NOT A CHARACTER COUNT — rewritten 2026-08-17 after
   * the count silently failed on UNDERLYING rows.
   *
   * This used to keep the largest ancestor whose text was under 80 characters.
   * That bound was tuned on AGUNAN rows, which carry a long name and a rupiah
   * value and so comfortably exceed it. An underlying row does not: measured,
   * its whole row reads "Uji Nama Payor 1 UJI-1002 Pilih Fasilitas Kredit
   * Rp 100.000.000" — 60 characters. So the climb swallowed the ENTIRE ROW,
   * stripping the placeholder left the payor name and the amount behind, and
   * every unassigned underlying row reported itself as already assigned. The
   * pass then returned `assigned: 0, remaining: 0` on a table where nothing was
   * linked, which reads as "nothing to do" rather than as a miss.
   *
   * The row is identifiable by STRUCTURE instead: it carries the row action
   * buttons, whose aria-labels are EXACTLY "Ubah" and "Hapus". A chip's remove
   * control is "Hapus <value>" — prefixed, never bare — so an exact match
   * separates the row from the control cleanly, whatever the text length.
   * Measured on the live row: levels 0-2 hold the control (one button, text is
   * just the placeholder), level 3 is the row (four buttons, both actions).
   */
  const isRowAction = el => {
    const a = el.getAttribute('aria-label')

    return a === 'Ubah' || a === 'Hapus'
  }

  const cellOf = trigger => {
    let node = trigger.parentElement
    let best = trigger.parentElement

    for (let i = 0; i < 5 && node; i++) {
      if ([...node.querySelectorAll('button')].some(isRowAction)) break
      best = node
      node = node.parentElement
    }

    return best
  }

  const isAssigned = trigger => {
    const rest = (cellOf(trigger).textContent || '').split('Pilih Fasilitas Kredit').join('').trim()

    return rest.length > 0
  }

  const pending = () =>
    [...document.querySelectorAll('button')]
      .filter(b => /Pilih Fasilitas Kredit/.test(b.textContent || ''))
      .filter(b => !isAssigned(b))

  const results = []
  let guard = 0

  while (pending().length && guard++ < 20) {
    const trigger = pending()[0]

    /**
     * The option panel renders INLINE among controls that are also <button>s,
     * so the only reliable read is a before/after diff — the same rule the
     * collateral driver's `choose` uses.
     *
     * ⚠️ RETRIED ONCE, because a trigger click TOGGLES. If a panel was already
     * open when this ran, the first click CLOSES it and the diff is empty —
     * indistinguishable from "this select has no options". Measured 2026-08-17
     * when a probe left one open: the driver reported "no facility offered" on
     * a select that had one. The second click opens it for real.
     */
    const openAndRead = async () => {
      const before = new Set([...document.querySelectorAll('button')])

      trigger.click()
      await wait(delayMs)

      return [...document.querySelectorAll('button')].filter(b => !before.has(b) && (b.textContent || '').trim())
    }

    let options = await openAndRead()

    if (!options.length) options = await openAndRead()

    if (!options.length) {
      results.push({ ok: false, reason: 'no facility offered — was a facility created on step 1?' })
      trigger.click()
      await wait(300)
      break
    }

    const chosen = (options[0].textContent || '').trim()

    options[0].click()
    await wait(delayMs)

    results.push({ ok: true, facility: chosen })
  }

  return { assigned: results.filter(r => r.ok).length, remaining: pending().length, results }
}

async function v2AddRows(specs, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')]
      .filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  /** The RHF control behind a modal, by walking up the fiber from any control
   *  in it — the same walk `v2ReadValues` uses, scoped to a subtree. */
  const rhfControl = scopeEl => {
    for (const el of scopeEl.querySelectorAll('input, textarea, button')) {
      const key = Object.keys(el).find(k => /^__reactFiber\$/.test(k))

      if (!key) continue

      let fiber = el[key]
      let depth = 0

      while (fiber && depth++ < 200) {
        const props = fiber.memoizedProps

        if (props && props.control && typeof props.name === 'string') return props.control
        fiber = fiber.return
      }
    }

    return null
  }

  /**
   * `input` only — no `change`.
   *
   * ⚠️ This block used to claim a Cleave mask "collapses to 0 when a `change`
   * event follows the `input` one". That was never observed; it was inferred
   * from a field the filler had SKIPPED (see the `isBlank` note below).
   * Measured 2026-08-15 on `Isi Nominal Underlying`: a native write plus one
   * `input` event puts "100000000" in the RHF store and it is still there
   * 500ms later. `input` alone remains right — it is what React listens for —
   * but nothing here is working around a mask.
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
   * Verify what the fields actually hold, and re-set anything that did not take.
   *
   * ⚠️ Kept as a SAFETY NET, not as a fix — the one masked control measured
   * takes a plain write cleanly. Masks differ per field and only one was
   * tested, so a verify pass is cheap insurance; if it ever repairs something,
   * that is a finding worth chasing rather than a routine occurrence.
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

        /* 🔴 A MOUNTED `0` IS A PLACEHOLDER, NOT DATA — and this is the whole of
           the add-rows blocker. `Isi Nominal Underlying` renders "0" because its
           form default is the number 0, so a bare `!i.value` filter skipped it,
           the field was never written, and the save failed on a value the driver
           had never touched. The report said `Nominal Underlying=0`, which reads
           as a write that collapsed — six hypotheses chased that reading (mask
           collapse, `change` events, date format, close timing, upload settling,
           attach re-render) and every one was downstream of a write that never
           happened. Measured 2026-08-15: a native write to that same field lands
           in the store as "100000000" and holds. Same trap as v1's `skipFilled`. */
        const isBlank = value => !String(value ?? '').trim() || /^0([.,]0+)?$/.test(String(value).trim())

        ;[...scope.querySelectorAll('input, textarea')]
          .filter(i => i.type !== 'file' && isBlank(i.value) && !i.disabled && !i.readOnly)
          .forEach((input, i) => {
            const value = guess(input.placeholder, n + 1 + i)

            setNative(input, value)
            written.push([input, value])
          })

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

        /* Last thing before the save, so the verify sees the state the save
           will. (It sits here because "the attach re-renders and undoes the
           repair" was the sixth hypothesis — also wrong, but this is the right
           place for a verify pass regardless.) */
        await repairMasked(written, wait)
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

        /* 🔴 The errors REACT-HOOK-FORM holds, which are not the errors the
           modal renders. These modals submit through `methods.handleSubmit`, so
           a resolver failure refuses SILENTLY — and a field whose error has no
           visible slot (an array, a control that draws no helper text) leaves
           the DOM scrape above reporting "no message in the dialog" on a form
           that is loudly invalid inside. Reading the store is the only way to
           see it. */
        const rhf = rhfControl(box3)

        if (rhf) {
          const flat = (obj, path = []) =>
            Object.entries(obj || {}).flatMap(([k, v]) =>
              v && typeof v === 'object' && !v.message ? flat(v, [...path, k]) : [[...path, k].join('.') + ': ' + (v?.message ?? v)]
            )

          lastError += ' | rhf errors: ' + (flat(rhf._formState?.errors).join(' · ') || 'none') +
            ' | rhf values: ' + JSON.stringify(rhf._formValues || {})
        } else {
          lastError += ' | rhf: control not found'
        }

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
  /* ⚠️ Do NOT add `[contenteditable]` here. ProseMirror builds its own DOM
     OUTSIDE React, so that node carries no `__reactFiber$` key at all
     (measured 2026-08-17) and can never resolve to a field name — it would be
     swept up and then dropped. A rich-text field is reached through its TOOLBAR
     BUTTONS, which do carry the Controller; `classify` recognises it from
     there. */
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

// ─── Record modals ────────────────────────────────────────────────────────────
/**
 * 🔴 THESE DID NOT EXIST, AND THAT MADE "Fill modals" A NO-OP ON EVERY v2 PAGE.
 *
 * `walkRecordModals` opens with `if (!driver.listModals) return null`, and
 * `drivers.js` wired `listModals`/`openModal` for v1 ONLY. So on v2 the entire
 * modal phase returned null before doing anything: the checkbox was ticked, the
 * run reported success, and Fasilitas Kredit — which only exists behind
 * "Tambah Fasilitas" — was never filled (user, 2026-08-15).
 *
 * Same shape as the other defects found that night: a setting produced and
 * never consumed. The contract below matches v1's exactly so `walkRecordModals`
 * needs no branch.
 */
/**
 * The "Tambah …" controls the GENERIC modal walk may drive.
 *
 * 🔴 "Tambah Agunan" and "Tambah Fasilitas" are EXCLUDED because each has its
 * own capability — `v2FillCollaterals` and `v2AddFacilities`. Without the
 * exclusion agunan was walked TWICE: the generic phase opened it, filled it
 * with whatever the sweep chose and SAVED it, and then the collateral pass
 * added the configured list on top. Measured 2026-08-17 from a user run — a
 * config of 6 produced 7 rows, and the extra one was a "Pesawat Udara", a
 * collateral TYPE nobody had asked for, because the generic fill simply took an
 * option from the Jenis Agunan select.
 *
 * 🔑 The same reasoning already excludes agunan from the generic row-adder
 * (`simulation.js` TABLES: "Agunan is deliberately ABSENT — it needs a type per
 * row"). This applies it to the modal walk as well.
 *
 * ⚠️ The identical filter MUST be repeated in `v2OpenModal` — its own comment
 * requires same scope, same filter, same order, so filtering one alone would
 * make every index address a different button.
 */
function v2ListModals() {
  /* Scope to the open dialog if there is one — a modal can host its own
     "Tambah" (the agunan modal hosts none today, but step 2's records do) —
     otherwise to the step card, which is what the v2 driver keys on
     everywhere else. */
  const open = [...document.querySelectorAll('[role="dialog"]')]
    .filter(d => d.getAttribute('aria-hidden') !== 'true')
  const scope = open[open.length - 1] || document.querySelector('[data-m="stepcard"]') || document

  return [...scope.querySelectorAll('button')]
    .map(b => ({ label: (b.textContent || '').trim(), disabled: Boolean(b.disabled) }))
    .filter(x => /^Tambah/i.test(x.label) && !/^(Tambah Agunan|Tambah Fasilitas)$/.test(x.label))
    .map((x, n) => ({ index: n, label: x.label, disabled: x.disabled, opensModal: null }))
}

/**
 * Open the nth "Tambah …" control, probing whether it is a modal or a repeater.
 *
 * ⚠️ Indexing must agree with `v2ListModals` — same scope, same filter, same
 * order — or an index from that list addresses a different button here.
 */
async function v2OpenModal(nth) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const openDialogs = () =>
    [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

  const before = openDialogs().length
  const openNow = openDialogs()
  const scope = openNow[openNow.length - 1] || document.querySelector('[data-m="stepcard"]') || document

  const buttons = [...scope.querySelectorAll('button')].filter(b => {
    const label = (b.textContent || '').trim()

    return /^Tambah/i.test(label) && !/^(Tambah Agunan|Tambah Fasilitas)$/.test(label)
  })

  const btn = buttons[nth]

  if (!btn) return { opened: false, isModal: false, title: null, reason: 'no_button' }
  if (btn.disabled) return { opened: false, isModal: false, title: null, reason: 'disabled' }

  const label = (btn.textContent || '').trim()

  const inputCount = () => document.querySelectorAll('input:not([type="hidden"]), textarea, select').length
  const buttonsBefore = new Set([...document.querySelectorAll('button')])
  const countBefore = inputCount()

  btn.click()

  /* A v2 dialog mounts without a backdrop class to key on, so the signal is a
     NEW `[role="dialog"]` appearing — counted, because one may already be open
     when a modal hosts its own opener. */
  for (let i = 0; i < 40; i++) {
    if (openDialogs().length > before) break
    await sleep(50)
  }
  await sleep(400)

  const after = openDialogs()
  const isModal = after.length > before

  if (isModal) {
    const paper = after[after.length - 1]

    /* 🔴 A v2 dialog has NO heading element — measured 2026-08-15 on "Tambah
       Fasilitas Kredit": `querySelectorAll('h1,h2,h3,h4,h5,h6')` returns ZERO
       and the title is a plain div. v1's heading lookup was transcribed here
       and returned '' for every modal, which reads in a run report as an
       unnamed modal rather than as a broken extractor. On this design system
       the first line of the dialog's own text IS the title. */
    const heading = paper.querySelector('h1,h2,h3,h4,h5,h6')
    const title = heading
      ? (heading.textContent || '').trim()
      : ((paper.innerText || '').split('\n')[0] || '').trim()

    return { opened: true, isModal: true, label, title }
  }

  // ── No modal: it was a repeater. Put the row back. ────────────────────────
  const countAfter = inputCount()

  if (countAfter <= countBefore) {
    return { opened: true, isModal: false, label, title: null, reason: 'no_modal_no_change' }
  }

  /* v2 labels its destructive row control in Indonesian ("Hapus agunan"), which
     is a far better key than v1's red-text heuristic — colour is a design token
     that moves. Colour is kept as a fallback for rows that carry no label. */
  const appeared = [...document.querySelectorAll('button')].filter(b => !buttonsBefore.has(b))
  const isRed = el => {
    const rgb = (getComputedStyle(el).color || '').match(/\d+/g)

    return rgb && +rgb[0] > 150 && +rgb[1] < 90 && +rgb[2] < 90
  }

  const del = appeared.find(b => /hapus/i.test(b.getAttribute('aria-label') || b.title || ''))
    || appeared.filter(isRed).pop()

  if (del) {
    del.click()
    await sleep(700)
  }

  return {
    opened: true,
    isModal: false,
    label,
    title: null,
    addedInputs: countAfter - countBefore,
    reason: inputCount() <= countBefore ? 'repeater_reverted' : 'repeater_NOT_reverted'
  }
}

/**
 * Save the open record modal.
 *
 * ⚠️ `walkRecordModals` calls this and `v2CloseModal` WITHOUT a feature test
 * (popup.js:1332-1333), unlike `reveal`/`pendingConfirm`. So shipping
 * `listModals`/`openModal` alone would have opened every v2 modal and then
 * thrown on `executeScript({func: undefined})` — leaving a modal open over a
 * half-filled form, which is strictly worse than the no-op it replaced.
 *
 * 🔴 The save button often carries the SAME label as the opener ("Tambah
 * Agunan"), told apart only by living inside the dialog — searching the
 * document re-clicks the opener. And success is the dialog CLOSING, never the
 * click landing: a blocked save clicks perfectly well.
 */
async function v2SaveModal() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const open = () => [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

  const before = open()
  const box = before[before.length - 1]

  if (!box) return 'no_modal'

  const buttons = [...box.querySelectorAll('button')]
  const save = buttons.find(b => /^Simpan$/i.test((b.textContent || '').trim()))
    || buttons.find(b => /^(Simpan|Tambah)/i.test((b.textContent || '').trim()))

  if (!save) return 'no_button'
  if (save.disabled) return 'blocked'

  save.click()
  await sleep(700)

  /* v2 gates a record save behind its own confirm — a SECOND `[role=dialog]`,
     never sweetalert2. Answering it is part of saving, not a separate step. */
  const confirm = open().pop()
  const ya = confirm && confirm !== box
    && [...confirm.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

  if (ya) { ya.click(); await sleep(800) }

  for (let i = 0; i < 40; i++) {
    if (!open().includes(box)) return 'saved'
    await sleep(100)
  }

  return 'blocked'
}

/** Dismiss the open modal without saving. v2 record modals DO carry a Batal or
 *  Tutut-style dismissive, unlike v1's, so Escape is only the fallback. */
async function v2CloseModal() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const open = () => [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

  const box = open().pop()

  if (!box) return 'closed'

  const cancel = [...box.querySelectorAll('button')]
    .find(b => /^(Batal|Tutup|Kembali)$/i.test((b.textContent || '').trim()))

  if (cancel) {
    cancel.click()
    await sleep(700)

    /* Dismissing a dirty form can itself raise a confirm. */
    const confirm = open().pop()
    const ya = confirm && confirm !== box
      && [...confirm.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

    if (ya) { ya.click(); await sleep(700) }
    if (!open().includes(box)) return 'closed'
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(700)

  return open().includes(box) ? 'stuck' : 'closed'
}

/** A confirmation is a dialog with DECISIVE buttons and no inputs — the same
 *  test v1 uses, retargeted at `[role=dialog]`. */
function v2PendingConfirm() {
  const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')
  const top = open[open.length - 1]

  if (!top) return null
  if (top.querySelectorAll('input:not([type="hidden"]), textarea, select').length) return null

  const buttons = [...top.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean)

  if (!buttons.length) return null

  const decisive = buttons.filter(t => /^(ya|tidak|yes|no|ok|batal|cancel|lanjutkan|hapus|simpan)$/i.test(t))

  if (!decisive.length) return null

  return { text: (top.innerText || '').trim().slice(0, 200), buttons, decisive }
}

/** ⚠️ Defaults to REFUSING, like v1 — most confirmations here guard a
 *  destructive change, and `walkRecordModals` passes `false` deliberately. */
async function v2AnswerConfirm(accept) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')
  const top = open[open.length - 1]

  if (!top) return 'no_dialog'

  const want = accept ? /^(ya|yes|ok|lanjutkan)$/i : /^(tidak|no|batal|cancel)$/i
  const btn = [...top.querySelectorAll('button')].find(b => want.test((b.textContent || '').trim()))

  if (!btn) return 'no_button'

  btn.click()
  await sleep(800)

  return 'answered'
}

// ─── Credit facilities ────────────────────────────────────────────────────────
/**
 * Add N credit facilities through "Tambah Fasilitas".
 *
 * 🔴 WHY THIS NEEDS ITS OWN CAPABILITY, like the Agunan modal did.
 *
 * `FacilityFormModal` does NOT use react-hook-form — it holds its state in a
 * plain `useState` (`FacilityFormModal.tsx:154`) with `value`/`onChange` on
 * every control. The whole v2 discovery contract is "walk the fiber to a
 * `Controller` carrying `control` + `name`", so `v2Detect` sees **0 of its 12
 * inputs** and the generic fill has nothing to work with. Measured live
 * 2026-08-15: the modal opens, reports 12 inputs, and every fiber walk returns
 * null. That is the SECOND blocker on Fasilitas Kredit — the first was the v2
 * driver having no modal capability at all.
 *
 * So the sequence is ported from the proven `addFacility`
 * (`los-create-autofill/scripts/helpers.js`), whose ordering is the part that
 * matters, while the PRIMITIVES stay the driver's own — `choose` takes options
 * from a before/after button diff, which is what stops it re-clicking a pill.
 *
 * @param plan { count, plafon, tenor, rate, scheme, method, restructDefault }
 */
async function v2AddFacilities(plan, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))

  const spec = Object.assign(
    { count: 1, plafon: '900000000', tenor: '24', rate: '11', scheme: 'Reguler', method: 'Anuitas', restructDefault: '0' },
    plan || {}
  )

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement

    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Fill every input whose placeholder contains `needle` — BOTH of them where
   *  a block appears twice, the trap the collateral driver paid for. */
  /**
   * 🔴 PLACEHOLDER FIRST, THEN LABEL — because this modal has NO placeholders.
   *
   * Measured 2026-08-16: every input in "Tambah Fasilitas Kredit" reports
   * `placeholder: ""`, so a placeholder-only fill matched NOTHING. Plafon,
   * tenor and rate were never written and the save was refused with no message
   * — the same silent shape as every other bug on this path. It appeared to
   * work once only because the product picked on that run prefilled them.
   *
   * The label is the reliable key here: walk up from the input to the first
   * ancestor carrying a label element that is not the input's own wrapper.
   * Placeholder is kept first because every OTHER v2 modal does have them and
   * they are cheaper to match.
   */
  const labelOf = input => {
    let node = input

    /* ⚠️ Prefer a real <label>, and never an ADORNMENT. A currency field renders
       its "Rp" prefix as a span INSIDE the control wrapper, so "first span that
       is not the input" returns "Rp" — measured 2026-08-16, which is why
       `Plafon Pinjaman` matched nothing and the zero-fill then wrote 0 into the
       headline amount. Anything at or under three characters is a unit, not a
       name. */
    for (let depth = 0; depth < 6 && node; depth++) {
      node = node.parentElement

      if (!node) break

      const candidates = [...node.querySelectorAll('label, .kai-label, span')]
        .filter(el => !el.contains(input) && el.textContent.trim().length > 3)

      if (candidates.length) {
        const real = candidates.find(el => el.tagName === 'LABEL') || candidates[0]

        return real.textContent.trim()
      }
    }

    return ''
  }

  const fill = (needle, value) => {
    const scope = dialog() || document
    const want = String(needle).toLowerCase()
    const candidates = [...scope.querySelectorAll('input, textarea')].filter(i => !i.disabled && !i.readOnly)

    let hits = candidates.filter(i => (i.placeholder || '').toLowerCase().includes(want))

    if (!hits.length) hits = candidates.filter(i => labelOf(i).toLowerCase().includes(want))

    hits.forEach(i => setNative(i, value))

    return hits.length > 0
  }

  /* Options come from a BEFORE/AFTER DIFF of the dialog's button set: the panel
     renders INLINE among controls that are also <button>s, so "the first button
     that is not Batal" picks a pill. */
  const choose = async (triggerText, optionText, _exact = false, nth = 0) => {
    const scope = dialog()

    if (!scope) return false

    const trigger = [...scope.querySelectorAll('button')]
      .find(b => (b.textContent || '').toLowerCase().includes(String(triggerText).toLowerCase()))

    if (!trigger) return false

    const before = new Set([...scope.querySelectorAll('button')])

    trigger.click()
    await wait(openWait)

    const options = [...(dialog() || document).querySelectorAll('button')]
      .filter(b => b !== trigger && !before.has(b) && (b.textContent || '').trim())

    const usable = options.filter(b => !/^(Batal|Tutup|Simpan|Tambah)/.test((b.textContent || '').trim()))

    /* `nth` addresses the list positionally — used to walk PRODUCTS when the
       first one turns out to be unsaveable. Out of range closes the panel and
       reports, so the caller can stop rather than loop. */
    if (nth > 0) {
      if (!usable[nth]) { trigger.click(); return { ok: false, chosen: null, fellBack: false, exhausted: true } }

      const pick = usable[nth]
      const label = (pick.textContent || '').trim()

      pick.click()
      await wait(400)

      return { ok: true, chosen: label, fellBack: false }
    }

    const named = optionText
      ? (options.find(b => (b.textContent || '').trim() === optionText)
        || options.find(b => (b.textContent || '').trim().includes(optionText)))
      : null

    /**
     * 🔴 IF THE SEED VALUE IS NOT OFFERED, TAKE THE FIRST OPTION (user,
     * 2026-08-16: "if none of the mock data avail, just pick the first option
     * avail").
     *
     * The seeds are generic — `Reguler` / `Anuitas` — and a product decides its
     * own list. `PROD - KK - MULTIGUNA FIXED LOAN` offers only Bullet Pokok,
     * Bullet Bunga and Bullet Pokok + Bunga, so asking for `Reguler` matched
     * nothing, the REQUIRED select stayed empty, and the save was refused with
     * no message at all. Leaving a required select blank because a mock value
     * was unavailable fails the whole record over a detail nobody cares about
     * in a fixture.
     *
     * ⚠️ The substitution is REPORTED, never silent — `fellBack` rides back to
     * the caller. Quietly filling something different from what was asked for
     * is the exact class of bug this driver keeps paying for.
     */
    const hit = named || usable[0]

    if (!hit) { trigger.click(); return { ok: false, chosen: null, fellBack: false } }

    const chosen = (hit.textContent || '').trim()

    hit.click()
    await wait(400)

    return { ok: true, chosen, fellBack: Boolean(optionText) && !named }
  }

  const blockingErrors = () => {
    const scope = dialog()

    if (!scope) return []

    return [...new Set(
      [...scope.querySelectorAll('*')]
        .filter(e => !e.children.length)
        .map(e => (e.textContent || '').trim())
        .filter(t => /wajib|tidak boleh/i.test(t) && !/^•/.test(t) && !/^Format /i.test(t))
    )].slice(0, 4)
  }

  const results = []

  /* Which product to try. Advanced — not reset — when one proves unsaveable,
     so the walk never revisits a dead product on a later row. */
  let attempt = 0

  for (let n = 0; n < Math.max(0, Number(spec.count) || 0); n++) {
    const opener = [...document.querySelectorAll('button')]
      .find(b => /Tambah Fasilitas/.test(b.textContent || ''))

    if (!opener) {
      results.push({ ok: false, step: 'open', reason: 'no "Tambah Fasilitas" — is a Jenis Kredit chosen?' })
      break
    }

    opener.click()
    await wait(600)

    if (!dialog()) { results.push({ ok: false, step: 'open', reason: 'dialog did not mount' }); continue }

    /**
     * 🔴 TRY THE NEXT PRODUCT WHEN ONE LEADS TO AN UNSATISFIABLE FORM.
     *
     * "Pick the first option available" has to mean the first that WORKS.
     * Measured 2026-08-16 on Perorangan Konsumtif, which offers exactly two
     * products:
     *
     *   1020 MULTIGUNA FIXED LOAN → schemes Bullet Pokok / Bunga / Pokok+Bunga,
     *                               and **zero** Metode Perhitungan options for
     *                               ANY of them ("Tidak ada pilihan yang cocok")
     *   1021 MULTIGUNA ANGSURAN   → scheme Reguler, which works
     *
     * `Metode Perhitungan Bunga` is REQUIRED, so on 1020 the modal cannot be
     * saved by anyone — driver or human. Taking the first product parked the
     * run on the one dead product in the list. Recorded as a data gap in its
     * own right; the driver simply must not stop there.
     */
    const productIndex = attempt

    const product = await choose('Pilih produk kredit', null, false, productIndex)

    if (!product.ok) {
      results.push({ ok: false, step: 'product', reason: `no product at index ${productIndex}` })

      const cancel = [...dialog().querySelectorAll('button')].find(b => /^(Batal|Tutup)$/.test((b.textContent || '').trim()))

      cancel?.click()
      await wait(500)
      continue
    }

    /* 🔴 The product's find-one. EVERYTHING below depends on it — the helper
       this is ported from records 3000ms as the working number, and a shorter
       wait fills fields that are about to be replaced. */
    await wait(3000)

    fill('Plafon Pinjaman', spec.plafon)
    fill('Jangka Waktu', spec.tenor)
    fill('Suku Bunga', spec.rate)
    await wait(300)

    const scheme = await choose('Pilih skema pembayaran', spec.scheme)

    /* A BULLET_* scheme LOCKS the method to Flat and removes the trigger, so
       `choose` finding nothing here is correct rather than a failure. */
    const method = await choose('Pilih metode perhitungan', spec.method)

    /**
     * 🔴 The method select is STILL PRESENT but offered NOTHING — the modal is
     * unsatisfiable on this product, so move to the next one rather than
     * submitting into a required field that can never be filled. A trigger that
     * has VANISHED is the locked case and is fine; a trigger that remains and
     * yields no option is the dead one.
     */
    const methodDead = !method.ok
      && [...(dialog() || document).querySelectorAll('button')].some(b => /metode perhitungan/i.test(b.textContent || ''))

    if (methodDead) {
      const cancel = [...dialog().querySelectorAll('button')].find(b => /^(Batal|Tutup)$/.test((b.textContent || '').trim()))

      cancel?.click()
      await wait(700)

      /* Dismissing a dirty modal raises its own confirm. ⚠️ Answered inline —
         `answerConfirm` belongs to `v2FillCollaterals` and is NOT in scope
         here; each driver function is serialised alone. */
      const ya = [...(dialog() || document).querySelectorAll('button')]
        .find(b => /^Ya$/i.test((b.textContent || '').trim()))

      if (ya) { ya.click(); await wait(800) }

      attempt += 1
      n -= 1

      /* Bounded: without this a form whose every product is dead loops forever. */
      if (attempt > 4) {
        results.push({ ok: false, step: 'product', reason: `no product offers a usable Metode Perhitungan (tried ${attempt})` })
        break
      }

      continue
    }

    /* Perpanjangan/Restrukturisasi make seven more figures required. Anything
       still empty gets a zero so the save is not blocked on a field the caller
       never named. */
    const stillEmpty = [...(dialog()?.querySelectorAll('input') || [])].filter(i => i.value === '' && !i.disabled)

    stillEmpty.forEach(i => setNative(i, spec.restructDefault))
    await wait(250)

    const box = dialog()
    const submit = box && [...box.querySelectorAll('button')]
      .find(b => /^(Tambah Fasilitas|Simpan)/.test((b.textContent || '').trim()))

    submit?.click()
    await wait(900)

    /**
     * v2 gates the save behind its own confirm.
     *
     * 🔴 Do NOT require the confirm to be a DIFFERENT element than the modal.
     * Measured 2026-08-16: after clicking save, the open dialog's button list
     * reads `Tidak, Ya, Batal, Tambah Fasilitas` — the confirm's buttons are
     * reachable in the same scope, so a `confirm !== box` guard never fires,
     * the Ya is never clicked, and the modal simply stays open forever. Look
     * for the button, not for a second dialog.
     */
    const ya = [...(dialog() || document).querySelectorAll('button')]
      .find(b => /^Ya$/i.test((b.textContent || '').trim()))

    if (ya) { ya.click(); await wait(900) }

    /* Success is the dialog CLOSING, never the click landing. */
    for (let i = 0; i < 12 && dialog(); i++) await wait(200)

    /* Every choice this row actually made — so a substituted option is visible
       in the report rather than discovered later in the record. */
    const chosen = {
      product: product.chosen,
      scheme: scheme.chosen,
      method: method.chosen,
      ...(scheme.fellBack || method.fellBack
        ? { substituted: [scheme.fellBack && `skema→${scheme.chosen}`, method.fellBack && `metode→${method.chosen}`].filter(Boolean) }
        : {})
    }

    if (dialog()) {
      results.push({ ok: false, step: 'submit', errors: blockingErrors(), chosen })

      const cancel = [...dialog().querySelectorAll('button')].find(b => /^(Batal|Tutup)$/.test((b.textContent || '').trim()))

      cancel?.click()
      await wait(600)
      continue
    }

    results.push({ ok: true, total: (document.body.innerText.match(/Total Plafon[^\n]*/) || [null])[0], chosen })
  }

  return results
}

/**
 * Step 8's documents — the two document TABLES plus the SLIK dropzone.
 *
 * 🔴 THREE THINGS MADE THIS UNREACHABLE BY THE GENERIC ROW-ADDER, and each one
 * alone would have been enough (all measured live 2026-08-17):
 *
 *   1. **The rows have no "Tambah" opener at all.** A mandatory document row
 *      already EXISTS — the BE seeds it from the product — and is opened by the
 *      row's PENCIL, an IconButton whose only handle is `aria-label="Ubah"`.
 *      `v2AddRows` finds its opener by exact BUTTON TEXT, and a pencil has none.
 *   2. **Both blocks' add buttons carry the SAME label, "Upload Dokumen"**, so
 *      even the add path cannot tell Dokumen Pengajuan Kredit from Dokumen
 *      Calon Debitur by text. (`simulation.js` also had the wrong string
 *      entirely — "Tambah Dokumen Pengajuan Kredit" — which is a third
 *      instance of the opener-label bug already recorded for Fasilitas and
 *      Kunjungan.)
 *   3. **The SLIK attachment is not in a modal at all** — it is a page-level
 *      dropzone on the step card.
 *
 * 🔑 SCOPED BY `[data-block]`, which los-fe emits for every RAW block
 * (`DynamicField.tsx` — added 2026-08-17 for the submit-guard highlight and
 * reused here). That is the only handle that distinguishes the two tables.
 * ⚠️ A heading fallback is kept for any build predating that attribute:
 * "DOKUMEN PENGAJUAN KREDIT" / "DOKUMEN CALON DEBITUR". Without it this fails
 * TOTALLY and silently on an older FE, which is the failure mode this repo
 * keeps paying for.
 */
async function v2FillDocuments(plan, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const spec = Object.assign({ required: true, optional: 1, slik: true }, plan || {})
  const report = { required: [], optional: [], slik: null }

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  /* A tiny but STRUCTURALLY VALID pdf. A text file renamed .pdf is accepted by
     the dropzone's accept filter and rejected downstream, which reads as an
     upload bug rather than a fixture one. */
  const makePdf = name => {
    const body = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
      + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
      + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n'
      + 'trailer<</Root 1 0 R>>\n%%EOF'

    return new File([body], name, { type: 'application/pdf' })
  }

  const setNative = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement

    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Drop a file on a dropzone and WAIT for the DMS temp upload to settle.
   *  🔴 3200ms is not arbitrary — `v2AddRows` measured 1500ms as too short, and
   *  saving before the round trip returns leaves the form holding no document
   *  with NO validation message to explain the refusal. */
  const dropFile = async (input, name) => {
    const transfer = new DataTransfer()

    transfer.items.add(makePdf(name))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(3200)
  }

  const blockEl = (id, heading) => {
    const direct = document.querySelector(`[data-block="${id}"]`)

    if (direct) return direct

    /* Fallback for an FE without `data-block`: the SMALLEST element that
       contains the heading AND an upload control — smallest, because anything
       larger swallows the sibling block and the two become indistinguishable
       again, which is the exact bug this scoping exists to fix. */
    const candidates = [...document.querySelectorAll('div')].filter(el => {
      const t = el.innerText || ''

      return t.toUpperCase().includes(heading) && el.querySelector('button')
    })

    return candidates.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null
  }

  const saveModal = async () => {
    const box = dialog()

    if (!box) return 'no_modal'

    const save = [...box.querySelectorAll('button')].find(b => /^Simpan$/i.test((b.textContent || '').trim()))
      || [...box.querySelectorAll('button')].find(b => /^(Simpan|Tambah|Upload)/i.test((b.textContent || '').trim()))

    if (!save) return 'no_save_button'
    if (save.disabled) return 'save_disabled'

    save.click()
    await wait(900)

    /* v2 gates a record save behind its own confirm — a SECOND dialog. */
    const confirm = dialog()
    const ya = confirm && confirm !== box
      && [...confirm.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

    if (ya) { ya.click(); await wait(900) }

    for (let i = 0; i < 30; i++) {
      if (!dialog()) return 'saved'
      await wait(150)
    }

    /* 🔑 REPORT THE STATE AT THE MOMENT OF REFUSAL, before anything closes.
       A driver that must cancel to reach the next row destroys its own
       evidence — the lesson the mutation modal was rebuilt around. */
    const box2 = dialog()
    const reds = box2
      ? [...box2.querySelectorAll('*')].filter(e => {
        const c = getComputedStyle(e).color

        return /rgb\((223|200|210), (42|30|31)/.test(c) && (e.textContent || '').trim().length < 120 && !e.children.length
      }).map(e => e.textContent.trim())
      : []
    const values = box2 ? [...box2.querySelectorAll('input, textarea')].map(i => `${i.placeholder || i.name || '?'}=${i.value}`) : []

    await (async () => {
      const cancel = box2 && [...box2.querySelectorAll('button')].find(b => /^(Batal|Tutup|Kembali)$/i.test((b.textContent || '').trim()))

      if (cancel) { cancel.click(); await wait(600) }
      const c2 = dialog()
      const ya2 = c2 && [...c2.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

      if (ya2) { ya2.click(); await wait(600) }
    })()

    return { blocked: true, errors: reds, values }
  }

  /**
   * Answer an UNSET select inside the modal.
   *
   * 🔴 Without this the optional-document save was refused with "Field ini
   * wajib diisi" and nothing else — measured 2026-08-17. Four of the modal's
   * fields are text and filled fine; `Tipe Dokumen *` is a SELECT whose trigger
   * still read "Pilih Tipe Dokumen", and a text-and-file-only fill cannot see
   * it. `Ketentuan Dokumen *` is a select too, but arrives already showing
   * "Opsional" — which is why only one of the two ever complained, and why the
   * "Pilih " prefix rather than the asterisk is the right tell for unanswered.
   *
   * ⚠️ Options are diffed from the BUTTON SET, never queried: Kairos renders
   * the panel INLINE among controls that are themselves `<button>`s, so "the
   * first button that is not Batal" picks a neighbouring control and re-clicks
   * it — the trap already paid for in the collateral driver.
   */
  const chooseFirst = async triggerText => {
    const box = dialog()

    if (!box) return false

    const trigger = [...box.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim().toLowerCase() === triggerText.toLowerCase())

    if (!trigger) return false

    const before = new Set([...box.querySelectorAll('button')])

    trigger.click()
    await wait(openWait)

    const option = [...(dialog() || box).querySelectorAll('button')]
      .filter(b => !before.has(b) && (b.textContent || '').trim())
      .find(b => !/^(Batal|Tutup|Simpan|Tambah|Upload)/i.test((b.textContent || '').trim()))

    /* Close the panel again rather than leaving it open over the next control —
       an open panel makes every later button lookup ambiguous. */
    if (!option) { trigger.click(); return false }

    const label = (option.textContent || '').trim()

    option.click()
    await wait(400)

    return label
  }

  /** Fill whatever the open modal still needs, then attach and save. */
  const completeModal = async (fileName) => {
    const box = dialog()

    if (!box) return 'no_modal'

    /* Only genuinely EMPTY text fields — a mounted "0" is a placeholder, not
       data, but a document modal has no numeric defaults so blank is blank. */
    ;[...box.querySelectorAll('input, textarea')]
      .filter(i => i.type !== 'file' && !i.value.trim() && !i.disabled && !i.readOnly)
      .forEach(i => setNative(i, 'Uji autofill'))

    /* Any trigger still reading "Pilih …" is an UNANSWERED select. Snapshotted
       as TEXT before the loop, because choosing re-renders the modal and
       renames the trigger — holding element references across the loop would
       address detached nodes. "Pilih File" is the upload button, not a select. */
    const unset = [...box.querySelectorAll('button')]
      .map(b => (b.textContent || '').trim())
      .filter(t => /^Pilih /i.test(t) && !/^Pilih File$/i.test(t))

    for (const triggerText of unset) await chooseFirst(triggerText)

    for (const input of [...box.querySelectorAll('input[type=file]')]) await dropFile(input, fileName)

    await wait(300)

    return saveModal()
  }

  /**
   * ── 1. Mandatory rows: opened by the row PENCIL, never a Tambah button ─────
   *
   * 🔴 BOTH BLOCKS, not just the credit-application one. The first version ran
   * this pass on `v2CreditApplicationDocumentBlock` alone, which left "Kartu
   * Tanda Penduduk (KTP)" and "Nomor Pokok Wajib Pajak (NPWP)" — both marked
   * Wajib — unattached under Dokumen Calon Debitur, with the red incomplete
   * glyph beside them. Seen on the user's own run 2026-08-17.
   *
   * The mistake was treating "mandatory documents" as a property of the credit
   * application when it is a property of EITHER table: the BE seeds mandatory
   * rows into the debtor block too.
   */
  const REQUIRED_BLOCKS = [
    { id: 'v2CreditApplicationDocumentBlock', heading: 'DOKUMEN PENGAJUAN KREDIT' },
    { id: 'v2PotentialDebtorDocumentBlock', heading: 'DOKUMEN CALON DEBITUR' }
  ]

  for (const target0 of (spec.required ? REQUIRED_BLOCKS : [])) {
    const block = blockEl(target0.id, target0.heading)

    if (!block) {
      report.required.push({ ok: false, block: target0.id, reason: `no ${target0.heading} block on this step` })
    } else {
      /* Re-query every iteration: saving a row re-renders the table, so a
         pencil captured up front is detached by the time its turn comes. */
      for (let i = 0; i < 12; i++) {
        const block2 = blockEl(target0.id, target0.heading)
        const pencils = [...block2.querySelectorAll('button[aria-label="Ubah"]')]
        /**
         * 🔴 BOUND THE UPWARD WALK. `FlushTable` is a CSS grid of divs with no
         * row element to key on, so the row has to be reconstructed by climbing
         * from the pencil — and an unbounded climb does not stop at the row, it
         * reaches the TABLE. Measured 2026-08-17: one row's reconstructed text
         * came back as "NAMA DOKUMEN TIPE DOKUMEN KETENTUAN LAMPIRAN AKSI …"
         * — the whole table — so a sibling's "1 file" badge counted as THIS
         * row's attachment and a genuinely empty row was skipped. The run
         * reported success having filled one row fewer than it should.
         *
         * The upper bound is the fix: a single document row is comfortably
         * under 200 characters, a table of them is not. Same length-bounded
         * `cellOf` trick `v2AssignCollateralFacilities` already uses.
         */
        const ROW_TEXT_LIMIT = 200
        const rowTextOf = p => {
          let row = p.parentElement
          let best = ''

          for (let d = 0; d < 6 && row; d++) {
            const t = (row.innerText || '').replace(/\s+/g, ' ').trim()

            if (t.length > ROW_TEXT_LIMIT) break
            if (t.length > best.length) best = t
            row = row.parentElement
          }

          return best
        }

        const target = pencils.find(p => {
          const text = rowTextOf(p)

          /* Wajib AND nothing attached yet. The attachment cell prints "N file"
             once a document is on the row, so its absence is the tell. */
          return /Wajib/.test(text) && !/\d+\s*file/i.test(text)
        })

        if (!target) break

        /* Same reasoning as the qualitative pass: work the table the way a
           person does, on screen, rather than clicking a row nobody has seen. */
        try { target.scrollIntoView({ block: 'center', behavior: 'auto' }); await wait(60) } catch (err) { /* detached */ }

        target.click()
        await wait(openWait)

        const label = (() => {
          const box = dialog()

          return box ? (box.innerText || '').split('\n').find(l => l.trim()) : '?'
        })()

        const outcome = await completeModal(`dokumen-wajib-${i + 1}.pdf`)

        report.required.push({ block: target0.id, row: label, outcome })

        if (outcome !== 'saved') break
        await wait(500)
      }
    }
  }

  // ── 2. Optional rows on Dokumen Calon Debitur ─────────────────────────────
  for (let i = 0; i < Math.max(0, Number(spec.optional) || 0); i++) {
    const block = blockEl('v2PotentialDebtorDocumentBlock', 'DOKUMEN CALON DEBITUR')

    if (!block) { report.optional.push({ ok: false, reason: 'no Dokumen Calon Debitur block' }); break }

    /* 🔴 SCOPED to the block. Both blocks' add buttons read "Upload Dokumen",
       so a document-wide search always hits the first one. */
    const add = [...block.querySelectorAll('button')]
      .find(b => /^(Upload Dokumen|Tambah)/i.test((b.textContent || '').trim()))

    if (!add) { report.optional.push({ ok: false, reason: 'no add button inside the block' }); break }

    add.click()
    await wait(openWait)

    if (!dialog()) { report.optional.push({ ok: false, reason: 'dialog did not mount' }); break }

    const outcome = await completeModal(`dokumen-calon-debitur-${i + 1}.pdf`)

    report.optional.push({ outcome })

    if (outcome !== 'saved') break
    await wait(500)
  }

  // ── 3. The SLIK dropzone — page level, not a modal ────────────────────────
  if (spec.slik) {
    const cell = document.querySelector('[data-field="CREDIT_APPLICATION_SLIK_FILE_LIST"]')
    const input = cell && cell.querySelector('input[type=file]')

    if (!input) {
      report.slik = { ok: false, reason: 'no SLIK dropzone on this step' }
    } else {
      const before = (cell.innerText || '')

      await dropFile(input, 'slik-calon-debitur.pdf')
      report.slik = { ok: /file diunggah|\.pdf/i.test(cell.innerText || '') && cell.innerText !== before }
    }
  }

  return report
}

/**
 * Step 5's Data Kualitatif — the 16 analyst narratives.
 *
 * 🔴 THE ROWS ALREADY EXIST AND HAVE NO "Tambah" ANYWHERE, so the generic
 * row-adder has nothing to key on. Each row is opened by its own pencil, an
 * IconButton whose only handle is `aria-label="Ubah analisa {name}"` — the same
 * shape as step 8's document rows, and the reason both needed a capability
 * rather than a `v2AddRows` spec.
 *
 * 🔑 THE MODAL IS A TIPTAP EDITOR, NOT A FORM. Measured 2026-08-17: one file
 * input, a 7-button toolbar (H1 H2 H3 B I U S) and a single `.ProseMirror` —
 * and ZERO text inputs. A fill that writes into inputs writes nothing here,
 * which is exactly why `..._DEBTOR_TYPE` above the table filled while the table
 * itself never did.
 *
 * ⚠️ Labels are snapshotted as STRINGS, never as elements: saving re-renders
 * the table, so a pencil captured up front is a detached node by the time its
 * turn comes. Same rule the document pass records.
 */
async function v2FillQualitative(plan, openWait = 900) {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const spec = Object.assign({ limit: 16 }, plan || {})
  const results = []

  const dialog = () => {
    const open = [...document.querySelectorAll('[role="dialog"]')].filter(d => d.getAttribute('aria-hidden') !== 'true')

    return open[open.length - 1] || null
  }

  const block = () => document.querySelector('[data-block="v2QualitativeBlock"]')
    /* Heading fallback for an FE predating `data-block` — SMALLEST element
       carrying the heading and a pencil, so it cannot swallow a sibling block. */
    || [...document.querySelectorAll('div')]
      .filter(el => (el.innerText || '').toUpperCase().includes('DATA KUALITATIF')
        && el.querySelector('button[aria-label^="Ubah analisa"]'))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]
      || null

  const root = block()

  if (!root) return [{ ok: false, reason: 'no Data Kualitatif block on this step' }]

  const labels = [...root.querySelectorAll('button[aria-label^="Ubah analisa"]')]
    .map(b => b.getAttribute('aria-label'))
    .slice(0, Math.max(0, Number(spec.limit) || 0))

  for (const label of labels) {
    const name = label.replace(/^Ubah analisa\s*/, '')

    const opener = document.querySelector(`button[aria-label="${label.replace(/"/g, '\\"')}"]`)

    if (!opener) { results.push({ row: name, ok: false, reason: 'pencil not found on re-query' }); continue }

    /* Bring the row on screen before opening it — the run should look like a
       person working down the table, and a row the viewport never showed is a
       row whose visibility-gated rendering was never exercised. 'auto', because
       smooth is compositor-driven and dead in a background tab. */
    try { opener.scrollIntoView({ block: 'center', behavior: 'auto' }); await wait(60) } catch (err) { /* detached */ }

    opener.click()
    await wait(openWait)

    const box = dialog()

    if (!box) { results.push({ row: name, ok: false, reason: 'modal did not mount' }); continue }

    const host = box.querySelector('.ProseMirror, [contenteditable="true"]')

    if (!host) { results.push({ row: name, ok: false, reason: 'no editor in the modal' }); continue }

    /**
     * `execCommand('insertText')`, never `innerHTML` — Tiptap owns this node
     * through ProseMirror's own state, and markup written behind its back is
     * reverted on the next transaction or never reaches the form at all.
     * selectAll first so a re-run REPLACES rather than appends.
     */
    host.focus()
    await wait(80)
    document.execCommand('selectAll', false, null)
    document.execCommand(
      'insertText',
      false,
      `Hasil ${name}: tidak ditemukan catatan negatif. Data telah diverifikasi pada proses analisa kredit.`
    )
    host.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(150)

    const wrote = (host.textContent || '').trim()

    const save = [...box.querySelectorAll('button')].find(b => /^Simpan$/i.test((b.textContent || '').trim()))

    if (!save) { results.push({ row: name, ok: false, reason: 'no Simpan button', wrote: Boolean(wrote) }); continue }

    save.click()
    await wait(800)

    const confirm = dialog()
    const ya = confirm && confirm !== box
      && [...confirm.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

    if (ya) { ya.click(); await wait(800) }

    let closed = false

    for (let i = 0; i < 30; i++) {
      if (!dialog()) { closed = true; break }
      await wait(150)
    }

    if (closed) {
      results.push({ row: name, ok: true })
    } else {
      /* 🔑 State at the moment of refusal, before anything closes — a driver
         that must cancel to reach the next row destroys its own evidence. */
      const box2 = dialog()
      const reds = box2
        ? [...box2.querySelectorAll('*')].filter(e => {
          const c = getComputedStyle(e).color

          return /rgb\((223|200|210), (42|30|31)/.test(c) && (e.textContent || '').trim().length < 120 && !e.children.length
        }).map(e => e.textContent.trim())
        : []

      results.push({ row: name, ok: false, reason: 'save blocked', errors: reds, wrote: Boolean(wrote) })

      const back = box2 && [...box2.querySelectorAll('button')].find(b => /^(Kembali|Batal|Tutup)$/i.test((b.textContent || '').trim()))

      if (back) { back.click(); await wait(700) }
      const c2 = dialog()
      const ya2 = c2 && [...c2.querySelectorAll('button')].find(b => /^Ya$/i.test((b.textContent || '').trim()))

      if (ya2) { ya2.click(); await wait(700) }
    }

    await wait(400)
  }

  return results
}
