'use strict';

const express = require('express');
const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { runADASEngine } = require('./adasEngine');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup ───────────────────────────────────────────────────────────

const dbPath = process.env.DB_PATH || path.join(__dirname, 'collisioniq.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId            TEXT UNIQUE,
    ro               TEXT,
    vin              TEXT,
    year             TEXT,
    make             TEXT,
    model            TEXT,
    trim             TEXT,
    technicianName   TEXT,
    repairsPerformed TEXT,
    adasSystems      TEXT,
    rationale        TEXT,
    liabilityWarning TEXT,
    makeSpecificNotes TEXT,
    status           TEXT DEFAULT 'Created',
    shareToken       TEXT,
    shareUrl         TEXT,
    createdAt        TEXT,
    updatedAt        TEXT
  )
`);

// Migration: add scan requirement and tool columns if not present
for (const col of ['preScanRequired', 'postScanRequired', 'approvedScanTool']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch (e) {}
}

// Step 1 — New column migrations
for (const col of ['track', 'collision_grade', 'mileage', 'service_date', 'assigned_tech', 'return_mileage', 'return_date']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch (e) {}
}

// Step 1 — New tables
db.exec(`
  CREATE TABLE IF NOT EXISTS vin_flags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id         INTEGER NOT NULL,
    vin             TEXT NOT NULL,
    item_type       TEXT NOT NULL,
    sub_item        TEXT,
    grade           TEXT NOT NULL,
    origin_job_id   TEXT NOT NULL,
    date_flagged    TEXT NOT NULL,
    status          TEXT DEFAULT 'OPEN',
    resolved_job_id TEXT,
    date_resolved   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS grade_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         TEXT NOT NULL,
    shop_id        INTEGER NOT NULL,
    tech_name      TEXT NOT NULL,
    item_type      TEXT NOT NULL,
    sub_item       TEXT,
    grade          TEXT NOT NULL,
    previous_grade TEXT,
    timestamp      TEXT DEFAULT (datetime('now')),
    note           TEXT
  );

  CREATE TABLE IF NOT EXISTS job_service_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    item_type  TEXT NOT NULL,
    sub_item   TEXT,
    grade      TEXT,
    measurement TEXT,
    note       TEXT,
    tech_name  TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       TEXT NOT NULL,
    layer        INTEGER NOT NULL,
    category     TEXT NOT NULL,
    filename     TEXT NOT NULL,
    tech_name    TEXT,
    damage_grade TEXT,
    uploaded_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_checkpoints (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            TEXT NOT NULL,
    checkpoint_index  INTEGER NOT NULL,
    label             TEXT NOT NULL,
    completed         INTEGER DEFAULT 0,
    completed_by      TEXT,
    completed_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS share_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked    INTEGER DEFAULT 0
  );
`);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Uploads directory (photo storage)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 20 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadsDir));

// No auth yet — placeholder shop ID for flag/audit tables
const DEFAULT_SHOP_ID = 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateJobId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `CIQ-${date}-${rand}`;
}

function statusClass(status) {
  switch (status) {
    case 'Created':              return 'blue';
    case 'In Progress':          return 'orange';
    case 'Calibration Complete': return 'green';
    case 'Closed':               return 'gray';
    default:                     return 'blue';
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function scanBadgeClass(status) {
  const s = (status || '').toUpperCase();
  if (s.startsWith('REQUIRED'))              return 'red';
  if (s.startsWith('STRONGLY RECOMMENDED') ||
      s.startsWith('HIGHLY RECOMMENDED') ||
      s.startsWith('IMPERATIVE'))            return 'amber';
  return 'blue';  // RECOMMENDED and fallback
}

// Extract just the lead keyword for the compact badge label
function scanBadgeLabel(status) {
  const s = (status || '').toUpperCase();
  if (s.startsWith('REQUIRED'))              return 'REQUIRED';
  if (s.startsWith('STRONGLY RECOMMENDED'))  return 'STRONGLY RECOMMENDED';
  if (s.startsWith('HIGHLY RECOMMENDED'))    return 'HIGHLY RECOMMENDED';
  if (s.startsWith('IMPERATIVE'))            return 'IMPERATIVE';
  return 'RECOMMENDED';
}

// ─── Grade / Flag Helpers ─────────────────────────────────────────────────────

// Checkpoint labels for MODERATE collision jobs
const CHECKPOINT_LABELS = [
  'Pre-repair scan complete — DTCs documented',
  'Structural repair complete — frame inspection signed off',
  'Panel replacement complete — ADAS sensor mounting points inspected',
  'ADAS calibration setup — targets placed, tool connected',
  'Calibration performed — readings documented',
  'Post-repair scan complete — no ADAS-related DTCs remaining',
  'Road test / dynamic verification complete',
  'QC Manager final sign-off',
];

/**
 * Save a graded service item, write audit trail, and apply flag logic.
 * grade must be 'GREEN', 'YELLOW', or 'RED' (or empty/null to skip flag logic).
 */
function applyGradeFlag(vin, shopId, jobId, techName, itemType, subItem, grade, prevGrade, measurement, note) {
  const now = new Date().toISOString();
  const sub = subItem || null;

  // 1. Save service item
  db.prepare(`
    INSERT INTO job_service_items (job_id, item_type, sub_item, grade, measurement, note, tech_name, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(jobId, itemType, sub, grade || null, measurement || null, note || null, techName, now);

  // 2. Audit trail
  db.prepare(`
    INSERT INTO grade_audit (job_id, shop_id, tech_name, item_type, sub_item, grade, previous_grade, timestamp, note)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(jobId, shopId, techName, itemType, sub, grade || '', prevGrade || null, now, note || null);

  if (!grade || !vin) return;

  const findOpen = db.prepare(`
    SELECT id, grade FROM vin_flags
    WHERE vin=? AND shop_id=? AND item_type=?
      AND (sub_item IS ? OR sub_item = ?)
      AND status IN ('OPEN','ESCALATED')
    ORDER BY id DESC LIMIT 1
  `);

  if (grade === 'GREEN') {
    const existing = findOpen.get(vin, shopId, itemType, sub, sub);
    if (existing) {
      db.prepare(`UPDATE vin_flags SET status='RESOLVED', resolved_job_id=?, date_resolved=? WHERE id=?`)
        .run(jobId, now.slice(0, 10), existing.id);
    }
  } else if (grade === 'YELLOW') {
    db.prepare(`
      INSERT INTO vin_flags (shop_id, vin, item_type, sub_item, grade, origin_job_id, date_flagged)
      VALUES (?,?,?,?,?,?,?)
    `).run(shopId, vin, itemType, sub, 'YELLOW', jobId, now.slice(0, 10));
  } else if (grade === 'RED') {
    const existing = findOpen.get(vin, shopId, itemType, sub, sub);
    if (existing && existing.grade === 'YELLOW') {
      db.prepare(`UPDATE vin_flags SET status='ESCALATED' WHERE id=?`).run(existing.id);
    }
    db.prepare(`
      INSERT INTO vin_flags (shop_id, vin, item_type, sub_item, grade, origin_job_id, date_flagged)
      VALUES (?,?,?,?,?,?,?)
    `).run(shopId, vin, itemType, sub, 'RED', jobId, now.slice(0, 10));
  }
}

/** Server-side grade button HTML (used in tech view form) */
function gradeButtonHtml(fieldId, currentGrade) {
  const g = currentGrade || '';
  return `<input type="hidden" name="${escapeHtml(fieldId)}" id="${escapeHtml(fieldId)}" value="${escapeHtml(g)}">
    <div class="grade-btn-row" data-target="${escapeHtml(fieldId)}">
      <button type="button" class="grade-btn grade-green${g === 'GREEN' ? ' selected' : ''}" data-grade="GREEN">GREEN</button>
      <button type="button" class="grade-btn grade-yellow${g === 'YELLOW' ? ' selected' : ''}" data-grade="YELLOW">YELLOW</button>
      <button type="button" class="grade-btn grade-red${g === 'RED' ? ' selected' : ''}" data-grade="RED">RED</button>
    </div>`;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function layout(title, content, activeNav = '') {
  const nav = (href, key, label) =>
    `<a href="${href}" class="${activeNav === key ? 'active' : ''}">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — CollisionIQ</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <a href="/" class="brand-logo">CollisionIQ</a>
        <span class="brand-tagline">ADAS Calibration Documentation Platform</span>
      </div>
      <nav class="main-nav">
        ${nav('/', 'list', 'Jobs')}
        ${nav('/new', 'new', 'New Job')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        ${nav('/dashboard/flags', 'flags', 'Open Flags')}
        ${nav('/admin', 'admin', 'Admin')}
      </nav>
    </div>
  </header>

  <main class="main-content">
    ${content}
  </main>

  <footer class="site-footer">
    <p>&copy; 2026 Cueljuris LLC &mdash; CollisionIQ Platform</p>
  </footer>
</body>
</html>`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET / — Jobs list
app.get('/', (req, res) => {
  const search = (req.query.search || '').trim();
  let jobs;

  if (search) {
    const q = `%${search}%`;
    jobs = db
      .prepare(`SELECT * FROM jobs WHERE ro LIKE ? OR vin LIKE ? OR technicianName LIKE ? ORDER BY createdAt DESC`)
      .all(q, q, q);
  } else {
    jobs = db.prepare(`SELECT * FROM jobs ORDER BY createdAt DESC`).all();
  }

  const rows = jobs.map(j => `
    <tr>
      <td><span class="job-id">${escapeHtml(j.jobId)}</span></td>
      <td>${escapeHtml(j.ro) || '&mdash;'}</td>
      <td class="mono">${j.vin ? escapeHtml(j.vin.slice(-6)) : '&mdash;'}</td>
      <td>${escapeHtml(j.year)} ${escapeHtml(j.make)} ${escapeHtml(j.model)}</td>
      <td>${escapeHtml(j.technicianName) || '&mdash;'}</td>
      <td><span class="badge badge-${statusClass(j.status)}">${escapeHtml(j.status)}</span></td>
      <td>${formatDate(j.createdAt)}</td>
      <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
    </tr>`).join('');

  const content = `
    <div class="page-header">
      <h1>Jobs <span class="count-badge">${jobs.length}</span></h1>
      <a href="/new" class="btn btn-primary">+ New Job</a>
    </div>

    <div class="search-bar">
      <form method="GET" action="/">
        <input type="text" name="search" placeholder="Search by RO#, VIN, or Technician name&hellip;"
               value="${escapeHtml(search)}">
        <button type="submit" class="btn">Search</button>
        ${search ? '<a href="/" class="btn btn-ghost">Clear</a>' : ''}
      </form>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>RO #</th>
            <th>VIN (last 6)</th>
            <th>Vehicle</th>
            <th>Technician</th>
            <th>Status</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="8" class="empty">No jobs found.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  res.send(layout('Jobs', content, 'list'));
});

// GET /new — New job form (track selector → GM or Collision)
app.get('/new', (req, res) => {
  const prefill = {
    make:  req.query.make  || '',
    model: req.query.model || '',
    year:  req.query.year  || '',
  };

  const repairOptions = [
    'Windshield',
    'Front Camera Area',
    'Front Bumper',
    'Rear Bumper',
    'Radar',
    'Structural Body Repair',
    'Airbag / SRS Deployment',
    'Rear Structural',
    'Wheel Alignment',
    'Suspension',
    'Door / Mirror Repair',
    'EV / Hybrid Vehicle',
    'Other',
  ];

  const checkboxes = repairOptions.map(r => `
    <label class="checkbox-label">
      <input type="checkbox" name="repairs" value="${escapeHtml(r)}">
      <span>${escapeHtml(r)}</span>
    </label>`).join('');

  const today = new Date().toISOString().slice(0, 10);

  // Sub-item rows for brakes/tires/wipers
  const brakePositions = [['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr']];
  const tirePositions  = [['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr']];
  const wiperPositions = [['Driver Side','driver'],['Passenger Side','passenger'],['Rear (optional)','rear']];

  const brakeSubItems = brakePositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="brake_${code}_grade" id="brake_${code}_grade" value="">
      <div class="grade-btn-row" data-target="brake_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
      <input type="text" name="brake_${code}_measurement" placeholder="mm" class="measurement-input">
    </div>`).join('');

  const tireSubItems = tirePositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="tire_${code}_grade" id="tire_${code}_grade" value="">
      <div class="grade-btn-row" data-target="tire_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
      <input type="text" name="tire_${code}_depth" placeholder="32nds" class="measurement-input">
    </div>`).join('');

  const wiperSubItems = wiperPositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="wiper_${code}_grade" id="wiper_${code}_grade" value="">
      <div class="grade-btn-row" data-target="wiper_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
    </div>`).join('');

  const content = `
    <div class="page-header"><h1>New Job</h1></div>

    <!-- VIN Flag Warning Panel (populated via JS on VIN blur) -->
    <div id="vin-flags-panel" class="vin-flag-panel hidden" role="alert"></div>

    <!-- ── STEP 2: TRACK SELECTOR ───────────────────────────────────────────── -->
    <div class="track-selector" id="trackSelector">
      <p class="track-selector-label">Select job type to continue</p>
      <div class="track-btn-row">
        <button type="button" class="track-btn" id="btn-gm"
                onclick="selectTrack('general-maintenance')">
          <span class="track-btn-icon">&#9881;</span>
          <span class="track-btn-title">GENERAL MAINTENANCE</span>
          <span class="track-btn-sub">Oil change, brakes, tires, service inspection</span>
        </button>
        <button type="button" class="track-btn" id="btn-collision"
                onclick="selectTrack('post-collision')">
          <span class="track-btn-icon">&#9888;</span>
          <span class="track-btn-title">POST-COLLISION REPAIR</span>
          <span class="track-btn-sub">ADAS calibration, structural repair, insurance documentation</span>
        </button>
      </div>
    </div>

    <!-- ── TRACK 1: GENERAL MAINTENANCE FORM ────────────────────────────────── -->
    <form method="POST" action="/jobs" id="gm-form" class="track-form job-form hidden">
      <input type="hidden" name="track" value="general-maintenance">

      <div class="form-section">
        <h2 class="section-heading">Vehicle &amp; Job Information</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="gm-ro">RO Number <span class="req">*</span></label>
            <input type="text" id="gm-ro" name="ro" placeholder="e.g. RO-12345" required>
          </div>
          <div class="form-group">
            <label for="gm-vin">VIN</label>
            <input type="text" id="gm-vin" name="vin" placeholder="17-character VIN" maxlength="17"
                   style="text-transform:uppercase" autocomplete="off">
            <span class="field-hint" id="gm-vin-status"></span>
          </div>
          <div class="form-group">
            <label for="gm-year">Year</label>
            <input type="text" id="gm-year" name="year" placeholder="e.g. 2022" maxlength="4">
          </div>
          <div class="form-group">
            <label for="gm-make">Make</label>
            <input type="text" id="gm-make" name="make" placeholder="e.g. Honda">
          </div>
          <div class="form-group">
            <label for="gm-model">Model</label>
            <input type="text" id="gm-model" name="model" placeholder="e.g. Accord">
          </div>
          <div class="form-group">
            <label for="gm-trim">Trim</label>
            <input type="text" id="gm-trim" name="trim" placeholder="e.g. Sport">
          </div>
          <div class="form-group">
            <label for="gm-service-date">Date of Service</label>
            <input type="date" id="gm-service-date" name="service_date" value="${today}">
          </div>
          <div class="form-group">
            <label for="gm-mileage">Mileage at Service</label>
            <input type="number" id="gm-mileage" name="mileage" placeholder="e.g. 47250" min="0">
          </div>
          <div class="form-group">
            <label for="gm-tech">Assigned Technician <span class="req">*</span></label>
            <input type="text" id="gm-tech" name="assigned_tech" placeholder="Full name" required>
          </div>
          <div class="form-group form-group-full">
            <label for="gm-notes">Notes</label>
            <textarea id="gm-notes" name="notes" rows="2"
                      placeholder="General notes for this visit..."></textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h2 class="section-heading">Service Items</h2>
        <p class="section-hint">Check each service item performed or inspected during this visit.</p>

        <!-- OIL CHANGE -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="oil_change_enabled" value="1"
                   class="module-checkbox" id="oil-toggle">
            <span class="module-toggle-label">Oil Change</span>
          </label>
          <div class="module-body hidden" id="oil-body">
            <div class="form-grid">
              <div class="form-group">
                <label>Oil Type</label>
                <select name="oil_type">
                  <option value="">— Select —</option>
                  <option value="conventional">Conventional</option>
                  <option value="synthetic-blend">Synthetic Blend</option>
                  <option value="full-synthetic">Full Synthetic</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div class="form-group">
                <label>Viscosity</label>
                <input type="text" name="oil_viscosity" placeholder="e.g. 5W-30">
              </div>
              <div class="form-group">
                <label>Return Interval — Miles</label>
                <input type="number" name="oil_return_miles" id="oil-return-miles"
                       placeholder="e.g. 5000" min="0" oninput="calcOilReturn()">
              </div>
              <div class="form-group">
                <label>Return Interval — Months</label>
                <input type="number" name="oil_return_months" id="oil-return-months"
                       placeholder="e.g. 6" min="0" oninput="calcOilReturn()">
              </div>
              <div class="form-group">
                <label>Return Mileage (auto-calculated)</label>
                <input type="text" name="return_mileage" id="oil-return-mileage-display"
                       readonly placeholder="Auto-calculated" class="field-readonly">
              </div>
              <div class="form-group">
                <label>Return Date (auto-calculated)</label>
                <input type="text" name="return_date" id="oil-return-date-display"
                       readonly placeholder="Auto-calculated" class="field-readonly">
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="oil_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- BRAKES -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="brakes_enabled" value="1"
                   class="module-checkbox" id="brakes-toggle">
            <span class="module-toggle-label">Brakes</span>
          </label>
          <div class="module-body hidden" id="brakes-body">
            <div class="service-sub-items">${brakeSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Front Rotor Condition</label>
                <select name="brake_rotor_front">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="grooved">Grooved</option>
                  <option value="needs-replacement">Needs Replacement</option>
                </select>
              </div>
              <div class="form-group">
                <label>Rear Rotor Condition</label>
                <select name="brake_rotor_rear">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="grooved">Grooved</option>
                  <option value="needs-replacement">Needs Replacement</option>
                </select>
              </div>
              <div class="form-group">
                <label>Brake Fluid</label>
                <select name="brake_fluid">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="contaminated">Contaminated</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="brake_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- TIRES -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="tires_enabled" value="1"
                   class="module-checkbox" id="tires-toggle">
            <span class="module-toggle-label">Tires</span>
          </label>
          <div class="module-body hidden" id="tires-body">
            <div class="service-sub-items">${tireSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Rotation Performed</label>
                <select name="tire_rotation">
                  <option value="">— Select —</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="tire_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- WINDSHIELD WIPERS -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="wipers_enabled" value="1"
                   class="module-checkbox" id="wipers-toggle">
            <span class="module-toggle-label">Windshield Wipers</span>
          </label>
          <div class="module-body hidden" id="wipers-body">
            <div class="service-sub-items">${wiperSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Replaced This Visit</label>
                <select name="wiper_replaced">
                  <option value="">— Select —</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="wiper_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- BATTERY -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="battery_enabled" value="1"
                   class="module-checkbox" id="battery-toggle">
            <span class="module-toggle-label">Battery</span>
          </label>
          <div class="module-body hidden" id="battery-body">
            <div class="form-grid">
              <div class="form-group">
                <label>Voltage Reading (V)</label>
                <input type="number" name="battery_voltage" step="0.01"
                       placeholder="e.g. 12.6" min="0">
              </div>
              <div class="form-group">
                <label>CCA if Tested (optional)</label>
                <input type="number" name="battery_cca" placeholder="e.g. 550" min="0">
              </div>
              <div class="form-group">
                <label>Test Result</label>
                <select name="battery_test_result">
                  <option value="">— Select —</option>
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                </select>
              </div>
              <div class="form-group">
                <label>Battery Age (years, optional)</label>
                <input type="number" name="battery_age" placeholder="e.g. 3" min="0">
              </div>
              <div class="form-group">
                <label>Battery Grade</label>
                <input type="hidden" name="battery_grade" id="battery_grade" value="">
                <div class="grade-btn-row" data-target="battery_grade">
                  <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
                  <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
                  <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
                </div>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="battery_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div class="form-actions">
        <a href="/" class="btn btn-ghost">Cancel</a>
        <button type="submit" class="btn btn-primary btn-lg">Save General Maintenance Job</button>
      </div>
    </form>

    <!-- ── TRACK 2: POST-COLLISION FORM ──────────────────────────────────────── -->
    <form method="POST" action="/jobs" id="collision-form" class="track-form job-form hidden">
      <input type="hidden" name="track" value="post-collision">
      <input type="hidden" name="collision_grade" id="collision_grade" value="">

      <!-- Step 9: Collision grade selector — required before rest renders -->
      <div class="form-section">
        <h2 class="section-heading">Collision Damage Grade <span class="req">*</span></h2>
        <p class="section-hint">Select a grade before continuing. This determines calibration checkpoints and documentation requirements.</p>
        <div class="collision-grade-row">
          <button type="button" class="collision-grade-btn" data-grade="MINOR"
                  onclick="selectCollisionGrade('MINOR')">
            <span class="cgb-label">MINOR</span>
            <span class="cgb-def">No structural involvement. Cosmetic/panel work.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="MODERATE"
                  onclick="selectCollisionGrade('MODERATE')">
            <span class="cgb-label">MODERATE</span>
            <span class="cgb-def">Panels replaced. Frame inspection required. Full ADAS verification required at milestones and at close.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="MAJOR"
                  onclick="selectCollisionGrade('MAJOR')">
            <span class="cgb-label">MAJOR</span>
            <span class="cgb-def">Likely total loss. Pending insurance decision.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="TOTAL"
                  onclick="selectCollisionGrade('TOTAL')">
            <span class="cgb-label">TOTAL</span>
            <span class="cgb-def">Total loss confirmed.</span>
          </button>
        </div>
      </div>

      <div id="collision-rest" class="hidden">
        <div class="form-section">
          <h2 class="section-heading">Vehicle Information</h2>
          <div class="form-grid">
            <div class="form-group">
              <label for="col-ro">RO Number <span class="req">*</span></label>
              <input type="text" id="col-ro" name="ro" placeholder="e.g. RO-12345" required>
            </div>
            <div class="form-group">
              <label for="col-vin">VIN</label>
              <input type="text" id="col-vin" name="vin" placeholder="17-character VIN" maxlength="17"
                     style="text-transform:uppercase" autocomplete="off">
              <span class="field-hint" id="col-vin-status"></span>
            </div>
            <div class="form-group">
              <label for="col-year">Year</label>
              <input type="text" id="col-year" name="year" placeholder="e.g. 2022" maxlength="4"
                     value="${escapeHtml(prefill.year)}">
            </div>
            <div class="form-group">
              <label for="col-make">Make</label>
              <input type="text" id="col-make" name="make" placeholder="e.g. Honda"
                     value="${escapeHtml(prefill.make)}">
            </div>
            <div class="form-group">
              <label for="col-model">Model</label>
              <input type="text" id="col-model" name="model" placeholder="e.g. Accord"
                     value="${escapeHtml(prefill.model)}">
            </div>
            <div class="form-group">
              <label for="col-trim">Trim</label>
              <input type="text" id="col-trim" name="trim" placeholder="e.g. Sport">
            </div>
            <div class="form-group">
              <label for="col-tech">Technician Name <span class="req">*</span></label>
              <input type="text" id="col-tech" name="technicianName" placeholder="Full name" required>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h2 class="section-heading">Repairs Performed</h2>
          <p class="section-hint">Select all that apply. The ADAS engine will analyze these to flag required calibrations.</p>
          <div class="checkbox-grid">${checkboxes}</div>
          <div class="form-group" style="margin-top:1.25rem">
            <label for="col-other-repairs">Other Repairs (describe)</label>
            <input type="text" id="col-other-repairs" name="otherRepairs"
                   placeholder="Describe any additional repairs performed&hellip;">
          </div>
        </div>

        <div class="form-actions">
          <a href="/" class="btn btn-ghost">Cancel</a>
          <button type="submit" class="btn btn-primary btn-lg">Submit &amp; Generate ADAS Report</button>
        </div>
      </div>
    </form>

    <script>
    /* ── Track Selection ─────────────────────────────────────────────────── */
    function selectTrack(track) {
      document.querySelectorAll('.track-btn').forEach(function(b) { b.classList.remove('selected'); });
      document.getElementById(track === 'general-maintenance' ? 'btn-gm' : 'btn-collision').classList.add('selected');
      document.querySelectorAll('.track-form').forEach(function(f) { f.classList.add('hidden'); });
      document.getElementById(track === 'general-maintenance' ? 'gm-form' : 'collision-form').classList.remove('hidden');
    }

    /* ── Service Module Expand/Collapse ─────────────────────────────────── */
    document.querySelectorAll('.module-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var bodyId = this.id.replace('-toggle', '-body');
        document.getElementById(bodyId).classList.toggle('hidden', !this.checked);
      });
    });

    /* ── Grade Buttons ───────────────────────────────────────────────────── */
    document.addEventListener('click', function(e) {
      if (!e.target.classList.contains('grade-btn')) return;
      var row = e.target.closest('.grade-btn-row');
      if (!row) return;
      var targetId = row.dataset.target;
      row.querySelectorAll('.grade-btn').forEach(function(b) { b.classList.remove('selected'); });
      e.target.classList.add('selected');
      document.getElementById(targetId).value = e.target.dataset.grade;
    });

    /* ── Collision Grade ─────────────────────────────────────────────────── */
    function selectCollisionGrade(grade) {
      document.querySelectorAll('.collision-grade-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.grade === grade);
      });
      document.getElementById('collision_grade').value = grade;
      document.getElementById('collision-rest').classList.remove('hidden');
    }

    /* ── Oil Change Auto-Calculate ───────────────────────────────────────── */
    function calcOilReturn() {
      var miles   = parseInt(document.getElementById('oil-return-miles').value)  || 0;
      var months  = parseInt(document.getElementById('oil-return-months').value) || 0;
      var mileage = parseInt(document.getElementById('gm-mileage').value)        || 0;
      var sDate   = document.getElementById('gm-service-date').value;
      if (miles > 0 && mileage > 0)
        document.getElementById('oil-return-mileage-display').value = (mileage + miles).toLocaleString();
      if (months > 0 && sDate) {
        var d = new Date(sDate + 'T12:00:00');
        d.setMonth(d.getMonth() + months);
        document.getElementById('oil-return-date-display').value = d.toISOString().slice(0, 10);
      }
    }
    document.getElementById('gm-mileage').addEventListener('input', calcOilReturn);

    /* ── Shared VIN decode + flag lookup ────────────────────────────────── */
    function vinDecode(vinInput, yearId, makeId, modelId, statusId) {
      var vin = vinInput.value.trim().toUpperCase();
      vinInput.value = vin;
      if (vin.length !== 17) return;
      var statusEl = document.getElementById(statusId);
      statusEl.textContent = 'Decoding VIN\u2026';
      statusEl.className = 'field-hint';
      fetch('https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/' + encodeURIComponent(vin) + '?format=json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var r = data.Results && data.Results[0];
          if (r) {
            if (r.ModelYear) document.getElementById(yearId).value  = r.ModelYear;
            if (r.Make)      document.getElementById(makeId).value  = r.Make.charAt(0).toUpperCase() + r.Make.slice(1).toLowerCase();
            if (r.Model)     document.getElementById(modelId).value = r.Model;
            statusEl.textContent = 'VIN decoded.';
            statusEl.className = 'field-hint hint-ok';
          }
        })
        .catch(function() { statusEl.textContent = 'VIN decode failed — check connection.'; statusEl.className = 'field-hint hint-err'; });

      fetch('/api/vin/' + encodeURIComponent(vin) + '/flags')
        .then(function(r) { return r.json(); })
        .then(function(flags) {
          var panel = document.getElementById('vin-flags-panel');
          if (!flags || flags.length === 0) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
          panel.innerHTML = '<strong>\u26A0 OPEN FLAGS ON VIN ' + _esc(vin) + '</strong>' +
            flags.map(function(f) {
              return '<div class="vin-flag-item">\u26A0 OPEN FLAG \u2014 ' +
                _esc(f.item_type) + (f.sub_item ? ' &mdash; ' + _esc(f.sub_item) : '') +
                ' \u2014 <strong class="grade-text-' + f.grade.toLowerCase() + '">' + _esc(f.grade) + '</strong>' +
                ' \u2014 First flagged: ' + _esc(f.date_flagged) +
                ' \u2014 Job: <a href="/jobs/' + encodeURIComponent(f.origin_job_id) + '">' + _esc(f.origin_job_id) + '</a></div>';
            }).join('');
          panel.classList.remove('hidden');
        })
        .catch(function() {});
    }

    function _esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    document.getElementById('gm-vin').addEventListener('blur', function() {
      vinDecode(this, 'gm-year', 'gm-make', 'gm-model', 'gm-vin-status');
    });
    document.getElementById('col-vin').addEventListener('blur', function() {
      vinDecode(this, 'col-year', 'col-make', 'col-model', 'col-vin-status');
    });
    </script>`;

  res.send(layout('New Job', content, 'new'));
});

// POST /jobs — Create job (handles both tracks)
app.post('/jobs', (req, res) => {
  const track = req.body.track || 'post-collision';
  const jobId      = generateJobId();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const shareUrl   = `/share/${shareToken}`;
  const now        = new Date().toISOString();

  if (track === 'general-maintenance') {
    // ── Step 3: General Maintenance ──────────────────────────────────────────
    const { ro, vin, year, make, model, trim, notes } = req.body;
    const serviceDate = req.body.service_date || now.slice(0, 10);
    const mileage     = req.body.mileage     || '';
    const assignedTech = req.body.assigned_tech || '';

    const returnMileage = req.body.return_mileage || '';
    const returnDate    = req.body.return_date    || '';

    db.prepare(`
      INSERT INTO jobs
        (jobId, ro, vin, year, make, model, trim, technicianName, assigned_tech,
         track, service_date, mileage, return_mileage, return_date,
         repairsPerformed, status, shareToken, shareUrl, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      jobId, ro || '', (vin || '').toUpperCase(), year || '', make || '', model || '', trim || '',
      assignedTech, assignedTech, 'general-maintenance',
      serviceDate, mileage, returnMileage, returnDate,
      notes || '', 'Created', shareToken, shareUrl, now, now
    );

    // ── Step 5: Save service items + grade audit + vin flags ─────────────────
    const vinUpper = (vin || '').trim().toUpperCase();

    // Oil Change — grade is always GREEN when performed
    if (req.body.oil_change_enabled) {
      applyGradeFlag(vinUpper, DEFAULT_SHOP_ID, jobId, assignedTech,
        'Oil Change', null, 'GREEN', null,
        [req.body.oil_type, req.body.oil_viscosity].filter(Boolean).join(' / '),
        req.body.oil_note || null
      );
    }

    // Brakes
    if (req.body.brakes_enabled) {
      const brakeSubs = [
        ['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr'],
      ];
      for (const [label, code] of brakeSubs) {
        const grade = req.body[`brake_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, DEFAULT_SHOP_ID, jobId, assignedTech,
            'Brakes', label, grade, null,
            req.body[`brake_${code}_measurement`] || null,
            req.body.brake_note || null
          );
        }
      }
    }

    // Tires
    if (req.body.tires_enabled) {
      const tireSubs = [
        ['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr'],
      ];
      for (const [label, code] of tireSubs) {
        const grade = req.body[`tire_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, DEFAULT_SHOP_ID, jobId, assignedTech,
            'Tires', label, grade, null,
            req.body[`tire_${code}_depth`] || null,
            req.body.tire_note || null
          );
        }
      }
    }

    // Wipers
    if (req.body.wipers_enabled) {
      const wiperSubs = [
        ['Driver Side','driver'],['Passenger Side','passenger'],['Rear','rear'],
      ];
      for (const [label, code] of wiperSubs) {
        const grade = req.body[`wiper_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, DEFAULT_SHOP_ID, jobId, assignedTech,
            'Wipers', label, grade, null, null,
            req.body.wiper_note || null
          );
        }
      }
    }

    // Battery
    if (req.body.battery_enabled) {
      const grade = req.body.battery_grade || '';
      if (grade) {
        applyGradeFlag(vinUpper, DEFAULT_SHOP_ID, jobId, assignedTech,
          'Battery', null, grade, null,
          [req.body.battery_voltage ? `${req.body.battery_voltage}V` : '',
           req.body.battery_test_result || ''].filter(Boolean).join(' / '),
          req.body.battery_note || null
        );
      }
    }

    return res.redirect(`/jobs/${jobId}`);
  }

  // ── Step 9: Post-Collision ────────────────────────────────────────────────
  const { ro, vin, year, make, model, trim, technicianName, otherRepairs } = req.body;
  const collisionGrade = req.body.collision_grade || '';

  let repairs = req.body.repairs || [];
  if (!Array.isArray(repairs)) repairs = [repairs];
  if (otherRepairs && otherRepairs.trim()) repairs.push(otherRepairs.trim());
  const repairsStr = repairs.join(', ');

  const {
    adasSystems, rationale, liabilityWarning, makeSpecificNotes,
    preScanRequired, postScanRequired, approvedScanTool,
  } = runADASEngine(make, model, year, repairs);

  db.prepare(`
    INSERT INTO jobs
      (jobId, ro, vin, year, make, model, trim, technicianName,
       repairsPerformed, adasSystems, rationale, liabilityWarning,
       makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
       track, collision_grade,
       status, shareToken, shareUrl, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Created',?,?,?,?)
  `).run(
    jobId, ro || '', (vin || '').toUpperCase(), year || '', make || '', model || '', trim || '',
    technicianName || '', repairsStr, adasSystems, rationale, liabilityWarning,
    makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
    'post-collision', collisionGrade,
    shareToken, shareUrl, now, now
  );

  // Step 11: Create ADAS checkpoints for MODERATE grade jobs
  if (collisionGrade === 'MODERATE') {
    for (let i = 0; i < CHECKPOINT_LABELS.length; i++) {
      db.prepare(`
        INSERT INTO job_checkpoints (job_id, checkpoint_index, label)
        VALUES (?,?,?)
      `).run(jobId, i, CHECKPOINT_LABELS[i]);
    }
  }

  res.redirect(`/jobs/${jobId}`);
});

// GET /jobs/:jobId — Job view (hard copy)
app.get('/jobs/:jobId', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);

  if (!job) {
    return res.status(404).send(layout('Not Found', `
      <div class="error-page">
        <div class="error-icon">&#x26A0;</div>
        <h1>Job Not Found</h1>
        <p>No job with ID <strong>${escapeHtml(req.params.jobId)}</strong> exists.</p>
        <a href="/" class="btn btn-primary" style="margin-top:1.5rem">Back to Jobs</a>
      </div>`));
  }

  const isGM        = job.track === 'general-maintenance';
  const isCollision = !isGM;

  // ── GM: service items section ─────────────────────────────────────────────
  let serviceItemsSection = '';
  if (isGM) {
    const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);
    if (items.length > 0) {
      const itemRows = items.map(i => `
        <tr>
          <td>${escapeHtml(i.item_type)}</td>
          <td>${escapeHtml(i.sub_item || '—')}</td>
          <td><span class="grade-badge grade-badge-${(i.grade || '').toLowerCase()}">${escapeHtml(i.grade || '—')}</span></td>
          <td>${escapeHtml(i.measurement || '—')}</td>
          <td>${escapeHtml(i.note || '—')}</td>
        </tr>`).join('');
      serviceItemsSection = `
      <section class="doc-section">
        <h2 class="doc-section-title">Service Items</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Sub-Item</th><th>Grade</th><th>Measurement</th><th>Note</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
        ${job.return_mileage || job.return_date ? `
        <div class="info-grid" style="margin-top:1rem">
          ${job.return_mileage ? `<div class="info-row"><span class="info-label">Return Mileage</span><span class="info-val">${escapeHtml(job.return_mileage)}</span></div>` : ''}
          ${job.return_date    ? `<div class="info-row"><span class="info-label">Return Date</span><span class="info-val">${escapeHtml(job.return_date)}</span></div>` : ''}
        </div>` : ''}
      </section>`;
    }
  }

  // ── Collision: checkpoints ────────────────────────────────────────────────
  let checkpointsSection = '';
  if (isCollision && job.collision_grade === 'MODERATE') {
    const cps = db.prepare(`SELECT * FROM job_checkpoints WHERE job_id = ? ORDER BY checkpoint_index`).all(job.jobId);
    if (cps.length > 0) {
      const cpRows = cps.map(cp => `
        <div class="checkpoint-row ${cp.completed ? 'checkpoint-done' : ''}">
          <span class="checkpoint-num">${cp.checkpoint_index + 1}</span>
          <span class="checkpoint-label">${escapeHtml(cp.label)}</span>
          <span class="checkpoint-status">
            ${cp.completed
              ? `&#10003; Signed off by ${escapeHtml(cp.completed_by || '—')} on ${escapeHtml(cp.completed_at ? cp.completed_at.slice(0,10) : '—')}`
              : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/checkpoints/${cp.checkpoint_index}/complete" class="inline-form">
                   <input type="text" name="completed_by" placeholder="Your name" required style="width:140px">
                   <button type="submit" class="btn btn-sm btn-primary">Sign Off</button>
                 </form>`}
          </span>
        </div>`).join('');
      const allDone = cps.every(c => c.completed);
      checkpointsSection = `
      <section class="doc-section">
        <h2 class="doc-section-title">ADAS Verification Checkpoints
          ${allDone ? '<span class="badge badge-green" style="font-size:.7rem;margin-left:.5rem">ALL COMPLETE</span>' : ''}</h2>
        <div class="checkpoint-list no-print">${cpRows}</div>
        <div class="print-only checkpoint-print">
          ${cps.map(cp => `<div class="cp-print-row">${cp.checkpoint_index+1}. ${escapeHtml(cp.label)} — ${cp.completed ? 'COMPLETE — ' + escapeHtml(cp.completed_by||'') : 'PENDING'}</div>`).join('')}
        </div>
      </section>`;
    }
  }

  // ── Photos section ────────────────────────────────────────────────────────
  let photosSection = '';
  if (isCollision) {
    const photos = db.prepare(`SELECT * FROM photos WHERE job_id = ? ORDER BY layer, uploaded_at`).all(job.jobId);
    const layer1Photos = photos.filter(p => p.layer === 1);
    const layer2Photos = photos.filter(p => p.layer === 2);
    const layer1Done   = layer1Photos.length > 0;

    const photoGrid = (ps) => ps.length === 0
      ? '<p class="empty" style="margin:.5rem 0">No photos uploaded yet.</p>'
      : `<div class="photo-grid">${ps.map(p => `
          <div class="photo-thumb">
            <img src="/uploads/${encodeURIComponent(p.filename)}" alt="${escapeHtml(p.category)}" loading="lazy">
            <div class="photo-caption">${escapeHtml(p.category)}${p.damage_grade ? ' — ' + escapeHtml(p.damage_grade) : ''}</div>
          </div>`).join('')}</div>`;

    photosSection = `
      <section class="doc-section no-print">
        <h2 class="doc-section-title">Photo Documentation</h2>

        <div class="photo-layer-block">
          <h3 class="photo-layer-title">Layer 1 — General Area
            ${layer1Done ? '<span class="badge badge-green" style="font-size:.7rem;margin-left:.5rem">COMPLETE</span>' : '<span class="badge badge-amber" style="font-size:.7rem;margin-left:.5rem">PENDING</span>'}
          </h3>
          ${photoGrid(layer1Photos)}
          <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/photos"
                enctype="multipart/form-data" class="photo-upload-form">
            <input type="hidden" name="layer" value="1">
            <select name="category" required>
              <option value="">— Select Category —</option>
              <option value="Full vehicle (all sides)">Full vehicle (all sides)</option>
              <option value="Full impact zone">Full impact zone</option>
              <option value="Adjacent panels">Adjacent panels</option>
            </select>
            <input type="file" name="photo" accept="image/*" required>
            <input type="text" name="tech_name" placeholder="Tech name">
            <button type="submit" class="btn btn-primary btn-sm">Upload</button>
          </form>
        </div>

        <div class="photo-layer-block ${!layer1Done ? 'layer-locked' : ''}">
          <h3 class="photo-layer-title">Layer 2 — In-Process &amp; Documentation
            ${!layer1Done ? '<span class="badge badge-amber" style="font-size:.7rem;margin-left:.5rem">REQUIRES LAYER 1 COMPLETE</span>' : ''}
          </h3>
          ${!layer1Done
            ? '<p class="photo-locked-msg">Complete Layer 1 (upload at least one photo) before accessing Layer 2.</p>'
            : `${photoGrid(layer2Photos)}
               <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/photos"
                     enctype="multipart/form-data" class="photo-upload-form">
                 <input type="hidden" name="layer" value="2">
                 <select name="category" required>
                   <option value="">— Select Category —</option>
                   <option value="Close damage detail">Close damage detail</option>
                   <option value="In-process repair">In-process repair</option>
                   <option value="ADAS setup documentation">ADAS setup documentation</option>
                   <option value="Finished state">Finished state</option>
                 </select>
                 <select name="damage_grade">
                   <option value="">— Damage Grade (optional) —</option>
                   <option value="MINOR">MINOR</option>
                   <option value="MODERATE">MODERATE</option>
                   <option value="MAJOR">MAJOR</option>
                 </select>
                 <input type="file" name="photo" accept="image/*" required>
                 <input type="text" name="tech_name" placeholder="Tech name">
                 <button type="submit" class="btn btn-primary btn-sm">Upload</button>
               </form>`}
        </div>
      </section>`;
  }

  // ── Share link section ─────────────────────────────────────────────────────
  const activeToken = db.prepare(
    `SELECT token FROM share_tokens WHERE job_id=? AND revoked=0 ORDER BY id DESC LIMIT 1`
  ).get(job.jobId);

  const shareSection = `
      <section class="doc-section no-print">
        <h2 class="doc-section-title">Insurer Link</h2>
        ${activeToken
          ? `<div class="share-url-row">
               <span class="field-hint hint-ok">Active share link:</span>
               <code class="share-url" id="shareUrlDisplay">${escapeHtml(req.protocol + '://' + req.get('host') + '/share/' + activeToken.token)}</code>
               <button onclick="navigator.clipboard.writeText(document.getElementById('shareUrlDisplay').textContent)" class="btn btn-sm">Copy</button>
               <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share/revoke" class="inline-form" style="margin-left:.5rem">
                 <button type="submit" class="btn btn-sm" style="border-color:#c0392b;color:#c0392b">Revoke</button>
               </form>
             </div>`
          : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share" class="inline-form">
               <button type="submit" class="btn btn-primary btn-sm">Generate Insurer Link</button>
             </form>`}
      </section>`;

  // ── Tech view link ─────────────────────────────────────────────────────────
  const techViewLink = `
      <section class="doc-section no-print" style="padding:.75rem 1.25rem">
        <a href="/jobs/${encodeURIComponent(job.jobId)}/tech" class="btn btn-sm">Tech View</a>
        ${job.status === 'Closed'
          ? `<a href="/jobs/${encodeURIComponent(job.jobId)}/export/tech-pdf" class="btn btn-sm" style="margin-left:.5rem">Save My Work Record</a>`
          : ''}
      </section>`;

  // ── Existing collision sections ───────────────────────────────────────────
  const adasList      = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const rationaleList = job.rationale   ? job.rationale.split('\n').filter(Boolean)   : [];
  const isHV =
    (job.make || '').toLowerCase().includes('tesla') ||
    (job.repairsPerformed || '').toLowerCase().includes('ev / hybrid vehicle') ||
    (job.repairsPerformed || '').toLowerCase().includes('ev/hybrid');

  const adasItems = adasList.length > 0
    ? adasList.map(s => `
        <li class="adas-item">
          <span class="adas-flag">&#9888;</span>
          <span>${escapeHtml(s)}</span>
        </li>`).join('')
    : `<li class="adas-item adas-none">
         <span class="adas-flag adas-ok">&#10003;</span>
         <span>No ADAS calibration flagged for the reported repairs on this vehicle.</span>
       </li>`;

  const rationaleItems = rationaleList.length > 0
    ? rationaleList.map(r => `<li>${escapeHtml(r)}</li>`).join('')
    : '<li>No rationale generated.</li>';

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          <div><span class="meta-label">Track</span>
            <span class="badge badge-${isGM ? 'blue' : 'orange'}">${isGM ? 'General Maintenance' : 'Post-Collision'}</span>
          </div>
          ${job.collision_grade ? `<div><span class="meta-label">Damage Grade</span>
            <span class="badge badge-${job.collision_grade === 'MINOR' ? 'green' : job.collision_grade === 'MODERATE' ? 'orange' : 'red'}">${escapeHtml(job.collision_grade)}</span>
          </div>` : ''}
          <div><span class="meta-label">Status</span>
            <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span>
          </div>
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print / Save PDF</button>
          <a href="/" class="btn btn-ghost-white">Back to Jobs</a>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle Information</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">RO Number</span><span class="info-val">${escapeHtml(job.ro) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Year</span><span class="info-val">${escapeHtml(job.year) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Make</span><span class="info-val">${escapeHtml(job.make) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Model</span><span class="info-val">${escapeHtml(job.model) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Trim</span><span class="info-val">${escapeHtml(job.trim) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName || job.assigned_tech) || '&mdash;'}</span></div>
          ${isGM && job.service_date ? `<div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date)}</span></div>` : ''}
          ${isGM && job.mileage     ? `<div class="info-row"><span class="info-label">Mileage</span><span class="info-val">${escapeHtml(job.mileage)}</span></div>` : ''}
          ${isCollision ? `<div class="info-row info-row-full"><span class="info-label">Repairs Performed</span><span class="info-val">${escapeHtml(job.repairsPerformed) || '&mdash;'}</span></div>` : ''}
        </div>
      </section>

      ${serviceItemsSection}

      ${isCollision ? `
      <section class="doc-section scan-req-section">
        <h2 class="doc-section-title">Scan Requirements</h2>
        <div class="scan-req-grid">
          <div class="scan-req-row">
            <span class="scan-req-label">Pre-Repair Scan</span>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(job.preScanRequired)}">${escapeHtml(scanBadgeLabel(job.preScanRequired))}</span>
            <span class="scan-req-detail">${escapeHtml(job.preScanRequired || 'RECOMMENDED')}</span>
          </div>
          <div class="scan-req-row">
            <span class="scan-req-label">Post-Repair Scan</span>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(job.postScanRequired)}">${escapeHtml(scanBadgeLabel(job.postScanRequired))}</span>
            <span class="scan-req-detail">${escapeHtml(job.postScanRequired || 'RECOMMENDED')}</span>
          </div>
          <div class="scan-req-row scan-req-tool-row">
            <span class="scan-req-label">&#128295; Approved Scan Tool</span>
            <span class="scan-tool-value">${escapeHtml(job.approvedScanTool || 'Consult OEM service information')}</span>
          </div>
        </div>
      </section>

      ${isHV ? `
      <div class="hv-banner">
        <span class="hv-banner-icon">&#9889;</span>
        <p>HIGH VOLTAGE / EV VEHICLE &mdash; Review HV isolation and safety procedures before beginning repair. See ADAS Systems section for full requirements.</p>
      </div>` : ''}

      <section class="doc-section adas-section">
        <h2 class="doc-section-title">ADAS Systems &mdash; Calibration Required</h2>
        <ul class="adas-list">${adasItems}</ul>
      </section>

      <section class="doc-section">
        <h2 class="doc-section-title">Rationale</h2>
        <ul class="rationale-list">${rationaleItems}</ul>
      </section>

      <section class="doc-section warning-section">
        <h2 class="doc-section-title">Liability Warning</h2>
        <div class="warning-box">
          <span class="warning-icon">&#9888;</span>
          <p>${escapeHtml(job.liabilityWarning) || '&mdash;'}</p>
        </div>
      </section>

      <section class="doc-section">
        <h2 class="doc-section-title">Make-Specific Notes</h2>
        <div class="notes-box"><p>${escapeHtml(job.makeSpecificNotes) || '&mdash;'}</p></div>
      </section>` : ''}

      ${checkpointsSection}
      ${photosSection}
      ${shareSection}
      ${techViewLink}

      <div class="doc-footer">
        <p>Generated by CollisionIQ &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC</p>
      </div>
    </div>`;

  res.send(layout(`Job ${job.jobId}`, content));
});

// GET /admin — Admin panel
app.get('/admin', (req, res) => {
  const jobs = db.prepare(`SELECT * FROM jobs ORDER BY createdAt DESC`).all();

  const statusOptions = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];

  const rows = jobs.map(j => {
    const options = statusOptions.map(s =>
      `<option value="${s}"${j.status === s ? ' selected' : ''}>${s}</option>`
    ).join('');

    return `
    <tr>
      <td><span class="job-id">${escapeHtml(j.jobId)}</span></td>
      <td>${escapeHtml(j.ro) || '&mdash;'}</td>
      <td class="mono">${j.vin ? escapeHtml(j.vin.slice(-6)) : '&mdash;'}</td>
      <td>${escapeHtml(j.year)} ${escapeHtml(j.make)} ${escapeHtml(j.model)}</td>
      <td>${escapeHtml(j.technicianName) || '&mdash;'}</td>
      <td>
        <form method="POST" action="/jobs/${encodeURIComponent(j.jobId)}/status" class="inline-form">
          <select name="status" onchange="this.form.submit()" class="status-select status-${statusClass(j.status)}">
            ${options}
          </select>
        </form>
      </td>
      <td>${formatDate(j.createdAt)}</td>
      <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
    </tr>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Admin &mdash; Job Management <span class="count-badge">${jobs.length}</span></h1>
    </div>

    <div class="admin-hint">
      <p>Change a job's status using the dropdown. The page will update automatically.</p>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>RO #</th>
            <th>VIN (last 6)</th>
            <th>Vehicle</th>
            <th>Technician</th>
            <th>Status</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="8" class="empty">No jobs found.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  res.send(layout('Admin', content, 'admin'));
});

// POST /jobs/:jobId/status — Update status
app.post('/jobs/:jobId/status', (req, res) => {
  const validStatuses = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];
  const { status } = req.body;

  if (!validStatuses.includes(status)) {
    return res.status(400).send('Invalid status value.');
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE jobs SET status = ?, updatedAt = ? WHERE jobId = ?`)
    .run(status, now, req.params.jobId);

  res.redirect('/admin');
});

// ─── Step 4: VIN Flag API ─────────────────────────────────────────────────────

app.get('/api/vin/:vin/flags', (req, res) => {
  const vin = (req.params.vin || '').toUpperCase();
  const flags = db.prepare(`
    SELECT * FROM vin_flags
    WHERE vin=? AND shop_id=? AND status IN ('OPEN','ESCALATED')
    ORDER BY date_flagged ASC
  `).all(vin, DEFAULT_SHOP_ID);
  res.json(flags);
});

// ─── Step 6: GM Flag Dashboard ────────────────────────────────────────────────

app.get('/dashboard/flags', (req, res) => {
  const flags = db.prepare(`
    SELECT * FROM vin_flags
    WHERE shop_id=? AND status IN ('OPEN','ESCALATED')
    ORDER BY date_flagged ASC
  `).all(DEFAULT_SHOP_ID);

  const gradeClass = g => g === 'YELLOW' || g === 'ESCALATED' ? 'yellow' : 'red';

  const rows = flags.length === 0
    ? '<tr><td colspan="6" class="empty">No open flags.</td></tr>'
    : flags.map(f => `
      <tr>
        <td class="mono">${escapeHtml(f.vin)}</td>
        <td>${escapeHtml(f.item_type)}</td>
        <td>${escapeHtml(f.sub_item || '—')}</td>
        <td><span class="grade-badge grade-badge-${gradeClass(f.grade)}">${escapeHtml(f.status === 'ESCALATED' ? 'ESCALATED' : f.grade)}</span></td>
        <td>${escapeHtml(f.date_flagged)}</td>
        <td><a href="/jobs/${encodeURIComponent(f.origin_job_id)}" class="btn btn-sm">${escapeHtml(f.origin_job_id)}</a></td>
      </tr>`).join('');

  const content = `
    <div class="page-header">
      <h1>Open Vehicle Flags <span class="count-badge">${flags.length}</span></h1>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>VIN</th><th>Item Type</th><th>Sub-Item</th>
            <th>Status / Grade</th><th>First Flagged</th><th>Origin Job</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  res.send(layout('Open Vehicle Flags', content, 'flags'));
});

// ─── Step 7: Tech Job View ────────────────────────────────────────────────────

app.get('/jobs/:jobId/tech', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send(layout('Not Found', '<p>Job not found.</p>'));

  // Open flag warning
  const openFlags = job.vin
    ? db.prepare(`SELECT * FROM vin_flags WHERE vin=? AND shop_id=? AND status IN ('OPEN','ESCALATED') ORDER BY date_flagged`).all(job.vin, DEFAULT_SHOP_ID)
    : [];

  const flagPanel = openFlags.length > 0
    ? `<div class="vin-flag-panel" style="margin-bottom:1.5rem">
        <strong>&#9888; OPEN FLAGS ON VIN ${escapeHtml(job.vin)}</strong>
        ${openFlags.map(f => `
        <div class="vin-flag-item">&#9888; OPEN FLAG &mdash; ${escapeHtml(f.item_type)}${f.sub_item ? ' &mdash; ' + escapeHtml(f.sub_item) : ''}
          &mdash; <strong>${escapeHtml(f.grade)}</strong>
          &mdash; First flagged: ${escapeHtml(f.date_flagged)}
          &mdash; Job: <a href="/jobs/${encodeURIComponent(f.origin_job_id)}">${escapeHtml(f.origin_job_id)}</a>
        </div>`).join('')}
       </div>`
    : '';

  // Service items
  const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);

  // Group items by type for editing
  const itemTypes = [...new Set(items.map(i => i.item_type))];
  const itemForms = itemTypes.map(type => {
    const typeItems = items.filter(i => i.item_type === type);
    return `
      <div class="form-section">
        <h3 class="section-heading">${escapeHtml(type)}</h3>
        ${typeItems.map(item => `
        <div class="service-sub-items">
          <div class="sub-item-row">
            <span class="sub-item-label">${escapeHtml(item.sub_item || 'Reading')}</span>
            ${gradeButtonHtml(`grade_${item.id}`, item.grade)}
            <input type="text" name="measurement_${item.id}" value="${escapeHtml(item.measurement || '')}"
                   placeholder="Measurement" class="measurement-input">
            <input type="text" name="note_${item.id}" value="${escapeHtml(item.note || '')}"
                   placeholder="Note" style="flex:1;min-width:120px">
            <input type="hidden" name="item_id_${item.id}" value="${item.id}">
          </div>
        </div>`).join('')}
      </div>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Tech View &mdash; ${escapeHtml(job.jobId)}</h1>
      <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span>
    </div>

    ${flagPanel}

    <div class="job-doc" style="padding:1.5rem">
      <div class="info-grid" style="margin-bottom:1rem">
        <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
        <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)} ${escapeHtml(job.trim || '')}</span></div>
        <div class="info-row"><span class="info-label">RO</span><span class="info-val">${escapeHtml(job.ro) || '—'}</span></div>
        <div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date || formatDate(job.createdAt))}</span></div>
      </div>

      ${items.length > 0
        ? `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/tech/update" class="job-form">
            <input type="hidden" name="tech_name" value="${escapeHtml(job.technicianName || job.assigned_tech || '')}">
            ${itemForms}
            <div class="form-actions">
              <a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn btn-ghost">Back to Job</a>
              <button type="submit" class="btn btn-primary">Save Updates</button>
            </div>
           </form>`
        : '<p style="color:#888">No service items on this job.</p>'}

      ${job.status === 'Closed'
        ? `<div style="margin-top:1.5rem">
             <a href="/jobs/${encodeURIComponent(job.jobId)}/export/tech-pdf" class="btn btn-primary">Save My Work Record</a>
           </div>`
        : ''}
    </div>`;

  res.send(layout(`Tech View — ${job.jobId}`, content));
});

app.post('/jobs/:jobId/tech/update', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const techName = req.body.tech_name || '';
  const now = new Date().toISOString();

  // Collect item IDs from hidden fields
  const itemIds = Object.keys(req.body)
    .filter(k => k.startsWith('item_id_'))
    .map(k => parseInt(req.body[k]));

  for (const id of itemIds) {
    const existing = db.prepare(`SELECT * FROM job_service_items WHERE id=?`).get(id);
    if (!existing || existing.job_id !== job.jobId) continue;

    const newGrade   = req.body[`grade_${id}`]       || existing.grade;
    const newMeas    = req.body[`measurement_${id}`]  ?? existing.measurement;
    const newNote    = req.body[`note_${id}`]         ?? existing.note;
    const prevGrade  = existing.grade;

    db.prepare(`UPDATE job_service_items SET grade=?, measurement=?, note=?, tech_name=?, updated_at=? WHERE id=?`)
      .run(newGrade, newMeas, newNote, techName, now, id);

    // Audit + flag logic
    if (newGrade !== prevGrade) {
      db.prepare(`
        INSERT INTO grade_audit (job_id, shop_id, tech_name, item_type, sub_item, grade, previous_grade, timestamp, note)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(job.jobId, DEFAULT_SHOP_ID, techName, existing.item_type, existing.sub_item,
             newGrade, prevGrade, now, newNote || null);

      // Re-apply flag logic on grade change
      const vinUpper = (job.vin || '').toUpperCase();
      const sub = existing.sub_item || null;
      const findOpen = db.prepare(`
        SELECT id, grade FROM vin_flags
        WHERE vin=? AND shop_id=? AND item_type=? AND (sub_item IS ? OR sub_item=?)
          AND status IN ('OPEN','ESCALATED') ORDER BY id DESC LIMIT 1
      `);
      if (newGrade === 'GREEN') {
        const flag = findOpen.get(vinUpper, DEFAULT_SHOP_ID, existing.item_type, sub, sub);
        if (flag) db.prepare(`UPDATE vin_flags SET status='RESOLVED', resolved_job_id=?, date_resolved=? WHERE id=?`)
          .run(job.jobId, now.slice(0,10), flag.id);
      } else if (newGrade === 'YELLOW') {
        db.prepare(`INSERT INTO vin_flags (shop_id,vin,item_type,sub_item,grade,origin_job_id,date_flagged) VALUES (?,?,?,?,?,?,?)`)
          .run(DEFAULT_SHOP_ID, vinUpper, existing.item_type, sub, 'YELLOW', job.jobId, now.slice(0,10));
      } else if (newGrade === 'RED') {
        const flag = findOpen.get(vinUpper, DEFAULT_SHOP_ID, existing.item_type, sub, sub);
        if (flag && flag.grade === 'YELLOW') db.prepare(`UPDATE vin_flags SET status='ESCALATED' WHERE id=?`).run(flag.id);
        db.prepare(`INSERT INTO vin_flags (shop_id,vin,item_type,sub_item,grade,origin_job_id,date_flagged) VALUES (?,?,?,?,?,?,?)`)
          .run(DEFAULT_SHOP_ID, vinUpper, existing.item_type, sub, 'RED', job.jobId, now.slice(0,10));
      }
    }
  }

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}/tech`);
});

// ─── Step 8: Tech PDF Export (server-side PII scrub) ─────────────────────────

app.get('/jobs/:jobId/export/tech-pdf', (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  // Scrub: never pass customer name / contact / plate to client
  // (those fields don't exist yet but this route will never expose them when they do)
  const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);

  const itemRows = items.map(i => `
    <tr>
      <td>${escapeHtml(i.item_type)}</td>
      <td>${escapeHtml(i.sub_item || '—')}</td>
      <td><span class="grade-badge grade-badge-${(i.grade||'').toLowerCase()}">${escapeHtml(i.grade || '—')}</span></td>
      <td>${escapeHtml(i.measurement || '—')}</td>
      <td>${escapeHtml(i.note || '—')}</td>
    </tr>`).join('');

  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="tech-pdf-notice">
        <strong>Personal Work Record</strong><br>
        This record is for your personal professional documentation. Customer identifying information has been removed.
        This PDF is your record of work performed &mdash; it is not a shop document and should be stored privately.
      </div>

      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ &mdash; Tech Work Record</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.service_date || job.createdAt)}</div>
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Save PDF</button>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
          <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)} ${escapeHtml(job.trim || '')}</span></div>
          <div class="info-row"><span class="info-label">Mileage</span><span class="info-val">${escapeHtml(job.mileage || '—')}</span></div>
          <div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date || formatDate(job.createdAt))}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName || job.assigned_tech || '—')}</span></div>
        </div>
      </section>

      ${items.length > 0 ? `
      <section class="doc-section">
        <h2 class="doc-section-title">Service Items &amp; Findings</h2>
        <table class="data-table">
          <thead><tr><th>Item</th><th>Sub-Item</th><th>Grade</th><th>Measurement</th><th>Note</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </section>` : ''}

      ${adasList.length > 0 ? `
      <section class="doc-section">
        <h2 class="doc-section-title">ADAS Findings</h2>
        <ul class="adas-list">
          ${adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      <div class="doc-footer">
        <p>CollisionIQ Tech Work Record &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC</p>
      </div>
    </div>`;

  res.send(layout(`Work Record — ${job.jobId}`, content));
});

// ─── Step 10: Photo Upload ────────────────────────────────────────────────────

app.post('/jobs/:jobId/photos', upload.single('photo'), (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job || !req.file) return res.redirect(`/jobs/${encodeURIComponent(req.params.jobId)}`);

  const layer       = parseInt(req.body.layer) || 1;
  const category    = req.body.category   || '';
  const techName    = req.body.tech_name  || '';
  const damageGrade = req.body.damage_grade || null;

  // Gate: Layer 2 requires at least one Layer 1 photo
  if (layer === 2) {
    const l1count = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE job_id=? AND layer=1`).get(job.jobId);
    if (!l1count || l1count.c === 0) {
      return res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
    }
  }

  db.prepare(`
    INSERT INTO photos (job_id, layer, category, filename, tech_name, damage_grade)
    VALUES (?,?,?,?,?,?)
  `).run(job.jobId, layer, category, req.file.filename, techName, damageGrade);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// ─── Step 11: Checkpoint Sign-Off ────────────────────────────────────────────

app.post('/jobs/:jobId/checkpoints/:idx/complete', (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const idx         = parseInt(req.params.idx);
  const completedBy = req.body.completed_by || 'Unknown';
  const now         = new Date().toISOString();

  db.prepare(`
    UPDATE job_checkpoints SET completed=1, completed_by=?, completed_at=?
    WHERE job_id=? AND checkpoint_index=?
  `).run(completedBy, now, job.jobId, idx);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// ─── Step 12: Shareable Insurer Link ─────────────────────────────────────────

app.post('/jobs/:jobId/share', (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const token = crypto.randomUUID();
  const now   = new Date().toISOString();
  db.prepare(`INSERT INTO share_tokens (job_id, token, created_at) VALUES (?,?,?)`).run(job.jobId, token, now);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

app.post('/jobs/:jobId/share/revoke', (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  db.prepare(`UPDATE share_tokens SET revoked=1 WHERE job_id=? AND revoked=0`).run(job.jobId);
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

app.get('/share/:token', (req, res) => {
  const row = db.prepare(`SELECT * FROM share_tokens WHERE token=? AND revoked=0`).get(req.params.token);
  if (!row) {
    return res.status(404).send(layout('Link Expired', `
      <div class="error-page">
        <div class="error-icon">&#x26A0;</div>
        <h1>Link Not Found or Revoked</h1>
        <p>This insurer link is invalid, expired, or has been revoked.</p>
      </div>`));
  }

  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(row.job_id);
  if (!job) return res.status(404).send('Job not found.');

  const photos      = db.prepare(`SELECT * FROM photos WHERE job_id=? ORDER BY layer,uploaded_at`).all(job.jobId);
  const checkpoints = db.prepare(`SELECT * FROM job_checkpoints WHERE job_id=? ORDER BY checkpoint_index`).all(job.jobId);
  const adasList    = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];

  const photoGrid = photos.length > 0
    ? `<div class="photo-grid">${photos.map(p => `
        <div class="photo-thumb">
          <img src="/uploads/${encodeURIComponent(p.filename)}" alt="${escapeHtml(p.category)}" loading="lazy">
          <div class="photo-caption">${escapeHtml(p.category)}${p.damage_grade ? ' — ' + escapeHtml(p.damage_grade) : ''}</div>
        </div>`).join('')}</div>`
    : '<p class="empty">No photos on file.</p>';

  const cpList = checkpoints.length > 0
    ? checkpoints.map(cp => `
       <div class="checkpoint-row ${cp.completed ? 'checkpoint-done' : ''}">
         <span class="checkpoint-num">${cp.checkpoint_index + 1}</span>
         <span class="checkpoint-label">${escapeHtml(cp.label)}</span>
         <span class="checkpoint-status">${cp.completed ? '&#10003; Complete' : 'Pending'}</span>
       </div>`).join('')
    : '';

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ &mdash; Insurer Documentation</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          ${job.collision_grade ? `<div><span class="meta-label">Damage Grade</span> ${escapeHtml(job.collision_grade)}</div>` : ''}
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print</button>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">Job ID</span><span class="info-val">${escapeHtml(job.jobId)}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
          <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}</span></div>
          <div class="info-row"><span class="info-label">Date</span><span class="info-val">${formatDate(job.createdAt)}</span></div>
        </div>
      </section>

      ${adasList.length > 0 ? `
      <section class="doc-section adas-section">
        <h2 class="doc-section-title">ADAS Calibration Requirements</h2>
        <ul class="adas-list">
          ${adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      ${cpList ? `
      <section class="doc-section">
        <h2 class="doc-section-title">Verification Checkpoints</h2>
        <div class="checkpoint-list">${cpList}</div>
      </section>` : ''}

      <section class="doc-section">
        <h2 class="doc-section-title">Photo Documentation</h2>
        ${photoGrid}
      </section>

      <div class="doc-footer">
        <p>CollisionIQ &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC &mdash; Read-only insurer view</p>
      </div>
    </div>`;

  res.send(layout(`Insurer View — ${job.jobId}`, content));
});

// ─── ADAS Reference ───────────────────────────────────────────────────────────

function getOEMPortal(make) {
  const m = (make || '').toLowerCase();
  if (m.includes('toyota') || m.includes('lexus') || m.includes('scion'))
    return 'Toyota Technical Information System (TIS) — Techstream / Techstream Lite';
  if (m.includes('ford') || m.includes('lincoln'))
    return 'Ford IDS or FDRS (Ford Diagnosis and Repair System)';
  if (m.includes('chev') || m.includes('gmc') || m.includes('buick') || m.includes('cadillac'))
    return 'GM GDS2';
  if (m.includes('chrysler') || m.includes('dodge') || m.includes('ram') || m.includes('jeep') || m.includes('fiat'))
    return 'Mopar wiTECH — techauthority.com';
  if (m.includes('honda') || m.includes('acura'))
    return 'Honda i-HDS with Denso DST-i VCI — techinfo.honda.com';
  if (m.includes('nissan') || m.includes('infiniti'))
    return 'Nissan/Infiniti CONSULT — nissan-techinfo.com';
  if (m.includes('kia') || m.includes('hyundai') || m.includes('genesis'))
    return 'Kia/Hyundai GDS (Global Diagnostic System)';
  if (m.includes('subaru'))
    return 'Subaru SSM4 / asTech remote — techinfo.subaru.com (STIS)';
  if (m.includes('mazda'))
    return 'Mazda diagnostic tool — oem1stop.com';
  if (m.includes('mercedes'))
    return 'Mercedes-Benz XENTRY — Startime for labor times';
  if (m.includes('jaguar'))
    return 'JLR Pathfinder — topix.jaguar.com';
  if (m.includes('land rover'))
    return 'JLR Pathfinder — topix.landrover.com';
  if (m.includes('volvo'))
    return 'Volvo VIDA (Vehicle Information and Diagnostics for Aftersales)';
  return 'Consult OEM service information for this vehicle make';
}

// GET /reference — ADAS Reference lookup page
app.get('/reference', (req, res) => {
  const makes = [
    'Toyota', 'Lexus', 'Scion',
    'Ford', 'Lincoln',
    'Chevrolet', 'GMC', 'Buick', 'Cadillac',
    'Chrysler', 'Dodge', 'Ram', 'Jeep', 'Fiat',
    'Honda', 'Acura',
    'Nissan', 'Infiniti',
    'Kia', 'Hyundai', 'Genesis',
    'Subaru', 'Mazda', 'Mercedes-Benz',
    'Jaguar', 'Land Rover', 'Volvo',
    'Tesla',
  ];

  const makeOptions = makes
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join('');

  const years = [];
  for (let y = 2026; y >= 2010; y--) years.push(y);
  const yearOptions = years.map(y => `<option value="${y}">${y}</option>`).join('');

  const content = `
    <div class="page-header">
      <div>
        <h1>ADAS OEM Reference</h1>
        <p class="ref-subtitle">OEM calibration standards by make, model, and year</p>
      </div>
    </div>

    <div class="ref-lookup-card">
      <form method="GET" action="/reference/lookup" class="ref-form">
        <div class="ref-form-steps">
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">1</span> Select Make</div>
            <select name="make" required class="ref-select">
              <option value="">&#8212; Select Make &#8212;</option>
              ${makeOptions}
            </select>
          </div>
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">2</span> Model</div>
            <input type="text" name="model" placeholder="e.g. Camry, Civic, F-150" class="ref-input">
          </div>
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">3</span> Year</div>
            <select name="year" class="ref-select">
              ${yearOptions}
            </select>
          </div>
          <div class="ref-step ref-step-submit">
            <button type="submit" class="btn btn-primary btn-lg">Look Up ADAS Requirements</button>
          </div>
        </div>
      </form>
    </div>

    <div class="ref-note">
      <span class="ref-note-icon">&#9432;</span>
      Calibration requirements shown are based on OEM position statements for the selected make.
      Always verify model-specific procedures in OEM service information.
    </div>`;

  res.send(layout('ADAS Reference', content, 'reference'));
});

// GET /reference/lookup — Reference results
app.get('/reference/lookup', (req, res) => {
  const make  = (req.query.make  || '').trim();
  const model = (req.query.model || '').trim();
  const year  = (req.query.year  || '').trim();

  if (!make) return res.redirect('/reference');

  // Full data: all repairs checked to get every possible system for this make
  const allRepairs = [
    'Windshield', 'Front Camera Area', 'Front Bumper', 'Rear Bumper',
    'Radar', 'Wheel Alignment', 'Suspension', 'Side Mirror', 'Door', 'Mirror',
    'Airbag Deployment', 'Battery Disconnect', 'Air Bag', 'SRS', 'Disassembly',
    'Glass', 'Parking Sensor',
  ];
  const full = runADASEngine(make, model, year, allRepairs);

  // Per-category triggers for the triggers table
  const categories = [
    { label: 'Windshield / Front Camera Area',           repairs: ['Windshield', 'Front Camera Area', 'Glass'] },
    { label: 'Front Bumper / Radar',                     repairs: ['Front Bumper', 'Radar'] },
    { label: 'Rear Bumper',                              repairs: ['Rear Bumper', 'Parking Sensor'] },
    { label: 'Side Mirror / Door',                       repairs: ['Side Mirror', 'Door', 'Mirror'] },
    { label: 'Wheel Alignment / Suspension',             repairs: ['Wheel Alignment', 'Suspension'] },
    { label: 'Airbag Deployment / Battery Disconnect',   repairs: ['Airbag Deployment', 'Battery Disconnect', 'Air Bag', 'SRS', 'Disassembly'] },
  ];

  const triggerRows = categories.map(cat => {
    const catResult = runADASEngine(make, model, year, cat.repairs);
    const systems   = catResult.adasSystems
      ? catResult.adasSystems.split('\n').filter(Boolean)
      : [];

    if (systems.length === 0) {
      const isAirbagCat = cat.label.toLowerCase().includes('airbag') || cat.label.toLowerCase().includes('battery');
      if (isAirbagCat) {
        return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems">
          <div class="trigger-system-item">
            <span class="cal-type-badge cal-type-oem">SCAN</span>
            <span>Pre and post-repair scan required per OEM position statement &mdash; run full DTC/alert check</span>
          </div>
        </td>
      </tr>`;
      }
      return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems"><span class="trigger-none">&#10003; No calibration required for this make</span></td>
      </tr>`;
    }

    const systemsHtml = systems.map(s => {
      const isStatic  = /static/i.test(s);
      const isDynamic = /dynamic/i.test(s);
      const badge = isStatic
        ? '<span class="cal-type-badge cal-type-static">Static</span>'
        : isDynamic
          ? '<span class="cal-type-badge cal-type-dynamic">Dynamic</span>'
          : '<span class="cal-type-badge cal-type-oem">Per OEM</span>';
      return `<div class="trigger-system-item">${badge}<span>${escapeHtml(s)}</span></div>`;
    }).join('');

    return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems">${systemsHtml}</td>
      </tr>`;
  }).join('');

  const sourceCitation = full.sourceCitation || 'OEM Position Statement';

  const oemPortal = getOEMPortal(make);

  const vehicleDisplay = [year, make, model].filter(Boolean).join(' ');

  const content = `
    <div class="ref-back-bar no-print">
      <a href="/reference" class="btn btn-ghost">&larr; New Lookup</a>
      <span class="ref-vehicle-label">${escapeHtml(vehicleDisplay)}</span>
    </div>

    <div class="ref-card" id="refCard">

      <div class="ref-card-header">
        <div>
          <div class="ref-card-brand">CollisionIQ &mdash; ADAS OEM Reference</div>
          <div class="ref-card-vehicle">${escapeHtml(vehicleDisplay) || '&mdash;'}</div>
        </div>
        <div class="ref-card-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print Reference Card</button>
        </div>
      </div>

      <!-- SECTION 1: OEM SCAN STANDARD -->
      <section class="ref-section">
        <h2 class="ref-section-title">&#9654; Section 1 &mdash; OEM Scan Standard</h2>
        <div class="ref-scan-grid">
          <div class="ref-scan-item">
            <div class="ref-scan-item-label">Pre-Repair Scan</div>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(full.preScanRequired)}">${escapeHtml(scanBadgeLabel(full.preScanRequired))}</span>
            <div class="ref-scan-detail">${escapeHtml(full.preScanRequired || 'RECOMMENDED')}</div>
          </div>
          <div class="ref-scan-item">
            <div class="ref-scan-item-label">Post-Repair Scan</div>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(full.postScanRequired)}">${escapeHtml(scanBadgeLabel(full.postScanRequired))}</span>
            <div class="ref-scan-detail">${escapeHtml(full.postScanRequired || 'RECOMMENDED')}</div>
          </div>
        </div>
        <div class="ref-tool-row">
          <span class="ref-tool-icon">&#128295;</span>
          <span class="ref-tool-label">Approved Scan Tool</span>
          <span class="ref-tool-value">${escapeHtml(full.approvedScanTool)}</span>
        </div>
        <div class="ref-source-row">
          <span class="ref-source-label">Source</span>
          <span class="ref-source-value">${escapeHtml(sourceCitation)}</span>
        </div>
        ${make.toLowerCase().includes('tesla') ? `
        <div class="ref-tesla-note">
          <strong>Note:</strong> Tesla does not use standard DTCs. Tesla uses an alert-based diagnostic system.
          Toolbox 3 software required &mdash; not standard OBDII compatible.
        </div>` : ''}
      </section>

      <!-- SECTION 2: CALIBRATION TRIGGERS -->
      <section class="ref-section">
        <h2 class="ref-section-title">&#9654; Section 2 &mdash; Calibration Triggers by Repair Type</h2>
        <div class="ref-trigger-wrap">
          <table class="ref-trigger-table">
            <thead>
              <tr>
                <th>Repair Type</th>
                <th>Systems Requiring Calibration</th>
              </tr>
            </thead>
            <tbody>
              ${triggerRows}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: LIABILITY & COMPLIANCE -->
      <section class="ref-section ref-liability-section">
        <h2 class="ref-section-title">&#9654; Section 3 &mdash; Liability &amp; Compliance Summary</h2>
        <div class="warning-box ref-liability-box">
          <span class="warning-icon">&#9888;</span>
          <p>${escapeHtml(full.liabilityWarning)}</p>
        </div>
        <div class="ref-notes-block">
          <div class="ref-notes-heading">${escapeHtml(make)}-Specific Notes</div>
          <div class="notes-box">
            <p>${escapeHtml(full.makeSpecificNotes)}</p>
          </div>
        </div>
        <div class="ref-oem-source-row">
          <span class="ref-oem-label">&#128196; OEM Repair Information</span>
          <span class="ref-oem-value">${escapeHtml(oemPortal)}</span>
        </div>
      </section>

      <!-- SECTION 4: QUICK ACTIONS -->
      <section class="ref-section ref-actions-section no-print">
        <h2 class="ref-section-title">&#9654; Section 4 &mdash; Quick Actions</h2>
        <div class="ref-action-buttons">
          <a href="/new?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${encodeURIComponent(year)}"
             class="btn btn-primary btn-lg">
            + Start New Job &mdash; ${escapeHtml(make)} ${escapeHtml(model)} ${escapeHtml(year)}
          </a>
          <button onclick="window.print()" class="btn btn-lg">
            &#128438; Print Reference Card
          </button>
        </div>
      </section>

      <div class="ref-watermark">
        SOURCE: OEM Position Statement &mdash; Calibration requirements are make-based.
        Always verify model-specific procedures in OEM service information.
      </div>

    </div>

    <div class="ref-note no-print" style="margin-top:1rem">
      <span class="ref-note-icon">&#9432;</span>
      Calibration requirements shown are based on OEM position statements for this make.
      Always verify model-specific procedures in OEM service information.
    </div>`;

  res.send(layout(`ADAS Reference \u2014 ${make}`, content, 'reference'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`CollisionIQ running on http://localhost:${PORT}`);
});
