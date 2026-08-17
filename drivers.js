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
    advance: v1AdvanceStep,

    /* Record modals ("Tambah …" above a table) and the gates that hide them.
       Optional capability: a driver without these is walked page-only, so the
       popup checks for the function before using it rather than assuming. */
    reveal:         v1RevealGated,
    listModals:     v1ListModals,
    openModal:      v1OpenModal,
    saveModal:      v1SaveModal,
    closeModal:     v1CloseModal,
    pendingConfirm: v1PendingConfirm,
    answerConfirm:  v1AnswerConfirm
  },
  v2: {
    label: 'v2 · Kairos',
    detect:  v2Detect,
    fill:    v2FillField,
    tables:  v2FillTables,
    /* Step 4's Agunan modal, one call per plan. v1 has no equivalent yet, so
       callers must feature-test rather than assume it exists. */
    collaterals: v2FillCollaterals,

    /* Step 5's account-mutation modal. Its OWN capability for the same reason
       the facility modal has one: none of its inputs is an RHF Controller, so
       `detect`/`fill` see zero of them. One save per account PER MONTH. */
    mutations: v2AddMutations,

    /* Links each saved agunan to a credit facility. Separate from
       `collaterals` because it runs on the TABLE after every row exists — a
       row cannot be linked before it is saved, and the control is a
       SearchableMultiSelect, not one of the modal's fields. */
    assignFacilities: v2AssignCollateralFacilities,
    /* Generic N-rows-per-table. Uniform modals only — Agunan branches on type
       and has its own capability above. */
    addRows: v2AddRows,

    /* Step 1's Fasilitas Kredit. Its own capability because
       `FacilityFormModal` holds state in `useState`, not react-hook-form — so
       `detect`/`fill` see ZERO of its 12 inputs and the generic path cannot
       touch it. Sequence ported from the proven `addFacility` helper. */
    facilities: v2AddFacilities,

    /* Step 8's documents. Its own capability because the generic row-adder
       cannot reach ANY of it: the mandatory rows already EXIST (the BE seeds
       them from the product) and open by a PENCIL — `aria-label="Ubah"`, no
       button text to match — both blocks' add buttons carry the IDENTICAL
       label "Upload Dokumen", and the SLIK attachment is a page-level dropzone
       rather than a modal. Scoped by the `data-block` attribute los-fe emits,
       with a heading fallback for builds predating it. */
    documents: v2FillDocuments,
    read:    v2ReadValues,
    current: v2CurrentStep,
    goTo:    v2GoToStep,
    advance: v2AdvanceStep,

    /* 🔴 Absent until 2026-08-15, which made "Fill modals" a SILENT NO-OP on
       every v2 page: `walkRecordModals` returns null the moment `listModals`
       is missing, so the checkbox was ticked, the run reported success, and
       Fasilitas Kredit — reachable only through "Tambah Fasilitas" — was never
       filled. Feature-testing a capability is right; shipping a UI control for
       one that half the drivers lack is not. */
    listModals:     v2ListModals,
    openModal:      v2OpenModal,

    /* 🔴 saveModal and closeModal are called with NO feature test
       (popup.js:1332-1333), unlike reveal/pendingConfirm. Registering the pair
       above without these would open every v2 modal and then throw on
       `executeScript({func: undefined})`, leaving a modal open over a
       half-filled form — worse than the no-op it replaced. Ship the whole
       capability or none of it. */
    saveModal:      v2SaveModal,
    closeModal:     v2CloseModal,
    pendingConfirm: v2PendingConfirm,
    answerConfirm:  v2AnswerConfirm
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
