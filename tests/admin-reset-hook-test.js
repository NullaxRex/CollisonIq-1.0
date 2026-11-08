'use strict';
// Tests the PLATFORM_ADMIN_PASSWORD_RESET boot hook in CollisonIq/server.js on
// throwaway databases: rejected values (too short, known default, line breaks,
// leading/trailing whitespace, unknown username) change nothing and boot continues;
// a valid value is applied at cost 12, logs the target username, signs out only
// platform_admin's sessions, warns about demo data, never prints the value, and is
// not re-applied on the next boot.
// Self-contained (no lib.js). Usage: node tests/admin-reset-hook-test.js
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const APP_DIR = path.resolve(__dirname, '..', 'CollisonIq');
const bcrypt = require(path.join(APP_DIR, 'node_modules', 'bcrypt'));

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciq-reset-'));
const dbPath = path.join(tmp, 'c.db');
const sessPath = path.join(tmp, 's.db');
const OLD_PW = 'initial-admin-pw-123';

// Boots server.js until it is listening (or exits), then stops it. Returns its output.
async function boot(reset, extraEnv = {}) {
  const env = {
    ...process.env, PORT: String(await freePort()),
    DB_PATH: dbPath, SESSION_DB_PATH: sessPath, UPLOADS_DIR: path.join(tmp, 'up'),
    PLATFORM_ADMIN_PASSWORD: OLD_PW,
  };
  for (const k of ['NODE_ENV', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'STRIPE_SECRET_KEY', 'SESSION_SECRET', 'PLATFORM_ADMIN_USERNAME', 'PLATFORM_ADMIN_PASSWORD_RESET']) delete env[k];
  if (reset !== undefined) env.PLATFORM_ADMIN_PASSWORD_RESET = reset;
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: APP_DIR, env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const started = await new Promise((resolve) => {
    const t = setTimeout(() => { clearInterval(poll); resolve(false); }, 20000);
    const poll = setInterval(() => { if (out.includes('running on')) { clearInterval(poll); clearTimeout(t); resolve(true); } }, 100);
    child.on('exit', () => { clearInterval(poll); clearTimeout(t); resolve(false); });
  });
  child.kill();
  await new Promise((r) => (child.exitCode !== null ? r() : child.on('exit', r)));
  return { started, out };
}

const adminHash = () => new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT password_hash h FROM users WHERE username='platform_admin'").get().h;
const sessionIds = () => new DatabaseSync(sessPath, { readOnly: true }).prepare('SELECT sid FROM sessions ORDER BY sid').all().map((r) => r.sid).join(',');
function addSessions() {
  const s = new DatabaseSync(sessPath);
  const adminId = new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT id FROM users WHERE username='platform_admin'").get().id;
  s.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run('admin', JSON.stringify({ user: { id: adminId } }), Date.now() + 1e7);
  s.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run('other', JSON.stringify({ user: { id: adminId + 1000 } }), Date.now() + 1e7);
  s.close();
}

(async () => {
  // First boot creates the schema and platform_admin from PLATFORM_ADMIN_PASSWORD.
  let r = await boot(undefined);
  check('baseline boot without reset var', r.started && !/password reset/.test(r.out));
  const original = adminHash();
  check('baseline admin has initial password', await bcrypt.compare(OLD_PW, original));
  {
    const d = new DatabaseSync(dbPath);
    const shopId = d.prepare("INSERT INTO shops (name) VALUES ('Metro Collision Center')").run().lastInsertRowid;
    d.prepare("INSERT INTO users (shop_id, username, password_hash, role) VALUES (?, 'metro_admin', ?, 'shop_admin')").run(shopId, original);
    d.close();
  }
  addSessions();

  // Rejected values: boot continues, nothing changes, value never printed.
  // The whitespace cases are long enough to pass every other rule once trimmed.
  const CORE = 'Whitespace-Test-Password-7q';
  for (const [label, value, reason] of [
    ['11-character value', 'short-pw-11', /shorter than 12/],
    ['known default (localadmin123)', 'localadmin123', /known default/],
    ['known default (changeme123)', 'changeme123', /shorter than 12|known default/],
    ['trailing newline', CORE + '\n', /value contains a line break\./],
    ['trailing CRLF', CORE + '\r\n', /value contains a line break\./],
    ['line break inside', 'Whitespace-Test\nPassword-7q', /value contains a line break\./],
    ['trailing space', CORE + ' ', /value has leading or trailing whitespace\./],
    ['leading space', ' ' + CORE, /value has leading or trailing whitespace\./],
    ['trailing tab', CORE + '\t', /value has leading or trailing whitespace\./],
  ]) {
    r = await boot(value);
    check(`${label} → boots, logs reason, changes nothing`,
      r.started && reason.test(r.out) && !/reset applied/.test(r.out) && adminHash() === original && sessionIds() === 'admin,other',
      r.out.split('\n').find((l) => /password reset/.test(l)) || '');
    check(`${label} → value not printed`, !r.out.includes(value) && !r.out.includes(value.trim()) && !r.out.includes(CORE));
  }

  // Valid value aimed at a username that does not exist: skipped, and the username is named.
  r = await boot('Wrong-User-Test-Password-4k', { PLATFORM_ADMIN_USERNAME: 'no_such_admin' });
  check('unknown PLATFORM_ADMIN_USERNAME → skipped, log names that username',
    r.started && /^platform_admin password reset skipped: no platform_admin user with username "no_such_admin"\.$/m.test(r.out)
      && adminHash() === original && sessionIds() === 'admin,other');
  check('unknown username → value not printed', !r.out.includes('Wrong-User-Test-Password-4k'));

  // Valid value.
  const NEW_PW = 'Boot-Hook-Test-Password-9z';
  r = await boot(NEW_PW);
  check('valid value → boots and logs the target username', r.started && /^platform_admin password reset applied to username "platform_admin"$/m.test(r.out));
  const h = adminHash();
  check('new password verifies', await bcrypt.compare(NEW_PW, h));
  check('old password no longer verifies', !(await bcrypt.compare(OLD_PW, h)));
  check('stored at cost 12', h.startsWith('$2b$12$'));
  check("platform_admin's sessions signed out, others kept", sessionIds() === 'other');
  check('warns about demo seed data', /WARNING: demo seed data present.*metro_admin.*Metro Collision Center/s.test(r.out));
  check('output contains no password and no hash', !r.out.includes(NEW_PW) && !/\$2[aby]\$/.test(r.out));
  check('other users untouched', new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT password_hash h FROM users WHERE username='metro_admin'").get().h === original);

  // Variable left set on the next boot: not re-applied, sessions not signed out again.
  addSessions();
  r = await boot(NEW_PW);
  check('next boot with same value → not re-applied', r.started && /already applied to username "platform_admin"/.test(r.out) && !/reset applied to/.test(r.out) && adminHash() === h && sessionIds() === 'admin,other');
  check('next boot → value not printed', !r.out.includes(NEW_PW));

  console.log(failures ? `\n${failures} reset-hook check(s) FAILED` : '\nall reset-hook checks passed');
  process.exit(failures ? 1 : 0);
})();
