'use strict'

// ─── Driver: v1 (legacy MUI + React Hook Form) ────────────────────────────────
//
// Every function below is injected into the page's MAIN world by
// chrome.scripting.executeScript, which serialises it with Function.toString().
// They must therefore stay SELF-CONTAINED — no closure over anything in this
// file, no imports, no shared helpers. That is why `sleep`, `waitFor`,
// `getFiberFieldName` and friends are redeclared inside each one.
//
// Targets the legacy CustomFormWizard (src/components/custom/CustomFormWizard):
// MUI markup, so fields are addressable by `input[name="FIELD"]` and control
// kind is read off MUI's own class names.

// ─── Page-context detect function ─────────────────────────────────────────────
// Self-contained — runs in world:'MAIN'. Peeks select options WITHOUT leaving them open.
async function v1Detect() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = (fn, ms = 1400) => new Promise(res => {
    const end = Date.now() + ms
    const t = () => { const r = fn(); if (r) return res(r); if (Date.now() > end) return res(null); setTimeout(t, 40) }
    t()
  })

  // Detect an open MUI dialog by its backdrop — the only element that is
  // unconditionally rendered (and only rendered) while a dialog is open.
  // Class/attribute checks on .MuiDialog-paper are fragile; the backdrop is not.
  //
  /**
   * 🔴 The LIVE dialog is the LAST `.MuiDialog-paper` whose root is NOT
   * `aria-hidden` — never simply the first one on the page.
   *
   * MUI leaves earlier dialogs mounted and marks them `aria-hidden="true"` on
   * `.MuiDialog-root`. Both keep a non-zero bounding box and both pass an
   * `offsetParent` or visibility test, so that attribute is the only reliable
   * discriminator.
   *
   * Measured 2026-08-11 opening "Tambah Agunan": two papers present — index 0
   * empty and aria-hidden, index 1 the real "Registrasi Agunan" form carrying
   * 28 INPUTS. `querySelector` returned the dead one, so detect reported zero
   * fields, the title read as empty, and saveModal answered 'no_button'. It was
   * indistinguishable from a modal that fails to load, and 28 fields were
   * invisible to the driver.
   *
   * This shape is repeated at every modal-root resolution in this file rather
   * than shared, because chrome.scripting serialises each contract function on
   * its own and it cannot close over a helper.
   */
  const modalRoot = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
    ? ((function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})() || null)
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

  /**
   * Is the field REQUIRED?
   *
   * 🔴 This must NOT go through getLabel. getLabel strips the trailing asterisk
   * (`.replace(/\s*\*\s*$/, '')`) so the label is clean for display and for
   * matching, and the requiredness test used to run `label.includes('*')` on
   * that already-stripped string — so it was false for EVERY field, always.
   *
   * Deterministic, and it failed in the worst direction: with "skip optional"
   * ticked, a v1 run skipped every field, filled NOTHING, and reported a clean
   * set of `skipped_optional` results. It also invalidated every v1↔v2
   * required-ness comparison (45 phantom mismatches measured before the cause
   * was found).
   *
   * Reads the asterisk ELEMENT first — MUI renders required as
   * `<label>Nama <span class="MuiFormLabel-asterisk"> *</span></label>` — and
   * falls back to the raw, unstripped text.
   */
  function isFieldRequired(el) {
    const fc = el.closest && el.closest('.MuiFormControl-root') || el
    let src = fc.querySelector && fc.querySelector('.MuiFormLabel-root, .MuiInputLabel-root')
    if (!src && el.id) src = document.querySelector('label[for="' + el.id + '"]')
    if (!src) return false
    if (src.querySelector && src.querySelector('.MuiFormLabel-asterisk')) return true
    return /\*\s*$/.test(src.textContent || '')
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
    const optional = !isFieldRequired(anchor)
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
async function v1FillField(name, value, delayMs, ignoreDisabled, skipFilled, skipOptional, isOptional) {
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

    /**
     * ── Preferred path: the COMPONENT's own onChange ─────────────────────────
     *
     * 🔴 Order matters more than anything else in this function.
     *
     * This used to run only as a fallback, after writing straight into
     * react-hook-form via `control.register(name).onChange`. That skips whatever
     * the component does to a value on its way to the form, and different fields
     * want different types — measured 2026-08-11, in BOTH directions:
     *
     *   bank-statement debit  `parseFloat(raw)` → NUMBER, schema v.number()
     *                         writing the string failed as "Field ini wajib diisi"
     *                         on a cell visibly showing 23.200.000
     *   Nominal Underlying    stores the STRING; writing a number failed as
     *                         "Harus berupa teks"
     *
     * No heuristic on the driver's side can know which — an earlier attempt keyed
     * off whether the stored value was `null`, and that got underlying backwards.
     * Letting the field's own handler run is the only approach that is right by
     * construction, and it generalises to every v1 form rather than to the fields
     * someone remembered to special-case.
     *
     * `rawValue` is supplied alongside `value` because Cleave-backed handlers read
     * `e.target.rawValue ?? e.target.value`.
     *
     * The write is VERIFIED against the form store rather than trusted: if this
     * handler is a no-op or the component swallows the shape, the RHF path below
     * still runs.
     */
    const storeOf = () => {
      if (!fk) return null
      let f = el[fk], d = 0
      while (f && d++ < 150) {
        const p = f.memoizedProps
        if (p && p.control && p.control._formValues) return { control: p.control, name: p.name }
        f = f.return
      }
      return null
    }

    const readStored = ctx => ctx && typeof ctx.name === 'string'
      ? ctx.name.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx.control._formValues)
      : undefined

    const ctx0 = storeOf()
    const before = readStored(ctx0)

    /**
     * 🔴 Call the LAST onChange BEFORE the Controller — not the one on the DOM
     * node.
     *
     * `el.__reactProps$.onChange` is the INNERMOST handler, and on a MUI field
     * that is MUI's own `(event, ...args) => { if (!isControlled) …}`, which
     * forwards the raw string untouched. The handler that gives the form the
     * type it wants sits several levels up, passed as a prop to the styled
     * TextField. Measured on the bank-statement debit cell 2026-08-11:
     *
     *   depth 1-4    input / MuiFilledInputInput  → MUI's isControlled forwarder
     *   depth 8-17   (e) => parseFloat(raw) → field.onChange(parsed)   ← the app's
     *   depth 18     Controller                                        ← boundary
     *
     * Calling depth 1 wrote the string "18200000" into a field whose schema is
     * `v.nullable(v.number())`, and the modal refused to save reporting the cell
     * as EMPTY while showing 18.200.000. Calling the outermost handler below the
     * Controller runs the app's own transform, so the value arrives in whatever
     * shape that field wants — a number here, a string for Nominal Underlying —
     * with no type-guessing on the driver's side. An earlier attempt DID guess,
     * and got Underlying backwards ("Harus berupa teks").
     *
     * When a field has no handler of its own the outermost one is MUI's, which
     * forwards to `field.onChange` — still correct.
     */
    let outerOnChange = null
    if (fk) {
      let f = el[fk]
      let depth = 0
      while (f && depth++ < 60) {
        const p = f.memoizedProps
        if (p && p.control && typeof p.name === 'string') break   // Controller: stop
        if (p && typeof p.onChange === 'function') outerOnChange = p.onChange
        f = f.return
      }
    }

    if (outerOnChange) {
      try {
        outerOnChange({ target: { value: strVal, rawValue: strVal, name: el.getAttribute('name') || '' } })
        await sleep(90)
        const after = readStored(storeOf())
        if (after !== undefined && after !== before && after !== '' && after !== null) filled = true
      } catch (_) { /* fall through to the RHF path */ }
    }

    // ── Cleave / regular text: RHF control.register(name).onChange via fiber walk ─
    if (!filled && fk) {
      let f = el[fk], depth = 0
      while (f && depth++ < 150) {
        const p = f.memoizedProps
        if (p && p.control && p.name && typeof p.name === 'string') {
          try {
            const reg = p.control.register(p.name)
            if (reg && typeof reg.onChange === 'function') {
              /* Reached only when the component has no onChange of its own, so
                 there is no transformation to preserve and the raw string is
                 what the form wants. Type-guessing used to live here and got
                 Nominal Underlying backwards — see the note at the top. */
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

    // ── TIME-mode picker (value is HH:mm) ────────────────────────────────────
    //
    // 🔴 `Jam Mulai` / `Jam Selesai` resolve as `datepicker`, not `time`: they are
    // react-datepicker in `showTimeSelectOnly` mode, so they carry a
    // `.react-datepicker__input-container` exactly like a date field. Everything
    // below this point hunts for a DAY cell in a calendar popper, which a
    // time-only picker never renders — so the fill failed and returned
    // not_found, and that alone blocked the whole Kunjungan modal from saving
    // (measured 2026-08-11: 15 of 19 fields filled, save refused).
    //
    // The instance's own `setSelected` takes a Date, and time mode reads the
    // hours/minutes off it, so no popper interaction is needed at all.
    if (/^\d{1,2}[:.]\d{2}$/.test(strVal)) {
      const [hh, mm] = strVal.split(/[:.]/).map(Number)
      const base = new Date()
      base.setHours(hh, mm, 0, 0)

      if (dpInstance) {
        try {
          dpInstance.setSelected(base)
          await sleep(220)
          if (inp.value.trim()) return true
        } catch (_) {}
      }

      // Fallback: type it. react-datepicker parses the input against its own
      // dateFormat, which for these fields is HH:mm.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, strVal)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(180)
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      inp.blur()
      await sleep(180)
      return Boolean(inp.value.trim())
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

    /**
     * 🔴 A numeric field sitting at ZERO is a placeholder, not data.
     *
     * `skipFilled` exists to protect what a user typed. A currency box the form
     * mounted as `0` is the opposite of that, and skipping it leaves a REQUIRED
     * field at a value the schema rejects. Measured on Tambah Underlying
     * 2026-08-11: `Nominal Underlying` mounts as "0", was reported
     * `skipped_filled`, and the modal then refused to save with "Harus berupa
     * teks" — it holds the NUMBER 0 where a string is wanted. The same modal
     * saved when skipFilled was off and the field was actually written.
     *
     * Treated as empty only when the value is nothing but zeros and grouping
     * punctuation ("0", "0,00", "Rp 0", "0.000") — so a real 0 typed into a
     * count stays protected wherever it is genuinely the answer, and every
     * non-zero value is still left alone.
     */
    const zeroish = typeof cur === 'string' && cur !== '' && /^[0.,\s]*$/.test(cur.replace(/^rp\s*/i, ''))

    if (cur !== '' && cur !== false && !zeroish) return 'skipped_filled'
  }

  /**
   * 🔴 An EMPTY value must not be WRITTEN to an already-empty text field.
   * Leaving a field untouched and clearing it are different states.
   *
   * The bank-statement modal proved it. A fresh transaction row holds
   * `credit: null` / `debit: null`, and its cross-rule reads
   *
   *     hasCredit = tx.credit !== null && tx.credit !== undefined && tx.credit !== 0
   *
   * (`bank-statement/form/validations.ts:48`). An empty STRING passes all three
   * tests, so writing '' into the credit cell made `hasCredit` true alongside
   * `hasDebit` and the modal refused to save with "Debit dan Kredit tidak boleh
   * diisi bersamaan" — while the cell looked empty on screen and in the store.
   * A human filling only Debit never trips this, because untouched stays null.
   *
   * Only skipped when the field is ALREADY empty, so an explicit '' from a JSON
   * replay still CLEARS a field that has content. Selects are untouched by this:
   * for them '' means "pick the first live option" and never reaches here.
   */
  if (value === '' || value === null || value === undefined) {
    if (type === 'text' || type === 'textarea' || type === 'datepicker' || type === 'date' || type === 'time') {
      const el = document.querySelector('input[name="' + name + '"]:not([aria-hidden="true"])')
        || document.querySelector('textarea[name="' + name + '"]')
      if (!el || !String(el.value || '').trim()) return 'skipped_empty'
    }
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
//
// 🔴 KNOWN LIMITATION — this assumes EVERY input column is currency, and says
// nothing when that is false. Measured 2026-08-11 on the credit application's
// "Proyeksi Loan to Income & DSCR" table (step 3):
//
//   column              intended (from the disabled template row)   written
//   Uraian              "Pendapatan Normal"  — a TEXT description   450000000
//   Penyesuaian Income  "100"                — a PERCENT            360000000
//
// It reported 8 cells filled and the table looked populated, while holding a
// number where a description belongs and a percentage of 360 million. So a v1
// table run is NOT trustworthy as a fixture — check it by eye before relying on
// one.
//
// Deliberately NOT fixed (user, 2026-08-11): v1 is the tree being migrated away
// from, and this logic does not carry forward — there is no <table> anywhere in
// src/app-v2 or src/kairos (FlushTable is a grid of divs) and v2's totals are
// read-only computed spans, so the stamp-the-totals strategy is structurally
// void there. v2FillTables returns 0 for the same reason.
//
// If it is ever worth fixing: the DISABLED first row is a type template —
// read each column's kind from it rather than assuming currency.
async function v1FillTables() {
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
  const root = modalEl ? ((function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})() || document) : document
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
function v1ReadValues(fieldNames) {
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

// ─── Record modals ("Tambah …" above a table) ────────────────────────────────
//
// 🔴 THE BIGGEST COVERAGE GAP IN THIS DRIVER, and it was invisible.
//
// v1Detect already scopes itself to an open dialog (see `modalRoot` at the top
// of this file), so fields inside a modal were always FILLABLE — nothing ever
// OPENED one. A full seven-step sweep therefore reported 84 fields and looked
// complete, while 95 more sat behind eight buttons. Measured 2026-08-11 on a
// Badan Usaha / Baru application:
//
//   step  button                          modal?  fields  required
//   0     Tambah Fasilitas                  yes       8       6
//   1     Tambah Pemegang Saham             yes       2       1
//   1     Tambah Pengurus                   yes      20      14
//   1     Tambah Pemilik Manfaat Utama      yes      15       3
//   1     Tambah Kontak Darurat             yes       7       5
//   2     Tambah Proyeksi                   NO — adds a table row inline
//   2     Tambah  ×2                        NO — adds a table row inline
//   4     Tambah Data Pinjaman              yes      13       9
//   4     Tambah Data Mutasi Rekening       yes      11       5
//   6     Tambah Kunjungan Calon Debitur    yes      19      16
//
// So a `Tambah` button is NOT reliably a modal — three of the eleven add a row
// in place. Open it and look for the backdrop rather than assuming.
//
// The dialog's contract, measured: root `.MuiDialog-paper`, title in the first
// heading, commit button labelled **Simpan**, and NO cancel button — closing is
// Escape or a backdrop click.

/**
 * Is the TOPMOST dialog a confirmation rather than a form?
 *
 * 🔴 A driver that cannot tell these apart silently drives the wrong thing.
 * Confirmations are `.MuiDialog-paper` like any modal, so the live-dialog rule
 * points detect/fill/save straight at them: detect finds no named fields and
 * reports nothing, the fill loop carries on regardless, and saveModal hunts for
 * a "Simpan" that does not exist and answers 'no_button'. From the outside it
 * looks like the autofill ignored a popup and kept running — because it did.
 *
 * Seen 2026-08-11: filling the Agunan modal re-set an already-populated Jenis
 * Kredit, which raised "Konfirmasi Ganti Jenis Kredit — Mengganti Jenis Kredit
 * akan mengosongkan seluruh data yang sudah diisi". One wrong answer there wipes
 * the whole application.
 *
 * Recognised by shape, not by copy: a confirmation carries NO form inputs and
 * offers a small set of decision buttons. Returns null when the top dialog is a
 * real form.
 */
function v1PendingConfirm() {
  const papers = [].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function (el) {
    const r = el.closest('.MuiDialog-root') || el.parentElement
    return !(r && r.getAttribute('aria-hidden') === 'true')
  })
  const top = papers[papers.length - 1]
  if (!top) return null

  if (top.querySelectorAll('input:not([type="hidden"]), textarea, select').length) return null

  const buttons = [].slice.call(top.querySelectorAll('button'))
    .map(b => (b.textContent || '').trim())
    .filter(Boolean)
  if (!buttons.length) return null

  const decisive = buttons.filter(t => /^(ya|tidak|yes|no|ok|batal|cancel|lanjutkan|hapus|simpan)$/i.test(t))
  if (!decisive.length) return null

  return { text: (top.innerText || '').trim().slice(0, 200), buttons, decisive }
}

/**
 * Answer the pending confirmation. `accept` true clicks Ya/OK/Lanjutkan, false
 * clicks Tidak/Batal.
 *
 * ⚠️ Default to REFUSING. Most confirmations in this app guard a destructive
 * change, and the one that prompted this function offers to empty every field
 * already filled — accepting by reflex would throw away the run's own work.
 */
async function v1AnswerConfirm(accept) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const papers = [].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function (el) {
    const r = el.closest('.MuiDialog-root') || el.parentElement
    return !(r && r.getAttribute('aria-hidden') === 'true')
  })
  const top = papers[papers.length - 1]
  if (!top) return 'no_dialog'

  const want = accept ? /^(ya|yes|ok|lanjutkan)$/i : /^(tidak|no|batal|cancel)$/i
  const btn = [].slice.call(top.querySelectorAll('button')).find(b => want.test((b.textContent || '').trim()))
  if (!btn) return 'no_button'

  btn.click()
  await sleep(800)
  return 'answered'
}

/**
 * Turn ON every gating checkbox / Ya-Tidak toggle in the current scope, so the
 * sections they hide come into existence.
 *
 * 🔴 Without this a "fill everything" run actively HIDES work. `smartDefault`
 * answers `false` for a checkbox — the honest default for a blank create form,
 * and right for a normal fill — but a v1 form uses those same controls as GATES.
 * Step 4's Agunan and Underlying tables, and the Tambah buttons above them, do
 * not exist in the DOM until their toggle says Ya (user, 2026-08-11: "the add
 * button sometimes only shows up after the checkbox has been checked too").
 * A run that fills faithfully therefore reports a step with no tables and no
 * add-buttons, which is indistinguishable from a step that genuinely has none.
 *
 * Deliberately SEPARATE from the fill pass rather than folded into it: turning
 * a gate on is a coverage decision, not a value, so a caller filling a real
 * fixture can leave it out. Returns what it flipped, so a report can say which
 * sections only appeared because the driver opened them.
 */
async function v1RevealGated() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const scope = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
    ? ((function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})() || document)
    : document

  const flipped = []

  /**
   * 🔴 Keep a tick ONLY if it revealed more than it hid.
   *
   * Not every checkbox is a gate. Some are MODE SWITCHES, and ticking one hides
   * the section it replaces. Measured 2026-08-11: ticking "Menggunakan
   * Referensi Pengajuan Kredit" on step 1 put the form into reference mode and
   * removed the credit-facility table — after which listModals() found NO
   * add-buttons on steps 1, 2 and 5, and the run reported a form with no record
   * modals at all. A "reveal" that reveals less is worse than not revealing.
   *
   * Counting live inputs before and after separates the two without knowing
   * which is which, and unticking is safe — it is the same control, unlike a
   * row repeater, whose click cannot be undone.
   */
  const liveInputs = () => document.querySelectorAll('input:not([type="hidden"]), textarea, select').length

  for (const box of scope.querySelectorAll('input[type="checkbox"]')) {
    if (box.disabled || box.checked) continue
    const fc = box.closest('.MuiFormControlLabel-root') || box.closest('.MuiFormControl-root')
    const label = fc ? (fc.textContent || '').trim().slice(0, 60) : (box.name || '')

    const before = liveInputs()
    box.click()
    await sleep(260)
    if (!box.checked) continue

    if (liveInputs() < before) {
      box.click()                       // it hid something — put it back
      await sleep(260)
      continue
    }

    flipped.push({ kind: 'checkbox', label, name: box.name || null })
  }

  /* Ya/Tidak radio pairs are the other gate shape. Only the affirmative one is
     clicked, and only when nothing in the group is chosen yet — re-answering a
     question the form already answered would discard whatever it revealed. */
  const groups = new Map()
  for (const radio of scope.querySelectorAll('input[type="radio"]')) {
    if (!radio.name) continue
    if (!groups.has(radio.name)) groups.set(radio.name, [])
    groups.get(radio.name).push(radio)
  }

  for (const [name, radios] of groups) {
    if (radios.some(r => r.checked)) continue
    const yes = radios.find(r => /^(ya|yes|true|1|ada)$/i.test(String(r.value || '').trim()))
      || radios.find(r => {
        const lab = r.closest('.MuiFormControlLabel-root')
        return lab && /^(ya|yes|ada)\b/i.test((lab.textContent || '').trim())
      })
    if (!yes || yes.disabled) continue
    yes.click()
    await sleep(260)
    if (yes.checked) flipped.push({ kind: 'radio', label: name, value: yes.value })
  }

  return flipped
}


// Add-record buttons in the CURRENT scope, by label. Labels repeat ("Tambah" ×2
// on step 2), so callers address them by INDEX, not by text.
//
// ⚠️ Scoped exactly like v1Detect: when a dialog is open this lists the DIALOG's
// own add-buttons, not the page's. Without that, calling it while the facility
// modal was open returned step 1's four record buttons PLUS the modal's nested
// "Tambah Biaya" — five entries from two different scopes, so index 4 opened a
// control that belonged to a different form.
function v1ListModals() {
  const scope = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
    ? ((function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})() || document)
    : document

  return [...scope.querySelectorAll('button')]
    .map(b => ({ label: (b.textContent || '').trim(), disabled: Boolean(b.disabled) }))
    .filter(x => /^Tambah/i.test(x.label))
    .map((x, n) => ({
      index: n,
      label: x.label,
      disabled: x.disabled,

      /* Whether this opens a modal cannot be known without clicking — nothing
         in the markup separates a modal opener from a row repeater. openModal
         probes and reverts. */
      opensModal: null
    }))
}

// Open the nth add-record control on this step.
// Returns { opened, isModal, title } — `isModal: false` means it added an inline
// row instead, which is a real answer, not a failure.
async function v1OpenModal(nth) {
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  // Same scoping as v1ListModals, so an index from that list addresses the same
  // control here.
  const scope = document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
    ? ((function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})() || document)
    : document

  const buttons = [...scope.querySelectorAll('button')].filter(b => /^Tambah/i.test((b.textContent || '').trim()))
  const btn = buttons[nth]
  if (!btn) return { opened: false, isModal: false, title: null, reason: 'no_button' }
  if (btn.disabled) return { opened: false, isModal: false, title: null, reason: 'disabled' }

  const label = (btn.textContent || '').trim()

  /**
   * 🔴 PROBE, then REVERT if it was a repeater.
   *
   * Nothing in the markup separates a modal opener from a row repeater — every
   * Tambah button on this form is `MuiButton-outlinedPrimary` in a Grid2
   * container with a table nearby (measured 2026-08-11). So the only way to
   * know is to click, and the only way to make that safe is to undo.
   *
   * A repeater appends an empty REQUIRED row to a financial table, which then
   * blocks the step's own validation — the run breaks the form it was asked to
   * fill. Undo is by the row's DELETE control, identified by its red text
   * colour: the design system paints destructive actions rgb(210, 31, 37) and
   * nothing else on these rows is red.
   *
   * ⚠️ Match the delete among buttons that APPEARED with the click, not any red
   * button on the page. Two earlier attempts clicked "the last icon button in
   * the new row" and made it worse — inputs went 2 -> 6, because that control
   * adds rather than removes on some tables.
   */
  const inputCount = () => document.querySelectorAll('input:not([type="hidden"]), textarea, select').length
  const buttonsBefore = new Set([].slice.call(document.querySelectorAll('button')))
  const countBefore = inputCount()

  btn.click()

  // The dialog mounts and animates; the backdrop is the reliable signal — class
  // checks on the paper are fragile, which is why detect keys off it too.
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')) break
    await sleep(50)
  }
  await sleep(400)

  const paper = (function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})()
  const isModal = Boolean(document.querySelector('.MuiBackdrop-root.MuiModal-backdrop') && paper)

  if (isModal) {
    return {
      opened: true,
      isModal: true,
      label,
      title: ((paper.querySelector('h1,h2,h3,h4,h5,h6') || {}).textContent || '').trim()
    }
  }

  // ── No modal: it was a repeater. Put the row back. ────────────────────────
  const countAfter = inputCount()
  if (countAfter <= countBefore) {
    return { opened: true, isModal: false, label, title: null, reason: 'no_modal_no_change' }
  }

  const isRed = el => {
    const rgb = (getComputedStyle(el).color || '').match(/\d+/g)
    return rgb && +rgb[0] > 150 && +rgb[1] < 90 && +rgb[2] < 90
  }
  const appeared = [].slice.call(document.querySelectorAll('button')).filter(b => !buttonsBefore.has(b))
  const del = appeared.filter(isRed).pop()

  if (del) {
    del.click()
    await sleep(700)
  }

  const reverted = inputCount() <= countBefore
  return {
    opened: true,
    isModal: false,
    label,
    title: null,
    reason: reverted ? 'repeater_reverted' : 'repeater_NOT_reverted',
    addedInputs: countAfter - countBefore,
    reverted
  }
}

// Commit the open modal. Returns 'saved' | 'blocked' | 'no_modal' | 'no_button'.
//
// ⚠️ 'blocked' is the important one: a v1 modal that fails validation simply
// stays open with no toast, exactly like the facility modal's silent refusal.
// Treating a click as success is how a run reports a record it never created.
async function v1SaveModal() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const paper = (function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})()
  if (!paper) return 'no_modal'

  const save = [...paper.querySelectorAll('button')].find(b => /^Simpan$/i.test((b.textContent || '').trim()))
  if (!save) return 'no_button'
  if (save.disabled) return 'blocked'

  save.click()
  for (let i = 0; i < 60; i++) {
    if (!document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')) return 'saved'
    await sleep(100)
  }
  return 'blocked'
}

// Dismiss the open modal without saving. There is no Batal button on these, so
// Escape first, then a backdrop click.
async function v1CloseModal() {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const gone = () => !document.querySelector('.MuiBackdrop-root.MuiModal-backdrop')
  if (gone()) return 'closed'

  const paper = (function(){var ps=[].slice.call(document.querySelectorAll('.MuiDialog-paper')).filter(function(el){var r=el.closest('.MuiDialog-root')||el.parentElement;return !(r&&r.getAttribute('aria-hidden')==='true')});return ps[ps.length-1]||null})()
  const cancel = paper && [...paper.querySelectorAll('button')].find(b => /^(Batal|Tutup|Kembali)$/i.test((b.textContent || '').trim()))
  if (cancel) { cancel.click(); await sleep(700); if (gone()) return 'closed' }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(700)
  if (gone()) return 'closed'

  const backdrop = document.querySelector('.MuiBackdrop-root')
  if (backdrop) { backdrop.click(); await sleep(700) }
  return gone() ? 'closed' : 'stuck'
}

// Page-context helper: returns the active wizard step index (skin="filled" avatar).
// Returns -1 when a modal dialog is open so the scan loop treats the modal as
// a single-step form and doesn't try to navigate the main wizard behind it.
function v1CurrentStep() {
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
function v1GoToStep(idx) {
  const label = document.querySelector('[data-step-index="' + idx + '"] .MuiStepLabel-root')
  if (label) { label.click(); return true }
  return false
}

// ─── Wizard step advancement (runs in page MAIN world) ───────────────────────
// Strategy 1: look for an explicit Next/Continue button by text.
// Strategy 2: MUI CustomFormWizard — steps are navigated by clicking the next
//   step's MuiStepLabel-root. Active step is identified by its avatar having
//   the attribute skin="filled"; inactive steps have skin="light".
// Returns 'clicked' or 'no_next'.
function v1AdvanceStep() {
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
