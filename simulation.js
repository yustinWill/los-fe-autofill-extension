/**
 * Simulation options — the Quick Fill pre-flight for the credit-application form.
 *
 * Quick Fill used to be one button with no dial on it: it filled whatever the
 * page had, with values baked into the driver. That is fine for a smoke test and
 * useless for building a FIXTURE, where what matters is the shape of the record —
 * how many facilities, which collateral branches, and a name you can find again
 * in a list of 377.
 *
 * So on the credit-application create route the popup grows a panel: pick the
 * scenario, the row counts and the collateral list, and the run is built from
 * that. Everywhere else the panel stays hidden and Quick Fill behaves exactly as
 * before.
 *
 * 🔴 This module owns the NAMING CONVENTION (user, 2026-08-15). Nothing else may
 * compose those strings — a second implementation is how a convention rots.
 */
window.SIM = (() => {
  /**
   * The collateral branches, taken from `los-create-autofill/scripts/step4.js`
   * rather than invented, so the extension exercises the same field sets the
   * scripted runs already proved.
   *
   * ⚠️ `jenis` is the DROPDOWN OPTION LABEL, not the template. The dropdown is
   * master data — 48 rows from `/api/collaterals/type-template-mappings` — and
   * several labels share one template: Rumah, Gudang, Hotel and Apartemen are
   * all PROPERTY; Tabungan, Deposito and Giro are all BANK_ACCOUNT. Picking a
   * different label of the same template exercises the same fields, so these
   * are representative examples, not a closed list.
   *
   * `general` renders NO detail block at all — the shared fields are the whole
   * form. It is worth keeping precisely because "nothing appeared" is the
   * branch most easily mistaken for a failure.
   */
  const COLLATERAL_TYPES = [
    { key: 'property', label: 'Properti', jenis: 'Rumah' },
    { key: 'vehicle', label: 'Kendaraan', jenis: 'Kendaraan' },
    { key: 'saving', label: 'Tabungan', jenis: 'Tabungan' },
    { key: 'deposito', label: 'Deposito', jenis: 'Deposito' },
    { key: 'preciousMetal', label: 'Logam mulia', jenis: 'Emas dan mata uang emas' },
    { key: 'general', label: 'Mesin', jenis: 'Mesin' }
  ]

  /** The repeatable tables, in the order the wizard meets them. `max` is a
   *  guard rail, not a form rule — a 40-row shareholder table is a typo, and a
   *  run that fills one wastes minutes before anyone notices. */
  /**
   * The repeatable tables. `opener` is the button's EXACT label, taken from the
   * app's own `id` translations rather than guessed — the driver matches on it
   * exactly, and "Tambah Fasilitas" and "Tambah Fasilitas Kredit" are different
   * buttons on different screens.
   *
   * `max` is a guard rail, not a form rule: a 40-row shareholder table is a
   * typo, and a run that fills one wastes minutes before anyone notices.
   *
   * ⚠️ Agunan is deliberately ABSENT — it needs a type per row, so the panel
   * models it as a list and the driver has a separate capability for it.
   */
  const TABLES = [
    /* 🔴 The button reads "Tambah Fasilitas". "Tambah Fasilitas Kredit" is the
       MODAL'S TITLE, and this entry carried it for weeks — so the generic
       row-adder matched nothing and the facility was never added, which is the
       third of three independent reasons Fasilitas Kredit would not fill
       (measured 2026-08-15). The warning directly above this list is about
       exactly this pair of strings.
       ⚠️ It also has its OWN driver capability now — see `isOwnCapability`
       below — because the modal is not uniform: it needs a ~3s wait after the
       product picker for that product's find-one. */
    /* `min: 1` — the user's rule (2026-08-21): a fixture without a facility
       has no product, and EVERYTHING per-product hangs off it (workflow
       options, qualitative forms) besides the FACILITY_COUNT submit floor.
       The Minimal preset and the panel input both respect it. */
    { key: 'facility', label: 'Fasilitas', opener: 'Tambah Fasilitas', def: 1, min: 1, max: 5, isOwnCapability: true },
    /* 🔴 `appliesTo` since 2026-08-20 (v1.0.77): these tables exist only on
       SOME scenarios, and a plan that asks a Perorangan form for Badan Usaha
       tables ends an otherwise-perfect run with "no opener … on any step" —
       the 20:02 I-K run was all green except exactly these phantom errors.
       Filtered in plan(), so the driver never chases them. */
    { key: 'shareholder', label: 'Pemegang saham', opener: 'Tambah Pemegang Saham', def: 2, max: 10, appliesTo: s => s.debitur === 'BU' },
    { key: 'boardMember', label: 'Pengurus', opener: 'Tambah Pengurus', def: 2, max: 10, appliesTo: s => s.debitur === 'BU' },
    /* 🔴 `isOwnCapability` since 2026-08-20: the Neraca grid must balance, so
       the generic row-adder cannot save it — `v2AddFinancialReports` owns the
       whole ladder (see the driver's header for the count → years mapping). */
    /* Konsumtif's financial section renders income/expense, never reports —
       the three-way table in credit-assessment/create/form.tsx:319. BU is
       always Produktif here (BU+K is the blocked pill), so `sifat === 'P'`
       covers exactly the forms that mount the reports list. */
    { key: 'financialReport', label: 'Laporan keuangan', opener: 'Tambah Laporan Keuangan', def: 4, max: 8, isOwnCapability: true, appliesTo: s => s.sifat === 'P' },
    { key: 'underlying', label: 'Underlying', opener: 'Tambah Underlying', def: 1, max: 5 },
    { key: 'slik', label: 'Data pinjaman (SLIK)', opener: 'Tambah Data Pinjaman', def: 1, max: 10 },
    { key: 'ubo', label: 'Pemilik manfaat', opener: 'Tambah Pemilik Manfaat Utama', def: 1, max: 10, more: true },
    { key: 'emergencyContact', label: 'Kontak darurat', opener: 'Tambah Kontak Darurat', def: 1, max: 10, more: true },
    { key: 'bankAccount', label: 'Akun bank', opener: 'Tambah Akun Bank', def: 1, max: 5, more: true },
    /* Months of account mutations (2 accounts each — the user's own spec,
       2026-08-17). `isOwnCapability`: v2AddMutations owns the modal; the
       generic row-adder must never touch it. 0 skips the pass entirely —
       added for the Minimal preset, whose first live run still wrote 6
       mutation records because this pass had no knob (2026-08-21). */
    { key: 'mutation', label: 'Mutasi (bulan × 2 akun)', opener: 'Tambah Data Mutasi Rekening', def: 3, max: 12, more: true, isOwnCapability: true },
    /* 🔴 `isOwnCapability` since 2026-08-17: documents are handled by
       `v2FillDocuments`, not the generic row-adder, and this entry's opener was
       wrong anyway — BOTH document blocks' add buttons read "Upload Dokumen",
       never "Tambah Dokumen Pengajuan Kredit". Left in the model so the panel
       can still show the row, excluded from the generic pass so it cannot fire
       a second, broken attempt at the same table. */
    { key: 'document', label: 'Dokumen pengajuan', opener: 'Upload Dokumen', def: 1, max: 12, more: true, isOwnCapability: true },

    /* 🔴 SAME BUG AS `facility` ABOVE, SECOND INSTANCE — measured live
       2026-08-17. This carried "Tambah Data Kunjungan", which is the DEBTOR
       module's label (`page/debtor.json:96`). The credit-application form's
       button reads "Tambah Kunjungan Calon Debitur"
       (`page/creditApplication.json:1152` → `addDebtorVisitButton`), and
       `v2AddRows` matches the opener with `===`, so the visit rows were never
       added and nothing reported a reason.

       ✅ Proven both ways on a blank create form: the configured string appears
       NOWHERE in the DOM, and running v2AddRows with the correct one returned
       `{wanted: 2, added: 2, error: null}` with the section header going to
       "DATA KUNJUNGAN CALON DEBITUR (2)". Step 9 needed no new code at all —
       only the right string.

       🔑 Safe to hardcode the credit-application wording because the panel is
       mounted ONLY on that route (`mountSimulation` returns false unless
       `SIM.isCreditApplication(tab.url)`), so this list never runs against the
       debtor form. */
    /* 🔴 `seeded: 0` — the second half of why step 9 stayed empty, and the half
       the label fix could not reach. `fillPlannedRows` subtracts ONE from every
       count for "the row the wizard already seeded", then drops any spec that
       reaches zero. Data Kunjungan starts at (0), so a default of 1 became 0
       and the spec was discarded BEFORE the opener was ever looked up — the
       corrected label was unreachable code. Measured 2026-08-17 on the user's
       own run: "DATA KUNJUNGAN CALON DEBITUR (0)" after a full Quick Fill.

       `def: 2` because the user asked for two sample visits. */
    { key: 'visit', label: 'Kunjungan', opener: 'Tambah Kunjungan Calon Debitur', def: 2, max: 5, seeded: 0, more: true }
  ]

  const SCENARIO = {
    jenis: [
      { v: 'N', label: 'Normal' },
      { v: 'R', label: 'Restruk' },
      { v: 'E', label: 'Perpanj' }
    ],
    debitur: [
      { v: 'BU', label: 'Badan usaha' },
      { v: 'I', label: 'Perorangan' }
    ],
    sifat: [
      { v: 'P', label: 'Produktif' },
      { v: 'K', label: 'Konsumtif' }
    ]
  }

  /**
   * Combinations the product does not accommodate today.
   *
   * A pill that would land on one is DISABLED rather than removed: the option
   * still exists in the domain, and hiding it would read as the panel having
   * fewer dimensions than it has.
   *
   * 🔑 Expressed as STATE, not as a per-pill flag, because the constraint is on
   * the pair — "Konsumtif" is legal under Badan usaha and illegal under
   * Perorangan, so no property of the Konsumtif pill alone can express it.
   */
  const BLOCKED = [
    /* Kredit Badan Usaha - Konsumtif. NOT a policy call — the app does not
       implement it: `los-fe/src/utils/enumHelpers.ts:687` has
       COMPANY_CONSUMPTIVE commented out with "NOTE: not implemented yet", so
       the Jenis Kredit select offers three options, never four. Measured on the
       running form 2026-08-20 (user confirmed the same day).

       🔴 Leaving it selectable was actively harmful, not merely useless: the
       driver's old `|| opts[0]` fallback matched nothing and silently picked
       the FIRST option — "Kredit Perorangan - Konsumtif" — so a run configured
       for a company built an individual application and reported ok. Both ends
       are fixed; this one stops the request being made at all. */
    { debitur: 'BU', sifat: 'K' }
  ]

  const isBlocked = s => BLOCKED.some(combo => Object.keys(combo).every(k => s[k] === combo[k]))

  /**
   * Would choosing `v` for `group` land on a blocked combination?
   *
   * 🔴 The `!isBlocked(state)` guard is load-bearing, and leaving it out LOCKS
   * THE PANEL. From a state that is already blocked, no single pill escapes the
   * block — `wouldBlock` answers true for all nine, every pill greys out, and
   * the only way back is clearing extension storage. Caught by `check.js`,
   * which sets I + K directly to exercise the naming convention.
   *
   * So: while the state is legal, refuse the moves that break it; while it is
   * already broken, every move is an escape route and none is refused. That is
   * an INVARIANT ("a blocked state is never reachable, and never final") rather
   * than a rule each caller has to remember.
   */
  const wouldBlock = (group, v) => !isBlocked(state) && isBlocked({ ...state, [group]: v })

  /**
   * Nudge an already-blocked state back to a legal one by moving `sifat`.
   *
   * ⚠️ Only reachable from a state PERSISTED BEFORE this rule existed — the
   * pills cannot produce one, because a pill that would is disabled. Without
   * this, anyone who last ran Perorangan + Konsumtif reopens the popup on a
   * combination every pill refuses to leave.
   */
  const unblock = () => {
    if (!isBlocked(state)) return

    const legal = SCENARIO.sifat.find(o => !isBlocked({ ...state, sifat: o.v }))

    if (legal) state.sifat = legal.v
  }

  const pad = n => String(n).padStart(2, '0')

  /** `YYYY-MM-DD HH:mm`, local time. Local on purpose: the name is read by a
   *  person looking for the row they just made, and UTC would show them an hour
   *  they did not act in. (The DATA is UTC — that contract is unaffected.) */
  const stamp = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  /** `MM-DD HH:mm` — the collateral name is already scoped by the debtor, so the
   *  year is noise in a column that truncates. */
  const shortStamp = (d = new Date()) =>
    `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

  const state = {
    jenis: 'N',
    debitur: 'BU',
    sifat: 'P',
    userName: '',
    debtorName: '',
    projectOverride: null,
    rows: Object.fromEntries(TABLES.map(t => [t.key, t.def])),
    collaterals: [{ type: 'property', name: null }],

    /** Whether the config body is folded away. Persisted, because a fixture's
     *  shape is usually decided once and then re-run many times — after which
     *  the panel is mostly something between you and the run button. */
    collapsed: false
  }

  /**
   * `Testing {user} {N|R|E} {BU|I}-{P|K} {YYYY-MM-DD} {HH:mm}` (user, 2026-08-15).
   *
   * Derived, never typed — the whole point of the pills is that the convention
   * cannot drift through a typo. `projectOverride` exists for the one-off case
   * and is deliberately the ONLY way to deviate.
   */
  const projectName = (at = new Date()) =>
    state.projectOverride ||
    `Testing ${state.userName || 'Anon'} ${state.jenis} ${state.debitur}-${state.sifat} ${stamp(at)}`

  /**
   * `Agunan {debtor} {type} - {MM-DD HH:mm}`.
   *
   * ⚠️ The debtor name is EDITABLE and may be blank at popup time — the debtor
   * is chosen during the fill, not before it — so this falls back to a visible
   * `{debitur}` placeholder rather than silently producing "Agunan  Properti".
   * A name with a hole in it is obvious; a name with a double space is not.
   */
  const collateralName = (item, at = new Date()) => {
    if (item.name) return item.name
    const type = COLLATERAL_TYPES.find(t => t.key === item.type)

    return `Agunan ${state.debtorName || '{debitur}'} ${type ? type.label : item.type} - ${shortStamp(at)}`
  }

  /** Everything the run needs, resolved at one instant so every generated name
   *  in a single run carries the SAME timestamp. Resolving per-name would stamp
   *  a five-minute run with five different minutes. */
  const plan = () => {
    const at = new Date()

    return {
      at: at.toISOString(),
      scenario: { jenis: state.jenis, debitur: state.debitur, sifat: state.sifat },
      creditType: creditTypeLabel(),
      applicationType: applicationTypeLabel(),
      debtorType: state.debitur === 'BU' ? 'Badan Usaha' : 'Perorangan',
      debtorName: state.debtorName || '',
      projectName: projectName(at),
      rows: { ...state.rows },

      /* Shaped for the driver: it needs the opener label, not our key. Zero-count
         tables are dropped here rather than in the driver, so "do nothing" is
         expressed once. */
      tables: TABLES
        .filter(t => (state.rows[t.key] ?? 0) > 0 && (!t.appliesTo || t.appliesTo(state)))
        /* `seeded` rides along because only the TABLE knows whether the form
           mounts a first row for it — see the note on `visit`. Defaulting here
           rather than at the consumer keeps the assumption in the model. */
        .map(t => ({
          key: t.key,
          opener: t.opener,
          count: state.rows[t.key],
          seeded: t.seeded ?? 1,
          isOwnCapability: Boolean(t.isOwnCapability)
        })),
      collaterals: state.collaterals.map(item => ({
        type: item.type,
        jenis: (COLLATERAL_TYPES.find(t => t.key === item.type) || {}).jenis,
        name: collateralName(item, at)
      }))
    }
  }

  /** The form's own wording, which the driver has to match exactly. */
  const creditTypeLabel = () =>
    `${state.debitur === 'BU' ? 'Kredit Badan Usaha' : 'Kredit Perorangan'} - ${state.sifat === 'P' ? 'Produktif' : 'Konsumtif'}`

  const applicationTypeLabel = () =>
    ({ N: 'Baru', R: 'Restrukturisasi', E: 'Perpanjangan' })[state.jenis]

  // ── Persistence ─────────────────────────────────────────────────────────────
  /* Kept so the panel reopens on the settings the last run used: these are
     fixture recipes, and re-picking six controls to repeat a run is the friction
     this panel exists to remove. The timestamp is never stored — it is always
     "now". */
  const STORAGE_KEY = 'simOptions'

  const save = () => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: state })
    } catch (_) {
      /* storage unavailable — the panel still works, it just forgets */
    }
  }

  const load = () =>
    new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY], got => {
          const saved = got && got[STORAGE_KEY]

          if (saved) {
            Object.assign(state, saved, { rows: { ...state.rows, ...(saved.rows || {}) } })

            /* A stored type that no longer exists would render a blank select
               and fill nothing, so drop it rather than carry it forward. */
            state.collaterals = (state.collaterals || []).filter(item =>
              COLLATERAL_TYPES.some(t => t.key === item.type)
            )

            unblock()
          }

          resolve(state)
        })
      } catch (_) {
        resolve(state)
      }
    })

  /**
   * Is this the credit-application CREATE form?
   *
   * ⚠️ Deliberately CREATE only. The options describe a record to build; on a
   * detail route there is nothing to build and the panel would offer choices
   * that cannot apply.
   */
  /**
   * One-tick fixture sizing. 'minimal' exists to keep test writes off shared
   * staging: ROWS are the storage — every table row is real relational weight
   * and every attach is a never-purged GCS file (B47) — so it zeroes every
   * table and clears the agunan list; the popup pairs it with Complete data
   * OFF and Skip optional ON. 'lengkap' restores the defaults. Scenario,
   * names and the debtor are left alone: size is not identity.
   * ⚠️ Zero everywhere is a DRAFT recipe — a SUBMIT still needs the
   * validation floors (a facility, the Wajib documents).
   */
  const applyPreset = kind => {
    if (kind === 'minimal') {
      for (const t of TABLES) state.rows[t.key] = t.min ?? 0
      state.collaterals = []
    } else {
      for (const t of TABLES) state.rows[t.key] = t.def
      state.collaterals = [{ type: 'property', name: null }]
    }
    save()

    return kind
  }

  const isCreditApplication = url => /\/v2\/credit-application\/create/.test(String(url || ''))

  return {
    COLLATERAL_TYPES,
    TABLES,
    SCENARIO,
    state,
    wouldBlock,
    projectName,
    collateralName,
    creditTypeLabel,
    applicationTypeLabel,
    plan,
    applyPreset,
    save,
    load,
    isCreditApplication,
    stamp,
    shortStamp
  }
})()
