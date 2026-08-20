#!/usr/bin/env node
/**
 * Pre-release check: `node check.js`
 *
 * Two things, both of which have burned this repo:
 *
 * 1. **LOAD** — every popup script is evaluated in order in a stubbed
 *    DOM/chrome context. 🔴 `node --check` CANNOT catch the failure that once
 *    killed this popup (V1-DRIVER.md): a `let` referenced above its declaration
 *    parses perfectly and throws ReferenceError at load, aborting popup.js
 *    before a single handler binds — every button dead, presenting as "Quick
 *    Fill stopped working". Only evaluation finds it.
 *
 * 2. **NAMING** — the fixture-name convention (user, 2026-08-15). It is the
 *    contract between this extension and whoever reads the records afterwards,
 *    and it is composed in exactly one place; these assertions are what keep it
 *    there.
 *
 * ⚠️ Prove the harness before trusting it: break something on purpose and watch
 * this fail. A check that has never failed has not been tested.
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const dir = __dirname
const FILES = ['driver-v1.js', 'driver-v2.js', 'drivers.js', 'simulation.js', 'simulation-ui.js', 'popup.js']

let failures = 0
const fail = msg => { failures++; console.log('  FAIL  ' + msg) }
const pass = msg => console.log('  ok    ' + msg)

// ── 1. Load ───────────────────────────────────────────────────────────────────
/**
 * ⚠️ `textContent` is a real ACCESSOR here, and setting it to '' really does
 * drop the children — because that is the whole mechanism the panel checks in
 * §3 depend on. A plain `textContent: ''` data property looks equivalent and
 * silently makes those assertions unfalsifiable: the sabotage passes, the
 * check goes green, and the harness certifies a bug. Caught 2026-08-15 by
 * reintroducing the bug on purpose and watching nothing happen.
 */
const stubEl = () => {
  const node = {
    style: { cssText: '' },
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    children: [],
    value: '',
    className: '',
    disabled: false,
    checked: false,
    firstChild: null,
    appendChild(k) { this.children.push(k); return k },
    insertBefore(kid, ref) {
      const at = ref ? this.children.indexOf(ref) : -1

      at === -1 ? this.children.unshift(kid) : this.children.splice(at, 0, kid)

      return kid
    },
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    click() {},
    remove() {}
  }

  let text = ''

  Object.defineProperty(node, 'textContent', {
    configurable: true,
    get: () => text,
    set(v) {
      text = String(v)
      if (text === '') node.children.length = 0
    }
  })

  return node
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, RegExp, Array, Object, String, Number, Boolean, Error,
  document: {
    getElementById: () => stubEl(),
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    addEventListener() {},
    body: stubEl()
  },
  chrome: {
    storage: { local: { get: (k, cb) => (cb ? cb({}) : Promise.resolve({})), set() {} } },
    scripting: { executeScript: async () => [{ result: null }] },
    tabs: { query: async () => [{ id: 1, url: 'https://example.test/' }] },
    runtime: { lastError: null }
  },
  navigator: { clipboard: { writeText: async () => {} } },
  location: { href: 'chrome-extension://x/popup.html' }
}

sandbox.window = sandbox
sandbox.globalThis = sandbox
vm.createContext(sandbox)

console.log('load')

for (const f of FILES) {
  const full = path.join(dir, f)

  if (!fs.existsSync(full)) { fail(`${f} is missing`); continue }

  try {
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: f })
    pass(f)
  } catch (e) {
    fail(`${f}: ${e.name}: ${e.message}`)
    break
  }
}

;['SIM', 'SIMUI'].forEach(g => (sandbox[g] ? pass(`global ${g}`) : fail(`global ${g} missing`)))

// ── 2. Naming convention ──────────────────────────────────────────────────────
console.log('\nnaming')

const S = sandbox.SIM

if (!S) {
  fail('SIM unavailable — skipping naming checks')
} else {
  const at = new Date(2026, 7, 15, 10, 42)
  const eq = (label, got, want) => (got === want ? pass(`${label} → ${got}`) : fail(`${label}\n          got  ${got}\n          want ${want}`))

  S.state.userName = 'Yusti'
  S.state.debtorName = ''
  S.state.projectOverride = null
  S.state.jenis = 'N'; S.state.debitur = 'BU'; S.state.sifat = 'P'

  eq('project name', S.projectName(at), 'Testing Yusti N BU-P 2026-08-15 10:42')
  eq('credit type', S.creditTypeLabel(), 'Kredit Badan Usaha - Produktif')
  eq('application type', S.applicationTypeLabel(), 'Baru')

  S.state.jenis = 'R'; S.state.debitur = 'I'; S.state.sifat = 'K'
  eq('scenario flows through', S.projectName(at), 'Testing Yusti R I-K 2026-08-15 10:42')
  eq('credit type follows', S.creditTypeLabel(), 'Kredit Perorangan - Konsumtif')
  eq('application type follows', S.applicationTypeLabel(), 'Restrukturisasi')

  /* The debtor is chosen DURING the fill, so a blank name must stay visible
     rather than collapsing into a double space. */
  eq('debtor placeholder', S.collateralName({ type: 'property', name: null }, at), 'Agunan {debitur} Properti - 08-15 10:42')

  S.state.debtorName = 'PT Anugrah Logistik'
  eq('collateral name', S.collateralName({ type: 'vehicle', name: null }, at), 'Agunan PT Anugrah Logistik Kendaraan - 08-15 10:42')
  eq('override wins', S.collateralName({ type: 'property', name: 'Deposito uji BMPK' }, at), 'Deposito uji BMPK')

  S.state.projectOverride = 'Nama khusus'
  eq('project override wins', S.projectName(at), 'Nama khusus')
  S.state.projectOverride = null

  // Every branch the form supports must be reachable from the panel.
  const branches = S.COLLATERAL_TYPES.map(t => t.key)
  const wanted = ['property', 'vehicle', 'saving', 'deposito', 'preciousMetal', 'general']
  const missing = wanted.filter(w => !branches.includes(w))

  missing.length ? fail('collateral branches missing: ' + missing.join(', ')) : pass(`collateral branches: ${branches.length}`)

  // The panel only appears where it can mean something.
  S.isCreditApplication('http://localhost:3000/v2/credit-application/create')
    ? pass('detects the create route')
    : fail('did not detect the create route')

  S.isCreditApplication('http://localhost:3000/v2/credit-application/list')
    ? fail('detected the LIST route — the panel would offer options that cannot apply')
    : pass('ignores non-create routes')
}

// ── 3. Panel behaviour ────────────────────────────────────────────────────────
/**
 * 🔴 Three bugs shipped here and NONE was visible to the checks above (user,
 * 2026-08-15: "on type at popup autofill, it loses focus each time").
 *
 * All three are the same shape — a re-render destroying something it should
 * not — so all three are asserted on the MECHANISM, which a stub DOM can see,
 * rather than on focus, which it cannot:
 *
 *   1. typing rebuilt the panel body  → the input died mid-keystroke
 *   2. `render()` cleared the CONTAINER → it deleted popup.js's run button,
 *      which is a sibling, not a child
 *   3. `defaultUserName` was never fed  → the name box stayed empty
 *
 * ⚠️ Proven to fire. Restore `commit()` in a name handler and #1 fails; render
 * into the container instead of `.sim-body` and #2 fails.
 */
;(async () => {
  console.log('\npanel behaviour')

  const SU = sandbox.SIMUI

  if (!SU || !S) {
    fail('SIMUI/SIM unavailable — skipping panel checks')
  } else {
    const listeners = []
    const created = []
    const realCreate = sandbox.document.createElement

    sandbox.document.createElement = () => {
      const node = stubEl()

      node.addEventListener = (type, fn) => listeners.push({ node, type, fn })
      created.push(node)

      return node
    }

    const container = stubEl()

    /**
     * Fire the recorded handler that provably causes `changed()`, found by
     * BEHAVIOUR rather than by position — the panel's append order is not a
     * contract, and keying on it would fail for the wrong reason the next time
     * a row moves.
     *
     * ⚠️ Iterate a SNAPSHOT. Several handlers re-render, and a re-render
     * registers fresh listeners into this very array — so a live `for…of` walks
     * into "+ Tambah agunan" appending a collateral, re-rendering, appending
     * another "+ Tambah agunan", forever. That is a stack overflow in the
     * CHECK, and it presents as the whole harness dying with a V8 trace rather
     * than as a failed assertion.
     */
    const fireHandlerThat = (type, prepare, changed) => {
      for (const { node, type: t, fn } of listeners.slice()) {
        if (t !== type) continue

        prepare(node)

        try {
          fn({ preventDefault() {}, key: 'x' })
        } catch (_) {
          continue
        }

        if (changed()) return true
      }

      return false
    }

    try {
      S.state.userName = ''
      S.state.collapsed = false
      await SU.mount(container, { defaultUserName: 'Budi Santoso' })

      // The hook existed in `mount` from the start; nothing ever fed it.
      S.state.userName === 'Budi Santoso'
        ? pass('name prefills from the session')
        : fail(`name prefill: got "${S.state.userName}", want "Budi Santoso"`)

      // A name the user typed themselves must survive a re-mount.
      S.state.userName = 'Diketik Sendiri'
      await SU.mount(container, { defaultUserName: 'Budi Santoso' })
      S.state.userName === 'Diketik Sendiri'
        ? pass('a typed name beats the session name')
        : fail(`typed name lost: got "${S.state.userName}"`)

      const body = created.filter(n => n.className === 'sim-body').pop()

      if (!body) {
        fail('no .sim-body — the panel renders straight into its container, so a re-render deletes the run button')
      } else {
        let clears = 0

        /* Counts, and still CLEARS — keep the real semantics, or the sibling
           assertion below stops being falsifiable. */
        Object.defineProperty(body, 'textContent', {
          configurable: true,
          get: () => '',
          set() { clears++; body.children.length = 0 }
        })

        // 1. Typing must not rebuild the body.
        const typed = fireHandlerThat(
          'input',
          node => { S.state.userName = ''; node.value = 'Zed' },
          () => S.state.userName === 'Zed'
        )

        if (!typed) fail('could not find the userName input handler — this check never ran')
        else if (clears) fail(`typing rebuilt the panel (${clears}× re-render) — focus is lost per keystroke`)
        else pass('typing does not rebuild the panel')

        /* 2. A full re-render is legitimate on a PILL click — what must survive
              it is popup.js's run button, appended to the container as a
              sibling of the body. */
        const sentinel = stubEl()

        sentinel.className = 'run-button-sentinel'
        container.appendChild(sentinel)

        const before = S.state.jenis
        const clicked = fireHandlerThat('click', () => {}, () => S.state.jenis !== before)

        if (!clicked) fail('could not find a pill click handler — the sibling check never ran')
        else if (!container.children.includes(sentinel)) fail('a re-render deleted a container sibling — this is how the run button disappeared')
        else pass('a re-render leaves container siblings alone')
      }

      // 3. The fold state round-trips.
      S.state.collapsed = false
      const folded = fireHandlerThat('click', () => {}, () => S.state.collapsed === true)

      folded ? pass('the config folds away') : fail('nothing toggles state.collapsed — the panel cannot be collapsed')

      /**
       * 🔴 4. EVERY DRIVER MUST IMPLEMENT THE WHOLE MODAL CAPABILITY.
       *
       * `walkRecordModals` bails on a missing `listModals` — silently, so
       * "Fill modals" was a ticked checkbox that did NOTHING on every v2 page,
       * and Fasilitas Kredit (reachable only via "Tambah Fasilitas") never
       * filled. Worse, `saveModal`/`closeModal` are called with NO feature
       * test, so a HALF-registered capability opens a modal and then throws.
       *
       * The rule this asserts: a UI control may not advertise a capability that
       * a driver it can run against lacks, and the capability is all-or-nothing.
       */
      /* ⚠️ `const DRIVERS` is a LEXICAL binding, not a property of the context,
         so `sandbox.DRIVERS` is undefined however well the file loaded. Read it
         by evaluating in the same context — the alternative, exporting it onto
         `window` purely to be testable, would change production code to suit
         the test. */
      const drivers = vm.runInContext('typeof DRIVERS !== "undefined" ? DRIVERS : null', sandbox)
      const MODAL_CAPS = ['listModals', 'openModal', 'saveModal', 'closeModal']

      if (!drivers) {
        fail('DRIVERS not reachable — cannot check driver capability parity')
      } else {
        Object.entries(drivers).forEach(([variant, d]) => {
          const missing = MODAL_CAPS.filter(c => typeof d[c] !== 'function')
          const partial = missing.length && missing.length < MODAL_CAPS.length

          if (!missing.length) pass(`${variant} implements the modal capability`)
          else if (partial) fail(`${variant} implements the modal capability PARTIALLY (missing ${missing.join(', ')}) — saveModal/closeModal are called untested and will throw`)
          else fail(`${variant} implements NO modal capability, but the popup offers a "Fill modals" checkbox — it would tick and do nothing`)
        })
      }
    } catch (e) {
      fail(`panel checks: ${e.name}: ${e.message}`)
    } finally {
      sandbox.document.createElement = realCreate
    }
  }

  // ── 4. The extras passes navigate before they search ────────────────────────
  console.log('\nopener navigation')

  {
    /**
     * 🔴 B53 #2, 2026-08-16. All three passes in `runPlannedExtras` searched
     * `document` for their opener while `runAllWizardSteps` had already walked
     * to the LAST step, so the facility pass reported
     * `no "Tambah Fasilitas" — is a Jenis Kredit chosen?` on a form that had
     * one, every real run. NOTHING could catch it: the driver's own reason
     * string described a plausible gate, and every direct-call verification
     * happened with the form parked on the right step.
     *
     * The sabotage that makes exactly this fail: delete the `for` loop from
     * `goToOpener` — the first assertion then returns null instead of 3.
     */
    const goToOpener = vm.runInContext('typeof goToOpener !== "undefined" ? goToOpener : null', sandbox)

    if (typeof goToOpener !== 'function') {
      fail('goToOpener not reachable — the extras passes cannot navigate')
    } else {
      const realTimeout = sandbox.setTimeout
      const OPENER = 'Tambah Fasilitas'
      const OWNING_STEP = 3

      sandbox.setTimeout = fn => realTimeout(fn, 0)

      /* ONE stub for both injections, told apart by their args: `goTo` is given
         a step index, the presence probe an opener label. */
      const rail = startOn => {
        let current = startOn
        const visited = []

        return {
          visited,
          exec: async ({ args }) => {
            if (typeof args[0] === 'number') { current = args[0]; visited.push(args[0]); return [{ result: true }] }

            return [{ result: current === OWNING_STEP }]
          }
        }
      }

      try {
        const driver = { goTo: () => true }

        sandbox.chrome.scripting.executeScript = rail(8).exec

        const landed = await goToOpener(driver, 1, OPENER)

        landed === OWNING_STEP
          ? pass(`walks the rail from the last step to the one owning "${OPENER}"`)
          : fail(`goToOpener returned ${landed} starting from step 8 — "${OPENER}" is on step ${OWNING_STEP}, and every extras pass runs from the LAST step`)

        const here = rail(OWNING_STEP)

        sandbox.chrome.scripting.executeScript = here.exec

        const already = await goToOpener(driver, 1, OPENER)

        already === -1 && !here.visited.length
          ? pass('an opener already on screen costs one probe and no navigation')
          : fail(`goToOpener moved the rail (${here.visited.join(',')}) for an opener already on screen`)

        sandbox.chrome.scripting.executeScript = async () => [{ result: false }]

        const nowhere = await goToOpener(driver, 1, 'Tambah Yang Tidak Ada')

        nowhere === null
          ? pass('an opener no step has reports null rather than looping')
          : fail(`goToOpener returned ${nowhere} for an opener no step has`)
      } catch (e) {
        fail(`opener navigation: ${e.name}: ${e.message}`)
      } finally {
        sandbox.setTimeout = realTimeout
        sandbox.chrome.scripting.executeScript = async () => [{ result: null }]
      }
    }
  }

  // ── 5. The run never answers a business question ────────────────────────────
  console.log('\nuser gates')

  {
    /**
     * 🔴 B53 #1, 2026-08-16. Quick Fill turned on "Menggunakan Referensi
     * Pengajuan Kredit", which puts step 1 into reference mode and makes a
     * reference picker required — the run ended on a form that could not be
     * submitted. v1's reveal tried to catch this by counting live inputs, and
     * `driver-v1.js:1342` records that the count RISES here, so the heuristic
     * kept the tick on the very control its own comment cites.
     *
     * Sabotage that makes exactly this fail: drop `isUserGate(f) ||` from
     * `skipField`, and the wiring assertion goes red while the shape ones stay
     * green — which is the split that says the predicate, not the regex, broke.
     */
    const read = expr => vm.runInContext(`typeof ${expr} !== "undefined" ? ${expr} : null`, sandbox)
    const isUserGate = read('isUserGate')
    const skipField = read('skipField')

    if (typeof isUserGate !== 'function' || typeof skipField !== 'function') {
      fail('isUserGate/skipField not reachable — the run can still answer a gate')
    } else {
      const GATES = [
        'CREDIT_APPLICATION_AVALIST_HAS_AVALIST',
        'CREDIT_APPLICATION_REFERENCE_DATA_USE_REFERENCE',
        'DEBTOR_GENERAL_DATA_IS_USING_REFERENCE_DEBTOR',
        'CREDIT_APPLICATION_APPLICATION_DATA_RESTRUCT_OR_EXTENSION_USE_REFERENCE'
      ]

      const missed = GATES.filter(name => !isUserGate({ name, type: 'toggle' }))

      missed.length
        ? fail(`isUserGate does not recognise ${missed.join(', ')} — the run would answer ${missed.length} business question(s)`)
        : pass(`the ${GATES.length} reference gates are recognised`)

      /* An ordinary gate must still be reachable, or "reveal" reveals nothing.
         Asserted on isUserGate alone so it does not depend on the checkbox
         option's state. */
      isUserGate({ name: 'CREDIT_APPLICATION_COLLATERAL_DATA_IS_HAVE_COLLATERAL', type: 'toggle' })
        ? fail('isUserGate blocks an ordinary gate — the collateral section would never open')
        : pass('an ordinary gate is left reachable')

      /**
       * The wiring: every fill site filters on `skipField`, so a gate that
       * `isUserGate` recognises but `skipField` does not fold in is recognised
       * for nothing.
       *
       * 🔴 Asserted with a NON-checkbox type ON PURPOSE, and this matters.
       * With "Tick checkboxes" ON — the setting during the run that found the
       * bug — `shouldSkipCheckboxFills()` is false, so `isUserGate` is the ONLY
       * thing dropping the gate. Written with `type: 'toggle'` this assertion
       * PASSED with the gate rule deleted, because the sandbox stubs the option
       * element as unchecked and the checkbox branch swallowed it. Measured
       * 2026-08-16 by deleting `isUserGate(f) ||` and watching nothing go red.
       * An assertion that cannot fail is not evidence.
       */
      skipField({ name: GATES[0], type: 'select' })
        ? pass('skipField carries the gate rule to every fill site')
        : fail('skipField does not drop a reference gate — isUserGate is recognised but never applied')
    }
  }

  console.log('\nauto-run on open')

  {
    /**
     * 🔴 2026-08-17. "On open: Quick Fill" did nothing on the credit-application
     * create form — the one route it exists for. The auto-run block opened with
     * `if (await mountSimulation()) return`, and `mountSimulation` answers TRUE
     * on that route, so `pref_onOpen` was never fetched there at all. The
     * setting worked everywhere it was useless.
     *
     * 🔴 And the block was a STALE COPY of the button: it called
     * `runAllWizardSteps()` bare, with no `SIM.plan()` capture and no
     * `runPlannedExtras()`. Restoring reachability ALONE would have shipped a
     * run that fills the wizard then skips every agunan, row, mutation and
     * facility pass — worse than the no-op, because it reports success.
     *
     * Asserted on SOURCE rather than behaviour: the auto-run is an IIFE that has
     * already run by the time the sandbox is readable, so it cannot be invoked
     * again to observe.
     *
     * Sabotage that makes exactly these fail — each verified to go red:
     *   1. restore `if (await mountSimulation()) return`      → the gate one
     *   2. swap `runQuickFill()` for `runAllWizardSteps()`    → the shared-path one
     */
    const source = fs.readFileSync(path.join(dir, 'popup.js'), 'utf8')
    const autoRun = source.slice(source.indexOf('── Auto-run on popup open'))
    const read = expr => vm.runInContext(`typeof ${expr} !== "undefined" ? ${expr} : null`, sandbox)

    typeof read('runQuickFill') === 'function'
      ? pass('runQuickFill is extracted, so both entry points share one path')
      : fail('runQuickFill is missing — the button and the auto-run are two copies again')

    /* Named rather than inlined: this file omits semicolons, so a statement
       BEGINNING with a regex literal is parsed as division against the line
       above and the whole check dies at load with "Invalid or unexpected
       token". Paid for once, 2026-08-17. */
    const mountsPanel = /await mountSimulation\(\)/.test(autoRun)
    const shortCircuits = /if \(await mountSimulation\(\)\) return/.test(autoRun)
    const usesShared = /runQuickFill\(\)/.test(autoRun)
    const usesBareWizard = /await runAllWizardSteps\(\)/.test(autoRun)

    mountsPanel && !shortCircuits
      ? pass('mounting the panel no longer short-circuits the preference')
      : fail('the auto-run returns on mountSimulation() — "On open: Quick Fill" is dead on the create route')

    /* The point is not that runQuickFill is MENTIONED — it is that the bare
       wizard call is GONE. A block containing both would still skip the extras
       on whichever branch ran. */
    usesShared && !usesBareWizard
      ? pass('the auto-run goes through runQuickFill, not a bare wizard loop')
      : fail('the auto-run calls runAllWizardSteps directly — it would skip every extras pass')
  }

  console.log('\nextras are produced AND consumed')

  {
    /**
     * 🔴 THE RECURRING SHAPE, guarded: a value produced and never read. This
     * repo has shipped it three times — a pill that set nothing, a plan
     * reaching one of two fill paths, and "Fill modals" being a silent no-op on
     * every v2 page. Each time the run reported SUCCESS.
     *
     * An extras pass has three links and all three must exist: the driver
     * registers the capability, `runPlannedExtras` CALLS the pass, and its
     * result reaches the `problems` list. Break any one and the user gets a
     * green "Done" over work that did not happen.
     *
     * Sabotage that makes exactly these fail, each verified:
     *   delete `documents: v2FillDocuments` from drivers.js  → registration
     *   drop the `await fillPlannedDocuments()` line         → invocation
     *   delete the `if (documents)` block                    → reporting
     */
    const popupSrc = fs.readFileSync(path.join(dir, 'popup.js'), 'utf8')
    const driversSrc = fs.readFileSync(path.join(dir, 'drivers.js'), 'utf8')
    /**
     * ⚠️ COMMENTS STRIPPED BEFORE COUNTING, and this is load-bearing. The first
     * version counted raw source, so deleting the reporting CODE while leaving
     * its explanatory comment — which naturally names the variable — kept the
     * count at 2 and the assertion passed on a pass that reported nothing.
     * Same family as `includes('hasPermission')` being satisfied by an unused
     * import. Prose must never be able to satisfy a claim about behaviour.
     */
    const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const extras = stripComments(popupSrc.slice(popupSrc.indexOf('async function runPlannedExtras')))

    const PASSES = [
      { name: 'documents', fn: 'fillPlannedDocuments', v: 'documents' },
      { name: 'financialReports', fn: 'fillPlannedFinancialReports', v: 'financialReports' },
      { name: 'qualitative', fn: 'fillPlannedQualitative', v: 'qualitative' },
      { name: 'mutations', fn: 'fillPlannedMutations', v: 'mutations' },
      { name: 'collaterals', fn: 'fillPlannedCollaterals', v: 'agunan' }
    ]

    PASSES.forEach(p => {
      const registered = new RegExp(`${p.name}:\\s*v2`).test(driversSrc)
      const invoked = new RegExp(`await ${p.fn}\\(`).test(extras)

      /**
       * Consumed = the bound value is READ somewhere, not merely assigned.
       *
       * 🔴 The first version of this asserted `${v}[\s\S]*problems.push` and
       * PASSED its own sabotage — the binding line itself supplies the name and
       * some LATER pass supplies the push, so the pattern matched a variable
       * nothing read. Fifth unfalsifiable assertion found in this repo, and the
       * first one I wrote myself. Counting occurrences is the honest test: a
       * name that appears exactly ONCE inside `runPlannedExtras` appears only
       * in its own `const`, which is precisely the produced-never-consumed bug.
       */
      const mentions = (extras.match(new RegExp(`\\b${p.v}\\b`, 'g')) || []).length
      const consumed = mentions > 1 && /problems\.push/.test(extras)

      registered && invoked && consumed
        ? pass(`${p.name}: registered, invoked and reported`)
        : fail(`${p.name}: registered=${registered} invoked=${invoked} reported=${consumed} — a silent no-op`)
    })
  }

  console.log('\nrun log')

  {
    /**
     * The log exists to answer ONE question the status bar cannot: was a user
     * gate already on before the run, or did the run switch it on? That needs
     * the BEFORE snapshot taken before the first write, and the per-field map
     * recorded so a `skipped_user_gate` is visible.
     *
     * ⚠️ Every test below is NAMED in a const. A statement starting with a
     * regex literal is DIVISION in this semicolon-free codebase and kills the
     * whole file at load — already recorded in the handover, and paid for a
     * second time writing exactly this block.
     *
     * Sabotage that makes exactly these fail, each verified:
     *   move `snapshotGates('before')` below runAllWizardSteps  → ordering
     *   delete `logEvent('fields', results)` from renderResults → field map
     *   delete the persistRunLog() call in the finally block    → persistence
     */
    const stripLogComments = str => str.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const logSrc = stripLogComments(fs.readFileSync(path.join(dir, 'popup.js'), 'utf8'))
    const qf = logSrc.slice(logSrc.indexOf('async function runQuickFill'))

    const beforeAt = qf.indexOf("snapshotGates('before')")
    const walkAt = qf.indexOf('runAllWizardSteps(')

    const orderedOk = beforeAt !== -1 && walkAt !== -1 && beforeAt < walkAt

    orderedOk
      ? pass('the gate snapshot is taken BEFORE the first field is written')
      : fail("snapshotGates('before') must run before runAllWizardSteps, or it proves nothing")

    const rr = logSrc.slice(logSrc.indexOf('function renderResults'), logSrc.indexOf('function renderResults') + 400)
    const fieldsLogged = /logEvent\(\s*'fields'/.test(rr)

    fieldsLogged
      ? pass('the per-field result map reaches the log')
      : fail('renderResults must log the raw results map — counts cannot show skipped_user_gate')

    /**
     * Values must be recorded on BOTH fill branches. "A filter applied on one
     * branch of a two-branch fill is not applied" is already a recorded trap
     * here — the multi-step and single-step paths have diverged before, and a
     * value log that only covers "All steps" is silently empty for the other.
     *
     * Sabotage, verified: delete either recordFieldDetail call site → fails.
     */
    const detailCalls = (logSrc.match(/recordFieldDetail\(/g) || []).length

    /* Two per branch — try AND catch — so 4. The DEFINITION does not match this
       pattern (`recordFieldDetail = (`, with spaces), which is why the first
       threshold of 5 was wrong and the harness caught it rather than the code. */
    detailCalls >= 4
      ? pass('written values are recorded on both fill branches')
      : fail(`recordFieldDetail appears ${detailCalls}x — both fill branches must record, in try AND catch`)

    const persisted = /persistRunLog\(\)/.test(qf)

    persisted
      ? pass('the log is persisted, so it survives the popup closing')
      : fail('runQuickFill must call persistRunLog() — an unrecorded run is unrecoverable')

    /**
     * The version must come from the MANIFEST, never a literal. A hand-edited
     * version string eventually disagrees with the build it labels, which is
     * the exact problem putting it on screen was meant to solve.
     *
     * Sabotage, verified: replace the getManifest() call with a string literal
     * → both halves fail (no manifest read, and a version-shaped literal).
     */
    const htmlSrc = fs.readFileSync(path.join(dir, 'popup.html'), 'utf8')
    const readsManifest = /getManifest\(\)\.version/.test(logSrc)
    const hardcoded = /v?\d+\.\d+\.\d+/.test(stripLogComments(htmlSrc))

    readsManifest && !hardcoded
      ? pass('the popup version is read from the manifest, not hardcoded')
      : fail(`version display: readsManifest=${readsManifest} hardcodedInHtml=${hardcoded}`)
  }

  // ── 9. The scenario panel actually reaches the fill ───────────────────────────
  console.log('\nscenario panel reaches the fill')

  {
    const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const src = strip(fs.readFileSync(path.join(dir, 'popup.js'), 'utf8'))

    /**
     * 🔴 B56. Both fill branches resolve a value as
     * `data[f.name] ?? simOverride(f.label)`. Pre-filling `data` with a smart
     * default for every detected field therefore makes the left side always
     * win and `simOverride` UNREACHABLE — the panel's Jenis Kredit, Jenis
     * Pengajuan, debtor type and project name all silently discarded, while
     * the run reports success naming values it never wrote.
     *
     * Asserted on the ASSIGNMENT, not on a comment: comments are stripped
     * above, because prose must never be able to satisfy a claim about
     * behaviour.
     *
     * Sabotage, verified: restore the `for (const f of lastDetectedFields)
     * data[f.name] = smartDefault(...)` loop → this fails alone.
     */
    const prefills = /data\s*\[[^\]]+\]\s*=\s*smartDefault\s*\(/.test(src)
    const sites = (src.match(/\?\?\s*simOverride\(/g) || []).length

    !prefills
      ? pass('the smart-default bag does not pre-empt simOverride')
      : fail('popup.js pre-fills `data` with smartDefault — simOverride becomes unreachable (B56)')

    sites >= 2
      ? pass('both fill branches consult the simulation plan')
      : fail(`?? simOverride( appears ${sites}x — the single-step and all-steps branches BOTH need it`)
  }

  if (!S) {
    fail('SIM unavailable — skipping blocked-combination checks')
  } else {
    /**
     * Badan usaha + Konsumtif cannot be built — `enumHelpers.ts:687` leaves
     * COMPANY_CONSUMPTIVE commented out — so the pill that would select it is
     * disabled. ⚠️ Perorangan + Konsumtif IS legal and must stay selectable;
     * an earlier version of this rule blocked the wrong one.
     *
     * Sabotage, verified: empty `BLOCKED` → the two "refused" assertions fail;
     * drop the `!isBlocked(state)` guard in `wouldBlock` → the escape-hatch
     * assertion fails ALONE, which is the lock-up this check exists to catch.
     */
    const at = (debitur, sifat, jenis) => {
      S.state.debitur = debitur
      S.state.sifat = sifat
      S.state.jenis = jenis || 'N'
    }

    at('BU', 'P')
    const buThenK = S.wouldBlock('sifat', 'K')

    at('I', 'K')
    const kThenBU = S.wouldBlock('debitur', 'BU')

    buThenK && kThenBU
      ? pass('the Badan usaha + Konsumtif pill is refused from either direction')
      : fail(`blocked combo not refused: BU→Konsumtif=${buThenK} Konsumtif→BU=${kThenBU}`)

    /* 🔴 The regression this exists to catch: blocking the WRONG consumptive.
       Perorangan + Konsumtif is a real credit type the app offers. */
    at('I', 'P')
    const peroranganKeepsKonsumtif = !S.wouldBlock('sifat', 'K')

    at('BU', 'P')
    const badanUsahaKeepsProduktif = !S.wouldBlock('debitur', 'I') && !S.wouldBlock('jenis', 'R')

    peroranganKeepsKonsumtif && badanUsahaKeepsProduktif
      ? pass('Perorangan + Konsumtif stays selectable — only the company pair is refused')
      : fail(`over-blocking: peroranganKonsumtif=${peroranganKeepsKonsumtif} others=${badanUsahaKeepsProduktif}`)

    /* 🔴 The lock-up. From an already-blocked state no single pill escapes, so
       without the guard every pill in every group greys out at once and the
       only way back is clearing extension storage. */
    at('BU', 'K')
    const anyDisabled = ['jenis', 'debitur', 'sifat'].some(g => S.SCENARIO[g].some(o => S.wouldBlock(g, o.v)))

    !anyDisabled
      ? pass('an already-blocked state disables nothing, so the panel can be escaped')
      : fail('every pill is disabled from BU+K — the panel is locked; wouldBlock needs its !isBlocked(state) guard')

    /* A state persisted BEFORE the rule existed is the only way to arrive
       blocked. `load()` must normalise it rather than render it. */
    at('BU', 'K')
    const saved = { debitur: 'BU', sifat: 'K', jenis: 'N' }

    sandbox.chrome.storage.local.get = (k, cb) => cb({ simOptions: saved })

    const loaded = await S.load()

    sandbox.chrome.storage.local.get = (k, cb) => (cb ? cb({}) : null)

    !(loaded.debitur === 'BU' && loaded.sifat === 'K')
      ? pass('a persisted Badan usaha + Konsumtif is normalised on load')
      : fail('load() rendered the blocked combination it was handed — unblock() is not being called')

    at('BU', 'P')
  }

  {
    /**
     * 🔴 NO CLICK OR WRITE MAY RESOLVE AGAINST `document` AS A DIALOG
     * FALLBACK. `(dialog() || document)` reads as defensive and is the exact
     * opposite: it becomes reachable only when the modal has already closed,
     * which is precisely when acting on the page is wrong. Measured
     * 2026-08-20: the facility pass's document-fallback "Ya" clicked the
     * USE_REFERENCE toggle's own Ya segment on step 1 (B55) — a raw .click()
     * that never passed v2FillField, so the gate refusal could not log it.
     *
     * Zero instances is the contract. v2AddRows' in-form case never needs the
     * fallback (its select loop only runs once a dialog exists), and every
     * read-probe now answers false/[] when the dialog is gone.
     *
     * Sabotage, verified: reintroduce one `(dialog() || document)` → fails.
     */
    const raw = fs.readFileSync(path.join(dir, 'driver-v2.js'), 'utf8')
    const bare = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const fallbacks = (bare.match(/dialog\(\)\s*\|\|\s*document/g) || []).length

    fallbacks === 0
      ? pass('no dialog→document fallback anywhere in driver-v2.js')
      : fail(`${fallbacks}x (dialog() || document) — a closed modal makes that scope the PAGE, and a "Ya" there is the reference gate (B55)`)

    /**
     * 🔴 AN ACTION BUTTON IS NEVER A CHOOSER. A filled dropzone's visible
     * elements are buttons only (FileCardList's input is display:none and the
     * Kairos one unmounts), and "Unduh Semua" carries a DownloadIcon svg — so
     * the chevron heuristic called the group a SELECT and both the Scan
     * (peekOptions) and the Fill (trigger) CLICKED it, downloading the row's
     * files on every run ("Gagal download semua file", 2026-08-20, v1.0.71).
     *
     * Two layers asserted: the ACTION_BUTTON regex BEHAVES (eval'd, not
     * grepped — prose cannot satisfy it), and it is CONSULTED at all five
     * target-choice sites on comment-stripped source.
     *
     * Sabotage, verified each ALONE: drop 'Unduh' from either regex → the
     * behaviour assert fails; remove the filter from either classify copy,
     * the opener, the trigger, or the pills collection → its count fails.
     */
    const actionDecls = [...bare.matchAll(/const ACTION_BUTTON = \/(.+?)\/i/g)].map(m => m[1])

    actionDecls.length === 2 && actionDecls[0] === actionDecls[1]
      ? pass('ACTION_BUTTON declared in BOTH serialised functions, identically')
      : fail(`ACTION_BUTTON declarations: ${actionDecls.length}, identical: ${actionDecls[0] === actionDecls[1]} — v2Detect and v2FillField serialise separately; one copy is half a fix`)

    if (actionDecls.length) {
      const re = new RegExp(actionDecls[0], 'i')
      const hits = ['Unduh Semua', 'Download', 'Hapus 001 - Main Branch', 'Upload Dokumen', 'Tambah Fasilitas'].every(t => re.test(t))
      const spares = ['Ya', 'Tidak', 'Baru', 'Pilih Provinsi', 'Kredit Badan Usaha - Produktif'].every(t => !re.test(t))

      hits && spares
        ? pass('ACTION_BUTTON refuses action labels and spares real choosers')
        : fail('ACTION_BUTTON regex drifted — it must catch Unduh/Download/Hapus/Upload/Tambah and spare Ya/Tidak/pills/select triggers')
    }

    /**
     * 🔴 v1.0.74 widened the veto into `actionish`: an ICON-ONLY button has
     * empty textContent, so the text-keyed regex passed the file cards' Unduh
     * IconButton — and clicking it NAVIGATES (cross-origin GCS URL ignores
     * the download attribute), raising "Leave site?" over the half-filled
     * form. actionish refuses empty text AND vets aria-label/title.
     *
     * Sabotage, verified each ALONE: drop the `!t ||` empty-text refusal →
     * the helper assert fails; drop the aria-label veto → same; swap any of
     * the five sites back to a raw filter → its count fails.
     */
    const actionishDecls = (bare.match(/const actionish = b => \{/g) || []).length
    const emptyTextRefusals = (bare.match(/return !t \|\| ACTION_BUTTON\.test\(t\)/g) || []).length
    const labelVetoes = (bare.match(/\|\| ACTION_BUTTON\.test\(\(\(b\.getAttribute && \(b\.getAttribute\('aria-label'\) \|\| b\.getAttribute\('title'\)\)\) \|\| ''\)\.trim\(\)\)/g) || []).length

    actionishDecls === 2 && emptyTextRefusals === 2 && labelVetoes === 2
      ? pass('actionish declared in BOTH serialised functions: refuses empty text and vets aria-label/title')
      : fail(`actionish — decls: ${actionishDecls}/2, empty-text refusals: ${emptyTextRefusals}/2, label vetoes: ${labelVetoes}/2`)

    const classifyFilters = (bare.match(/els\.filter\(e => e\.tagName === 'BUTTON' && !actionish\(e\)\)/g) || []).length
    const openerFilter = (bare.match(/!isChipRemove\(e\) && !actionish\(e\)/g) || []).length
    const triggerFilter = (bare.match(/group\.els\.find\(e => e\.tagName === 'BUTTON' && !actionish\(e\)\)/g) || []).length

    classifyFilters === 3 && openerFilter === 1 && triggerFilter === 1
      ? pass('actionish consulted at all 5 target-choice sites (classify x2, opener, trigger, pills)')
      : fail(`actionish sites — classify+pills: ${classifyFilters}/3, opener: ${openerFilter}/1, trigger: ${triggerFilter}/1`)

    /**
     * 🔴 THE YEAR TRIGGER'S CLEARED STATE IS THE PLACEHOLDER, NOT '—'.
     * Changing the period type CLEARS the year (FinancialReportModal:199), so
     * the Full-1-Tahun path always arrives at a trigger reading "Pilih
     * Periode Tahun" — a hunt for '—'/a 4-digit year finds nothing and both
     * prior-year reports save-block (measured on the v1.0.71 live run:
     * saved 2/4, yearSet:false on both non-YTD rows). The YTD rows passed
     * for the WRONG reason: the year auto-defaults, so pickYear never
     * clicked at all.
     *
     * Sabotage, verified: drop the placeholder alternative from the trigger
     * find → fails.
     */
    const pickYearIdx = bare.indexOf('const pickYear')
    const pickYearSlice = pickYearIdx >= 0 ? bare.slice(pickYearIdx, pickYearIdx + 1200) : ''

    pickYearSlice.includes("t === 'Pilih Periode Tahun'")
      ? pass("pickYear accepts the CLEARED trigger state (placeholder), not just '—'/a year")
      : fail("pickYear's trigger hunt misses the cleared state — the Full-1-Tahun path arrives at the placeholder and both prior-year reports save-block")

    /**
     * 🔴 THE ROLL-UP MUST NOT CRASH THE RUN IT SUMMARISES.
     * v2AssignCollateralFacilities answers { assigned, remaining, results };
     * the per-link rows are .results. The roll-up filtered the OBJECT
     * (measured 2026-08-20: "facilityLinks.filter is not a function" at the
     * END of an otherwise-complete run, labelling the whole thing Failed).
     *
     * Sabotage, verified: filter facilityLinks directly again → fails.
     */
    const popupBare = fs.readFileSync(path.join(dir, 'popup.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const rollupIdx = popupBare.indexOf('if (facilityLinks !== null)')
    const rollupSlice = rollupIdx >= 0 ? popupBare.slice(rollupIdx, rollupIdx + 600) : ''

    rollupSlice.includes('Array.isArray(facilityLinks)') && !/facilityLinks\.filter/.test(rollupSlice)
      ? pass('the facilityLinks roll-up normalises the object shape before filtering')
      : fail('the roll-up filters facilityLinks directly — the { assigned, remaining, results } shape crashes the run at its final step')

    /* The file-input classification, asserted in BOTH classify copies — they
       are serialised separately, so fixing one alone ships half a fix.
       Sabotage, verified: remove either copy's file branch → fails. */
    const fileBranches = (bare.match(/if \(inp\.type === 'file'\) return 'file'/g) || []).length
    /* The branch must ATTACH (DataTransfer), never setNative — assigning
       .value on a file input is a DOMException, and skipping leaves a required
       dropzone counting 5/6 forever. */
    const fileIdx = bare.indexOf("if (type === 'file')")
    const fileBody = fileIdx < 0 ? '' : bare.slice(fileIdx, fileIdx + 1200)
    const fileAttaches = /new DataTransfer\(\)/.test(fileBody) && /el\.files = dt\.files/.test(fileBody)

    fileBranches === 2 && fileAttaches
      ? pass('file inputs classify as file in both copies, and the fill ATTACHES via DataTransfer')
      : fail(`file-input handling: classify branches=${fileBranches} (need 2), attaches=${fileAttaches}`)
  }

  {
    /**
     * 🔴 A BRANCH-DECIDING FIELD MUST NOT SUBSTITUTE.
     *
     * `fillPanel`'s `|| opts[0]` is correct for an ordinary select and wrong
     * where the choice picks a branch: asking for the unimplemented
     * "Kredit Badan Usaha - Konsumtif" matched nothing and silently selected
     * option 0 — "Kredit Perorangan - Konsumtif" — reporting ok. Verified live
     * 2026-08-20: the refusal answers `no_matching_option` and leaves the
     * trigger untouched, while "Kredit Badan Usaha - Produktif" still writes.
     *
     * 🔑 Asserted for the SELECT and the PILL branch separately — the pills
     * path has its own `|| buttons[0]` and fixing one does not fix the other.
     *
     * Sabotage, verified: restore either fallback → that half fails alone;
     * move BRANCH_SELECTS above v2FillField → the scope assertion fails.
     */
    const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const drv = strip(fs.readFileSync(path.join(dir, 'driver-v2.js'), 'utf8'))
    const start = drv.indexOf('async function v2FillField')
    const body = start < 0 ? '' : drv.slice(start)

    const declared = /const BRANCH_SELECTS\s*=/.test(body)

    declared
      ? pass('BRANCH_SELECTS is declared INSIDE v2FillField, so serialising it alone carries it')
      : fail('BRANCH_SELECTS must live inside v2FillField — executeScript sends one function at a time')

    const selectGuarded = /if \(exact && str && !match\)/.test(body)
    const pillGuarded = /if \(!match && str && BRANCH_SELECTS\.test/.test(body)

    selectGuarded
      ? pass('the select branch refuses to substitute on a branch field')
      : fail('fillPanel must refuse when `exact` and no option matches — silently picking opts[0] builds the wrong application')

    pillGuarded
      ? pass('the pill branch refuses to substitute on a branch field')
      : fail('the pills branch must refuse a non-matching label — `|| buttons[0]` silently selects pill #1')

    const covers = ['APPLICATION_DATA_CREDIT_TYPE', 'APPLICATION_DATA_APPLICATION_TYPE', 'GENERAL_DATA_DEBTOR_TYPE']
      .every(f => new RegExp(f).test(body))

    covers
      ? pass('all three form-deciding fields are covered')
      : fail('BRANCH_SELECTS must name credit type, application type and debtor type')
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
})()
