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
const stubEl = () => ({
  style: { cssText: '' },
  classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
  children: [],
  value: '',
  textContent: '',
  className: '',
  disabled: false,
  checked: false,
  appendChild(k) { this.children.push(k); return k },
  setAttribute() {},
  getAttribute: () => null,
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  closest: () => null,
  focus() {},
  click() {},
  remove() {}
})

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

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
