'use strict';
// Production boot checks: refuses to start without SESSION_SECRET when NODE_ENV=production
// or on Railway; starts with it; Secure cookies/HSTS/CSP; seed-demo.js refuses to run.
// Usage: node tests/prod-boot-test.js
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { APP_DIR, makeTempDir, freePort, reporter } = require('./lib');

const rep = reporter();
const { check } = rep;

async function boot(extraEnv) {
  const port = await freePort();
  const data = makeTempDir('ciq-prod-');
  const env = {
    ...process.env, NODE_ENV: 'production', PORT: String(port),
    DB_PATH: path.join(data, 'a.db'), SESSION_DB_PATH: path.join(data, 's.db'),
    UPLOADS_DIR: path.join(data, 'up'), PLATFORM_ADMIN_PASSWORD: 'prod-test-pw-123',
  };
  for (const k of ['SESSION_SECRET', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME']) delete env[k];
  for (const [k, v] of Object.entries(extraEnv)) { if (v === undefined) delete env[k]; else env[k] = v; }
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: APP_DIR, env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return new Promise((resolve) => {
    const done = (exited, code) => { clearInterval(poll); clearTimeout(t); resolve({ child, out, exited, code, port }); };
    const t = setTimeout(() => done(false), 8000);
    const poll = setInterval(() => { if (out.includes('running on')) done(false); }, 100);
    child.on('exit', (code) => done(true, code));
  });
}

(async () => {
  const a = await boot({ SESSION_SECRET: undefined });
  check('NODE_ENV=production without SESSION_SECRET refuses to start', a.exited && a.code !== 0 && /SESSION_SECRET must be set/.test(a.out), `exit ${a.code}`);

  const b = await boot({ SESSION_SECRET: 'x'.repeat(48) });
  check('NODE_ENV=production with SESSION_SECRET starts', !b.exited && /running on/.test(b.out));
  if (!b.exited) {
    const r = await fetch(`http://localhost:${b.port}/login`, { headers: { 'x-forwarded-proto': 'https' } });
    const sc = (r.headers.getSetCookie() || []).join(' ');
    check('production cookie is Secure + HttpOnly + SameSite=Lax (behind TLS proxy)', /Secure/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Lax/i.test(sc));
    check('production CSP includes upgrade-insecure-requests', (r.headers.get('content-security-policy') || '').includes('upgrade-insecure-requests'));
    check('HSTS header set', !!r.headers.get('strict-transport-security'));
    b.child.kill();
  }

  // Railway without NODE_ENV must still be treated as production.
  const c = await boot({ NODE_ENV: undefined, RAILWAY_ENVIRONMENT: 'production' });
  check('RAILWAY_ENVIRONMENT (no NODE_ENV) without SESSION_SECRET refuses to start', c.exited && c.code !== 0 && /SESSION_SECRET must be set/.test(c.out), `exit ${c.code}`);
  const e = await boot({ NODE_ENV: undefined, RAILWAY_ENVIRONMENT_NAME: 'production' });
  check('RAILWAY_ENVIRONMENT_NAME (no NODE_ENV) without SESSION_SECRET refuses to start', e.exited && e.code !== 0, `exit ${e.code}`);
  const d = await boot({ NODE_ENV: undefined, RAILWAY_ENVIRONMENT: 'production', SESSION_SECRET: 'y'.repeat(48) });
  check('RAILWAY_ENVIRONMENT with SESSION_SECRET starts', !d.exited && /running on/.test(d.out));
  if (!d.exited) {
    const r = await fetch(`http://localhost:${d.port}/login`, { headers: { 'x-forwarded-proto': 'https' } });
    check('Railway cookie is Secure', /Secure/.test((r.headers.getSetCookie() || []).join(' ')));
    d.child.kill();
  }

  // seed-demo.js must refuse to run in production / on Railway, and create nothing.
  for (const [label, extra] of [['NODE_ENV=production', { NODE_ENV: 'production' }], ['RAILWAY_ENVIRONMENT', { RAILWAY_ENVIRONMENT: 'production' }]]) {
    const tmp = makeTempDir('ciq-seed-');
    const s = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP_DIR, 'seed-demo.js')], { cwd: tmp, env: { ...process.env, ...extra }, encoding: 'utf8' });
    check(`seed-demo.js refuses with ${label}`, s.status === 1 && /refuses to run in production/.test(s.stderr) && !fs.existsSync(path.join(tmp, 'collisioniq.db')), `exit ${s.status}`);
  }

  console.log(rep.failures ? `\n${rep.failures} production boot check(s) FAILED` : '\nall production boot checks passed');
  process.exit(rep.failures ? 1 : 0);
})();
