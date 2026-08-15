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
    { key: 'facility', label: 'Fasilitas', opener: 'Tambah Fasilitas', def: 1, max: 5, isOwnCapability: true },
    { key: 'shareholder', label: 'Pemegang saham', opener: 'Tambah Pemegang Saham', def: 2, max: 10 },
    { key: 'boardMember', label: 'Pengurus', opener: 'Tambah Pengurus', def: 2, max: 10 },
    { key: 'financialReport', label: 'Laporan keuangan', opener: 'Tambah Laporan Keuangan', def: 4, max: 8 },
    { key: 'underlying', label: 'Underlying', opener: 'Tambah Underlying', def: 1, max: 5 },
    { key: 'slik', label: 'Data pinjaman (SLIK)', opener: 'Tambah Data Pinjaman', def: 1, max: 10 },
    { key: 'ubo', label: 'Pemilik manfaat', opener: 'Tambah Pemilik Manfaat Utama', def: 1, max: 10, more: true },
    { key: 'emergencyContact', label: 'Kontak darurat', opener: 'Tambah Kontak Darurat', def: 1, max: 10, more: true },
    { key: 'bankAccount', label: 'Akun bank', opener: 'Tambah Akun Bank', def: 1, max: 5, more: true },
    { key: 'document', label: 'Dokumen pengajuan', opener: 'Tambah Dokumen Pengajuan Kredit', def: 1, max: 12, more: true },
    { key: 'visit', label: 'Kunjungan', opener: 'Tambah Data Kunjungan', def: 1, max: 5, more: true }
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
        .filter(t => (state.rows[t.key] ?? 0) > 0)
        .map(t => ({ key: t.key, opener: t.opener, count: state.rows[t.key], isOwnCapability: Boolean(t.isOwnCapability) })),
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
  const isCreditApplication = url => /\/v2\/credit-application\/create/.test(String(url || ''))

  return {
    COLLATERAL_TYPES,
    TABLES,
    SCENARIO,
    state,
    projectName,
    collateralName,
    creditTypeLabel,
    applicationTypeLabel,
    plan,
    save,
    load,
    isCreditApplication,
    stamp,
    shortStamp
  }
})()
