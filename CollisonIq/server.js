'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const fs         = require('fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const bcrypt     = require('bcrypt');
const session    = require('express-session');
const multer     = require('multer');
const { DatabaseSync } = require('node:sqlite');
const Stripe     = require('stripe');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { csrfField, verifyCsrf, csrfTokenValid } = require('./utils/csrf');
const { generatePhotoLabels, ZONE_DISPLAY } = require('./utils/photoLabels');
const { calculatePhotoStatus, updateJobPhotoStatus } = require('./utils/photoStatus');
const oemRules   = require('./utils/oemCalibrationRules'); // loads ./utils/oemSourceRegister
const jobRepairs = require('./utils/jobRepairs');
const jobReport  = require('./utils/jobReport');
const calRecord  = require('./utils/calibrationRecord');

const app  = express();
const PORT = process.env.PORT || 3000;
// Production = NODE_ENV=production, or running on Railway (which sets
// RAILWAY_ENVIRONMENT / RAILWAY_ENVIRONMENT_NAME) even if NODE_ENV was never set.
const IS_PROD = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);

// Per-request context so layout() can render the CSRF-protected logout form
// without every route having to pass req through.
const requestContext = new AsyncLocalStorage();

// ─── Cost factor for password hashing (consistent everywhere) ──────────────────
const BCRYPT_ROUNDS = 12;

// ─── Request helpers ──────────────────────────────────────────────────────────
// The urlencoded parser turns `a[]=1` / `a[b]=1` into arrays/objects. Every field
// a handler reads goes through str()/strList() so a crafted body can never reach
// bcrypt or a SQL bind as a non-string (which throws).
function str(v, max = 500) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function strList(v, max = 200) {
  const list = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
  return list.filter(x => typeof x === 'string').map(x => x.trim().slice(0, max)).filter(Boolean);
}
// Express 4 does not catch rejected promises: without this, any throw inside an
// async handler is an unhandled rejection, which terminates the Node process.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Public base URL for Stripe redirects, never with a trailing slash.
function baseUrl(req) { return (process.env.APP_BASE_URL || `https://${req.get('host')}`).replace(/\/+$/, ''); }

// ─── Stripe ───────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' });
// Subscription price for self-serve signup. Falls back to the original live price.
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1TZBLcQx0YVznfDrJelvhtP4';

// ─── Database ─────────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'collisioniq.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT, state TEXT, address TEXT, phone TEXT,
    stripe_customer_id TEXT, stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'inactive',
    subscription_current_period_end INTEGER,
    grace_period_end INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    full_name TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId TEXT UNIQUE,
    ro TEXT, vin TEXT, year TEXT, make TEXT, model TEXT, trim TEXT,
    technicianName TEXT, repairsPerformed TEXT,
    adasSystems TEXT, rationale TEXT, liabilityWarning TEXT, makeSpecificNotes TEXT,
    preScanRequired TEXT, postScanRequired TEXT, approvedScanTool TEXT,
    status TEXT DEFAULT 'Created',
    track TEXT DEFAULT 'post-collision',
    collision_grade TEXT,
    shareToken TEXT, shareUrl TEXT,
    shop_id INTEGER, created_by INTEGER,
    createdAt TEXT, updatedAt TEXT, last_changed TEXT
  );
  CREATE TABLE IF NOT EXISTS share_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    revoked INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS job_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    layer INTEGER NOT NULL,
    zone TEXT,
    key TEXT NOT NULL,
    display TEXT NOT NULL,
    is_recommended INTEGER DEFAULT 0,
    is_adas INTEGER DEFAULT 0,
    file_path TEXT,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_by INTEGER,
    uploaded_at TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(jobId)
  );
`);

// Bring an older jobs table (e.g. the v1 schema, which has no shop_id) up to
// the current column set. ADD COLUMN only, and only for columns PRAGMA
// table_info says are missing; never rebuilds the table or touches rows.
const JOBS_COLUMNS = [
  ['ro','TEXT'], ['vin','TEXT'], ['year','TEXT'], ['make','TEXT'], ['model','TEXT'], ['trim','TEXT'],
  ['technicianName','TEXT'], ['repairsPerformed','TEXT'], ['adasSystems','TEXT'], ['rationale','TEXT'],
  ['liabilityWarning','TEXT'], ['makeSpecificNotes','TEXT'], ['preScanRequired','TEXT'],
  ['postScanRequired','TEXT'], ['approvedScanTool','TEXT'], ['status',"TEXT DEFAULT 'Created'"],
  ['track',"TEXT DEFAULT 'post-collision'"], ['collision_grade','TEXT'], ['shareToken','TEXT'],
  ['shareUrl','TEXT'], ['shop_id','INTEGER'], ['created_by','INTEGER'], ['createdAt','TEXT'],
  ['updatedAt','TEXT'], ['last_changed','TEXT'],
  ['mileage','TEXT'], ['service_date','TEXT'], ['assigned_tech','TEXT'], ['impact_areas','TEXT'], ['photo_status','TEXT'],
  // Nov 2026: job form values (JSON {values, other}) and the full rules-engine result (JSON).
  ['repair_keys','TEXT'], ['adas_eval','TEXT'],
];
{
  const present = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name));
  const missing = JOBS_COLUMNS.filter(([col]) => !present.has(col));
  for (const [col, def] of missing) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`);
  if (missing.length) console.log(`[migration] jobs: added missing column(s) ${missing.map(([c]) => c).join(', ')}`);
}

// Calibration record (Nov 2026): what was actually done against each required
// item, with proof files. Records are never deleted; a mistake is voided with a reason.
db.exec(`
  CREATE TABLE IF NOT EXISTS job_calibrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    item_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    result TEXT NOT NULL,
    method TEXT, si_reference TEXT, tool TEXT,
    performed_by_name TEXT, performed_on TEXT,
    reason TEXT, notes TEXT,
    created_by INTEGER, created_at TEXT,
    voided_at TEXT, voided_by INTEGER, void_reason TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(jobId)
  );
  CREATE INDEX IF NOT EXISTS idx_job_calibrations_job ON job_calibrations(job_id);
  CREATE TABLE IF NOT EXISTS job_calibration_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calibration_id INTEGER NOT NULL,
    job_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT, mime_type TEXT, size_bytes INTEGER,
    uploaded_by INTEGER, uploaded_at TEXT,
    FOREIGN KEY (calibration_id) REFERENCES job_calibrations(id)
  );
  CREATE INDEX IF NOT EXISTS idx_job_calibration_files_job ON job_calibration_files(job_id);
  -- Technician sign-off, QC approval and QC override (exception record). Never deleted.
  CREATE TABLE IF NOT EXISTS job_signoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    user_id INTEGER, user_name TEXT, role TEXT,
    statement TEXT, justification TEXT, open_items TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(jobId)
  );
  CREATE INDEX IF NOT EXISTS idx_job_signoffs_job ON job_signoffs(job_id);
  -- Technicians assigned to a job (several allowed). A technician sees and works
  -- only on jobs assigned to them. Unassigning keeps the row (removed_at).
  CREATE TABLE IF NOT EXISTS job_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_by INTEGER, assigned_at TEXT NOT NULL,
    removed_by INTEGER, removed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(jobId),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_job_assignments_job ON job_assignments(job_id);
  CREATE INDEX IF NOT EXISTS idx_job_assignments_user ON job_assignments(user_id);
  -- Platform access: how platform admin opens a shop's jobs, read-only, for a
  -- reason the terms of service allow. Private to the platform (shops don't see
  -- it); every view is logged as the platform's own record of staying in terms.
  CREATE TABLE IF NOT EXISTS platform_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL,
    opened_by INTEGER NOT NULL, reason_type TEXT NOT NULL, note TEXT NOT NULL,
    opened_at TEXT NOT NULL, expires_at TEXT NOT NULL, closed_at TEXT,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );
  CREATE TABLE IF NOT EXISTS platform_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, user_id INTEGER,
    method TEXT, path TEXT, at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_platform_access_log_shop ON platform_access_log(shop_id, id);
`);
// CREATE TABLE IF NOT EXISTS leaves an older table as it was. A database that
// already had one of these tables from an earlier build (production had an
// older job_assignments without removed_by) gets any missing columns added
// here. Columns are added as nullable: ALTER TABLE cannot add NOT NULL columns
// to a table that has rows, and older rows have no value for them.
{
  const expected = {
    job_calibrations: ['item_key TEXT', 'item_name TEXT', 'kind TEXT', 'result TEXT', 'method TEXT', 'si_reference TEXT', 'tool TEXT',
      'performed_by_name TEXT', 'performed_on TEXT', 'reason TEXT', 'notes TEXT', 'created_by INTEGER', 'created_at TEXT',
      'voided_at TEXT', 'voided_by INTEGER', 'void_reason TEXT'],
    job_calibration_files: ['calibration_id INTEGER', 'file_path TEXT', 'original_name TEXT', 'mime_type TEXT', 'size_bytes INTEGER',
      'uploaded_by INTEGER', 'uploaded_at TEXT'],
    job_signoffs: ['kind TEXT', 'user_id INTEGER', 'user_name TEXT', 'role TEXT', 'statement TEXT', 'justification TEXT',
      'open_items TEXT', 'created_at TEXT'],
    job_assignments: ['user_id INTEGER', 'assigned_by INTEGER', 'assigned_at TEXT', 'removed_by INTEGER', 'removed_at TEXT'],
    platform_access: ['shop_id INTEGER', 'opened_by INTEGER', 'reason_type TEXT', 'note TEXT', 'opened_at TEXT', 'expires_at TEXT', 'closed_at TEXT'],
    platform_access_log: ['access_id INTEGER', 'shop_id INTEGER', 'user_id INTEGER', 'method TEXT', 'path TEXT', 'at TEXT'],
  };
  for (const [table, cols] of Object.entries(expected)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    const added = [];
    for (const def of cols) {
      const name = def.split(' ')[0];
      if (have.has(name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
      added.push(name);
    }
    if (added.length) console.log(`Added missing column(s) to older ${table} table: ${added.join(', ')}.`);
  }
}
// One-time link for jobs saved before assignments existed: a job whose typed
// technician name matches exactly one active technician in its shop (full name
// or username) is assigned to that technician. Jobs that never had an
// assignment row are the only ones touched.
{
  const unlinked = db.prepare(`SELECT jobId, shop_id, technicianName, assigned_tech FROM jobs
    WHERE shop_id IS NOT NULL AND jobId NOT IN (SELECT job_id FROM job_assignments)`).all();
  const findTech = db.prepare(`SELECT id FROM users WHERE shop_id=? AND role='technician' AND active=1
    AND (lower(full_name)=lower(?) OR lower(username)=lower(?))`);
  const add = db.prepare('INSERT INTO job_assignments (job_id,user_id,assigned_at) VALUES (?,?,?)');
  const now = new Date().toISOString();
  let linked = 0;
  for (const j of unlinked) {
    const name = String(j.assigned_tech || j.technicianName || '').trim();
    if (!name) continue;
    const hits = findTech.all(j.shop_id, name, name);
    if (hits.length === 1) { add.run(j.jobId, hits[0].id, now); linked++; }
  }
  if (linked) console.log(`Linked ${linked} existing job(s) to technician accounts by name.`);
}

// job_photos may already exist from an earlier development pass with a different
// column set. CREATE TABLE IF NOT EXISTS above is a no-op against an existing
// table, so reconcile columns the same defensive way as the blocks above —
// safe no-ops if a column is already present, never touches existing rows.
for (const [col, def] of [
  ['layer','INTEGER'], ['zone','TEXT'], ['key','TEXT'], ['display','TEXT'],
  ['is_recommended','INTEGER DEFAULT 0'], ['is_adas','INTEGER DEFAULT 0'],
  ['file_path','TEXT'], ['original_name','TEXT'], ['mime_type','TEXT'],
  ['size_bytes','INTEGER'], ['uploaded_by','INTEGER'], ['uploaded_at','TEXT'],
  ['shop_id','INTEGER'],
]) {
  try { db.exec(`ALTER TABLE job_photos ADD COLUMN ${col} ${def}`); } catch(e) {}
}

// One-time repair migration: a prior deployment created job_photos with
// shop_id defined as NOT NULL. SQLite has no ALTER COLUMN — you cannot relax
// an existing NOT NULL constraint by adding/altering a column, which is why
// the earlier fix (just passing shop_id on INSERT) still failed whenever the
// acting user has no shop_id (platform_admin is legitimately shop-less, and
// any session predating shop assignment will also have it). The real fix is
// to rebuild the table with shop_id nullable and copy every row across.
// Idempotent and safe to run on every boot — it only acts when the NOT NULL
// constraint is actually still present, and it's wrapped in a transaction
// so a failure mid-rebuild leaves the original table untouched.
(function relaxJobPhotosShopIdIfNeeded() {
  const cols = db.prepare("PRAGMA table_info(job_photos)").all();
  const shopIdCol = cols.find(c => c.name === 'shop_id');
  if (!shopIdCol || shopIdCol.notnull !== 1) return; // already nullable, or column absent — nothing to do

  console.log('[migration] job_photos.shop_id is NOT NULL — rebuilding table to make it nullable...');
  try {
    db.exec('BEGIN');
    db.exec('ALTER TABLE job_photos RENAME TO job_photos_old');
    db.exec(`
      CREATE TABLE job_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        layer INTEGER,
        zone TEXT,
        key TEXT,
        display TEXT,
        is_recommended INTEGER DEFAULT 0,
        is_adas INTEGER DEFAULT 0,
        file_path TEXT,
        original_name TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        uploaded_by INTEGER,
        uploaded_at TEXT,
        shop_id INTEGER,
        FOREIGN KEY (job_id) REFERENCES jobs(jobId)
      )
    `);
    const oldColNames = db.prepare("PRAGMA table_info(job_photos_old)").all().map(c => c.name);
    const newColNames = db.prepare("PRAGMA table_info(job_photos)").all().map(c => c.name);
    const shared = newColNames.filter(c => oldColNames.includes(c)).join(', ');
    db.exec(`INSERT INTO job_photos (${shared}) SELECT ${shared} FROM job_photos_old`);
    db.exec('DROP TABLE job_photos_old');
    db.exec('COMMIT');
    console.log('[migration] job_photos rebuilt successfully — shop_id is now nullable. Existing rows preserved.');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[migration] job_photos rebuild FAILED, rolled back. Original table left in place:', err.message);
    throw err;
  }
})();

for (const [col, def] of [
  ['stripe_customer_id','TEXT'], ['stripe_subscription_id','TEXT'],
  ['subscription_status',"TEXT DEFAULT 'inactive'"],
  ['subscription_current_period_end','INTEGER'], ['grace_period_end','INTEGER'],
]) {
  try { db.exec(`ALTER TABLE shops ADD COLUMN ${col} ${def}`); } catch(e) {}
}
// Set when a shop is removed, so restoring the shop brings back exactly the
// accounts the removal turned off (not ones deactivated on their own before).
try { db.exec('ALTER TABLE users ADD COLUMN off_with_shop INTEGER DEFAULT 0'); } catch(e) {}

// The guest login was removed in Aug 2026, but its account rows stayed behind
// and the normal sign-in form would still accept them. Turn them off for good.
{
  const r = db.prepare("UPDATE users SET active=0 WHERE role='guest' AND active=1").run();
  if (r.changes) console.log(`Deactivated ${r.changes} leftover guest account(s).`);
}

// ─── Legacy ADAS Engine ───────────────────────────────────────────────────────
// Keyword engine from the first build. Jobs no longer use it: the job form and
// the hard copy go through utils/jobReport.js (oemCalibrationRules.evaluate()).
// It now feeds only the /reference lookup page. Many of its lines have no
// source; do not wire it into anything new.
function runADASEngine(make, model, year, repairs) {
  const m = (make || '').toLowerCase();
  const r = Array.isArray(repairs) ? repairs.join(' ').toLowerCase() : (repairs || '').toLowerCase();
  const systems = [], rationale = [], notes = [];
  let preScan = 'REQUIRED — OEM position statement mandates pre-repair scan';
  let postScan = 'REQUIRED — OEM position statement mandates post-repair scan';
  let tool = 'OEM-compatible scan tool';
  let liability = 'Failure to perform required ADAS calibrations after collision repair may result in system malfunction, creating safety hazards and legal liability. Always follow OEM repair procedures.';

  const hasWindshield = /windshield|front camera|glass/i.test(r);
  const hasFrontBumper = /front bumper|radar/i.test(r);
  const hasRearBumper = /rear bumper/i.test(r);
  const hasDoor = /door|mirror/i.test(r);
  const hasAlignment = /alignment|suspension/i.test(r);
  const hasAirbag = /airbag|srs/i.test(r);

  if (m.includes('toyota') || m.includes('lexus')) {
    tool = 'Toyota Techstream / Techstream Lite';
    if (hasWindshield) { systems.push('PCS Static Calibration — TSS Camera (Static, target board required)'); rationale.push('Toyota/Lexus windshield replacement requires PCS camera static calibration per CRIB 191'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); rationale.push('Front bumper/radar work requires front radar calibration'); }
    if (hasRearBumper) { systems.push('Blind Spot Monitor Calibration (Static)'); }
    if (hasAlignment) { systems.push('Dynamic Calibration — Drive at 25+ mph on straight road'); }
    notes.push('Toyota/Lexus: Use Techstream. CRIB 191 governs camera calibration. All ADAS work requires pre and post scan.');
  } else if (m.includes('ford') || m.includes('lincoln')) {
    tool = 'Ford IDS or FDRS';
    if (hasWindshield) { systems.push('IPMA Dynamic Calibration — Drive cycle required (25-85 mph)'); rationale.push('Ford windshield replacement triggers IPMA dynamic calibration per Ford position statement 2018'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasDoor) { systems.push('SODCM Blind Spot / Lane Change Calibration'); }
    notes.push('Ford/Lincoln: IPMA handles forward camera. SODCM handles blind spot. Use FDRS for programming.');
  } else if (m.includes('chev') || m.includes('gmc') || m.includes('buick') || m.includes('cadillac')) {
    tool = 'GM GDS2';
    if (hasWindshield) { systems.push('Forward Camera Calibration (VARIES — Static or Dynamic per model)'); rationale.push('GM camera calibration requirements vary by model year'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    notes.push('GM: Calibration type varies by model. Verify in GDS2 before proceeding.');
  } else if (m.includes('honda') || m.includes('acura')) {
    tool = 'Honda i-HDS with Denso DST-i VCI';
    if (hasWindshield) { systems.push('Honda Sensing Multipurpose Camera — Static Calibration'); rationale.push('Honda windshield replacement requires Honda Sensing camera static calibration per May 2019 position statement'); }
    if (hasFrontBumper) { systems.push('Millimeter Wave Radar Unit Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Blind Spot Information System Calibration (Static)'); }
    notes.push('Honda/Acura: Position statement May 2019 governs all ADAS calibration requirements.');
  } else if (m.includes('nissan') || m.includes('infiniti')) {
    tool = 'Nissan/Infiniti CONSULT';
    if (hasWindshield) { systems.push('Front Camera Calibration (Static)'); rationale.push('Nissan/Infiniti front camera calibration required per NPSB/18-409'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Rear Sonar / BSM Calibration (Static)'); }
    notes.push('Nissan/Infiniti: NPSB/18-409 governs calibration requirements.');
  } else if (m.includes('kia') || m.includes('hyundai') || m.includes('genesis')) {
    tool = 'Kia/Hyundai GDS (Global Diagnostic System)';
    if (hasWindshield) { systems.push('SCC Front Camera Calibration (Static)'); rationale.push('Kia/Hyundai front camera calibration required per OEM position statements'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Rear Cross Traffic Alert Calibration (Static)'); }
  } else if (m.includes('subaru')) {
    tool = 'Subaru SSM4 / asTech remote';
    if (hasWindshield) { systems.push('EyeSight Dual-Camera Calibration — SST required (Static)'); rationale.push('Subaru EyeSight calibration requires Special Service Tool per July 2017 position statement'); }
    if (hasFrontBumper) { systems.push('Front Grille Radar Calibration (Static)'); }
    notes.push('Subaru: EyeSight calibration REQUIRES special SST tool. Cannot be performed without it.');
  } else if (m.includes('mazda')) {
    tool = 'Mazda diagnostic tool';
    if (hasWindshield) { systems.push('Front Camera Calibration (Static)'); rationale.push('Mazda front camera calibration required per January 2018 position statement'); }
  } else if (m.includes('mercedes')) {
    tool = 'Mercedes-Benz XENTRY';
    if (hasWindshield) { systems.push('Stereo Multi-Purpose Camera — Static Calibration'); }
    if (hasFrontBumper) { systems.push('Distronic Radar Calibration (Static)'); }
    notes.push('Mercedes-Benz: All calibrations require XENTRY. Refer to MBUSA position statement.');
  } else if (m.includes('jaguar') || m.includes('land rover')) {
    tool = 'JLR Pathfinder';
    systems.push('Full Pathfinder Diagnostic Scan Required');
    if (hasWindshield) { systems.push('Windscreen Camera Calibration (Static)'); }
    notes.push('Jaguar/Land Rover: All collision repairs require full Pathfinder scan per JLRGPS 02v2.');
  } else if (m.includes('volvo')) {
    tool = 'Volvo VIDA';
    if (hasWindshield) { systems.push('Camera/Sensor Calibration (Static)'); }
    if (hasFrontBumper) { systems.push('Autonomous Drive Sensor Calibration (VARIES)'); }
  } else if (m.includes('tesla')) {
    tool = 'Tesla Toolbox 3 (not OBDII compatible)';
    preScan = 'REQUIRED — Tesla alert-based scan required (not standard DTC scan)';
    postScan = 'REQUIRED — Tesla alert-based scan required (not standard DTC scan)';
    systems.push('Tesla Autopilot Camera Calibration — Drive cycle required');
    notes.push('Tesla does not use standard DTCs. Requires Tesla Toolbox 3. Alert-based diagnostic system only.');
  }

  if (hasAirbag) { systems.push('Full System Scan Required — Airbag/SRS deployment triggers all-makes scan requirement'); }
  if (systems.length === 0) { systems.push('No ADAS calibration flagged for the reported repairs on this vehicle'); }

  return {
    adasSystems: systems.join('\n'), rationale: rationale.join('\n'),
    liabilityWarning: liability, makeSpecificNotes: notes.join('\n'),
    preScanRequired: preScan, postScanRequired: postScan, approvedScanTool: tool,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
// CIQ-YYYYMMDD-NNNN. jobId is UNIQUE, so retry on collision instead of letting the
// INSERT throw; only after repeated collisions widen the random suffix.
function generateJobId() {
  const d = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const exists = db.prepare('SELECT 1 FROM jobs WHERE jobId=?');
  for (let i = 0; i < 20; i++) {
    const id = `CIQ-${d}-${crypto.randomInt(1000, 10000)}`;
    if (!exists.get(id)) return id;
  }
  return `CIQ-${d}-${crypto.randomInt(100000, 1000000)}`;
}
function formatDate(iso) { return iso ? iso.slice(0,10) : '—'; }
function statusClass(s) {
  return s === 'In Progress' ? 'orange' : s === 'Calibration Complete' ? 'green' : s === 'Closed' ? 'gray' : 'blue';
}
function scanBadgeClass(s) {
  const u = (s||'').toUpperCase();
  return u.startsWith('REQUIRED') ? 'red' : (u.startsWith('STRONGLY') || u.startsWith('HIGHLY') || u.startsWith('IMPERATIVE')) ? 'amber' : 'blue';
}
function scanBadgeLabel(s) {
  const u = (s||'').toUpperCase();
  if (u.startsWith('REQUIRED')) return 'REQUIRED';
  if (u.startsWith('STRONGLY')) return 'STRONGLY RECOMMENDED';
  if (u.startsWith('HIGHLY')) return 'HIGHLY RECOMMENDED';
  return 'RECOMMENDED';
}
function setFlash(req, type, msg) { req.session.flash = { type, msg }; }
function consumeFlash(req) { const f = req.session.flash || null; delete req.session.flash; return f; }

// ─── Layout ───────────────────────────────────────────────────────────────────
function layout(title, content, activeNav='', user=null) {
  const nav = (href, key, label) => `<a href="${href}" class="${activeNav===key?'active':''}">${label}</a>`;
  const role = user ? user.role : null;
  const ctxReq = requestContext.getStore();
  const logout = ctxReq ? `<form method="POST" action="/logout" class="nav-logout-form">${csrfField(ctxReq)}<button type="submit" class="nav-logout">Logout</button></form>` : '';
  let navLinks = '';
  if (role === 'platform_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/reference','reference','ADAS Reference')}${nav('/platform/shops','shops','Shops')}${nav('/platform/accounts','accounts','Accounts')}${nav('/platform/access','access','Access Log')}${nav('/platform/billing','billing','Billing')}${logout}`;
  } else if (role === 'shop_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}${nav('/admin','admin','Admin')}${nav('/admin/users','users','Users')}${logout}`;
  } else if (role === 'technician') {
    navLinks = `${nav('/','list','My Jobs')}${nav('/reference','reference','ADAS Reference')}${logout}`;
  } else if (role) {
    navLinks = `${nav('/','list','Jobs')}${nav('/reference','reference','ADAS Reference')}${logout}`;
  }
  const userDisplay = user ? `<span class="nav-user">${escapeHtml(user.full_name||user.username)} <span class="nav-role">[${escapeHtml(user.role)}]</span></span>` : '';
  const adminBanner = role==='platform_admin' ? `<div style="background:#1B3A6B;color:#fff;text-align:center;padding:6px;font-size:13px">&#9881; PLATFORM ADMIN — CUELJURIS LLC</div>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)} — CollisionIQ</title><link rel="stylesheet" href="/style.css"><script src="/js/app.js" defer></script></head><body>${adminBanner}<header class="site-header"><div class="header-inner"><div class="brand"><a href="/" class="brand-logo">CollisionIQ</a><span class="brand-tagline">ADAS Calibration Documentation Platform</span></div><nav class="main-nav">${navLinks}${userDisplay}</nav></div></header><main class="main-content">${content}</main><footer class="site-footer"><p>&copy; 2026 Cueljuris LLC &mdash; CollisionIQ Platform</p></footer></body></html>`;
}

// ─── Security headers + proxy trust ────────────────────────────────────────────
// trust proxy is required so secure cookies work behind Railway's TLS terminator.
app.set('trust proxy', 1);
// CSP: no inline scripts or inline event handlers (UI behaviour lives in
// /js/app.js). Inline style attributes are still used throughout, so styles keep
// 'unsafe-inline'. /register POSTs then redirects to Stripe Checkout, which
// form-action must allow. upgrade-insecure-requests only in production so plain
// http://localhost keeps working.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'form-action': ["'self'", 'https://checkout.stripe.com'],
      'upgrade-insecure-requests': IS_PROD ? [] : null,
    },
  },
}));

// Rate limiter for registration (brute-force / abuse protection).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again in 15 minutes.',
});

// Login limiters count FAILED attempts only, so a whole shop logging in from
// one NAT'd IP at shift start isn't locked out. Per-IP caps spraying across
// accounts; per-username caps guessing against one account from many IPs.
const loginFailed = (req, res) => !res.locals.loginFailed;
// Logs why a sign-in failed and for which username. Never the password.
// The username is JSON-quoted so stray spaces show and control characters can't forge log lines.
function logLoginFailure(req, reason) {
  console.log(`login failed: reason=${reason} username=${JSON.stringify(str(req.body && req.body.username, 100))}`);
}
const lockedOut = (scope) => (req, res, next, options) => {
  logLoginFailure(req, `locked_out (${scope})`);
  res.status(options.statusCode).send(options.message);
};
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  skipSuccessfulRequests: true, requestWasSuccessful: loginFailed,
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many failed sign-in attempts. Please try again in 15 minutes.',
  handler: lockedOut('ip'),
});
const loginUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  skipSuccessfulRequests: true, requestWasSuccessful: loginFailed,
  keyGenerator: (req) => 'user:' + str(req.body && req.body.username, 100).toLowerCase(),
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many failed sign-in attempts for this account. Please try again in 15 minutes.',
  handler: lockedOut('username'),
});

// ─── Stripe webhook (must be BEFORE the JSON body parser) ──────────────────────
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    console.error('[webhook] signature failed:', err.message);
    return res.status(400).send('Webhook signature verification failed.');
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const status = ['active','trialing'].includes(sub.status) ? sub.status : sub.status === 'past_due' ? 'past_due' : 'inactive';
    // A shop platform admin removed stays removed whatever Stripe sends.
    // node:sqlite throws when binding undefined. Newer Stripe API versions moved
    // current_period_end off the subscription object, so default it to null.
    db.prepare(`UPDATE shops SET subscription_status=?, stripe_subscription_id=?, subscription_current_period_end=? WHERE stripe_customer_id=? AND subscription_status IS NOT 'removed'`)
      .run(status, sub.id ?? null, sub.current_period_end ?? null, sub.customer ?? null);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    db.prepare(`UPDATE shops SET subscription_status='cancelled' WHERE stripe_customer_id=? AND subscription_status IS NOT 'removed'`).run(sub.customer ?? null);
  }

  res.json({ received: true });
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Session ───────────────────────────────────────────────────────────────────
// Refuse to boot in production (including any Railway environment) without a
// real secret. No public fallback string.
if (IS_PROD && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// connect-sqlite3's underlying native sqlite3 binding is incompatible with
// Node 22 (throws "this.db.exec is not a function" on boot). Rather than
// fight a third-party native dependency, this store uses the same built-in
// node:sqlite module the rest of the app already relies on successfully.
class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER
    )`);
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires && row.expires < Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      this.db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires`
      ).run(sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  // Expired rows are otherwise only removed when that exact sid is read again.
  prune() {
    try { this.db.prepare('DELETE FROM sessions WHERE expires IS NOT NULL AND expires < ?').run(Date.now()); }
    catch (err) { console.error('[session] prune failed:', err.message); }
  }
}

const sessionDbPath = process.env.SESSION_DB_PATH || path.join(__dirname, 'sessions.db');
const sessionDb = new DatabaseSync(sessionDbPath);
const sessionStore = new SqliteSessionStore(sessionDb);
sessionStore.prune();
setInterval(() => sessionStore.prune(), 60 * 60 * 1000).unref();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
  },
}));

// Re-read the signed-in user on every request. The session only caches a
// snapshot from login, so without this a deactivated user keeps working for up
// to 8 hours and role or shop changes don't apply until they sign in again.
const loadSessionUser = db.prepare('SELECT id, username, full_name, role, shop_id, active FROM users WHERE id=?');
app.use((req, res, next) => {
  const cached = req.session && req.session.user;
  if (!cached) return next();
  const u = loadSessionUser.get(cached.id);
  if (!u || !u.active) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  req.session.user = { id: u.id, username: u.username, full_name: u.full_name, role: u.role, shop_id: u.shop_id };
  next();
});

app.use((req, res, next) => requestContext.run(req, next));

// CSRF protection — must come after session() so req.session exists,
// and after the body parsers above so req.body._csrf is populated.
app.use(verifyCsrf);

// UPLOADS_DIR should point at a Railway Volume mount in production (e.g. /data/uploads) —
// the plain container filesystem is wiped on every redeploy, which would silently lose
// every job photo. Defaults to a local folder for development only.
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Extension comes from the (allow-listed) MIME type, never from the client's
// filename, so nothing like `.html` or `.svg` can ever land in uploads/.
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${IMAGE_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_EXT[file.mimetype]) {
      return cb(new Error('Only JPEG, PNG, WEBP, or HEIC/HEIF images are allowed.'));
    }
    cb(null, true);
  },
});

// Calibration proof: scan reports (PDF) and photos, up to 5 files per record.
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${calRecord.PROOF_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: calRecord.MAX_PROOF_FILES, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (!calRecord.PROOF_EXT[file.mimetype]) return cb(new Error('Proof files must be PDF, JPEG, PNG, WEBP or HEIC/HEIF.'));
    cb(null, true);
  },
});
function proofSignatureMatches(filePath, mimetype) {
  if (mimetype !== 'application/pdf') return imageSignatureMatches(filePath, mimetype);
  const buf = Buffer.alloc(5);
  let fd;
  try { fd = fs.openSync(filePath, 'r'); fs.readSync(fd, buf, 0, 5, 0); }
  catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return buf.toString('latin1') === '%PDF-';
}

// The MIME type above is whatever the browser claimed. Confirm the bytes on disk
// really are that image format before accepting the upload.
function imageSignatureMatches(filePath, mimetype) {
  const buf = Buffer.alloc(12);
  let fd;
  try { fd = fs.openSync(filePath, 'r'); fs.readSync(fd, buf, 0, 12, 0); }
  catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  switch (mimetype) {
    case 'image/jpeg': return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    case 'image/png':  return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    case 'image/webp': return buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    case 'image/heic':
    case 'image/heif': return buf.toString('latin1', 4, 8) === 'ftyp';
    default: return false;
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
// Role gate. Roles: platform_admin, shop_admin, qc_manager, service_writer, technician.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.status(403).send('Access denied.');
    next();
  };
}
// Who may create and edit jobs (matches the Edit button shown on the job page).
// Shop roles only: jobs and their records are the shop's data. Platform admin
// can view every shop's jobs but never create, edit or document them.
const JOB_EDITORS = ['shop_admin', 'service_writer'];
const ASSIGNERS = ['shop_admin', 'qc_manager', 'service_writer'];
const requireJobEditor = requireRole(...JOB_EDITORS);
// Photo uploads: service writers are read-only, and a Closed job is locked for
// everyone except platform_admin.
function canUploadPhotos(user, job) {
  if (!['technician', 'qc_manager', 'shop_admin'].includes(user.role)) return false;
  return job.status !== 'Closed';
}
function isAssigned(jobId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM job_assignments WHERE job_id=? AND user_id=? AND removed_at IS NULL').get(jobId, userId));
}
// ─── Platform access (platform admin) ───────────────────────────────────────
// Platform admin sees a shop's jobs only after opening access to that shop for
// a reason the terms of service allow. Read-only; 4-hour window; every view is
// logged. The log is the platform's own record and is not shown to shops.
const ACCESS_REASONS = { legal: 'Legal matter involving the shop and the platform', support: 'Technical support', update: 'Platform update or maintenance' };
const ACCESS_HOURS = 4;
function activeAccess(shopId) {
  if (shopId === null || shopId === undefined) return null;
  return db.prepare('SELECT * FROM platform_access WHERE shop_id=? AND closed_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1')
    .get(shopId, new Date().toISOString()) || null;
}
function openShopIds() {
  return db.prepare('SELECT DISTINCT shop_id FROM platform_access WHERE closed_at IS NULL AND expires_at > ?').all(new Date().toISOString()).map((r) => r.shop_id);
}
function logPlatformAccess(req, access) {
  db.prepare('INSERT INTO platform_access_log (access_id,shop_id,user_id,method,path,at) VALUES (?,?,?,?,?,?)')
    .run(access.id, access.shop_id, req.session.user.id, req.method, String(req.originalUrl || '').slice(0, 300), new Date().toISOString());
}
function assignedTechs(jobId) {
  return db.prepare(`SELECT u.id, u.full_name, u.username FROM job_assignments a JOIN users u ON u.id=a.user_id
    WHERE a.job_id=? AND a.removed_at IS NULL ORDER BY u.full_name`).all(jobId);
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['shop_admin','platform_admin'].includes(req.session.user.role)) return res.status(403).send('Access denied.');
  next();
}
function requirePlatformAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'platform_admin') return res.status(403).send('Access denied.');
  next();
}
// 'comp' is complimentary access set by platform admin (test shops, pilots).
// Stripe never writes it: webhooks only update shops that have a Stripe customer.
const SHOP_ACCESS_STATUSES = ['active', 'trialing', 'comp'];
function requireSubscription(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  // Platform admin bypasses subscription check
  if (req.session.user.role === 'platform_admin') return next();
  const shop = db.prepare('SELECT subscription_status FROM shops WHERE id=?').get(req.session.user.shop_id);
  if (!shop || !SHOP_ACCESS_STATUSES.includes(shop.subscription_status)) return res.redirect('/billing/inactive');
  next();
}

// Returns the job ONLY if the current user is allowed to act on it, else null.
// Platform admins may act on any job; everyone else is scoped to their own shop.
function ownedJob(req) {
  const u = req.session.user;
  if (u.role === 'platform_admin') {
    const j = db.prepare('SELECT * FROM jobs WHERE jobId=?').get(req.params.jobId);
    const access = j ? activeAccess(j.shop_id) : null;
    if (!access) return undefined;
    logPlatformAccess(req, access);
    return j;
  }
  const job = db.prepare('SELECT * FROM jobs WHERE jobId=? AND shop_id=?').get(req.params.jobId, u.shop_id);
  // Technicians reach only the jobs assigned to them.
  if (job && u.role === 'technician' && !isAssigned(job.jobId, u.id)) return undefined;
  return job;
}

// ─── Registration ─────────────────────────────────────────────────────────────
app.get('/register', (req, res) => {
  const cancelled = req.query.cancelled === '1';
  res.send(layout('Register', `
    <div style="max-width:480px;margin:3rem auto;background:#fff;padding:2rem;border-radius:8px;border:1px solid #e0e0e0">
      <h1 style="margin-bottom:.25rem">Create Your Shop Account</h1>
      <p style="color:#666;margin-bottom:1.5rem;font-size:.9rem">CollisionIQ — Free to start. No credit card required.</p>
      ${cancelled ? '<div style="background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:.6rem;border-radius:4px;margin-bottom:1rem">Registration cancelled. Please try again.</div>' : ''}
      <form method="POST" action="/register">${csrfField(req)}
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Shop Name</label><input type="text" name="shop_name" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Your Name</label><input type="text" name="owner_name" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Email</label><input type="email" name="email" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Username</label><input type="text" name="username" required autocomplete="off" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Password</label><input type="password" name="password" required minlength="8" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1.5rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Confirm Password</label><input type="password" name="password_confirm" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <button type="submit" style="width:100%;padding:.65rem;background:#1a1a2e;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer">Create Free Account →</button>
      </form>
      <div style="text-align:center;margin-top:1rem;font-size:.85rem;color:#666">Already have an account? <a href="/login" style="color:#1B3A6B;font-weight:600">Sign in</a></div>
    </div>`));
});

app.post('/register', authLimiter, asyncRoute(async (req, res) => {
  const shop_name = str(req.body.shop_name, 200), owner_name = str(req.body.owner_name, 200);
  const email = str(req.body.email, 254), username = str(req.body.username, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const password_confirm = typeof req.body.password_confirm === 'string' ? req.body.password_confirm : '';
  if (!shop_name || !owner_name || !email || !username || !password) return res.redirect('/register?error=1');
  if (password !== password_confirm) return res.redirect('/register?error=1');
  if (password.length < 8) return res.redirect('/register?error=1');

  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) return res.redirect('/register?error=1');

  try {
    const customer = await stripe.customers.create({ email, name: shop_name, metadata: { owner_name } });
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    req.session.pending_registration = { shop_name, owner_name, email, username, password_hash, stripe_customer_id: customer.id };

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      payment_method_collection: 'if_required',
      success_url: `${baseUrl(req)}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl(req)}/register?cancelled=1`,
    });
    res.redirect(checkoutSession.url);
  } catch (err) {
    console.error('[register] error:', err.message);
    res.redirect('/register?error=1');
  }
}));

app.get('/register/success', asyncRoute(async (req, res) => {
  const session_id = str(req.query.session_id, 300);
  const pending = req.session.pending_registration;
  if (!session_id || !pending) return res.redirect('/register');

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    // The session_id comes from the URL, so it must belong to the Stripe customer
    // this browser started registering; otherwise any other paid session id
    // could be replayed to create an account.
    const sessionCustomer = typeof checkoutSession.customer === 'string' ? checkoutSession.customer : checkoutSession.customer?.id;
    if (!sessionCustomer || sessionCustomer !== pending.stripe_customer_id) {
      console.error('[register/success] checkout session customer does not match pending registration');
      return res.redirect('/register?cancelled=1');
    }
    const allowed = ['paid', 'no_payment_required'];
    if (!allowed.includes(checkoutSession.payment_status)) return res.redirect('/register?cancelled=1');

    const sub = checkoutSession.subscription;
    const subStatus = sub && ['active','trialing'].includes(sub.status) ? sub.status : 'trialing';
    const now = new Date().toISOString();

    const shopResult = db.prepare(`INSERT INTO shops (name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_current_period_end, created_at) VALUES (?,?,?,?,?,?)`)
      .run(pending.shop_name, pending.stripe_customer_id, sub ? sub.id : null, subStatus, sub ? sub.current_period_end : null, now);
    const shopId = shopResult.lastInsertRowid;

    const userResult = db.prepare(`INSERT INTO users (shop_id, username, email, password_hash, role, full_name, created_at) VALUES (?,?,?,?,'shop_admin',?,?)`)
      .run(shopId, pending.username, pending.email, pending.password_hash, pending.owner_name, now);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userResult.lastInsertRowid);
    // New session id on sign-in (prevents session fixation).
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, shop_id: user.shop_id };
    await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    res.redirect('/onboarding');
  } catch (err) {
    console.error('[register/success] error:', err.message);
    res.redirect('/register?cancelled=1');
  }
}));

// ─── Onboarding ───────────────────────────────────────────────────────────────
app.get('/onboarding', requireRole('shop_admin'), (req, res) => {
  const user = req.session.user;
  const shop = db.prepare('SELECT * FROM shops WHERE id=?').get(user.shop_id);
  res.send(layout('Welcome to CollisionIQ', `
    <div style="max-width:560px;margin:3rem auto">
      <div style="background:#1B3A6B;color:#fff;border-radius:8px 8px 0 0;padding:2rem">
        <div style="font-size:1.5rem;font-weight:700;margin-bottom:.25rem">&#10003; Account Created!</div>
        <div style="opacity:.85;font-size:.95rem">Welcome to CollisionIQ, ${escapeHtml(user.full_name||user.username)}. Let's finish setting up your shop.</div>
      </div>
      <div style="background:#fff;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:2rem">
        <h2 style="font-size:1.1rem;color:#1B3A6B;margin-bottom:1.25rem">Shop Details</h2>
        <form method="POST" action="/onboarding">${csrfField(req)}
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Shop Name</label>
            <input type="text" name="shop_name" value="${escapeHtml(shop?shop.name:'')}" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
            <div>
              <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">City</label>
              <input type="text" name="city" placeholder="Houston" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
            </div>
            <div>
              <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">State</label>
              <input type="text" name="state" placeholder="TX" maxlength="2" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
            </div>
          </div>
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Phone</label>
            <input type="text" name="phone" placeholder="(555) 555-5555" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Address</label>
            <input type="text" name="address" placeholder="123 Main St" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <button type="submit" style="width:100%;padding:.7rem;background:#1B3A6B;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer">Complete Setup → Go to Dashboard</button>
        </form>
        <div style="text-align:center;margin-top:1rem">
          <a href="/" style="color:#666;font-size:.85rem;text-decoration:none">Skip for now →</a>
        </div>
      </div>
    </div>`, '', user));
});

app.post('/onboarding', requireRole('shop_admin'), (req, res) => {
  const shop_name = str(req.body.shop_name, 200);
  if (!shop_name) return res.redirect('/onboarding');
  db.prepare('UPDATE shops SET name=?, city=?, state=?, phone=?, address=? WHERE id=?')
    .run(shop_name, str(req.body.city, 100), str(req.body.state, 2), str(req.body.phone, 40), str(req.body.address, 200), req.session.user.shop_id);
  res.redirect('/');
});

app.get('/billing/inactive', (req, res) => {
  res.send(layout('Subscription Inactive', `
    <div style="max-width:480px;margin:3rem auto;text-align:center;padding:2rem">
      <h1>Subscription Inactive</h1>
      <p>Your subscription is not active. Please subscribe to continue using CollisionIQ.</p>
      <a href="/register" class="btn btn-primary" style="display:inline-block;margin-top:1rem">Subscribe Now</a>
    </div>`));
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const error = req.query.error || '';
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login — CollisionIQ</title><link rel="stylesheet" href="/style.css"><style>
    .login-wrap{display:flex;justify-content:center;align-items:center;min-height:80vh}
    .login-card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:2.5rem 2rem;width:100%;max-width:380px;box-shadow:0 2px 12px rgba(0,0,0,.07)}
    .login-logo{font-size:1.5rem;font-weight:700;color:#1a1a2e;margin-bottom:.25rem}
    .login-sub{font-size:.85rem;color:#666;margin-bottom:2rem}
    .login-btn{width:100%;padding:.65rem;background:#1a1a2e;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.5rem}
    .login-btn:hover{background:#2d2d4e}
  </style></head><body><div class="login-wrap"><div class="login-card">
    <div class="login-logo">CollisionIQ</div>
    <div class="login-sub">ADAS Calibration Documentation Platform</div>
    ${error?'<div style="background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:.6rem;border-radius:4px;margin-bottom:1rem;font-size:.875rem">Invalid username or password.</div>':''}
    <form method="POST" action="/login">${csrfField(req)}
      <div style="margin-bottom:1rem"><label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.3rem">Username</label><input type="text" name="username" required autofocus style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1px solid #ccc;border-radius:4px;font-size:.95rem"></div>
      <div style="margin-bottom:1rem"><label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.3rem">Password</label><input type="password" name="password" required style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1px solid #ccc;border-radius:4px;font-size:.95rem"></div>
      <button type="submit" class="login-btn">Sign In</button>
    </form>
    <div style="text-align:center;margin-top:1.25rem;font-size:.85rem;color:#666">New shop? <a href="/register" style="color:#1B3A6B;font-weight:600">Create an account</a></div>
    <div style="text-align:center;margin-top:.5rem;font-size:.75rem;color:#999">&copy; 2026 Cueljuris LLC</div>
  </div></div></body></html>`);
});

app.post('/login', loginIpLimiter, loginUserLimiter, asyncRoute(async (req, res) => {
  const username = str(req.body.username, 100);
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  // Looked up without the active filter only so the log can say "inactive"; inactive users still fail.
  const user = username ? db.prepare('SELECT * FROM users WHERE username=?').get(username) : null;
  // Always run a compare so response timing doesn't reveal whether the username exists.
  const hash = user ? user.password_hash : '$2b$12$0000000000000000000000000000000000000000000000000000a';
  const match = await bcrypt.compare(password, hash);
  if (!user || !user.active || !match || !password) {
    const reason = !username || !password ? 'other' : !user ? 'unknown_user' : !user.active ? 'inactive' : 'bad_password';
    logLoginFailure(req, reason);
    res.locals.loginFailed = true;
    return res.redirect('/login?error=1');
  }
  // New session id on sign-in (prevents session fixation).
  await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, shop_id: user.shop_id };
  await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
  res.redirect('/');
}));

// Logout is a CSRF-protected POST so another site can't sign users out.
// GET /logout (old bookmarks) shows a one-button confirmation instead.
app.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });
app.get('/logout', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.send(layout('Sign out', `<div style="max-width:420px;margin:3rem auto;text-align:center"><h1>Sign out?</h1><form method="POST" action="/logout" style="margin-top:1rem">${csrfField(req)}<button type="submit" class="btn btn-primary">Sign out</button> <a href="/" class="btn btn-ghost">Cancel</a></form></div>`, '', req.session.user));
});

// ─── Jobs List ────────────────────────────────────────────────────────────────
app.get('/', requireAuth, requireSubscription, (req, res) => {
  const flash = consumeFlash(req);
  const search = str(req.query.search, 100);
  const user = req.session.user;
  const shopId = user.role === 'platform_admin' ? null : user.shop_id;

  let jobs;
  if (search) {
    const q = `%${search}%`;
    jobs = shopId
      ? db.prepare('SELECT * FROM jobs WHERE shop_id=? AND (ro LIKE ? OR vin LIKE ? OR technicianName LIKE ?) ORDER BY last_changed DESC').all(shopId,q,q,q)
      : db.prepare('SELECT * FROM jobs WHERE ro LIKE ? OR vin LIKE ? OR technicianName LIKE ? ORDER BY last_changed DESC').all(q,q,q);
  } else {
    jobs = shopId
      ? db.prepare('SELECT * FROM jobs WHERE shop_id=? ORDER BY last_changed DESC').all(shopId)
      : db.prepare('SELECT * FROM jobs ORDER BY last_changed DESC').all();
  }
  if (user.role === 'technician') jobs = jobs.filter((j) => isAssigned(j.jobId, user.id));
  if (user.role === 'platform_admin') {
    const open = new Set(openShopIds());
    jobs = jobs.filter((j) => open.has(j.shop_id));
    for (const sid of open) logPlatformAccess(req, activeAccess(sid));
  }

  const rows = jobs.map(j => `<tr>
    <td><a href="/jobs/${encodeURIComponent(j.jobId)}" style="font-family:monospace;font-weight:600;color:#1B3A6B;text-decoration:none">${escapeHtml(j.jobId)}</a></td>
    <td>${escapeHtml(j.ro)||'—'}</td>
    <td>${[j.year,j.make,j.model].filter(Boolean).map(escapeHtml).join(' ')||'—'}</td>
    <td><span class="badge badge-${statusClass(j.status)}">${escapeHtml(j.status)}</span></td>
    <td>${photoStatusBadge(j.photo_status || 'red')}</td>
    <td>${formatDate(j.createdAt)}</td>
    <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
  </tr>`).join('');

  const content = `
    ${flash?`<div style="background:${flash.type==='success'?'#D6F0D6':'#FFD6D6'};color:${flash.type==='success'?'#1A6B1A':'#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem">${escapeHtml(flash.msg)}</div>`:''}
    ${user.role === 'platform_admin' ? '<p class="adas-basis" style="margin-bottom:1rem">Shop jobs are the shops\' records. This list shows only shops you have opened under Shops for a reason the terms allow (legal, technical support, update). Access is read-only and every view is in your Access Log.</p>' : ''}
    ${user.role === 'technician' ? '<p class="adas-basis" style="margin-bottom:1rem">Jobs assigned to you.</p>' : ''}
    <div class="page-header"><h1>Jobs <span class="count-badge">${jobs.length}</span></h1>${JOB_EDITORS.includes(user.role) ? '<a href="/new" class="btn btn-primary">+ New Job</a>' : ''}</div>
    <div class="search-bar"><form method="GET" action="/"><input type="text" name="search" placeholder="Search by RO#, VIN, or Technician…" value="${escapeHtml(search)}"><button type="submit" class="btn">Search</button>${search?'<a href="/" class="btn btn-ghost">Clear</a>':''}</form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Job ID</th><th>RO #</th><th>Vehicle</th><th>Status</th><th>Photos</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">No jobs found.</td></tr>'}</tbody></table></div>`;

  res.send(layout('Jobs', content, 'list', user));
});

// ─── Repair checkboxes (job form) ─────────────────────────────────────────────
// Values come from utils/jobRepairs.js. Sided items have a Left and a Right box.
function repairFieldsets(selected = []) {
  const on = new Set(selected);
  const box = (value, text) => `<label class="checkbox-label"><input type="checkbox" name="repairs" value="${escapeHtml(value)}"${on.has(value)?' checked':''}><span>${escapeHtml(text)}</span></label>`;
  return jobRepairs.GROUPS.map(g => {
    const items = g.options.map(o => o.sided
      ? `<div class="repair-sided"><span class="repair-sided-label">${escapeHtml(o.label)}</span><div class="repair-sided-boxes">${box(`${o.key}:L`, 'Left')}${box(`${o.key}:R`, 'Right')}</div></div>`
      : box(o.key, o.label)).join('');
    return `<fieldset class="repair-group"><legend>${escapeHtml(g.title)}</legend><div class="${g.id==='sides'?'repair-sided-grid':'checkbox-grid'}">${items}</div></fieldset>`;
  }).join('');
}
function storedRepairs(job) {
  try {
    const r = JSON.parse(job.repair_keys || 'null');
    if (r && Array.isArray(r.values)) return { values: jobRepairs.normalizeValues(r.values), other: typeof r.other === 'string' ? r.other : '' };
  } catch (e) {}
  // Jobs saved before Nov 2026: old checkbox labels, comma-separated.
  return { values: jobRepairs.normalizeValues((job.repairsPerformed || '').split(',').map(s => s.trim())), other: '' };
}
// Runs the repairs through the rules engine and returns the columns to save.
function jobAdasColumns({ make, model, year, values, other }) {
  const built = jobReport.buildJobAdas({ make, model, year, repairValues: values });
  const cols = built.columns;
  if (other) cols.repairsPerformed = [cols.repairsPerformed, `Other: ${other}`].filter(Boolean).join(', ');
  return { ...cols, repair_keys: JSON.stringify({ values: built.result.input.repairValues, other }), adas_eval: JSON.stringify(built.result), adasRequired: built.adasRequired };
}

// ─── New Job ──────────────────────────────────────────────────────────────────
app.get('/new', requireJobEditor, requireSubscription, (req, res) => {
  const zoneCheckboxes = Object.entries(ZONE_DISPLAY).map(([key, label]) =>
    `<label class="checkbox-label"><input type="checkbox" name="impact_zones" value="${escapeHtml(key)}"><span>${escapeHtml(label)}</span></label>`
  ).join('');
  const content = `
    <div class="page-header"><h1>New Job</h1></div>
    <form method="POST" action="/jobs" class="job-form">${csrfField(req)}
      <div class="form-section"><h2 class="section-heading">Vehicle Information</h2><div class="form-grid">
        <div class="form-group"><label>RO Number <span class="req">*</span></label><input type="text" name="ro" required placeholder="e.g. RO-12345"></div>
        <div class="form-group"><label>VIN</label><input type="text" name="vin" maxlength="17" placeholder="17-character VIN" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Year</label><input type="text" name="year" maxlength="4" placeholder="e.g. 2022"></div>
        <div class="form-group"><label>Make</label><input type="text" name="make" placeholder="e.g. Toyota"></div>
        <div class="form-group"><label>Model</label><input type="text" name="model" placeholder="e.g. Camry"></div>
        <div class="form-group"><label>Trim</label><input type="text" name="trim" placeholder="e.g. XSE"></div>
        <div class="form-group"><label>Technician Name <span class="req">*</span></label><input type="text" name="technicianName" required placeholder="Full name"></div>
      </div></div>
      <div class="form-section"><h2 class="section-heading">Repairs Performed</h2><p style="color:#666;font-size:.85rem;margin-bottom:.75rem">Check every operation on the estimate. These drive the OEM calibration rules and the CollisionIQ field rules on the hard copy.</p>${repairFieldsets()}
        <div class="form-group" style="margin-top:1rem"><label>Other Repairs</label><input type="text" name="otherRepairs" placeholder="Describe additional repairs…"></div>
      </div>
      <div class="form-section"><h2 class="section-heading">Impact Zones</h2><p style="color:#666;font-size:.85rem;margin-bottom:.75rem">Select every area with visible damage — this determines which photos are required for documentation.</p><div class="checkbox-grid">${zoneCheckboxes}</div>
      </div>
      <div class="form-actions"><a href="/" class="btn btn-ghost">Cancel</a><button type="submit" class="btn btn-primary btn-lg">Submit &amp; Generate ADAS Report</button></div>
    </form>`;
  res.send(layout('New Job', content, 'new', req.session.user));
});

app.post('/jobs', requireJobEditor, requireSubscription, (req, res) => {
  const ro = str(req.body.ro, 50), vin = str(req.body.vin, 17), year = str(req.body.year, 4);
  const make = displayMake(str(req.body.make, 50)), model = str(req.body.model, 50), trim = str(req.body.trim, 50);
  const technicianName = str(req.body.technicianName, 100), otherRepairs = str(req.body.otherRepairs, 300);
  if (!ro) return res.status(400).send('RO number is required.');
  const impactZones = strList(req.body.impact_zones, 50).filter(z => Object.prototype.hasOwnProperty.call(ZONE_DISPLAY, z));

  const adas = jobAdasColumns({ make, model, year, values: strList(req.body.repairs, 100), other: otherRepairs });
  const adasRequired = adas.adasRequired;
  const jobId = generateJobId();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO jobs (jobId,ro,vin,year,make,model,trim,technicianName,repairsPerformed,adasSystems,rationale,liabilityWarning,makeSpecificNotes,preScanRequired,postScanRequired,approvedScanTool,status,shareToken,shareUrl,createdAt,updatedAt,last_changed,shop_id,created_by,impact_areas,repair_keys,adas_eval) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Created',?,?,?,?,?,?,?,?,?,?)`)
    .run(jobId, ro, vin.toUpperCase(), year, make, model, trim, technicianName,
      adas.repairsPerformed, adas.adasSystems, adas.rationale, adas.liabilityWarning, adas.makeSpecificNotes,
      adas.preScanRequired, adas.postScanRequired, adas.approvedScanTool,
      shareToken, `/share/${shareToken}`, now, now, now,
      req.session.user.shop_id || null, req.session.user.id, JSON.stringify(impactZones), adas.repair_keys, adas.adas_eval);

  // Generate the required photo-documentation slots for this job and persist
  // them (unfilled) so the photo checklist knows what's outstanding.
  // shop_id may legitimately be null here (platform_admin, or any session
  // without a shop) — the boot-time migration above ensures job_photos.shop_id
  // is nullable, so this is safe.
  const slots = generatePhotoLabels({ impact_areas: impactZones, adas_required: adasRequired });
  const insertSlot = db.prepare(`INSERT INTO job_photos (job_id, layer, zone, key, display, is_recommended, is_adas, shop_id) VALUES (?,?,?,?,?,?,?,?)`);
  for (const slot of slots) {
    insertSlot.run(jobId, slot.layer, slot.zone || null, slot.key, slot.display, slot.is_recommended ? 1 : 0, slot.is_adas ? 1 : 0, req.session.user.shop_id || null);
  }
  updateJobPhotoStatus(db, jobId);

  res.redirect(`/jobs/${jobId}`);
});

// ─── Job View ─────────────────────────────────────────────────────────────────
app.get('/jobs/:jobId', requireAuth, requireSubscription, (req, res) => {
  const user = req.session.user;
  // Same rule as every other job route: own shop; technicians only when
  // assigned; platform admin only under a shop's support grant (logged).
  const job = ownedJob(req);

  if (!job) return res.status(404).send(layout('Not Found', '<div class="error-page"><h1>Job Not Found</h1><a href="/" class="btn btn-primary">Back to Jobs</a></div>', '', user));

  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const rationaleList = job.rationale ? job.rationale.split('\n').filter(Boolean) : [];
  const activeToken = db.prepare('SELECT token FROM share_tokens WHERE job_id=? AND revoked=0 ORDER BY id DESC LIMIT 1').get(job.jobId);
  const adasEval = jobReport.parseStored(job.adas_eval);
  const rec = loadCalibrationRecord(job, adasEval);
  const canRecord = canUploadPhotos(user, job);
  const flash = consumeFlash(req);
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const assigned = assignedTechs(job.jobId);
  const canAssign = ASSIGNERS.includes(user.role) && job.status !== 'Closed';
  const shopTechs = canAssign ? db.prepare("SELECT id, full_name, username FROM users WHERE shop_id=? AND role='technician' AND active=1 ORDER BY full_name").all(job.shop_id) : [];
  const assignedIds = new Set(assigned.map((t) => t.id));
  const assignHtml = `<section class="doc-section"><h2 class="doc-section-title">Assigned Technicians</h2>
    <p class="adas-basis">${assigned.length ? assigned.map((t) => escapeHtml(t.full_name || t.username)).join(', ') : 'No technician assigned. Technicians only see jobs assigned to them.'}</p>
    ${canAssign ? (shopTechs.length ? `<form method="POST" action="${jobPath}/assign" class="no-print assign-form">${csrfField(req)}<div class="checkbox-grid">${shopTechs.map((t) => `<label class="checkbox-label"><input type="checkbox" name="tech_ids" value="${t.id}"${assignedIds.has(t.id) ? ' checked' : ''}><span>${escapeHtml(t.full_name || t.username)}</span></label>`).join('')}</div><button class="btn btn-sm" style="margin-top:.5rem">Save assignment</button></form>` : '<p class="adas-basis no-print">This shop has no active technician accounts. Add them under Users.</p>') : ''}
  </section>`;
  const signoffHtml = calRecord.renderSignoffs(rec.sign, rec.st.summary,
    job.status === 'Closed' ? {} : { forms: { csrf: csrfField(req), base: jobPath, user } });
  const recordHtml = calRecord.renderSection(rec.st, rec.files, {
    fileUrl: (f) => `${jobPath}/calibrations/files/${f.id}`,
    voidForm: canRecord ? (r) => `<form method="POST" action="${jobPath}/calibrations/${r.id}/void" class="calrec-void no-print">${csrfField(req)}<input type="text" name="void_reason" maxlength="300" placeholder="Reason to void this record" required><button class="btn btn-sm">Void</button></form>` : null,
    formHtml: canRecord ? calRecord.renderForm({
      action: `${jobPath}/calibrations`, csrf: csrfField(req), items: rec.st.rows,
      defaults: { date: new Date().toISOString().slice(0, 10), name: user.full_name || user.username || '', open: false },
    }) : '',
  });

  const adasItems = adasList.length > 0
    ? adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')
    : `<li class="adas-item adas-none"><span class="adas-flag adas-ok">&#10003;</span><span>No ADAS calibration flagged for the reported repairs on this vehicle.</span></li>`;

  const content = `
    ${flash?`<div class="no-print" style="background:${flash.type==='success'?'#D6F0D6':'#FFD6D6'};color:${flash.type==='success'?'#1A6B1A':'#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem">${escapeHtml(flash.msg)}</div>`:''}
    <div class="job-doc">
      <div class="job-doc-header">
        <div><div class="doc-brand">CollisionIQ</div><div class="doc-owner">ADAS Calibration Documentation</div></div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          <div><span class="meta-label">Status</span> <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span></div>
          <div><span class="meta-label">Photos</span> ${photoStatusBadge(job.photo_status || 'red')}</div>
          <div><span class="meta-label">Record</span> ${calRecord.summaryBadge(rec.st.summary)}</div>
        </div>
        <div class="doc-actions no-print">
          <button type="button" data-action="print" class="btn btn-white">&#128438; Print / Save PDF</button>
          <a href="/jobs/${encodeURIComponent(job.jobId)}/photos" class="btn btn-white">&#128247; Photos</a>
          ${JOB_EDITORS.includes(user.role) ? `<a href="/jobs/${encodeURIComponent(job.jobId)}/edit" class="btn btn-white">&#9998; Edit</a>` : ''}
          <a href="/" class="btn btn-ghost-white">Back</a>
        </div>
      </div>
      ${calRecord.renderSummary(calRecord.recordSummary(rec.st, rec.files, rec.sign, job.status))}
      <section class="doc-section"><h2 class="doc-section-title">Vehicle Information</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">RO Number</span><span class="info-val">${escapeHtml(job.ro)||'—'}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Year</span><span class="info-val">${escapeHtml(job.year)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Make</span><span class="info-val">${escapeHtml(job.make)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Model</span><span class="info-val">${escapeHtml(job.model)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Trim</span><span class="info-val">${escapeHtml(job.trim)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName)||'—'}</span></div>
          <div class="info-row info-row-full"><span class="info-label">Repairs</span><span class="info-val">${escapeHtml(job.repairsPerformed)||'—'}</span></div>
        </div>
      </section>
      <section class="doc-section scan-req-section"><h2 class="doc-section-title">Scan Requirements</h2>
        <div class="scan-req-grid">
          <div class="scan-req-row"><span class="scan-req-label">Pre-Repair Scan</span><span class="badge scan-badge scan-badge-${scanBadgeClass(job.preScanRequired)}">${escapeHtml(scanBadgeLabel(job.preScanRequired))}</span><span class="scan-req-detail">${escapeHtml(job.preScanRequired||'RECOMMENDED')}</span></div>
          <div class="scan-req-row"><span class="scan-req-label">Post-Repair Scan</span><span class="badge scan-badge scan-badge-${scanBadgeClass(job.postScanRequired)}">${escapeHtml(scanBadgeLabel(job.postScanRequired))}</span><span class="scan-req-detail">${escapeHtml(job.postScanRequired||'RECOMMENDED')}</span></div>
          <div class="scan-req-row scan-req-tool-row"><span class="scan-req-label">&#128295; Approved Scan Tool</span><span class="scan-tool-value">${escapeHtml(job.approvedScanTool||'Consult OEM service information')}</span></div>
        </div>
      </section>
      ${adasEval ? jobReport.renderSections(adasEval) : `<section class="doc-section adas-section"><h2 class="doc-section-title">ADAS Systems — Calibration Required</h2><p class="adas-basis no-print">Saved with the original engine. Open Edit and save to re-run this job through the current OEM and field rules.</p><ul class="adas-list">${adasItems}</ul></section>
      <section class="doc-section"><h2 class="doc-section-title">Rationale</h2><ul class="rationale-list">${rationaleList.map(r=>`<li>${escapeHtml(r)}</li>`).join('')||'<li>No rationale generated.</li>'}</ul></section>`}
      ${assignHtml}
      ${recordHtml}
      ${signoffHtml}
      <section class="doc-section warning-section"><h2 class="doc-section-title">Liability Warning</h2><div class="warning-box"><span class="warning-icon">&#9888;</span><p>${escapeHtml(job.liabilityWarning)||'—'}</p></div></section>
      ${adasEval ? '' : `<section class="doc-section"><h2 class="doc-section-title">Make-Specific Notes</h2><div class="notes-box"><p>${escapeHtml(job.makeSpecificNotes)||'—'}</p></div></section>`}
      <section class="doc-section no-print"><h2 class="doc-section-title">Insurer Link</h2>
        ${activeToken
          ? `<div><code id="shareUrl">${escapeHtml(req.protocol+'://'+req.get('host')+'/share/'+activeToken.token)}</code> <button type="button" data-copy-target="shareUrl" class="btn btn-sm">Copy</button> <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share/revoke" style="display:inline">${csrfField(req)}<button class="btn btn-sm" style="border-color:#c0392b;color:#c0392b">Revoke</button></form></div>`
          : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share">${csrfField(req)}<button class="btn btn-primary btn-sm">Generate Insurer Link</button></form>`}
      </section>
      <div class="doc-footer"><p>Generated by CollisionIQ — Job ID: ${escapeHtml(job.jobId)}</p></div>
    </div>`;

  res.send(layout(`Job ${job.jobId}`, content, '', user));
});

// ─── Edit Job ─────────────────────────────────────────────────────────────────
app.get('/jobs/:jobId/edit', requireJobEditor, requireSubscription, (req, res) => {
  const user = req.session.user;
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');

  const existing = storedRepairs(job);

  const content = `
    <div style="max-width:720px;margin:0 auto">
      <div class="page-header"><h1>Edit Job — <span style="font-family:monospace">${escapeHtml(job.jobId)}</span></h1><a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a></div>
      <div class="card" style="padding:1.5rem">
        <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/edit">${csrfField(req)}
          <div class="form-row-2">
            <div class="form-group"><label>RO Number</label><input type="text" name="ro" value="${escapeHtml(job.ro||'')}"></div>
            <div class="form-group"><label>VIN</label><input type="text" name="vin" value="${escapeHtml(job.vin||'')}" maxlength="17"></div>
            <div class="form-group"><label>Year</label><input type="text" name="year" value="${escapeHtml(job.year||'')}"></div>
            <div class="form-group"><label>Make</label><input type="text" name="make" value="${escapeHtml(job.make||'')}"></div>
            <div class="form-group"><label>Model</label><input type="text" name="model" value="${escapeHtml(job.model||'')}"></div>
            <div class="form-group"><label>Trim</label><input type="text" name="trim" value="${escapeHtml(job.trim||'')}"></div>
            <div class="form-group"><label>Technician</label><input type="text" name="technicianName" value="${escapeHtml(job.technicianName||'')}"></div>
          </div>
          <div class="form-section" style="margin-top:1rem"><h3>Repairs Performed</h3>${job.repair_keys ? '' : '<p style="color:#8B5A00;font-size:.85rem">This job was saved with the old checkboxes. They have been converted to the closest current options; check the side and any missing operations before saving.</p>'}${repairFieldsets(existing.values)}
            <div class="form-group" style="margin-top:1rem"><label>Other Repairs</label><input type="text" name="otherRepairs" value="${escapeHtml(existing.other)}" placeholder="Describe additional repairs…"></div></div>
          <div style="margin-top:1.5rem;display:flex;gap:.75rem"><button type="submit" class="btn btn-primary">Save Changes</button><a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a></div>
        </form>
      </div>
    </div>`;
  res.send(layout(`Edit ${job.jobId}`, content, '', user));
});

app.post('/jobs/:jobId/edit', requireJobEditor, requireSubscription, (req, res) => {
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  const ro = str(req.body.ro, 50), vin = str(req.body.vin, 17), year = str(req.body.year, 4);
  const make = displayMake(str(req.body.make, 50)), model = str(req.body.model, 50), trim = str(req.body.trim, 50);
  const technicianName = str(req.body.technicianName, 100), otherRepairs = str(req.body.otherRepairs, 300);
  const adas = jobAdasColumns({ make, model, year, values: strList(req.body.repairs, 100), other: otherRepairs });
  const now = new Date().toISOString();
  db.prepare(`UPDATE jobs SET ro=?,vin=?,year=?,make=?,model=?,trim=?,technicianName=?,repairsPerformed=?,adasSystems=?,rationale=?,liabilityWarning=?,makeSpecificNotes=?,preScanRequired=?,postScanRequired=?,approvedScanTool=?,repair_keys=?,adas_eval=?,updatedAt=?,last_changed=? WHERE jobId=?`)
    .run(ro, vin.toUpperCase(), year, make, model, trim, technicianName,
      adas.repairsPerformed, adas.adasSystems, adas.rationale, adas.liabilityWarning, adas.makeSpecificNotes,
      adas.preScanRequired, adas.postScanRequired, adas.approvedScanTool, adas.repair_keys, adas.adas_eval, now, now, job.jobId);
  setFlash(req, 'success', 'Job updated.');
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// ─── Photo Documentation ────────────────────────────────────────────────────
function photoStatusBadge(status) {
  const map = { green: 'green', yellow: 'orange', red: 'red' };
  const label = { green: 'Complete', yellow: 'Layer 1 Complete', red: 'Incomplete' };
  return `<span class="badge badge-${map[status] || 'gray'}">${label[status] || 'Not Started'}</span>`;
}

app.get('/jobs/:jobId/photos', requireAuth, requireSubscription, (req, res) => {
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');

  const slots = db.prepare('SELECT * FROM job_photos WHERE job_id=? ORDER BY layer, zone, id').all(job.jobId);
  const status = calculatePhotoStatus(slots);
  const canUpload = canUploadPhotos(req.session.user, job);
  const uploadForm = (s, label, cls) => !canUpload ? '' :
    `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/photos/${s.id}" enctype="multipart/form-data">${csrfField(req)}
       <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required style="font-size:.75rem;margin-bottom:.4rem;width:100%">
       <button type="submit" class="${cls}" style="width:100%">${label}</button>
     </form>`;

  const groups = {};
  for (const s of slots) {
    const groupKey = `Layer ${s.layer}${s.zone ? ' — ' + (ZONE_DISPLAY[s.zone] || s.zone) : ''}`;
    (groups[groupKey] = groups[groupKey] || []).push(s);
  }

  const groupsHtml = Object.entries(groups).map(([groupName, items]) => `
    <div class="doc-section" style="margin-bottom:1.5rem">
      <h2 class="doc-section-title">${escapeHtml(groupName)}</h2>
      <div class="checkbox-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem">
        ${items.map(s => `
          <div class="card" style="padding:.75rem">
            <div style="font-size:.85rem;font-weight:600;margin-bottom:.5rem">${escapeHtml(s.display)}${s.is_recommended ? ' <span style="color:#999;font-weight:400">(recommended)</span>' : ''}</div>
            ${s.file_path
              ? `<img src="/jobs/${encodeURIComponent(job.jobId)}/photos/${s.id}/file" style="width:100%;border-radius:4px;margin-bottom:.5rem;display:block" alt="${escapeHtml(s.display)}">
                 ${uploadForm(s, 'Replace', 'btn btn-sm')}`
              : (uploadForm(s, 'Upload', 'btn btn-primary btn-sm') || '<div style="color:#999;font-size:.8rem">Not uploaded</div>')}
          </div>`).join('')}
      </div>
    </div>`).join('');

  const content = `
    <div class="page-header"><h1>Photo Documentation — <span style="font-family:monospace">${escapeHtml(job.jobId)}</span> ${photoStatusBadge(status)}</h1><a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Back to Job</a></div>
    ${slots.length === 0 ? '<p style="color:#666">No photo requirements were generated for this job (no impact zones were selected at creation).</p>' : groupsHtml}`;
  res.send(layout(`Photos — ${job.jobId}`, content, '', req.session.user));
});

app.post('/jobs/:jobId/photos/:photoId', requireAuth, requireSubscription, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).send(escapeHtml(err.message || 'Upload failed.'));
    next();
  });
}, (req, res) => {
  if (!csrfTokenValid(req)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).send('Invalid or expired form token. Please go back, refresh the page, and try again.');
  }

  const discard = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  const job = ownedJob(req);
  if (!job) { discard(); return res.status(404).send('Not found'); }
  if (!canUploadPhotos(req.session.user, job)) {
    discard();
    return res.status(403).send(job.status === 'Closed' ? 'This job is closed. Photos cannot be changed.' : 'Your role cannot upload photos.');
  }
  const slot = db.prepare('SELECT * FROM job_photos WHERE id=? AND job_id=?').get(req.params.photoId, job.jobId);
  if (!slot) { discard(); return res.status(404).send('Photo slot not found'); }
  if (!req.file) return res.status(400).send('No file uploaded.');
  if (!imageSignatureMatches(req.file.path, req.file.mimetype)) {
    discard();
    return res.status(400).send('The uploaded file is not a valid image.');
  }

  // Replacing an existing photo — remove the old file from disk.
  if (slot.file_path) {
    fs.unlink(path.join(uploadsDir, path.basename(slot.file_path)), () => {});
  }

  db.prepare(`UPDATE job_photos SET file_path=?, original_name=?, mime_type=?, size_bytes=?, uploaded_by=?, uploaded_at=? WHERE id=?`)
    .run(req.file.filename, req.file.originalname || '', req.file.mimetype, req.file.size, req.session.user.id, new Date().toISOString(), slot.id);

  updateJobPhotoStatus(db, job.jobId);
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}/photos`);
});

app.get('/jobs/:jobId/photos/:photoId/file', requireAuth, requireSubscription, (req, res) => {
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  const slot = db.prepare('SELECT * FROM job_photos WHERE id=? AND job_id=?').get(req.params.photoId, job.jobId);
  if (!slot || !slot.file_path) return res.status(404).send('Not found');

  // file_path is always a server-generated name; resolve + prefix check is defense in depth.
  const root = path.resolve(uploadsDir);
  const filePath = path.resolve(root, slot.file_path);
  if (!filePath.startsWith(root + path.sep)) return res.status(400).send('Invalid path');
  res.type(IMAGE_EXT[slot.mime_type] ? slot.mime_type : 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=0');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not found');
  });
});

// ─── Technician assignment ──────────────────────────────────────────────────
app.post('/jobs/:jobId/assign', requireAuth, requireSubscription, (req, res) => {
  const user = req.session.user;
  if (!ASSIGNERS.includes(user.role)) return res.status(403).send('Access denied.');
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  if (job.status === 'Closed') return res.status(403).send('This job is closed.');
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const wanted = new Set(strList(req.body.tech_ids, 50).map((x) => Number(x)).filter(Number.isInteger));
  const techs = db.prepare("SELECT id, full_name, username FROM users WHERE shop_id=? AND role='technician' AND active=1").all(job.shop_id);
  const valid = new Set(techs.map((t) => t.id));
  for (const id of wanted) if (!valid.has(id)) { setFlash(req, 'error', 'Only active technicians in this shop can be assigned.'); return res.redirect(jobPath); }
  const current = new Set(assignedTechs(job.jobId).map((t) => t.id));
  const now = new Date().toISOString();
  for (const id of wanted) if (!current.has(id)) {
    db.prepare('INSERT INTO job_assignments (job_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)').run(job.jobId, id, user.id, now);
  }
  for (const id of current) if (!wanted.has(id)) {
    db.prepare('UPDATE job_assignments SET removed_by=?, removed_at=? WHERE job_id=? AND user_id=? AND removed_at IS NULL').run(user.id, now, job.jobId, id);
  }
  const names = assignedTechs(job.jobId).map((t) => t.full_name || t.username).join(', ');
  db.prepare('UPDATE jobs SET technicianName=?, updatedAt=?, last_changed=? WHERE jobId=?').run(names || job.technicianName, now, now, job.jobId);
  setFlash(req, 'success', names ? `Assigned: ${names}.` : 'No technicians assigned.');
  res.redirect(jobPath);
});

// ─── Calibration Record ─────────────────────────────────────────────────────
function loadCalibrationRecord(job, adasEval) {
  const items = calRecord.requiredItems(adasEval);
  const records = db.prepare('SELECT * FROM job_calibrations WHERE job_id=? ORDER BY id').all(job.jobId);
  const files = db.prepare('SELECT f.* FROM job_calibration_files f JOIN job_calibrations c ON c.id=f.calibration_id WHERE f.job_id=? AND c.voided_at IS NULL ORDER BY f.id').all(job.jobId);
  const st = calRecord.status(items, records);
  const signoffs = db.prepare('SELECT * FROM job_signoffs WHERE job_id=? ORDER BY id').all(job.jobId);
  return { items, records, files, st, signoffs, sign: calRecord.signoffState(records, signoffs, st.summary) };
}

// ─── Make as printed on the job ─────────────────────────────────────────────
// Typed makes are saved in their usual written form ("toyota" → "Toyota",
// "gmc" → "GMC"). A make typed in mixed case is kept as typed.
const MAKE_NAMES = ['Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge',
  'Ferrari', 'Fiat', 'Fisker', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini',
  'Land Rover', 'Lexus', 'Lincoln', 'Lucid', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar',
  'Porsche', 'Ram', 'Rivian', 'Rolls-Royce', 'Scion', 'Subaru', 'Tesla', 'Toyota', 'VinFast', 'Volkswagen', 'Volvo'];
const MAKE_BY_KEY = new Map(MAKE_NAMES.map((m) => [m.toLowerCase().replace(/[^a-z]/g, ''), m]));
for (const [alias, m] of [['chevy', 'Chevrolet'], ['vw', 'Volkswagen'], ['mercedes', 'Mercedes-Benz'], ['benz', 'Mercedes-Benz'], ['landrover', 'Land Rover']]) MAKE_BY_KEY.set(alias, m);
function displayMake(make) {
  const m = String(make || '').trim().replace(/\s+/g, ' ');
  if (!m) return '';
  const known = MAKE_BY_KEY.get(m.toLowerCase().replace(/[^a-z]/g, ''));
  if (known) return known;
  if (m === m.toLowerCase() || m === m.toUpperCase()) return m.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return m;
}

// ─── Sign-off, QC approval, QC override ─────────────────────────────────────
function signoffGuard(req, res, roles) {
  const job = ownedJob(req);
  if (!job) { res.status(404).send('Not found'); return null; }
  if (!roles.includes(req.session.user.role)) { res.status(403).send('Access denied.'); return null; }
  if (job.status === 'Closed') { res.status(403).send('This job is closed.'); return null; }
  return job;
}
function addSignoff(job, user, kind, extra = {}) {
  db.prepare('INSERT INTO job_signoffs (job_id,kind,user_id,user_name,role,statement,justification,open_items,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(job.jobId, kind, user.id, user.full_name || user.username, user.role, calRecord.STATEMENTS[kind], extra.justification || null, extra.open_items || null, new Date().toISOString());
}
// Job status follows the record: Created until the first record, In Progress
// while it is being documented, Calibration Complete once QC approves the
// current record, Closed only through close or QC override. A change after
// approval (new or voided record) makes the approval stale and moves the job
// back to In Progress. Closed jobs never change here.
function syncJobStatus(jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE jobId=?').get(jobId);
  if (!job || job.status === 'Closed') return job && job.status;
  const { records, sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  const next = sign.qcCurrent ? 'Calibration Complete' : records.length ? 'In Progress' : 'Created';
  if (next !== job.status) {
    const now = new Date().toISOString();
    db.prepare('UPDATE jobs SET status=?, updatedAt=?, last_changed=? WHERE jobId=?').run(next, now, now, job.jobId);
  }
  return next;
}
function closeJob(job) {
  const now = new Date().toISOString();
  db.prepare("UPDATE jobs SET status='Closed', updatedAt=?, last_changed=? WHERE jobId=?").run(now, now, job.jobId);
}
app.post('/jobs/:jobId/signoff/tech', requireAuth, requireSubscription, (req, res) => {
  const job = signoffGuard(req, res, calRecord.SIGN_ROLES); if (!job) return;
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const { sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  if (!sign.canTechSign) { setFlash(req, 'error', 'Document every record item before signing off.'); return res.redirect(jobPath); }
  addSignoff(job, req.session.user, 'tech');
  syncJobStatus(job.jobId);
  setFlash(req, 'success', 'Technician sign-off recorded.');
  res.redirect(jobPath);
});
app.post('/jobs/:jobId/signoff/qc', requireAuth, requireSubscription, (req, res) => {
  const job = signoffGuard(req, res, calRecord.QC_ROLES); if (!job) return;
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const { sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  if (!sign.canApprove) { setFlash(req, 'error', `QC approval needs: ${sign.approveBlockers.join('; ')}.`); return res.redirect(jobPath); }
  addSignoff(job, req.session.user, 'qc');
  syncJobStatus(job.jobId);
  setFlash(req, 'success', 'QC approval recorded: Calibration Complete. The job can now be closed.');
  res.redirect(jobPath);
});
app.post('/jobs/:jobId/signoff/close', requireAuth, requireSubscription, (req, res) => {
  const job = signoffGuard(req, res, calRecord.QC_ROLES); if (!job) return;
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const { st, sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  const blocker = calRecord.closeBlocker(sign, st.summary);
  if (blocker) { setFlash(req, 'error', `Job not closed: ${blocker}.`); return res.redirect(jobPath); }
  closeJob(job);
  setFlash(req, 'success', 'Job closed.');
  res.redirect(jobPath);
});
app.post('/jobs/:jobId/signoff/override', requireAuth, requireSubscription, (req, res) => {
  const job = signoffGuard(req, res, calRecord.QC_ROLES); if (!job) return;
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const { st, sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  if (sign.canClose) { setFlash(req, 'error', 'The record is approved; close the job normally.'); return res.redirect(jobPath); }
  const { errors, justification } = calRecord.validateOverride(req.body);
  if (errors.length) { setFlash(req, 'error', `Override not saved: ${errors.join(' ')}`); return res.redirect(jobPath); }
  const open = [...st.summary.openNames, ...(sign.techCurrent ? [] : ['Technician sign-off']), ...(sign.qcCurrent ? [] : ['QC approval'])];
  addSignoff(job, req.session.user, 'override', { justification, open_items: JSON.stringify(open) });
  closeJob(job);
  setFlash(req, 'success', 'Job closed under QC override. The exception is on the job record.');
  res.redirect(jobPath);
});

app.post('/jobs/:jobId/calibrations', requireAuth, requireSubscription, (req, res, next) => {
  proofUpload.array('proof', calRecord.MAX_PROOF_FILES)(req, res, (err) => {
    if (err) {
      for (const f of req.files || []) fs.unlink(f.path, () => {});
      return res.status(400).send(escapeHtml(err.code === 'LIMIT_FILE_COUNT' ? `Attach at most ${calRecord.MAX_PROOF_FILES} files.` : err.message || 'Upload failed.'));
    }
    next();
  });
}, (req, res) => {
  const discard = () => { for (const f of req.files || []) fs.unlink(f.path, () => {}); };
  if (!csrfTokenValid(req)) { discard(); return res.status(403).send('Invalid or expired form token. Please go back, refresh the page, and try again.'); }
  const job = ownedJob(req);
  if (!job) { discard(); return res.status(404).send('Not found'); }
  if (!canUploadPhotos(req.session.user, job)) {
    discard();
    return res.status(403).send(job.status === 'Closed' ? 'This job is closed. The calibration record cannot be changed.' : 'Your role cannot record calibrations.');
  }
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  for (const f of req.files || []) {
    if (!proofSignatureMatches(f.path, f.mimetype)) { discard(); return res.status(400).send('A proof file is not a valid PDF or image.'); }
  }
  const { items } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
  const key = str(req.body.item_key, 100);
  const item = key === 'ADDITIONAL' ? null : items.find((x) => x.key === key);
  if (key !== 'ADDITIONAL' && !item) { discard(); setFlash(req, 'error', 'That requirement is not on this job.'); return res.redirect(jobPath); }
  const { errors, record: r } = calRecord.validateRecord(req.body, item);
  if (errors.length) { discard(); setFlash(req, 'error', `Record not saved: ${errors.join(' ')}`); return res.redirect(jobPath); }
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO job_calibrations (job_id,item_key,item_name,kind,result,method,si_reference,tool,performed_by_name,performed_on,reason,notes,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(job.jobId, r.item_key, r.item_name, r.kind, r.result, r.method, r.si_reference, r.tool,
    r.performed_by_name, r.performed_on, r.reason, r.notes, req.session.user.id, now);
  const addFile = db.prepare('INSERT INTO job_calibration_files (calibration_id,job_id,file_path,original_name,mime_type,size_bytes,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const f of req.files || []) addFile.run(info.lastInsertRowid, job.jobId, f.filename, (f.originalname || '').slice(0, 200), f.mimetype, f.size, req.session.user.id, now);
  db.prepare('UPDATE jobs SET updatedAt=?, last_changed=? WHERE jobId=?').run(now, now, job.jobId);
  syncJobStatus(job.jobId);
  setFlash(req, 'success', `Recorded: ${r.item_name}.`);
  res.redirect(jobPath);
});

app.post('/jobs/:jobId/calibrations/:id/void', requireAuth, requireSubscription, (req, res) => {
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  if (!canUploadPhotos(req.session.user, job)) return res.status(403).send(job.status === 'Closed' ? 'This job is closed. The calibration record cannot be changed.' : 'Your role cannot change the calibration record.');
  const jobPath = `/jobs/${encodeURIComponent(job.jobId)}`;
  const reason = str(req.body.void_reason, 300);
  const row = db.prepare('SELECT * FROM job_calibrations WHERE id=? AND job_id=? AND voided_at IS NULL').get(req.params.id, job.jobId);
  if (!row) return res.status(404).send('Record not found');
  if (reason.length < 3) { setFlash(req, 'error', 'Give a reason to void the record.'); return res.redirect(jobPath); }
  const now = new Date().toISOString();
  db.prepare('UPDATE job_calibrations SET voided_at=?, voided_by=?, void_reason=? WHERE id=?').run(now, req.session.user.id, reason, row.id);
  db.prepare('UPDATE jobs SET updatedAt=?, last_changed=? WHERE jobId=?').run(now, now, job.jobId);
  syncJobStatus(job.jobId);
  setFlash(req, 'success', `Voided record for ${row.item_name}.`);
  res.redirect(jobPath);
});

function sendProofFile(res, f) {
  const root = path.resolve(uploadsDir);
  const filePath = path.resolve(root, f.file_path);
  if (!filePath.startsWith(root + path.sep)) return res.status(400).send('Invalid path');
  res.type(calRecord.PROOF_EXT[f.mime_type] ? f.mime_type : 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=0');
  res.set('Content-Disposition', `inline; filename="proof-${f.id}${calRecord.PROOF_EXT[f.mime_type] || ''}"`);
  res.sendFile(filePath, (err) => { if (err && !res.headersSent) res.status(404).send('File not found'); });
}
const PROOF_FILE_SQL = 'SELECT f.* FROM job_calibration_files f JOIN job_calibrations c ON c.id=f.calibration_id WHERE f.id=? AND f.job_id=? AND c.voided_at IS NULL';
app.get('/jobs/:jobId/calibrations/files/:fileId', requireAuth, requireSubscription, (req, res) => {
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  const f = db.prepare(PROOF_FILE_SQL).get(req.params.fileId, job.jobId);
  if (!f) return res.status(404).send('Not found');
  sendProofFile(res, f);
});
app.get('/share/:token/files/:fileId', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex');
  const row = db.prepare('SELECT * FROM share_tokens WHERE token=? AND revoked=0').get(req.params.token);
  if (!row) return res.status(404).send('Not found');
  const f = db.prepare(PROOF_FILE_SQL).get(req.params.fileId, row.job_id);
  if (!f) return res.status(404).send('Not found');
  sendProofFile(res, f);
});

// ─── Share Link ───────────────────────────────────────────────────────────────
// Creating a link needs an active subscription; revoking does not, and links
// that already exist keep working for insurers (see /share/:token).
app.post('/jobs/:jobId/share', requireAuth, requireSubscription, (req, res) => {
  if (req.session.user.role === 'platform_admin') return res.status(403).send('Share links belong to the shop.');
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO share_tokens (job_id, token, created_at) VALUES (?,?,?)').run(job.jobId, token, new Date().toISOString());
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});
app.post('/jobs/:jobId/share/revoke', requireAuth, (req, res) => {
  if (req.session.user.role === 'platform_admin') return res.status(403).send('Share links belong to the shop.');
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  db.prepare('UPDATE share_tokens SET revoked=1 WHERE job_id=? AND revoked=0').run(job.jobId);
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});
app.get('/share/:token', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex');
  const row = db.prepare('SELECT * FROM share_tokens WHERE token=? AND revoked=0').get(req.params.token);
  if (!row) return res.status(404).send(layout('Link Expired', '<div class="error-page"><h1>Link Not Found or Revoked</h1></div>'));
  const job = db.prepare('SELECT * FROM jobs WHERE jobId=?').get(row.job_id);
  if (!job) return res.status(404).send('Not found');
  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const adasEval = jobReport.parseStored(job.adas_eval);
  const rec = loadCalibrationRecord(job, adasEval);
  const recordHtml = calRecord.renderSection(rec.st, rec.files, { fileUrl: (f) => `/share/${encodeURIComponent(req.params.token)}/files/${f.id}` });
  const content = `<div class="job-doc"><div class="job-doc-header"><div><div class="doc-brand">CollisionIQ — Insurer View</div><div class="doc-owner">ADAS Calibration Documentation</div></div><div class="doc-meta"><div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div><div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div></div></div>${calRecord.renderSummary(calRecord.recordSummary(rec.st, rec.files, rec.sign, job.status))}<section class="doc-section"><h2 class="doc-section-title">Vehicle</h2><div class="info-grid"><div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin)||'—'}</span></div><div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}</span></div><div class="info-row info-row-full"><span class="info-label">Repairs</span><span class="info-val">${escapeHtml(job.repairsPerformed)||'—'}</span></div></div></section>${adasEval ? jobReport.renderSections(adasEval, { insurer: true }) : `<section class="doc-section adas-section"><h2 class="doc-section-title">ADAS Requirements</h2><ul class="adas-list">${adasList.map(s=>`<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')||'<li>No ADAS flagged.</li>'}</ul></section>`}${recordHtml}${calRecord.renderSignoffs(rec.sign, rec.st.summary)}<div class="doc-footer"><p>CollisionIQ — Insurer Read-Only View</p></div></div>`;
  res.send(layout(`Insurer View — ${job.jobId}`, content));
});

// ─── Admin ────────────────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  const user = req.session.user;
  const shopId = user.role === 'platform_admin' ? null : user.shop_id;
  let jobs = shopId
    ? db.prepare('SELECT * FROM jobs WHERE shop_id=? ORDER BY createdAt DESC').all(shopId)
    : db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
  if (user.role === 'platform_admin') {
    const open = new Set(openShopIds());
    jobs = jobs.filter((j) => open.has(j.shop_id));
    for (const sid of open) logPlatformAccess(req, activeAccess(sid));
  }
  const statusOptions = ['Created','In Progress','Calibration Complete','Closed'];
  const flash = consumeFlash(req);
  const rows = jobs.map(j => `<tr><td><span class="job-id">${escapeHtml(j.jobId)}</span></td><td>${escapeHtml(j.ro)||'—'}</td><td>${escapeHtml(j.year)} ${escapeHtml(j.make)} ${escapeHtml(j.model)}</td><td>${escapeHtml(j.technicianName)||'—'}</td><td>${user.role === 'platform_admin' ? `<span class="badge badge-${statusClass(j.status)}">${escapeHtml(j.status)}</span>` : `<form method="POST" action="/jobs/${encodeURIComponent(j.jobId)}/status" class="inline-form">${csrfField(req)}<select name="status" data-autosubmit class="status-select">${statusOptions.map(s=>`<option value="${s}"${j.status===s?' selected':''}>${s}</option>`).join('')}</select></form>`}</td><td>${formatDate(j.createdAt)}</td><td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td></tr>`).join('');
  const content = `${flash?`<div style="background:${flash.type==='success'?'#D6F0D6':'#FFD6D6'};color:${flash.type==='success'?'#1A6B1A':'#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem">${escapeHtml(flash.msg)}</div>`:''}<div class="page-header"><h1>Admin — Job Management <span class="count-badge">${jobs.length}</span></h1></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Job ID</th><th>RO #</th><th>Vehicle</th><th>Technician</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">No jobs.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Admin', content, 'admin', user));
});

app.post('/jobs/:jobId/status', requireAdmin, requireSubscription, (req, res) => {
  if (req.session.user.role === 'platform_admin') return res.status(403).send("Job status belongs to the shop. Platform admin can view jobs but not change them.");
  const valid = ['Created','In Progress','Calibration Complete','Closed'];
  if (!valid.includes(req.body.status)) return res.status(400).send('Invalid status');
  const job = ownedJob(req);
  if (!job) return res.status(404).send('Not found');
  // Calibration Complete needs a complete record; Closed also needs a current
  // technician sign-off and QC approval (or the QC override on the job page).
  if (['Calibration Complete', 'Closed'].includes(req.body.status)) {
    const { st, sign } = loadCalibrationRecord(job, jobReport.parseStored(job.adas_eval));
    // Calibration Complete means QC approved the current record, the same
    // point at which the job moves there on its own.
    const blocker = req.body.status === 'Closed' ? calRecord.closeBlocker(sign, st.summary)
      : (!st.summary.complete ? `${st.summary.open} calibration record item(s) open — ${st.summary.openNames.join('; ')}`
        : sign.qcCurrent ? null : 'QC has not approved the current record');
    if (blocker) {
      setFlash(req, 'error', `${job.jobId} cannot be marked ${req.body.status}: ${blocker}.${req.body.status === 'Closed' ? ' Approve or override on the job page.' : ''}`);
      return res.redirect('/admin');
    }
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE jobs SET status=?, updatedAt=?, last_changed=? WHERE jobId=?').run(req.body.status, now, now, job.jobId);
  res.redirect('/admin');
});

// ─── User Management ──────────────────────────────────────────────────────────
app.get('/admin/users', requireAdmin, requireSubscription, (req, res) => {
  const user = req.session.user;
  const users = user.role === 'platform_admin'
    ? db.prepare('SELECT id,full_name,username,email,role,active,created_at FROM users ORDER BY created_at DESC').all()
    : db.prepare('SELECT id,full_name,username,email,role,active,created_at FROM users WHERE shop_id=? ORDER BY created_at DESC').all(user.shop_id);
  const roleOptions = ['shop_admin','qc_manager','technician','service_writer'];
  const rows = users.map(u => `<tr><td>${escapeHtml(u.full_name||'—')}</td><td class="mono">${escapeHtml(u.username)}</td><td>${escapeHtml(u.email||'—')}</td><td><span class="badge badge-blue">${escapeHtml(u.role)}</span></td><td><span class="badge badge-${u.active?'green':'gray'}">${u.active?'Active':'Inactive'}</span></td><td>${u.id === user.id || u.role === 'platform_admin' ? '<span style="color:#999">—</span>' : `<form method="POST" action="/admin/users/${u.id}/role" style="display:inline">${csrfField(req)}<select name="role" data-autosubmit>${roleOptions.map(r=>`<option value="${r}"${u.role===r?' selected':''}>${r}</option>`).join('')}</select></form>${u.active?`<form method="POST" action="/admin/users/${u.id}/deactivate" style="display:inline;margin-left:.5rem">${csrfField(req)}<button class="btn btn-sm btn-ghost">Deactivate</button></form>`:''}`}</td></tr>`).join('');
  const content = `<div class="page-header"><h1>Users <span class="count-badge">${users.length}</span></h1></div>
    <div class="doc-section" style="margin-bottom:2rem"><h2 class="doc-section-title">Add New User</h2><form method="POST" action="/admin/users/create" style="display:grid;gap:1rem;max-width:520px">${csrfField(req)}<div class="form-group"><label>Full Name</label><input type="text" name="full_name" required placeholder="Jane Smith"></div><div class="form-group"><label>Username</label><input type="text" name="username" required autocomplete="off"></div><div class="form-group"><label>Email</label><input type="email" name="email" placeholder="optional"></div><div class="form-group"><label>Temporary Password</label><input type="password" name="password" required autocomplete="new-password"></div><div class="form-group"><label>Role</label><select name="role">${roleOptions.map(r=>`<option value="${r}">${r}</option>`).join('')}</select></div><button type="submit" class="btn btn-primary">Create User</button></form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No users.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Users', content, 'users', user));
});

app.post('/admin/users/create', requireAdmin, requireSubscription, asyncRoute(async (req, res) => {
  const full_name = str(req.body.full_name, 100), username = str(req.body.username, 100), email = str(req.body.email, 254);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = str(req.body.role, 30);
  const allowed = ['shop_admin','qc_manager','technician','service_writer'];
  if (!allowed.includes(role)) return res.status(400).send('Invalid role');
  if (!username || password.length < 8) return res.redirect('/admin/users?error=1');
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    db.prepare('INSERT INTO users (shop_id,username,email,password_hash,role,full_name,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.session.user.shop_id ?? null, username, email || null, hash, role, full_name, new Date().toISOString());
  } catch(e) { return res.redirect('/admin/users?error=1'); }
  res.redirect('/admin/users');
}));

// Shared checks for changing another user. Returns an error response or null.
function guardUserChange(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).send('Not found');
  const target = db.prepare('SELECT id, shop_id, role FROM users WHERE id=?').get(id);
  const me = req.session.user;
  if (!target) return res.status(404).send('Not found');
  if (target.role === 'platform_admin') return res.status(403).send('Access denied.');
  if (me.role !== 'platform_admin' && target.shop_id !== me.shop_id) return res.status(403).send('Access denied.');
  // An admin demoting or deactivating themselves can lock the shop out of admin.
  if (target.id === me.id) return res.status(400).send('You cannot change your own account here.');
  req.targetUserId = target.id;
  return null;
}

app.post('/admin/users/:id/role', requireAdmin, requireSubscription, (req, res) => {
  const allowed = ['shop_admin','qc_manager','technician','service_writer'];
  if (!allowed.includes(req.body.role)) return res.status(400).send('Invalid role');
  if (guardUserChange(req, res)) return;
  db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.targetUserId);
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/deactivate', requireAdmin, requireSubscription, (req, res) => {
  if (guardUserChange(req, res)) return;
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.targetUserId);
  res.redirect('/admin/users');
});

// ─── Platform Admin ───────────────────────────────────────────────────────────
app.get('/platform/shops', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
  const rows = shops.map(s => {
    const uc = db.prepare('SELECT COUNT(*) as c FROM users WHERE shop_id=?').get(s.id);
    const jc = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE shop_id=?').get(s.id);
    const a = activeAccess(s.id);
    const accessCell = a
      ? `Open until ${escapeHtml(a.expires_at.replace('T',' ').slice(0,16))} UTC (${escapeHtml(ACCESS_REASONS[a.reason_type] || a.reason_type)})<form method="POST" action="/platform/access/${a.id}/close" class="inline-form">${csrfField(req)}<button class="btn btn-sm">Close</button></form>`
      : `<form method="POST" action="/platform/shops/${s.id}/access" class="inline-form access-open-form">${csrfField(req)}<select name="reason_type" required><option value="">Reason…</option>${Object.entries(ACCESS_REASONS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select><input type="text" name="note" maxlength="300" minlength="10" required placeholder="What and why (ticket, matter)"><button class="btn btn-sm">Open read-only</button></form>`;
    return `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(SHOP_STATUS_LABELS[s.subscription_status] || s.subscription_status || 'inactive')}</td><td>${uc.c}</td><td>${jc.c}</td><td>${s.subscription_status === 'removed' ? '<span style="color:#999">—</span>' : accessCell}</td><td>${formatDate(s.created_at)}</td><td>${shopActions(req, s)}</td></tr>`;
  }).join('');
  const flash = consumeFlash(req);
  const content = `${flashHtml(flash)}<div class="page-header"><h1>Shops <span class="count-badge">${shops.length}</span></h1></div>
    <div class="doc-section" style="margin-bottom:2rem"><h2 class="doc-section-title">Onboard New Shop</h2><form method="POST" action="/platform/shops/create" style="display:grid;gap:1rem;max-width:520px">${csrfField(req)}<div class="form-group"><label>Shop Name</label><input type="text" name="shop_name" required></div><div class="form-group"><label>Admin Full Name</label><input type="text" name="admin_full_name" required></div><div class="form-group"><label>Admin Username</label><input type="text" name="admin_username" required autocomplete="off"></div><div class="form-group"><label>Temporary Password</label><input type="password" name="admin_password" required autocomplete="new-password"></div><button type="submit" class="btn btn-primary">Create Shop</button></form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Status</th><th>Users</th><th>Jobs</th><th>Job access</th><th>Created</th><th>Account</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">No shops.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Shops', content, 'shops', req.session.user));
});

app.post('/platform/shops/:id/access', requirePlatformAdmin, (req, res) => {
  const shop = db.prepare('SELECT id, name FROM shops WHERE id=?').get(req.params.id);
  if (!shop) return res.status(404).send('Not found');
  const reasonType = str(req.body.reason_type, 20);
  const note = str(req.body.note, 300);
  if (!ACCESS_REASONS[reasonType]) return res.status(400).send('Choose a reason the terms of service allow.');
  if (note.length < 10) return res.status(400).send('Describe the matter (at least 10 characters).');
  if (!activeAccess(shop.id)) {
    const now = new Date();
    db.prepare('INSERT INTO platform_access (shop_id,opened_by,reason_type,note,opened_at,expires_at) VALUES (?,?,?,?,?,?)')
      .run(shop.id, req.session.user.id, reasonType, note, now.toISOString(), new Date(now.getTime() + ACCESS_HOURS * 3600 * 1000).toISOString());
  }
  res.redirect('/');
});
app.post('/platform/access/:id/close', requirePlatformAdmin, (req, res) => {
  db.prepare('UPDATE platform_access SET closed_at=? WHERE id=? AND closed_at IS NULL').run(new Date().toISOString(), req.params.id);
  res.redirect('/platform/shops');
});
app.get('/platform/access', requirePlatformAdmin, (req, res) => {
  const t = (iso) => iso ? `${escapeHtml(iso.replace('T', ' ').slice(0, 16))} UTC` : '—';
  const sessions = db.prepare(`SELECT a.*, s.name AS shop_name, u.username FROM platform_access a JOIN shops s ON s.id=a.shop_id
    LEFT JOIN users u ON u.id=a.opened_by ORDER BY a.id DESC LIMIT 100`).all();
  const views = db.prepare(`SELECT l.*, s.name AS shop_name FROM platform_access_log l JOIN shops s ON s.id=l.shop_id ORDER BY l.id DESC LIMIT 300`).all();
  const content = `<div class="page-header"><h1>Access Log</h1></div>
    <p class="adas-basis" style="margin-bottom:1rem">Your record of every time shop jobs were opened and every page viewed. It is private to the platform and kept as evidence that access stayed within the terms of service.</p>
    <div class="doc-section"><h2 class="doc-section-title">Access sessions</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Opened</th><th>Shop</th><th>By</th><th>Reason</th><th>Note</th><th>Ends</th><th>Closed</th></tr></thead><tbody>
      ${sessions.map((x) => `<tr><td>${t(x.opened_at)}</td><td>${escapeHtml(x.shop_name)}</td><td>${escapeHtml(x.username || '—')}</td><td>${escapeHtml(ACCESS_REASONS[x.reason_type] || x.reason_type)}</td><td>${escapeHtml(x.note)}</td><td>${t(x.expires_at)}</td><td>${t(x.closed_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">None.</td></tr>'}</tbody></table></div></div>
    <div class="doc-section"><h2 class="doc-section-title">Pages viewed</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Shop</th><th>Page</th></tr></thead><tbody>
      ${views.map((x) => `<tr><td>${t(x.at)}</td><td>${escapeHtml(x.shop_name)}</td><td class="mono">${escapeHtml(x.method)} ${escapeHtml(x.path)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">None.</td></tr>'}</tbody></table></div></div>`;
  res.send(layout('Access Log', content, 'access', req.session.user));
});

app.post('/platform/shops/create', requirePlatformAdmin, asyncRoute(async (req, res) => {
  const shop_name = str(req.body.shop_name, 200), admin_full_name = str(req.body.admin_full_name, 100);
  const admin_username = str(req.body.admin_username, 100);
  const admin_password = typeof req.body.admin_password === 'string' ? req.body.admin_password : '';
  if (!shop_name || !admin_username || !admin_password) return res.status(400).send('Missing required fields');
  if (admin_password.length < 8) return res.status(400).send('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(admin_username)) return res.status(409).send('That username is already taken.');
  const hash = await bcrypt.hash(admin_password, BCRYPT_ROUNDS);
  const now = new Date().toISOString();
  // Shop + admin user together, so a failed user insert never leaves an orphan shop.
  db.exec('BEGIN');
  try {
    const shopId = db.prepare('INSERT INTO shops (name,created_at) VALUES (?,?)').run(shop_name, now).lastInsertRowid;
    db.prepare('INSERT INTO users (shop_id,username,password_hash,role,full_name,created_at) VALUES (?,?,?,?,?,?)')
      .run(shopId, admin_username, hash, 'shop_admin', admin_full_name, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[platform/shops/create]', err.message);
    return res.status(400).send('Could not create shop.');
  }
  res.redirect('/platform/shops');
}));

// ─── Platform Admin: account removal ─────────────────────────────────────────
// Removing an account turns its sign-in off; it is reversible. Permanent delete
// is allowed only for accounts that never touched a job, because a user's name
// on a calibration record, sign-off, photo or assignment is part of that shop's
// paperwork and must keep pointing at a real account.
const SHOP_STATUS_LABELS = { active: 'active (Stripe)', trialing: 'trialing (Stripe)', comp: 'complimentary', removed: 'removed', inactive: 'inactive' };
const USER_HISTORY_CHECKS = [
  'SELECT 1 FROM jobs WHERE created_by=?',
  'SELECT 1 FROM job_photos WHERE uploaded_by=?',
  'SELECT 1 FROM job_calibrations WHERE created_by=? OR voided_by=?',
  'SELECT 1 FROM job_calibration_files WHERE uploaded_by=?',
  'SELECT 1 FROM job_signoffs WHERE user_id=?',
  'SELECT 1 FROM job_assignments WHERE user_id=? OR assigned_by=? OR removed_by=?',
  'SELECT 1 FROM platform_access WHERE opened_by=?',
  'SELECT 1 FROM platform_access_log WHERE user_id=?',
].map((sql) => {
  // Never let a schema surprise stop the server from booting. A check that
  // can't run counts as "has history", so the account can't be deleted.
  try { return { stmt: db.prepare(sql + ' LIMIT 1'), n: (sql.match(/\?/g) || []).length }; }
  catch (err) { console.error(`[account history] check disabled (${err.message}): ${sql}`); return null; }
});
function userHasHistory(id) {
  return USER_HISTORY_CHECKS.some((c) => !c || Boolean(c.stmt.get(...Array(c.n).fill(id))));
}
function shopDeleteBlocker(shopId) {
  if (db.prepare('SELECT 1 FROM jobs WHERE shop_id=? LIMIT 1').get(shopId)) return 'it has jobs';
  if (db.prepare('SELECT 1 FROM platform_access WHERE shop_id=? LIMIT 1').get(shopId)) return 'the access log references it';
  const users = db.prepare('SELECT id FROM users WHERE shop_id=?').all(shopId);
  if (users.some((u) => userHasHistory(u.id))) return 'one of its users has job history';
  return null;
}
function flashHtml(flash) {
  if (!flash) return '';
  const ok = flash.type === 'success';
  return `<div style="background:${ok ? '#D6F0D6' : '#FFD6D6'};color:${ok ? '#1A6B1A' : '#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem">${escapeHtml(flash.msg)}</div>`;
}
function postButton(req, action, label, confirmText, cls = 'btn btn-sm') {
  return `<form method="POST" action="${action}" class="inline-form"${confirmText ? ` data-confirm="${escapeHtml(confirmText)}"` : ''}>${csrfField(req)}<button class="${cls}">${label}</button></form>`;
}
function shopActions(req, s) {
  const base = `/platform/shops/${s.id}`;
  if (s.subscription_status === 'removed') {
    const del = shopDeleteBlocker(s.id) ? '' : postButton(req, `${base}/delete`, 'Delete permanently', `Permanently delete ${s.name} and its user accounts? This cannot be undone.`, 'btn btn-sm btn-ghost');
    return postButton(req, `${base}/restore`, 'Restore') + del;
  }
  let out = '';
  if (s.subscription_status === 'comp') out += postButton(req, `${base}/comp/end`, 'End complimentary');
  else if (!s.stripe_customer_id && !['active', 'trialing'].includes(s.subscription_status)) out += postButton(req, `${base}/comp`, 'Give complimentary access');
  out += postButton(req, `${base}/remove`, 'Remove shop', `Remove ${s.name}? Every user in this shop is signed out and can no longer sign in. Their records are kept, and you can restore the shop later.`, 'btn btn-sm btn-ghost');
  return out;
}
function platformShop(req, res) {
  const shop = db.prepare('SELECT * FROM shops WHERE id=?').get(Number.parseInt(req.params.id, 10));
  if (!shop) { res.status(404).send('Not found'); return null; }
  return shop;
}

app.post('/platform/shops/:id/comp', requirePlatformAdmin, (req, res) => {
  const shop = platformShop(req, res); if (!shop) return;
  if (shop.stripe_customer_id || ['active', 'trialing', 'removed'].includes(shop.subscription_status)) {
    setFlash(req, 'error', `${shop.name} is billed through Stripe or removed; complimentary access is for shops without a subscription.`);
  } else {
    db.prepare("UPDATE shops SET subscription_status='comp' WHERE id=?").run(shop.id);
    setFlash(req, 'success', `${shop.name} now has complimentary access.`);
  }
  res.redirect('/platform/shops');
});
app.post('/platform/shops/:id/comp/end', requirePlatformAdmin, (req, res) => {
  const shop = platformShop(req, res); if (!shop) return;
  if (shop.subscription_status === 'comp') {
    db.prepare("UPDATE shops SET subscription_status='inactive' WHERE id=?").run(shop.id);
    setFlash(req, 'success', `Complimentary access ended for ${shop.name}.`);
  }
  res.redirect('/platform/shops');
});
app.post('/platform/shops/:id/remove', requirePlatformAdmin, (req, res) => {
  const shop = platformShop(req, res); if (!shop) return;
  if (shop.subscription_status !== 'removed') {
    db.exec('BEGIN');
    try {
      const off = db.prepare("UPDATE users SET active=0, off_with_shop=1 WHERE shop_id=? AND active=1 AND role!='platform_admin'").run(shop.id).changes;
      db.prepare("UPDATE shops SET subscription_status='removed' WHERE id=?").run(shop.id);
      db.prepare('UPDATE platform_access SET closed_at=? WHERE shop_id=? AND closed_at IS NULL').run(new Date().toISOString(), shop.id);
      db.exec('COMMIT');
      setFlash(req, 'success', `${shop.name} removed. ${off} user account(s) turned off.${shop.stripe_customer_id ? ' Cancel its Stripe subscription in Stripe as well.' : ''}`);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('[platform/shops/remove]', err.message);
      setFlash(req, 'error', `Could not remove ${shop.name}.`);
    }
  }
  res.redirect('/platform/shops');
});
app.post('/platform/shops/:id/restore', requirePlatformAdmin, (req, res) => {
  const shop = platformShop(req, res); if (!shop) return;
  if (shop.subscription_status === 'removed') {
    db.exec('BEGIN');
    try {
      const on = db.prepare('UPDATE users SET active=1, off_with_shop=0 WHERE shop_id=? AND off_with_shop=1').run(shop.id).changes;
      db.prepare("UPDATE shops SET subscription_status='inactive' WHERE id=?").run(shop.id);
      db.exec('COMMIT');
      setFlash(req, 'success', `${shop.name} restored with ${on} user account(s). Its status is inactive until it subscribes or you give complimentary access.`);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('[platform/shops/restore]', err.message);
      setFlash(req, 'error', `Could not restore ${shop.name}.`);
    }
  }
  res.redirect('/platform/shops');
});
app.post('/platform/shops/:id/delete', requirePlatformAdmin, (req, res) => {
  const shop = platformShop(req, res); if (!shop) return;
  const blocker = shop.subscription_status !== 'removed' ? 'remove it first' : shopDeleteBlocker(shop.id);
  if (blocker) {
    setFlash(req, 'error', `${shop.name} cannot be deleted: ${blocker}. It stays removed.`);
    return res.redirect('/platform/shops');
  }
  db.exec('BEGIN');
  try {
    const users = db.prepare('DELETE FROM users WHERE shop_id=?').run(shop.id).changes;
    db.prepare('DELETE FROM shops WHERE id=?').run(shop.id);
    db.exec('COMMIT');
    setFlash(req, 'success', `${shop.name} and ${users} user account(s) deleted.`);
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[platform/shops/delete]', err.message);
    setFlash(req, 'error', `Could not delete ${shop.name}.`);
  }
  res.redirect('/platform/shops');
});

app.get('/platform/accounts', requirePlatformAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.full_name, u.username, u.email, u.role, u.active, u.created_at, s.name AS shop_name, s.subscription_status AS shop_status
    FROM users u LEFT JOIN shops s ON s.id=u.shop_id ORDER BY (s.name IS NULL) DESC, s.name, u.role, u.username`).all();
  const rows = users.map((u) => {
    let actions = '<span style="color:#999">—</span>';
    if (u.role !== 'platform_admin') {
      const who = `${u.username}${u.shop_name ? ` (${u.shop_name})` : ''}`;
      const toggle = u.active
        ? postButton(req, `/platform/accounts/${u.id}/deactivate`, 'Deactivate', `Turn off ${who}? They are signed out right away.`)
        : (u.shop_status === 'removed' ? '<span class="adas-basis">Restore the shop first</span>' : u.role === 'guest' ? '' : postButton(req, `/platform/accounts/${u.id}/reactivate`, 'Reactivate'));
      const del = userHasHistory(u.id)
        ? '<span class="adas-basis" title="Their name is on job records, so the account is kept.">Has job history</span>'
        : postButton(req, `/platform/accounts/${u.id}/delete`, 'Delete', `Permanently delete ${who}? This cannot be undone.`, 'btn btn-sm btn-ghost');
      actions = toggle + del;
    }
    return `<tr><td>${escapeHtml(u.shop_name || '—')}</td><td>${escapeHtml(u.full_name || '—')}</td><td class="mono">${escapeHtml(u.username)}</td><td><span class="badge badge-blue">${escapeHtml(u.role)}</span></td><td><span class="badge badge-${u.active ? 'green' : 'gray'}">${u.active ? 'Active' : 'Inactive'}</span></td><td>${formatDate(u.created_at)}</td><td>${actions}</td></tr>`;
  }).join('');
  const content = `${flashHtml(consumeFlash(req))}<div class="page-header"><h1>Accounts <span class="count-badge">${users.length}</span></h1></div>
    <p class="adas-basis" style="margin-bottom:1rem">Every sign-in on the platform. Deactivate turns an account off and signs it out; it can be turned back on. Delete is only offered for accounts that never worked on a job; anyone whose name is on a record stays, deactivated, so the shop's paperwork still shows who did the work. To take a whole shop off the platform, use Remove on the Shops page.</p>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">No accounts.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Accounts', content, 'accounts', req.session.user));
});
function platformTargetUser(req, res) {
  const u = db.prepare('SELECT u.*, s.subscription_status AS shop_status FROM users u LEFT JOIN shops s ON s.id=u.shop_id WHERE u.id=?').get(Number.parseInt(req.params.id, 10));
  if (!u) { res.status(404).send('Not found'); return null; }
  if (u.role === 'platform_admin') { res.status(403).send('Access denied.'); return null; }
  return u;
}
app.post('/platform/accounts/:id/deactivate', requirePlatformAdmin, (req, res) => {
  const u = platformTargetUser(req, res); if (!u) return;
  db.prepare('UPDATE users SET active=0, off_with_shop=0 WHERE id=?').run(u.id);
  setFlash(req, 'success', `${u.username} deactivated and signed out.`);
  res.redirect('/platform/accounts');
});
app.post('/platform/accounts/:id/reactivate', requirePlatformAdmin, (req, res) => {
  const u = platformTargetUser(req, res); if (!u) return;
  if (u.role === 'guest') setFlash(req, 'error', 'Guest accounts stay off; guest login was removed.');
  else if (u.shop_status === 'removed') setFlash(req, 'error', `${u.username}'s shop is removed. Restore the shop first.`);
  else { db.prepare('UPDATE users SET active=1, off_with_shop=0 WHERE id=?').run(u.id); setFlash(req, 'success', `${u.username} reactivated.`); }
  res.redirect('/platform/accounts');
});
app.post('/platform/accounts/:id/delete', requirePlatformAdmin, (req, res) => {
  const u = platformTargetUser(req, res); if (!u) return;
  if (userHasHistory(u.id)) {
    setFlash(req, 'error', `${u.username} has job history, so the account is kept. Deactivate it instead.`);
  } else {
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    setFlash(req, 'success', `${u.username} deleted.`);
  }
  res.redirect('/platform/accounts');
});

app.get('/platform/billing', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY name ASC').all();
  const rows = shops.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.subscription_status||'inactive')}</td><td>${escapeHtml(s.stripe_customer_id||'—')}</td><td>${formatDate(s.created_at)}</td></tr>`).join('');
  const content = `<div class="page-header"><h1>Billing Overview</h1></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Status</th><th>Stripe Customer</th><th>Joined</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">No shops.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Billing', content, 'billing', req.session.user));
});

// ─── ADAS Reference ───────────────────────────────────────────────────────────
app.get('/reference', requireAuth, requireSubscription, (req, res) => {
  const makes = ['Toyota','Lexus','Ford','Lincoln','Chevrolet','GMC','Buick','Cadillac','Chrysler','Dodge','Ram','Jeep','Honda','Acura','Nissan','Infiniti','Kia','Hyundai','Genesis','Subaru','Mazda','Mercedes-Benz','Jaguar','Land Rover','Volvo','Tesla'];
  const makeOptions = makes.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  const years = []; for (let y=2026;y>=2010;y--) years.push(y);
  const yearOptions = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const content = `<div class="page-header"><h1>ADAS OEM Reference</h1></div>
    <div class="ref-lookup-card"><form method="GET" action="/reference/lookup" class="ref-form"><div class="ref-form-steps">
      <div class="ref-step"><div class="ref-step-label">Make</div><select name="make" required class="ref-select"><option value="">— Select —</option>${makeOptions}</select></div>
      <div class="ref-step"><div class="ref-step-label">Model</div><input type="text" name="model" placeholder="e.g. Camry" class="ref-input"></div>
      <div class="ref-step"><div class="ref-step-label">Year</div><select name="year" class="ref-select">${yearOptions}</select></div>
      <div class="ref-step"><button type="submit" class="btn btn-primary btn-lg">Look Up</button></div>
    </div></form></div>`;
  res.send(layout('ADAS Reference', content, 'reference', req.session.user));
});

app.get('/reference/lookup', requireAuth, requireSubscription, (req, res) => {
  const make = str(req.query.make, 50), model = str(req.query.model, 50), year = str(req.query.year, 4);
  if (!make) return res.redirect('/reference');
  const allRepairs = ['Windshield','Front Camera Area','Front Bumper','Rear Bumper','Radar','Wheel Alignment','Suspension','Door','Mirror','Airbag','SRS'];
  const full = runADASEngine(make, model, year, allRepairs);
  const adasList = full.adasSystems.split('\n').filter(Boolean);
  const content = `
    <div class="ref-back-bar no-print"><a href="/reference" class="btn btn-ghost">&larr; New Lookup</a></div>
    <div class="ref-card">
      <div class="ref-card-header"><div><div class="ref-card-brand">CollisionIQ — ADAS OEM Reference</div><div class="ref-card-vehicle">${escapeHtml([year,make,model].filter(Boolean).join(' '))}</div></div><div class="ref-card-actions no-print"><button type="button" data-action="print" class="btn btn-white">&#128438; Print</button></div></div>
      <section class="ref-section"><h2 class="ref-section-title">Scan Requirements</h2>
        <div class="ref-scan-grid">
          <div class="ref-scan-item"><div>Pre-Repair Scan</div><span class="badge scan-badge scan-badge-${scanBadgeClass(full.preScanRequired)}">${escapeHtml(scanBadgeLabel(full.preScanRequired))}</span></div>
          <div class="ref-scan-item"><div>Post-Repair Scan</div><span class="badge scan-badge scan-badge-${scanBadgeClass(full.postScanRequired)}">${escapeHtml(scanBadgeLabel(full.postScanRequired))}</span></div>
        </div>
        <div class="ref-tool-row"><span class="ref-tool-label">&#128295; Approved Scan Tool</span><span class="ref-tool-value">${escapeHtml(full.approvedScanTool)}</span></div>
      </section>
      <section class="ref-section"><h2 class="ref-section-title">Calibration Requirements</h2><ul class="adas-list">${adasList.map(s=>`<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}</ul></section>
      <section class="ref-section"><h2 class="ref-section-title">Liability Notice</h2><div class="warning-box"><span class="warning-icon">&#9888;</span><p>${escapeHtml(full.liabilityWarning)}</p></div></section>
      ${!JOB_EDITORS.includes(req.session.user.role) ? '' : `<section class="ref-section no-print"><a href="/new?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model||'')}&year=${encodeURIComponent(year||'')}" class="btn btn-primary btn-lg">+ Start New Job — ${escapeHtml(make)}</a></section>`}
    </div>`;
  res.send(layout(`ADAS Reference — ${make}`, content, 'reference', req.session.user));
});

// ─── OEM Calibration Evaluation API ───────────────────────────────────────────
// JSON body: { _csrf, make, model, year, lineItems: [eventId...], dtcs: [code...],
//             collisionRelated?: boolean, equipped?: { SYSTEM_ID: boolean } }
// lineItems are repair event IDs: oemCalibrationRules.EVENTS (Honda/Acura),
// oemFordPosition.EVENTS (all Ford / Lincoln) or COMMON_EVENTS (all makes).
// CSRF is enforced by the global verifyCsrf middleware via the _csrf body field.
const OEM_MAX_ITEMS = 100;
function oemStringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
  if (value.length > OEM_MAX_ITEMS) throw new Error(`${field} may contain at most ${OEM_MAX_ITEMS} entries.`);
  return value.map((v) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 64) throw new Error(`${field} entries must be non-empty strings (max 64 chars).`);
    return v.trim();
  });
}

app.post('/api/oem/evaluate', requireAuth, requireSubscription, (req, res) => {
  const { make, model, year } = req.body || {};
  if (typeof make !== 'string' || !make.trim() || make.length > 64) {
    return res.status(400).json({ error: 'make is required (string, max 64 chars).' });
  }
  if (model !== undefined && model !== null && (typeof model !== 'string' || model.length > 64)) {
    return res.status(400).json({ error: 'model must be a string (max 64 chars).' });
  }
  if (year !== undefined && year !== null && year !== '' && !/^\d{4}$/.test(String(year))) {
    return res.status(400).json({ error: 'year must be a 4-digit year.' });
  }

  let events, dtcs;
  try {
    events = oemStringList(req.body.lineItems, 'lineItems');
    dtcs = oemStringList(req.body.dtcs, 'dtcs');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { collisionRelated, equipped } = req.body;
  if (collisionRelated !== undefined && collisionRelated !== null && typeof collisionRelated !== 'boolean') {
    return res.status(400).json({ error: 'collisionRelated must be true or false.' });
  }
  let equippedClean;
  if (equipped !== undefined && equipped !== null) {
    const entries = typeof equipped === 'object' && !Array.isArray(equipped) ? Object.entries(equipped) : null;
    if (!entries || entries.length > 20 || entries.some(([k, v]) => !/^[A-Z0-9_]{1,32}$/.test(k) || typeof v !== 'boolean')) {
      return res.status(400).json({ error: 'equipped must be an object of SYSTEM_ID: true/false.' });
    }
    equippedClean = Object.fromEntries(entries);
  }

  try {
    const result = oemRules.evaluate({
      make: make.trim(), model: model ? model.trim() : null, year, events, dtcs,
      ...(collisionRelated === true ? { collisionRelated: true } : {}),
      ...(equippedClean ? { equipped: equippedClean } : {}),
    });
    res.json(result);
  } catch (err) {
    console.error('[oem/evaluate]', err);
    res.status(500).json({ error: 'OEM evaluation failed.' });
  }
});

// ─── Seed Platform Admin ──────────────────────────────────────────────────────
async function seedPlatformAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role='platform_admin'").get();
  if (existing) return;

  let pw = process.env.PLATFORM_ADMIN_PASSWORD;
  let generated = false;
  if (!pw) {
    pw = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
  const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
  db.prepare("INSERT INTO users (shop_id,username,password_hash,role,full_name,created_at) VALUES (NULL,'platform_admin',?,'platform_admin','Cueljuris LLC',?)")
    .run(hash, new Date().toISOString());

  if (generated) {
    console.log('───────────────────────────────────────────────');
    console.log('Platform admin created (no PLATFORM_ADMIN_PASSWORD set).');
    console.log(`  Username: platform_admin`);
    console.log(`  One-time password: ${pw}`);
    console.log('  Set PLATFORM_ADMIN_PASSWORD and change this after first login.');
    console.log('───────────────────────────────────────────────');
  } else {
    console.log('Platform admin created from PLATFORM_ADMIN_PASSWORD env var.');
  }
}

// ─── One-time platform_admin password reset ───────────────────────────────────
// For hosts without shell access. Same rules as scripts/set-platform-admin-password.js.
// Set PLATFORM_ADMIN_PASSWORD_RESET, deploy once, then remove the variable.
// Never logs the value; logs the target username (quoted, so stray spaces show).
// Any problem is logged briefly and boot continues unchanged.
const KNOWN_DEFAULT_PASSWORDS = ['changeme123', 'demo1234', 'localadmin123'];
const DEMO_USERNAMES = ['metro_admin','metro_qc','metro_tech1','metro_tech2','metro_writer','north_admin','north_qc','north_tech1','north_writer',
  'south_admin','south_qc','south_tech1','south_writer','premier_admin','premier_qc','premier_tech1','premier_tech2','premier_writer',
  'gulf_admin','gulf_qc','gulf_tech1','gulf_writer'];
const DEMO_SHOP_NAMES = ['Metro Collision Center','Northside Auto Repair','Southbelt Body Works','Premier ADAS & Collision','Gulf Coast Auto Service'];

async function applyPlatformAdminPasswordReset() {
  const pw = process.env.PLATFORM_ADMIN_PASSWORD_RESET;
  if (!pw) return;
  try {
    // One-line diagnostic before any rule runs. Never the value or the hash.
    {
      const name = process.env.PLATFORM_ADMIN_USERNAME || 'platform_admin';
      const u = db.prepare("SELECT active, shop_id, password_hash FROM users WHERE username=? AND role='platform_admin'").get(name);
      console.log(u
        ? `platform_admin reset diagnostic: username=${JSON.stringify(name)} active=${u.active} shop_id=${u.shop_id === null ? 'null' : u.shop_id} env_matches_stored_hash=${Boolean(u.password_hash) && await bcrypt.compare(pw, u.password_hash)}`
        : `platform_admin reset diagnostic: username=${JSON.stringify(name)} not found with role platform_admin`);
    }
    // Pasted values often pick up a trailing newline or space. That would be hashed as
    // part of the password, so the typed password would never match. Refuse instead.
    if (/[\r\n\u2028\u2029]/.test(pw)) return console.log('platform_admin password reset skipped: value contains a line break.');
    if (pw !== pw.trim()) return console.log('platform_admin password reset skipped: value has leading or trailing whitespace.');
    if (pw.length < 12) return console.log('platform_admin password reset skipped: value is shorter than 12 characters.');
    if (KNOWN_DEFAULT_PASSWORDS.includes(pw)) return console.log('platform_admin password reset skipped: value is a known default.');
    const username = process.env.PLATFORM_ADMIN_USERNAME || 'platform_admin';
    const who = JSON.stringify(username);
    const user = db.prepare("SELECT id, active, password_hash FROM users WHERE username=? AND role='platform_admin'").get(username);
    if (!user) return console.log(`platform_admin password reset skipped: no platform_admin user with username ${who}.`);

    // The variable stays set across restarts; don't re-hash or sign out again each boot.
    if (user.password_hash && await bcrypt.compare(pw, user.password_hash)) {
      console.log(`platform_admin password reset already applied to username ${who}; remove PLATFORM_ADMIN_PASSWORD_RESET.`);
    } else {
      const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
      const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
      if (r.changes !== 1) return console.log(`platform_admin password reset skipped: update did not apply to username ${who}.`);
      sessionDb.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.user.id') = ?").run(user.id);
      console.log(`platform_admin password reset applied to username ${who}`);
      if (!user.active) console.log(`Note: username ${who} is marked inactive, so it still cannot sign in.`);
    }

    // Read-only check: demo accounts must never exist in production.
    const marks = (list) => list.map(() => '?').join(',');
    const demo = db.prepare(`SELECT username FROM users WHERE username IN (${marks(DEMO_USERNAMES)})`).all(...DEMO_USERNAMES).map((x) => x.username);
    const demoShops = db.prepare(`SELECT name FROM shops WHERE name IN (${marks(DEMO_SHOP_NAMES)})`).all(...DEMO_SHOP_NAMES).map((x) => x.name);
    if (demo.length || demoShops.length) {
      console.log(`WARNING: demo seed data present. Accounts: ${demo.join(', ') || 'none'}. Shops: ${demoShops.join(', ') || 'none'}.`);
      console.log('         These share a publicly known demo password. Deactivate or remove them.');
    }
  } catch (err) {
    console.log(`platform_admin password reset failed: ${err && err.message ? err.message : 'unknown error'}`);
  }
}

// ─── Error handler ────────────────────────────────────────────────────────────
// Last in the chain: anything thrown (or passed to next(err)) ends here instead
// of crashing the process or leaking a stack trace to the browser.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  const status = err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: status === 500 ? 'Internal error.' : 'Bad request.' });
  res.status(status).send(status === 500 ? 'Something went wrong. Please try again.' : 'Bad request.');
});

// ─── Start ────────────────────────────────────────────────────────────────────
seedPlatformAdmin().then(applyPlatformAdminPasswordReset).then(() => {
  app.listen(PORT, () => console.log(`CollisionIQ running on http://localhost:${PORT}`));
});
