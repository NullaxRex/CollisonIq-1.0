'use strict';
/**
 * One-off: set a new password for the platform_admin account and sign out its
 * existing sessions. There is no in-app way to do this.
 *
 * Reads the new password from NEW_PLATFORM_ADMIN_PASSWORD (never from argv, so it
 * doesn't land in shell history or process listings). Uses the same DB_PATH /
 * SESSION_DB_PATH as server.js.
 *
 *   Railway:  railway run --service <service> node scripts/set-platform-admin-password.js
 *             with NEW_PLATFORM_ADMIN_PASSWORD set in the shell first.
 *   Note: `railway run` executes on YOUR machine with the service's variables. If DB_PATH
 *   points at a Railway volume (e.g. /data/...), run it inside the service instead:
 *             railway ssh  →  cd to the app dir  →  NEW_PLATFORM_ADMIN_PASSWORD=... node scripts/set-platform-admin-password.js
 *
 * Optional: PLATFORM_ADMIN_USERNAME (default "platform_admin").
 * Also reports (read-only) whether any demo-seed accounts exist in this database.
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { DatabaseSync } = require('node:sqlite');

const BCRYPT_ROUNDS = 12; // same cost as server.js
const appDir = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(appDir, 'collisioniq.db');
const sessionDbPath = process.env.SESSION_DB_PATH || path.join(appDir, 'sessions.db');
const username = process.env.PLATFORM_ADMIN_USERNAME || 'platform_admin';
const password = process.env.NEW_PLATFORM_ADMIN_PASSWORD || '';

function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

if (password.length < 12) fail('Set NEW_PLATFORM_ADMIN_PASSWORD to a password of at least 12 characters.');
if (['changeme123', 'demo1234', 'localadmin123'].includes(password)) fail('That password is a known default. Choose a new one.');
if (!fs.existsSync(dbPath)) fail(`Database not found at ${dbPath}. Set DB_PATH to the production database.`);

(async () => {
  const db = new DatabaseSync(dbPath);
  const user = db.prepare("SELECT id, username, role, active FROM users WHERE username=? AND role='platform_admin'").get(username);
  if (!user) fail(`No platform_admin user named "${username}" in ${dbPath}.`);

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
  if (r.changes !== 1) fail('Password update did not apply.');
  if (!(await bcrypt.compare(password, db.prepare('SELECT password_hash h FROM users WHERE id=?').get(user.id).h))) {
    fail('Verification of the new hash failed.');
  }
  console.log(`Password updated for "${user.username}" (user id ${user.id}) in ${dbPath}.`);
  if (!user.active) console.log('Note: this account is marked inactive, so it still cannot sign in.');

  // Sign out existing sessions for this user (the session row stores the user id).
  if (fs.existsSync(sessionDbPath)) {
    const sdb = new DatabaseSync(sessionDbPath);
    const hasTable = sdb.prepare("SELECT 1 FROM sqlite_master WHERE name='sessions'").get();
    const gone = hasTable ? sdb.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.user.id') = ?").run(user.id).changes : 0;
    console.log(`Signed out ${gone} existing session(s).`);
  } else {
    console.log(`No session database at ${sessionDbPath}; nothing to sign out.`);
  }

  // Read-only check: demo accounts must never exist in production.
  const demo = db.prepare(`SELECT username FROM users WHERE username IN
    ('metro_admin','metro_qc','metro_tech1','metro_tech2','metro_writer','north_admin','north_qc','north_tech1','north_writer',
     'south_admin','south_qc','south_tech1','south_writer','premier_admin','premier_qc','premier_tech1','premier_tech2','premier_writer',
     'gulf_admin','gulf_qc','gulf_tech1','gulf_writer')`).all().map((x) => x.username);
  const demoShops = db.prepare(`SELECT name FROM shops WHERE name IN ('Metro Collision Center','Northside Auto Repair',
    'Southbelt Body Works','Premier ADAS & Collision','Gulf Coast Auto Service')`).all().map((x) => x.name);
  if (demo.length || demoShops.length) {
    console.log(`WARNING: demo seed data present. Accounts: ${demo.join(', ') || 'none'}. Shops: ${demoShops.join(', ') || 'none'}.`);
    console.log('         These share a publicly known demo password. Deactivate or remove them.');
  } else {
    console.log('No demo seed accounts or shops found.');
  }
})().catch((e) => fail(e.message));
