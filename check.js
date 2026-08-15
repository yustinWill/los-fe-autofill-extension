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

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
})()
