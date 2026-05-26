'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const fs         = require('fs');
const bcrypt     = require('bcrypt');
const session    = require('express-session');
const multer     = require('multer');
const SQLiteStore = require('connect-sqlite3')(session);
const { DatabaseSync } = require('node:sqlite');
const Stripe     = require('stripe');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Stripe ───────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' });

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
`);

// safe column additions
const addCols = [
  ['jobs','mileage','TEXT'], ['jobs','service_date','TEXT'], ['jobs','assigned_tech','TEXT'],
  ['jobs','impact_areas','TEXT'], ['jobs','photo_status','TEXT'],
];
for (const [tbl, col, def] of addCols) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch(e) {}
}

// ─── Stripe billing migration ─────────────────────────────────────────────────
for (const [col, def] of [
  ['stripe_customer_id','TEXT'], ['stripe_subscription_id','TEXT'],
  ['subscription_status',"TEXT DEFAULT 'inactive'"],
  ['subscription_current_period_end','INTEGER'], ['grace_period_end','INTEGER'],
]) {
  try { db.exec(`ALTER TABLE shops ADD COLUMN ${col} ${def}`); } catch(e) {}
}

// ─── ADAS Engine ──────────────────────────────────────────────────────────────
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
function generateJobId() {
  const d = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `CIQ-${d}-${Math.floor(1000+Math.random()*9000)}`;
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
  let navLinks = '';
  if (role === 'platform_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}${nav('/admin','admin','Admin')}${nav('/platform/shops','shops','Shops')}${nav('/platform/billing','billing','Billing')}<a href="/logout">Logout</a>`;
  } else if (role === 'shop_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}${nav('/admin','admin','Admin')}${nav('/ad
