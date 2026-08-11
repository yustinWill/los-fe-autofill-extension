# driver-v1 — what it reaches, and what it cost to learn

**Written 2026-08-11**, from a full pass over the legacy KairosLOS credit
application (`los-fe`, `/credit-application/create`). Every number here was
measured in a browser against a running app, not reasoned about.

Read this before changing `driver-v1.js` or before reporting a v1 field as
unreachable. Several things below look exactly like a broken control and are
not — and two of them produced confidently wrong findings before the cause was
found.

---

## Coverage, measured

| | fields |
|---|---|
| page-level, all 7 steps | 84 |
| inside the 8 record modals | 95 |
| **total reachable** | **179** |

Per-step page sweep, `COMPANY_PRODUCTIVE` / `NEW`:

```
0:12f/7req  1:58f/41req  2:12f/5req  3:0f  4:1f/1req  5:0f  6:1f → no_next
```

Steps detecting 0 fields are correct, not broken: Data Keuangan is tables and
modals, Log Aktivitas is a read-only log.

### The record modals

All ten save. Fill counts sit below field counts because `skipFilled` leaves
already-populated fields alone; nothing reports a failure.

| step | modal | filled/seen | notes |
|---|---|---|---|
| 1 | Tambah Fasilitas | 6/20 | 8 → 20 via the re-detect loop |
| 2 | Tambah Pemegang Saham | 17/18 | 2 → 18 once Jenis is chosen |
| 2 | Tambah Pengurus | 18/20 | |
| 2 | Tambah Pemilik Manfaat Utama | 14/15 | |
| 2 | Tambah Kontak Darurat | 6/7 | |
| 4 | Tambah Agunan | 15/31 | needs a debtor — see below |
| 4 | Tambah Underlying | 6/6 | |
| 5 | Tambah Data Pinjaman | 13/13 | |
| 5 | Tambah Data Mutasi Rekening | 10/11 | |
| 7 | Tambah Kunjungan Calon Debitur | 18/19 | |

⚠️ **A "Tambah" button is not reliably a modal.** Three of the eleven on this
form add a table row in place (step 3's Proyeksi and two bare "Tambah"). Open it
and look for the backdrop rather than assuming.

⚠️ **The add-button set is state-dependent.** Agunan and Underlying do not
appear until a credit facility exists; step 2's three Badan Usaha tables do not
appear until `Jenis Calon Debitur` is set. Re-list per step; do not map once and
cache.

---

## Loading the driver — two traps, each cost a wrong diagnosis

🔴 **A `<script src>` tag does NOT reliably pick up a rebuilt file**, even with a
`?t=` cache-buster. After a rebuild the old function stayed bound and a working
fix read as broken — confirmed with
`v2AdvanceStep.toString().includes('aria-disabled') === false`. Use fetch + eval:

```js
const txt = await (await fetch('/autofill-bundle.js?b=' + Date.now(), { cache: 'no-store' })).text()
;(0, eval)(txt)
```

🔴 **Both drivers are `'use strict'`, so indirect `eval` keeps declarations in
its OWN scope.** Nothing reaches `window`, and `v1Detect is not defined` looks
exactly like a failed load. The bundle only works because it ends with an
explicit `window.__autofill = {…}`. For a raw driver, append the export inside
the same eval:

```js
;(0, eval)(txt + '\n;window.__v1 = { detect: v1Detect, fill: v1FillField, /* … */ };')
```

`smartDefault` lives in `popup.js`, so a v1 run needs the BUNDLE loaded too.

---

## The general model

Five primitives, none of which know anything about the credit application:

```
reveal → listModals → openModal → (detect → fill)* → saveModal
```

plus `pendingConfirm` / `answerConfirm`. The only app-specific knowledge is in
`SMART_RULES`, keyed by field name and label, and shared with v2.

**RE-DETECT UNTIL STABLE.** These forms mount most of themselves after one
select — Pemegang Saham 2 → 18 fields, Fasilitas 8 → 20. A single detect pass
fills the gate and stops, and reports a nearly-empty modal.

**REVEAL BEFORE LISTING.** Step 4's Agunan and Underlying tables, and the buttons
above them, do not exist until a gating checkbox says Ya. `smartDefault` answers
`false` for a checkbox — correct for a value, wrong for a gate — so revealing is
a separate call, not part of the fill.

**ANSWER CONFIRMATIONS.** A confirmation is a `.MuiDialog-paper` too, so the fill
loop will happily drive it: no named fields, nothing detected, loop continues,
`saveModal` hunts a "Simpan" that is not there. `v1PendingConfirm` recognises one
by SHAPE (no form inputs + decision buttons) and `v1AnswerConfirm` **refuses by
default** — the one that prompted this offers to empty the whole application.

---

## Traps paid for — mistake → rule

### An option that governs only half the run

🔴 **"Tick checkboxes = off" did not stop checkboxes being ticked** (user,
2026-08-11: *"I didn't tick the Tick checkboxes option but it tick the
checkbox"*). The option gated the FILL pass only. The REVEAL pass ran off the
hardcoded `ALWAYS_REVEAL_GATED`, ticked gate checkboxes, and
`shouldSkipCheckboxFills` then correctly declined to touch them — so the tick was
**left on screen**.

Confirmed on v1 `/credit-application/create`, option off throughout:

```
before   Menggunakan Referensi Pengajuan Kredit :: unticked
flipped  [{ kind: 'checkbox', label: 'Menggunakan Referensi Pengajuan Kredit' }]
after    Menggunakan Referensi Pengajuan Kredit :: TICKED
```

**Rule: a setting must gate every pass that performs the action it names, not
just the pass it was written for.** `v1RevealGated(includeCheckboxes)` now takes
the flag and `revealAndSettle` passes it through `args:` — the only channel into
a `func:` body, which is serialised and closes over nothing from popup.js.

Radio gates are still opened when it is off: the option says *checkboxes*, and a
Ya/Tidak group is a different control.

The honest cost of off: a section gated behind a checkbox is ABSENT from the DOM,
not hidden, so it is neither detected nor filled and the field count is genuinely
lower. That trade is the point of the option — do not "fix" it back.

### The reveal guard counts inputs, so it misses swaps

⚠️ **`liveInputs()` compares HOW MANY inputs exist, not WHICH**, so a mode switch
that trades one section for a larger one reads as a successful reveal and the
tick is kept. Measured 2026-08-11 on a bare step 1: ticking "Menggunakan
Referensi Pengajuan Kredit" took live inputs **6 → 8** — reference mode adds a
picker while removing the facility section — so the guard kept the tick, on the
very control it was written to catch.

Its verdict is also form-state dependent: with Jenis Kredit unset the facility
section is not rendered in either mode, so there is nothing for the count to
lose. **Treat a kept tick as "probably a gate", never as proof.** An identity
check (which labels disappeared) would be sound; a count is not.

### The live dialog is not the first one

🔴 **`querySelector('.MuiDialog-paper')` returns the WRONG dialog.** MUI leaves
earlier dialogs mounted and marks them `aria-hidden="true"` on `.MuiDialog-root`.
Both keep a non-zero bounding box and both pass an `offsetParent` or visibility
test, so that attribute is the only reliable discriminator.

Measured opening "Tambah Agunan": paper 0 empty and aria-hidden, paper 1 the real
"Registrasi Agunan" form with **28 inputs**. Detect reported 0 fields, the title
read empty and `saveModal` answered `no_button` — indistinguishable from a modal
that fails to load.

**Rule:** the live dialog is the LAST `.MuiDialog-paper` whose root is not
`aria-hidden`. Applied at all 8 resolution sites in the file.

### Let the field transform its own value

🔴 **`el.__reactProps$.onChange` is the INNERMOST handler.** On a MUI field that
is MUI's own `(event, ...args) => { if (!isControlled) … }`, which forwards the
raw string untouched. The handler that gives the form the type it wants is a prop
on the styled TextField, several levels up. Measured on the bank-statement debit
cell:

```
depth 1-4    input / MuiFilledInputInput     MUI's isControlled forwarder
depth 8-17   (e) => parseFloat(raw) → field.onChange(parsed)    the app's
depth 18     Controller                                          boundary
```

Writing at depth 1 put the string `"18200000"` into a field whose schema is
`v.nullable(v.number())`; the modal refused to save reporting the cell as EMPTY
while it displayed 18.200.000.

**Rule:** walk up from the input keeping the last `onChange` seen BEFORE the
fiber carrying `control` + `name`, and call that. Do not guess the type — an
earlier attempt keyed off whether the stored value was `null` and got Nominal
Underlying backwards (`Harus berupa teks`). Fields want different types and the
field itself is the only thing that knows which.

### Empty is not the same as untouched

🔴 A fresh bank-statement transaction row holds `credit: null`, and the
cross-rule reads

```js
hasCredit = tx.credit !== null && tx.credit !== undefined && tx.credit !== 0
```

An empty STRING passes all three, so writing `''` made debit and credit both
"present" and the modal refused with *Debit dan Kredit tidak boleh diisi
bersamaan* — while the cell looked empty on screen AND in the store.

**Rule:** never WRITE an empty value to an already-empty text field. Only skipped
when already empty, so an explicit `''` from a JSON replay still clears a
populated field.

### A zero is a placeholder, not data

🔴 `Nominal Underlying` mounts as `"0"`. `skipFilled` protected it, so a REQUIRED
field kept a value its own schema rejects and the modal would not save.

**Rule:** `skipFilled` treats a value that is nothing but zeros and grouping
punctuation (`0`, `0,00`, `Rp 0`) as EMPTY. It exists to protect what a USER
typed; a box the form mounted at zero is the opposite.

### Requiredness must not read the stripped label

🔴 `getLabel` strips the trailing asterisk, and the requiredness test used to run
`label.includes('*')` on that already-stripped string — so **every field reported
optional, always**. With *skip optional* ticked a run filled NOTHING and reported
a clean set of `skipped_optional` results.

**Rule:** `isFieldRequired` reads the `.MuiFormLabel-asterisk` ELEMENT, falling
back to the raw unstripped text. Verified 2026-08-11 against the DOM as ground
truth: **0 mismatches** across two samples, **0 required fields skipped**.

⚠️ `skipped_optional` is NOT the count of optional fields — `skipped_disabled`
takes precedence when a field is both. Step 1: 5 optional, 2 reported
`skipped_optional`, 3 disabled.

### advance() must skip disabled steps

🔴 `isStepDisabled` gates real steps. On a fresh application rail 5 and 6 are
disabled while **7 and 8 are not**. Clicking the immediate next step did nothing,
returned `'clicked'`, and the sweep ended at step 4 — silently reporting a
nine-step form as five.

### v1FillTables is not trustworthy as a fixture

🔴 It assumes every input column is currency. On *Proyeksi Loan to Income & DSCR*
it wrote `450000000` into `Uraian` (a TEXT description) and `360000000` into
`Penyesuaian Income` (a PERCENT), reporting 8 cells filled.

**Deliberately not fixed** (user decision, 2026-08-11): v1 is the tree being
migrated away from and none of this carries to v2 — there is no `<table>` in
`src/app-v2` or `src/kairos`, and v2's totals are read-only computed spans, which
is why `v2FillTables` returns 0. If it ever matters: the disabled first row is a
type template (`Pendapatan Normal` / `100`).

---

## Prerequisites that look like driver bugs

**Agunan needs a debtor.** Its "Data Calon Debitur" block holds three REQUIRED
but DISABLED fields — `Nama Lengkap`, `No NIB`, `Kode Sandi Bank` — populated
from step 2, and there is no picker inside the modal. With step 2 filled first
(43 page fields + its 4 record modals) Agunan saves with no driver change at all.
Ordering, not a fill gap.

**Single checkboxes are invisible to driver-v1 by construction.**
`CustomFormCheckbox.tsx:44-52` omits `{...field}`, so no `name` reaches the DOM.
v2 detects them as a toggle.

**A multi-autocomplete reads back empty.** The value lives in `.MuiChip-root`
chips and the search input clears itself, so `v1ReadValues` returns `''`. Count
the chips. `TAG` returned `ok`, read back `''`, and the chip was on the form the
whole time.

---

## Still open

- **The popup UI path has never been exercised end to end.** Everything above ran
  through a mirror of `walkRecordModals` driven from the page. The popup's own
  Quick Fill → Modals path is verified only by symbol resolution and script load
  order.
- **The modal set varies with rotation.** `_PICK` now rotates, so a run may pick
  a different `Jenis Calon Debitur` and surface a different set of step-2 tables.
  Pin the debtor type if a repeatable fixture matters.
- **`Tambah Fasilitas` fills 6 of 20.** Most are skipped as already-filled; the
  three fee-row `percentage` fields were `not_found` in an earlier run and have
  not been re-checked since the outermost-onChange fix.
- **`skipped_*` reasons are folded into one "skipped" count** in the popup badge.

---

## Building a testable version

```sh
./release.sh
```

Rebuilds `autofill-bundle.js` **and** bumps the manifest patch version, then:
**chrome://extensions → Reload (⟳)**. The version bump is not cosmetic — without
it a stale service worker is indistinguishable from a successful reload.

`autofill-bundle.js` is GENERATED from `popup.js` + `driver-v2.js`; never edit it
directly. `driver-v1.js` is NOT in the bundle (it loads as a popup script tag),
so v1-only changes need no rebuild — but `release.sh` is harmless either way.
