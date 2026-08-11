'use strict'

// ─── Driver registry ──────────────────────────────────────────────────────────
//
// A driver is the DOM dialect the page speaks. Everything above it — the smart
// defaults, the JSON editor, progress, the fields panel — is shared, because
// app-v2's `fields.ts` is copied verbatim from v1: same UPPERCASE_SNAKE field
// names, so the same value tables apply and JSON captured on one form replays
// into the other.
//
// Each driver exposes the same seven page-context functions. They are passed
// straight to chrome.scripting.executeScript, so they must be plain top-level
// declarations — Function.toString() is what crosses into the page, and a
// closure would not survive it.

const DRIVERS = {
  v1: {
    label: 'v1 · MUI',
    detect:  v1Detect,
    fill:    v1FillField,
    tables:  v1FillTables,
    read:    v1ReadValues,
    current: v1CurrentStep,
    goTo:    v1GoToStep,
    advance: v1AdvanceStep
  },
  v2: {
    label: 'v2 · Kairos',
    detect:  v2Detect,
    fill:    v2FillField,
    tables:  v2FillTables,
    read:    v2ReadValues,
    current: v2CurrentStep,
    goTo:    v2GoToStep,
    advance: v2AdvanceStep
  }
}

// Page-context probe: which dialect is this tab rendering?
//
// v2 is tested FIRST. During the migration a v2 route can still host a legacy
// MUI modal, so MUI markup being present does not mean the page is v1 — but the
// Kairos wrapper and the wizard's own `data-m` hooks only ever appear in v2.
//
// Returns 'v2' | 'v1' | null. Null means neither was recognised, which is a real
// answer worth surfacing rather than guessing at.
function pageVariant() {
  if (document.querySelector('[data-m="wizard"], [data-m="stepcard"], [data-m="railstep"], .kai-root')) return 'v2'
  if (document.querySelector('[data-step-index], .MuiFormControl-root, .MuiSelect-nativeInput')) return 'v1'
  return null
}
