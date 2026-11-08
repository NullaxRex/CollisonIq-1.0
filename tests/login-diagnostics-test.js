'use strict';
// Reproduces the production reset-then-login flow and checks the diagnostics:
// boots with NODE_ENV=production + PLATFORM_ADMIN_PASSWORD_RESET behind a TLS proxy
// (X-Forwarded-Proto: https), signs in with the new password, restarts with the
// variable still set ("already applied") and signs in again. Also checks the boot
// diagnostic line and that every POST /login failure logs its reason and the
// username, and that no password or hash is ever printed.
// Self-contained (no lib.js). Usage: node tests/login-diagnostics-test.js
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciq-login-'));
const dbPath = path.join(tmp, 'c.db');
const OLD_PW = 'initial-admin-pw-123';
const NEW_PW = 'Login-Diag-Test-Password-5x';
const INACTIVE_PW = 'Inactive-User-Password-8m';
const SECRETS = [OLD_PW, NEW_PW, INACTIVE_PW];

// Starts server.js in production mode and resolves once it is listening.
async function start(reset) {
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(48), PORT: String(port),
    DB_PATH: dbPath, SESSION_DB_PATH: path.join(tmp, 's.db'), UPLOADS_DIR: path.join(tmp, 'up'),
    PLATFORM_ADMIN_PASSWORD: OLD_PW,
  };
  for (const k of ['RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'STRIPE_SECRET_KEY', 'PLATFORM_ADMIN_USERNAME', 'PLATFORM_ADMIN_PASSWORD_RESET']) delete env[k];
  if (reset !== undefined) env.PLATFORM_ADMIN_PASSWORD_RESET = reset;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: APP_DIR, env });
  const srv = { child, port, out: '' };
  child.stdout.on('data', (d) => (srv.out += d));
  child.stderr.on('data', (d) => (srv.out += d));
  srv.started = await new Promise((resolve) => {
    const t = setTimeout(() => { clearInterval(poll); resolve(false); }, 20000);
    const poll = setInterval(() => { if (srv.out.includes('running on')) { clearInterval(poll); clearTimeout(t); resolve(true); } }, 100);
    child.on('exit', () => { clearInterval(poll); clearTimeout(t); resolve(false); });
  });
  return srv;
}
async function stop(srv) {
  srv.child.kill();
  await new Promise((r) => (srv.child.exitCode !== null ? r() : srv.child.on('exit', r)));
}
const settle = () => new Promise((r) => setTimeout(r, 150));

// Fresh browser: GET /login for a session cookie + CSRF token, then POST the form.
const HTTPS = { 'x-forwarded-proto': 'https' };
async function login(srv, username, password) {
  const base = `http://localhost:${srv.port}`;
  const page = await fetch(`${base}/login`, { headers: HTTPS });
  const cookie = (page.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const csrf = ((await page.text()).match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
  const r = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { ...HTTPS, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username, password }).toString(),
  });
  const setCookie = (r.headers.getSetCookie() || []).join(' ');
  const newCookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ') || cookie;
  await settle();
  return { status: r.status, location: r.headers.get('location'), setCookie, cookie: newCookie, base, body: r.status === 429 ? await r.text() : '' };
}
const noSecrets = (out) => SECRETS.every((s) => !out.includes(s)) && !/\$2[aby]\$/.test(out);

(async () => {
  // Boot 1: reset variable set on a fresh database.
  let srv = await start(NEW_PW);
  check('production boot with reset var starts', srv.started, srv.started ? '' : srv.out.slice(-300));
  check('boot diagnostic: username, active, shop_id, compare false before apply',
    /^platform_admin reset diagnostic: username="platform_admin" active=1 shop_id=null env_matches_stored_hash=false$/m.test(srv.out),
    srv.out.split('\n').find((l) => /diagnostic/.test(l)) || 'no diagnostic line');
  check('boot 1 applies the reset', /^platform_admin password reset applied to username "platform_admin"$/m.test(srv.out));

  // Successful sign-in with the new password, then the session works.
  let r = await login(srv, 'platform_admin', NEW_PW);
  check('login with new password → 302 to /', r.status === 302 && r.location === '/', `${r.status} ${r.location}`);
  check('login sets a Secure session cookie', /Secure/.test(r.setCookie) && /HttpOnly/.test(r.setCookie));
  let home = await fetch(`${r.base}/`, { headers: { ...HTTPS, cookie: r.cookie }, redirect: 'manual' });
  check('signed-in session loads / (200, not bounced to /login)', home.status === 200, `${home.status} ${home.headers.get('location') || ''}`);
  check('successful login logs no failure', !/login failed/.test(srv.out));

  // Each failure category.
  {
    const d = new DatabaseSync(dbPath);
    d.prepare("INSERT INTO users (shop_id, username, password_hash, role, active) VALUES (NULL, 'inactive_user', ?, 'technician', 0)").run(await bcrypt.hash(INACTIVE_PW, 4));
    d.close();
  }
  for (const [label, user, pw, re] of [
    ['old password', 'platform_admin', OLD_PW, /^login failed: reason=bad_password username="platform_admin"$/m],
    ['unknown username', 'nobody_here', NEW_PW, /^login failed: reason=unknown_user username="nobody_here"$/m],
    ['wrong-case username', 'Platform_Admin', NEW_PW, /^login failed: reason=unknown_user username="Platform_Admin"$/m],
    ['inactive user, right password', 'inactive_user', INACTIVE_PW, /^login failed: reason=inactive username="inactive_user"$/m],
    ['empty password', 'platform_admin', '', /^login failed: reason=other username="platform_admin"$/m],
  ]) {
    const before = srv.out.length;
    r = await login(srv, user, pw);
    const logged = srv.out.slice(before);
    check(`${label} → redirect to /login?error=1 and logs reason`, r.status === 302 && r.location === '/login?error=1' && re.test(logged), logged.trim().split('\n').pop() || `${r.status} ${r.location}`);
  }
  check('username with spaces is logged trimmed and quoted', await (async () => {
    const before = srv.out.length;
    await login(srv, '  nobody_here  ', 'x');
    return /^login failed: reason=unknown_user username="nobody_here"$/m.test(srv.out.slice(before));
  })());

  // Per-username lockout after 10 failures: 429 and locked_out is logged.
  for (let i = 0; i < 10; i++) await login(srv, 'lock_target', 'wrong-password-' + i);
  {
    const before = srv.out.length;
    r = await login(srv, 'lock_target', 'wrong-password-x');
    const logged = srv.out.slice(before);
    check('11th failure for one username → 429 with lockout message', r.status === 429 && /Too many failed sign-in attempts for this account/.test(r.body), String(r.status));
    check('lockout logs reason=locked_out (username)', /^login failed: reason=locked_out \(username\) username="lock_target"$/m.test(logged), logged.trim());
  }
  check('boot 1 output contains no password and no hash', noSecrets(srv.out));
  await stop(srv);

  // Boot 2: variable still set (the production situation). Not re-applied, login still works.
  srv = await start(NEW_PW);
  check('restart with reset var still set starts', srv.started);
  check('boot 2 diagnostic: compare true',
    /^platform_admin reset diagnostic: username="platform_admin" active=1 shop_id=null env_matches_stored_hash=true$/m.test(srv.out));
  check('boot 2 says already applied', /already applied to username "platform_admin"/.test(srv.out) && !/reset applied to/.test(srv.out));
  r = await login(srv, 'platform_admin', NEW_PW);
  check('after "already applied", login with the same password → 302 to /', r.status === 302 && r.location === '/', `${r.status} ${r.location}`);
  home = await fetch(`${r.base}/`, { headers: { ...HTTPS, cookie: r.cookie }, redirect: 'manual' });
  check('and / loads (200)', home.status === 200, String(home.status));
  check('boot 2 output contains no password and no hash', noSecrets(srv.out));
  await stop(srv);

  // Boot 3: admin deactivated. Diagnostic shows active=0 and login logs inactive.
  { const d = new DatabaseSync(dbPath); d.prepare("UPDATE users SET active=0 WHERE username='platform_admin'").run(); d.close(); }
  srv = await start(NEW_PW);
  check('boot 3 diagnostic shows active=0', /reset diagnostic: username="platform_admin" active=0 shop_id=null env_matches_stored_hash=true$/m.test(srv.out));
  r = await login(srv, 'platform_admin', NEW_PW);
  check('inactive platform_admin → error redirect, logs reason=inactive', r.location === '/login?error=1' && /^login failed: reason=inactive username="platform_admin"$/m.test(srv.out));
  check('boot 3 output contains no password and no hash', noSecrets(srv.out));
  await stop(srv);

  // No reset var → no diagnostic line.
  srv = await start(undefined);
  check('without reset var → no diagnostic line', srv.started && !/reset diagnostic/.test(srv.out));
  await stop(srv);

  console.log(failures ? `\n${failures} login diagnostics check(s) FAILED` : '\nall login diagnostics checks passed');
  process.exit(failures ? 1 : 0);
})();
