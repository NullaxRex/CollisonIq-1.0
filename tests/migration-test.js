'use strict';
// Boot-migration checks. Boots server.js twice each against:
//  (a) a database whose job_photos.shop_id is NOT NULL (needs the one-time rebuild)
//  (b) a v1-schema database (jobs table without shop_id etc.; needs ADD COLUMN only)
// and checks schema, idempotency, and that no rows or values change.
// Also (c): the one-time technician assignment link for older jobs.
// Usage: node tests/migration-test.js
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { APP_DIR, makeTempDir, reporter } = require('./lib');

const rep = reporter();
const { check } = rep;
const tmp = makeTempDir('ciq-mig-');

function boot(dbPath, label) {
  const script = `require(${JSON.stringify(path.join(APP_DIR, 'server.js'))}); setTimeout(() => process.exit(0), 1200);`;
  const env = { ...process.env, PORT: '0', DB_PATH: dbPath, SESSION_DB_PATH: dbPath + '.sessions', UPLOADS_DIR: path.join(tmp, 'up'), PLATFORM_ADMIN_PASSWORD: 'migration-test-pw' };
  for (const k of ['NODE_ENV', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME']) delete env[k];
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script], { cwd: APP_DIR, encoding: 'utf8', timeout: 30000, env });
  const out = (r.stdout || '') + (r.stderr || '');
  check(`${label}: boot exits cleanly`, r.status === 0, r.status === 0 ? '' : out.split('\n').slice(-5).join(' | '));
  return out;
}

// (a) job_photos with NOT NULL shop_id and existing rows
const a = path.join(tmp, 'notnull.db');
{
  const d = new DatabaseSync(a);
  d.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, jobId TEXT UNIQUE, shop_id INTEGER);
          CREATE TABLE job_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, layer INTEGER, key TEXT, display TEXT, shop_id INTEGER NOT NULL);
          INSERT INTO jobs (jobId, shop_id) VALUES ('CIQ-1', 1);
          INSERT INTO job_photos (job_id, layer, key, display, shop_id) VALUES ('CIQ-1', 1, 'K1', 'D1', 1), ('CIQ-1', 2, 'K2', 'D2', 1);`);
  d.close();
}
const out1 = boot(a, 'NOT NULL db, boot #1');
check('NOT NULL db, boot #1 ran the rebuild', /rebuilding table/.test(out1));
const out2 = boot(a, 'NOT NULL db, boot #2');
check('NOT NULL db, boot #2 skipped the rebuild', !/rebuilding table/.test(out2));
{
  const d = new DatabaseSync(a, { readOnly: true });
  const col = d.prepare('PRAGMA table_info(job_photos)').all().find((c) => c.name === 'shop_id');
  check('job_photos.shop_id is nullable', col && col.notnull === 0);
  check('job_photos rows preserved', d.prepare('SELECT COUNT(*) c FROM job_photos').get().c === 2);
  check('no job_photos_old left behind', !d.prepare("SELECT 1 FROM sqlite_master WHERE name='job_photos_old'").get());
  check('exactly one platform_admin', d.prepare("SELECT COUNT(*) c FROM users WHERE role='platform_admin'").get().c === 1);
  d.close();
}

// (b) v1 schema: the jobs table as the original v1 app created it (no shop_id,
// created_by, track, collision_grade, last_changed, ...), with a few rows.
const b = path.join(tmp, 'legacy-v1.db');
{
  const d = new DatabaseSync(b);
  d.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, jobId TEXT UNIQUE, ro TEXT, vin TEXT, year TEXT, make TEXT, model TEXT, trim TEXT,
    technicianName TEXT, repairsPerformed TEXT, adasSystems TEXT, rationale TEXT, liabilityWarning TEXT, makeSpecificNotes TEXT,
    status TEXT DEFAULT 'Created', shareToken TEXT, shareUrl TEXT, createdAt TEXT, updatedAt TEXT,
    preScanRequired TEXT, postScanRequired TEXT, approvedScanTool TEXT)`);
  const ins = d.prepare('INSERT INTO jobs (jobId, ro, vin, year, make, model, technicianName, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run('CIQ-20260323-1001', 'RO-TEST-001', '1HGCM82633A004352', '2003', 'Honda', 'Accord', 'Test Tech', 'Created', '2026-03-23T05:36:56.806Z');
  ins.run('CIQ-20260323-1002', 'RO-TEST-002', '', '2022', 'Toyota', 'Camry', 'Test Tech', 'Created', '2026-03-23T06:00:00.000Z');
  ins.run('CIQ-20260324-1003', 'RO-TEST-003', '5YJ3E1EA0PF000001', '2023', 'Tesla', 'Model 3', 'Test Tech', 'Created', '2026-03-24T23:50:36.686Z');
  d.close();
}
{
  const pre = new DatabaseSync(b, { readOnly: true });
  const before = pre.prepare('SELECT * FROM jobs ORDER BY id').all();
  const beforeTableSql = pre.prepare("SELECT sql FROM sqlite_master WHERE name='jobs'").get().sql;
  pre.close();
  const l1 = boot(b, 'v1 db, boot #1');
  check('v1 boot #1 added the missing jobs columns', /added missing column\(s\) .*shop_id/.test(l1), (l1.match(/added missing column\(s\) [^\n]*/) || [''])[0]);
  const l2 = boot(b, 'v1 db, boot #2');
  check('v1 boot #2 adds nothing (idempotent)', !/added missing column/.test(l2));
  const d = new DatabaseSync(b);
  const cols = d.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  const after = d.prepare('SELECT * FROM jobs ORDER BY id').all();
  check('v1 jobs rows preserved', after.length === before.length, `${before.length} rows`);
  check('v1 row values unchanged in original columns', before.every((row, i) => Object.keys(row).every((k) => after[i][k] === row[k])));
  check('v1 jobs now has shop_id, created_by, track, collision_grade, last_changed', ['shop_id', 'created_by', 'track', 'collision_grade', 'last_changed'].every((c) => cols.includes(c)));
  check('v1 jobs gained mileage, photo_status, impact_areas', ['mileage', 'photo_status', 'impact_areas'].every((c) => cols.includes(c)));
  check('jobs altered in place, not rebuilt (original DDL kept as prefix)', d.prepare("SELECT sql FROM sqlite_master WHERE name='jobs'").get().sql.startsWith(beforeTableSql.replace(/\)\s*$/, '')));
  check('shops/users tables created', !!d.prepare("SELECT 1 FROM sqlite_master WHERE name='users'").get());
  d.prepare("INSERT INTO jobs (jobId, ro, shop_id, created_by, last_changed) VALUES ('CIQ-MIG-1','RO-M',1,1,'2026-01-01')").run();
  check('job insert with shop_id works on migrated v1 db', !!d.prepare("SELECT 1 FROM jobs WHERE jobId='CIQ-MIG-1' AND shop_id=1").get());
  d.close();
}

// (c) Technician assignment link (Nov 2026): jobs saved before assignments
// existed are linked to a technician account when the typed name matches
// exactly one active technician in the job's shop.
const c = path.join(tmp, 'assign.db');
boot(c, 'assign db, first boot');
{
  const d = new DatabaseSync(c);
  d.exec(`INSERT INTO shops (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, shop_id, username, password_hash, role, full_name, active) VALUES
      (10, 1, 'a_tech', 'x', 'technician', 'Tech One', 1),
      (11, 1, 'a_tech2', 'x', 'technician', 'Same Name', 1),
      (12, 1, 'a_tech3', 'x', 'technician', 'Same Name', 1),
      (13, 2, 'b_tech', 'x', 'technician', 'Other Shop', 1),
      (14, 1, 'a_old', 'x', 'technician', 'Gone Tech', 0);
    INSERT INTO jobs (jobId, shop_id, technicianName) VALUES ('J1', 1, 'tech one'), ('J2', 1, 'Same Name'), ('J3', 1, 'Other Shop'),
      ('J4', 1, 'Gone Tech'), ('J5', 1, 'a_tech'), ('J6', 1, '');`);
  d.close();
}
const l3 = boot(c, 'assign db, link boot');
const l4 = boot(c, 'assign db, repeat boot');
{
  const d = new DatabaseSync(c, { readOnly: true });
  const links = d.prepare('SELECT job_id, user_id FROM job_assignments ORDER BY job_id').all().map((x) => `${x.job_id}:${x.user_id}`).join(',');
  check('jobs linked by exact name or username, case-insensitive, same shop, active only, unambiguous only', links === 'J1:10,J5:10', links);
  check('link boot reports what it linked; repeat boot links nothing', /Linked 2 existing job/.test(l3) && !/Linked/.test(l4));
  d.close();
}

console.log(rep.failures ? `\n${rep.failures} migration check(s) FAILED` : '\nall migration checks passed');
process.exit(rep.failures ? 1 : 0);
