'use strict';
// Runs every test suite with the Node that runs this file and prints a summary.
// Usage: node tests/run-all.js        (see tests/README.md for Node 22 / 26)
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['smoke + security (live server)', 'run-suite.js'],
  ['production boot', 'prod-boot-test.js'],
  ['boot migrations', 'migration-test.js'],
  ['bcrypt compatibility', 'bcrypt-compat-test.js'],
  ['platform_admin password script', 'password-script-test.js'],
  ['platform_admin reset hook', 'admin-reset-hook-test.js'],
  ['login failure diagnostics', 'login-diagnostics-test.js'],
];

console.log(`Node ${process.version}`);
const summary = [];
for (const [label, file] of SUITES) {
  console.log(`\n=== ${label} (${file})`);
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  const passed = (out.match(/^PASS /gm) || []).length;
  const failed = (out.match(/^FAIL /gm) || []).length;
  summary.push({ label, ok: r.status === 0, passed, failed });
}

console.log(`\n=== Summary (Node ${process.version})`);
for (const s of summary) console.log(`${s.ok ? 'OK  ' : 'FAIL'}  ${String(s.passed).padStart(3)}/${String(s.passed + s.failed).padEnd(3)}  ${s.label}`);
const allOk = summary.every((s) => s.ok);
console.log(allOk ? '\nALL SUITES PASSED' : '\nSOME SUITES FAILED');
process.exit(allOk ? 0 : 1);
