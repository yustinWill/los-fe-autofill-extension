#!/bin/sh
# Rebuild autofill-bundle.js — the paste-into-a-page form of the v2 driver.
#
# The bundle is the extension's own logic with the Chrome plumbing removed, so
# anything driving the form from a browser session (the los-fe repo's Claude
# Code, devtools, a Playwright run) uses the SAME detection and fill code the
# extension does, rather than a second implementation that drifts from it.
#
# Extraction is by marker, not by line number, so editing popup.js above the
# smart-default tables does not silently truncate the bundle.
set -e
cd "$(dirname "$0")"

OUT=autofill-bundle.js

extract() {   # extract <file> <start-marker> <end-marker>
  awk -v s="$2" -v e="$3" '
    index($0, s) == 1 { on = 1 }
    on && index($0, e) == 1 && NR > 1 { exit }
    on { print }
  ' "$1"
}

{
  cat <<'HEADER'
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

HEADER

  # sleep + FALLBACK_DATE, which the smart defaults depend on
  extract popup.js 'const sleep = ' 'let lastResults'
  # the smart-default tables and generator
  extract popup.js '// ─── Smart default generator' '// ─── Active tab'
  # the whole v2 driver, minus its 'use strict' preamble
  tail -n +3 driver-v2.js

  # The scenario model, so a pane simulation uses SIM.plan() — the SAME plan
  # builder the popup uses — instead of re-deriving plan shapes per session.
  # Its chrome.storage calls are already try/catch-guarded ("storage
  # unavailable — the panel still works, it just forgets"), so it loads
  # cleanly in a page with no chrome object.
  cat simulation.js

  cat <<'FOOTER'

// ─── Public API ───────────────────────────────────────────────────────────────
window.__autofill = {
  detect: v2Detect,
  fill: v2FillField,
  read: v2ReadValues,
  smartDefault,
  step: { current: v2CurrentStep, goTo: v2GoToStep, advance: v2AdvanceStep },

  /**
   * The extras capabilities — the same functions drivers.js registers for the
   * popup's passes. They were in the bundle all along (the whole driver is
   * included) but not exposed, so a pane simulation of "all fields" had to
   * hand-roll modal driving — the exact second-implementation drift this
   * bundle exists to prevent (audit, 2026-08-20).
   */
  collaterals: v2FillCollaterals,
  mutations: v2AddMutations,
  financialReports: v2AddFinancialReports,
  documents: v2FillDocuments,
  qualitative: v2FillQualitative,
  facilities: v2AddFacilities,
  addRows: v2AddRows,
  assignFacilities: v2AssignCollateralFacilities,
  modals: { list: v2ListModals, open: v2OpenModal, save: v2SaveModal, close: v2CloseModal },
  confirm: { pending: v2PendingConfirm, answer: v2AnswerConfirm },

  /**
   * TICK_CHECKBOXES is a bundle-scope `let` the popup normally overwrites from
   * its own checkbox; a page has no popup, so this is that switch. ⚠️ It only
   * governs ORDINARY toggles — the user gates (USE_REFERENCE / HAS_AVALIST)
   * are refused inside v2FillField whatever this says.
   */
  setTickCheckboxes: v => { TICK_CHECKBOXES = Boolean(v) },
  setCompleteData: v => { COMPLETE_DATA = Boolean(v) },

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
FOOTER
} > "$OUT"

node --check "$OUT"
echo "built $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
