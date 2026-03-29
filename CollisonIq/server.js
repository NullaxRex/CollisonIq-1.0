'use strict';

const express = require('express');
const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const { runADASEngine } = require('./adasEngine');

const app = express();
const PORT = 3000;
const fs = require('fs');
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
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`);
  } catch (e) {
    // Column already exists — skip
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// GET /new — New job form
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
    'Wheel Alignment',
    'Suspension',
    'Door / Mirror Repair',
    'EV / Hybrid Vehicle',
    'Other'
  ];

  const checkboxes = repairOptions.map(r => `
    <label class="checkbox-label">
      <input type="checkbox" name="repairs" value="${escapeHtml(r)}">
      <span>${escapeHtml(r)}</span>
    </label>`).join('');

  const content = `
    <div class="page-header">
      <h1>New Job</h1>
    </div>

    <form method="POST" action="/jobs" class="job-form" id="newJobForm">
      <div class="form-section">
        <h2 class="section-heading">Vehicle Information</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="ro">RO Number <span class="req">*</span></label>
            <input type="text" id="ro" name="ro" placeholder="e.g. RO-12345" required>
          </div>
          <div class="form-group">
            <label for="vin">VIN</label>
            <input type="text" id="vin" name="vin" placeholder="17-character VIN" maxlength="17"
                   style="text-transform:uppercase">
          </div>
          <div class="form-group">
            <label for="year">Year</label>
            <input type="text" id="year" name="year" placeholder="e.g. 2022" maxlength="4" pattern="[0-9]{4}"
                   value="${escapeHtml(prefill.year)}">
          </div>
          <div class="form-group">
            <label for="make">Make</label>
            <input type="text" id="make" name="make" placeholder="e.g. Toyota"
                   value="${escapeHtml(prefill.make)}">
          </div>
          <div class="form-group">
            <label for="model">Model</label>
            <input type="text" id="model" name="model" placeholder="e.g. Camry"
                   value="${escapeHtml(prefill.model)}">
          </div>
          <div class="form-group">
            <label for="trim">Trim</label>
            <input type="text" id="trim" name="trim" placeholder="e.g. XSE V6">
          </div>
          <div class="form-group">
            <label for="technicianName">Technician Name <span class="req">*</span></label>
            <input type="text" id="technicianName" name="technicianName" placeholder="Full name" required>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h2 class="section-heading">Repairs Performed</h2>
        <p class="section-hint">Select all that apply. The ADAS engine will analyze these to flag required calibrations.</p>
        <div class="checkbox-grid">
          ${checkboxes}
        </div>
        <div class="form-group" style="margin-top:1.25rem">
          <label for="otherRepairs">Other Repairs (describe)</label>
          <input type="text" id="otherRepairs" name="otherRepairs"
                 placeholder="Describe any additional repairs performed&hellip;">
        </div>
      </div>

      <div class="form-actions">
        <a href="/" class="btn btn-ghost">Cancel</a>
        <button type="submit" class="btn btn-primary btn-lg">Submit &amp; Generate ADAS Report</button>
      </div>
    </form>`;

  res.send(layout('New Job', content, 'new'));
});

// POST /jobs — Create job
app.post('/jobs', (req, res) => {
  const { ro, vin, year, make, model, trim, technicianName, otherRepairs } = req.body;

  let repairs = req.body.repairs || [];
  if (!Array.isArray(repairs)) repairs = [repairs];
  if (otherRepairs && otherRepairs.trim()) repairs.push(otherRepairs.trim());

  const repairsStr = repairs.join(', ');
  const { adasSystems, rationale, liabilityWarning, makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool } =
    runADASEngine(make, model, year, repairs);

  const jobId      = generateJobId();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const shareUrl   = `/jobs/${jobId}?token=${shareToken}`;
  const now        = new Date().toISOString();

  db.prepare(`
    INSERT INTO jobs
      (jobId, ro, vin, year, make, model, trim, technicianName,
       repairsPerformed, adasSystems, rationale, liabilityWarning,
       makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
       status, shareToken, shareUrl, createdAt, updatedAt)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Created', ?, ?, ?, ?)
  `).run(
    jobId, ro || '', vin || '', year || '', make || '', model || '', trim || '',
    technicianName || '', repairsStr, adasSystems, rationale, liabilityWarning,
    makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
    shareToken, shareUrl, now, now
  );

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
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName) || '&mdash;'}</span></div>
          <div class="info-row info-row-full"><span class="info-label">Repairs Performed</span><span class="info-val">${escapeHtml(job.repairsPerformed) || '&mdash;'}</span></div>
        </div>
      </section>

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
        <ul class="adas-list">
          ${adasItems}
        </ul>
      </section>

      <section class="doc-section">
        <h2 class="doc-section-title">Rationale</h2>
        <ul class="rationale-list">
          ${rationaleItems}
        </ul>
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
        <div class="notes-box">
          <p>${escapeHtml(job.makeSpecificNotes) || '&mdash;'}</p>
        </div>
      </section>

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
