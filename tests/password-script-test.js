'use strict';
// Tests CollisonIq/scripts/set-platform-admin-password.js against a throwaway
// database: input validation, the update itself, session sign-out, the demo-account
// report, and that nothing secret is printed.
// Usage: node tests/password-script-test.js
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { APP_DIR, makeTempDir, reporter } = require('./lib');

const bcrypt = require(path.join(APP_DIR, 'node_modules', 'bcrypt'));
const SCRIPT = path.join(APP_DIR, 'scripts', 'set-platform-admin-password.js');
const rep = reporter();
const { check } = rep;

(async () => {
  const tmp = makeTempDir('ciq-pw-');
  const dbPath = path.join(tmp, 'c.db');
  const sessPath = path.join(tmp, 's.db');
  const oldHash = await bcrypt.hash('old-password-123', 4);
  {
    const d = new DatabaseSync(dbPath);
    d.exec(`CREATE TABLE shops (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER, username TEXT UNIQUE, password_hash TEXT, role TEXT, active INTEGER DEFAULT 1);`);
    d.prepare("INSERT INTO users (username, password_hash, role) VALUES ('platform_admin', ?, 'platform_admin')").run(oldHash);
    d.prepare("INSERT INTO shops (id, name) VALUES (1, 'Metro Collision Center')").run();
    d.prepare("INSERT INTO users (shop_id, username, password_hash, role) VALUES (1, 'metro_admin', ?, 'shop_admin')").run(oldHash);
    d.close();
    const s = new DatabaseSync(sessPath);
    s.exec('CREATE TABLE sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER)');
    s.prepare('INSERT INTO sessions VALUES (?,?,?)').run('a', JSON.stringify({ user: { id: 1 } }), Date.now() + 1e6);
    s.prepare('INSERT INTO sessions VALUES (?,?,?)').run('b', JSON.stringify({ user: { id: 2 } }), Date.now() + 1e6);
    s.close();
  }
  const run = (pw) => {
    const env = { ...process.env, DB_PATH: dbPath, SESSION_DB_PATH: sessPath };
    if (pw === undefined) delete env.NEW_PLATFORM_ADMIN_PASSWORD; else env.NEW_PLATFORM_ADMIN_PASSWORD = pw;
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT], { env, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const hashNow = () => new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT password_hash h FROM users WHERE username='platform_admin'").get().h;

  let r = run(undefined);
  check('no env var → refuses', r.status === 1 && hashNow() === oldHash);
  r = run('short-pw-11');
  check('11-character password → refuses', r.status === 1 && /at least 12/.test(r.out) && hashNow() === oldHash);
  r = run('localadmin123');
  check('known default password → refuses', r.status === 1 && /known default/.test(r.out) && hashNow() === oldHash);

  const NEW_PW = 'Scratch-Test-Password-7q';
  r = run(NEW_PW);
  check('valid password → exit 0', r.status === 0, r.out.trim().split('\n')[0]);
  const h = hashNow();
  check('new password verifies', await bcrypt.compare(NEW_PW, h));
  check('old password no longer verifies', !(await bcrypt.compare('old-password-123', h)));
  check('stored at cost 12', h.startsWith('$2b$12$'));
  check("platform_admin's sessions signed out, others kept", (() => {
    const s = new DatabaseSync(sessPath, { readOnly: true });
    return !s.prepare("SELECT 1 FROM sessions WHERE sid='a'").get() && !!s.prepare("SELECT 1 FROM sessions WHERE sid='b'").get();
  })());
  check('reports demo accounts that exist', /WARNING: demo seed data present.*metro_admin/s.test(r.out));
  check('output contains no password and no hash', !r.out.includes(NEW_PW) && !/\$2[aby]\$/.test(r.out) && !r.out.includes('demo1234'));
  check('other users untouched', new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT password_hash h FROM users WHERE username='metro_admin'").get().h === oldHash);

  console.log(rep.failures ? `\n${rep.failures} password-script check(s) FAILED` : '\nall password-script checks passed');
  process.exit(rep.failures ? 1 : 0);
})();
