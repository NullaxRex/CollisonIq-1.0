'use strict';
// CollisionIQ end-to-end smoke + security suite. Normally started by run-suite.js,
// which boots a seeded throwaway server and passes these in:
//   CIQ_DB=<that server's DB> WEBHOOK_SECRET=<its webhook secret> node tests/smoke.js <baseUrl>
// CIQ_DB is used only for fixtures/lookups (user ids, Stripe customer ids).
// Never point this at a real database: it creates, edits and deactivates records.
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const BASE = process.argv[2];
if (!BASE || !process.env.CIQ_DB) {
  console.error('Run this through tests/run-suite.js (or tests/run-all.js); it needs a throwaway server URL and CIQ_DB.');
  process.exit(2);
}
const DB = process.env.CIQ_DB ? new DatabaseSync(process.env.CIQ_DB) : null;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const results = [];
let section = '';
const check = (name, ok, info = '') => {
  results.push({ section, name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};
const heading = (s) => { section = s; console.log(`\n## ${s}`); };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.token = null; }
  async req(method, path, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload = body;
    if (body && !(body instanceof FormData) && typeof body === 'object') {
      payload = new URLSearchParams(body).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    }
    const r = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    for (const c of r.headers.getSetCookie?.() || []) if (c.startsWith('connect.sid=')) this.cookie = c.split(';')[0];
    const text = await r.text();
    const m = text.match(/name="_csrf" value="([a-f0-9]+)"/);
    if (m) this.token = m[1];
    return { status: r.status, location: r.headers.get('location') || '', text, headers: r.headers };
  }
  raw(method, path, rawBody, contentType) {
    return this.req(method, path, rawBody, { 'content-type': contentType });
  }
  async csrf() { if (!this.token) await this.req('GET', '/login'); return this.token; }
  async freshToken(path) { this.token = null; await this.req('GET', path); if (!this.token) throw new Error(`${this.name}: no CSRF token on ${path}`); return this.token; }
  async login(u, p) {
    this.cookie = ''; this.token = null;
    await this.req('GET', '/login');
    return this.req('POST', '/login', { _csrf: this.token, username: u, password: p });
  }
  post(path, fields = {}) { return this.req('POST', path, { _csrf: this.token, ...fields }); }
  upload(path, buf, type, filename, withToken = true) {
    const fd = new FormData();
    if (withToken) fd.append('_csrf', this.token);
    fd.append('photo', new Blob([buf], { type }), filename);
    return this.req('POST', path, fd);
  }
}

const denied = (x) => x.status === 403 && !/form token/i.test(x.text);
async function alive() {
  try { const r = await fetch(BASE + '/login', { signal: AbortSignal.timeout(4000) }); return r.status === 200; }
  catch { return false; }
}
const userId = (username) => DB.prepare('SELECT id FROM users WHERE username=?').get(username).id;

(async () => {
  // ─── Public pages & static ─────────────────────────────────────────────────
  heading('Public pages');
  const anon = new Client('anon');
  let r = await anon.req('GET', '/login');
  check('GET /login renders', r.status === 200 && r.text.includes('CollisionIQ'));
  check('login form has CSRF token', !!anon.token);
  r = await anon.req('GET', '/register');
  check('GET /register renders', r.status === 200);
  for (const p of ['/style.css', '/manifest.json', '/js/app.js']) {
    r = await anon.req('GET', p);
    check(`static ${p} served`, r.status === 200);
  }
  for (const p of ['/', '/admin', '/new', '/jobs/CIQ-x', '/reference']) {
    r = await anon.req('GET', p);
    check(`anon GET ${p} → redirect /login`, r.status === 302 && r.location === '/login', `${r.status} ${r.location}`);
  }

  // ─── Headers / CSP ─────────────────────────────────────────────────────────
  heading('Security headers & CSP');
  r = await new Client('hdr').req('GET', '/login');
  const csp = r.headers.get('content-security-policy') || '';
  check('CSP header present', !!csp);
  check("CSP script-src is 'self' only", /script-src 'self'(;|$)/.test(csp), csp.match(/script-src[^;]*/)?.[0]);
  check("CSP script-src-attr 'none' (blocks inline handlers)", /script-src-attr 'none'/.test(csp));
  check('CSP form-action allows Stripe Checkout', /form-action 'self' https:\/\/checkout\.stripe\.com/.test(csp));
  check('X-Content-Type-Options nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options set', !!r.headers.get('x-frame-options'));
  const sc = (r.headers.getSetCookie?.() || []).join(' ');
  check('session cookie HttpOnly + SameSite=Lax', /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), sc.split(';').slice(1).join(';'));

  // ─── Login hardening ───────────────────────────────────────────────────────
  heading('Login hardening');
  const c0 = new Client('c0'); await c0.req('GET', '/login');
  r = await c0.req('POST', '/login', { username: 'metro_admin', password: 'demo1234' });
  check('POST /login without CSRF token rejected', r.status === 403);
  const probe = new Client('probe'); await probe.req('GET', '/login');
  r = await probe.raw('POST', '/login', `_csrf=${probe.token}&username=metro_admin`, 'application/x-www-form-urlencoded');
  check('login with no password → handled (no crash)', r.status === 302 && await alive(), `status ${r.status}`);
  r = await probe.raw('POST', '/login', `_csrf=${probe.token}&username[]=a&username[]=b&password=x`, 'application/x-www-form-urlencoded');
  check('login with username as array → handled (no crash)', r.status === 302 && await alive(), `status ${r.status}`);
  r = await probe.raw('POST', '/login', `_csrf=${probe.token}&username=metro_admin&password[a]=b`, 'application/x-www-form-urlencoded');
  check('login with password as object → handled (no crash)', r.status === 302 && await alive(), `status ${r.status}`);
  const bad = new Client('bad');
  r = await bad.login('metro_admin', 'wrong');
  check('wrong password rejected', r.status === 302 && r.location.includes('error=1'));
  const lock = new Client('lock'); await lock.req('GET', '/login');
  let lockStatus = [];
  for (let i = 0; i < 11; i++) {
    const x = await lock.post('/login', { username: 'lockout_probe_user', password: 'nope' + i });
    lockStatus.push(x.status);
  }
  check('per-username lockout after 10 failures (429)', lockStatus.slice(0, 10).every((s) => s === 302) && lockStatus[10] === 429, lockStatus.join(','));
  const fix = new Client('fix'); await fix.req('GET', '/login');
  const preLoginSid = fix.cookie;
  await fix.post('/login', { username: 'metro_admin', password: 'demo1234' });
  check('session id rotates on login (no fixation)', fix.cookie && fix.cookie !== preLoginSid);

  // ─── Shop admin happy path ─────────────────────────────────────────────────
  heading('Shop admin');
  const admin = new Client('metro_admin');
  r = await admin.login('metro_admin', 'demo1234');
  check('metro_admin login', r.status === 302 && r.location === '/', r.location);
  r = await admin.req('GET', '/');
  check('dashboard renders', r.status === 200, `status ${r.status}`);
  const seededJobs = [...new Set([...r.text.matchAll(/\/jobs\/(CIQ-[\w-]+)/g)].map((m) => m[1]))];
  check('dashboard lists jobs', seededJobs.length > 0, `${seededJobs.length} jobs`);
  for (const p of ['/new', '/reference', '/admin', '/admin/users']) {
    r = await admin.req('GET', p);
    check(`GET ${p} as shop_admin`, r.status === 200, `status ${r.status}`);
  }
  r = await admin.req('GET', '/reference/lookup?make=Toyota&model=Camry&year=2022');
  check('GET /reference/lookup', r.status === 200, `status ${r.status}`);
  r = await admin.req('GET', '/platform/shops');
  check('shop_admin blocked from /platform/shops', denied(r));

  heading('Malformed query/body input');
  r = await admin.req('GET', '/?search[]=a&search[]=b');
  check('array ?search → 200 (no 500)', r.status === 200, `status ${r.status}`);
  r = await admin.req('GET', '/reference/lookup?make[]=Toyota');
  check('array ?make on lookup → handled (no 500)', r.status === 302 || r.status === 200, `status ${r.status}`);

  heading('Inline handlers removed (CSP-compatible pages)');
  const pagesToScan = ['/', '/admin', '/admin/users', '/reference/lookup?make=Honda'];
  if (seededJobs[0]) pagesToScan.push(`/jobs/${seededJobs[0]}`, `/jobs/${seededJobs[0]}/photos`);
  let inline = [];
  for (const p of pagesToScan) {
    const x = await admin.req('GET', p);
    if (/\son[a-z]+\s*=\s*["']/i.test(x.text) || /<script(?![^>]*\bsrc=)[^>]*>/i.test(x.text)) inline.push(p);
  }
  check('no inline on*= handlers or inline <script> on app pages', inline.length === 0, inline.join(', '));

  // Create a job
  heading('Jobs');
  await admin.req('GET', '/new');
  const jobForm = { ro: 'RO-SMOKE1', vin: '1HGCV1F30LA000001', year: '2020', make: 'Honda', model: 'Accord', trim: 'EX', technicianName: 'Tech One', repairs: 'Windshield', impact_zones: 'front_end' };
  r = await admin.post('/jobs', jobForm);
  const jobA = (r.location.match(/\/jobs\/(CIQ-[\w-]+)/) || [])[1];
  check('POST /jobs creates a job', r.status === 302 && !!jobA, `→ ${r.location}`);
  r = await admin.post('/jobs', { ...jobForm, ro: 'RO-SMOKE2' });
  const jobB = (r.location.match(/\/jobs\/(CIQ-[\w-]+)/) || [])[1];
  check('second job created', !!jobB);
  r = await admin.req('POST', '/jobs', { _csrf: admin.token, 'ro[]': 'x', 'make[a]': 'b' });
  check('POST /jobs with array/object fields → handled', r.status === 400 || r.status === 302, `status ${r.status}`);
  for (const p of [`/jobs/${jobA}`, `/jobs/${jobA}/edit`, `/jobs/${jobA}/photos`]) {
    r = await admin.req('GET', p);
    check(`GET ${p.replace(jobA, ':id')}`, r.status === 200, `status ${r.status}`);
  }
  r = await admin.post(`/jobs/${jobA}/edit`, { ...jobForm, model: 'Civic' });
  check('POST /jobs/:id/edit as shop_admin', r.status === 302);

  // Job form → OEM rules engine → hard copy (Nov 2026)
  heading('Job hard copy (rules engine)');
  r = await admin.req('GET', '/new');
  check('job form has side-specific door/mirror boxes and tailgate/fender/rear door options',
    ['value="FRONT_DOOR_RI:L"', 'value="MIRROR_RI:R"', 'value="LIFTGATE_RI"', 'value="TRUNK_RI"', 'value="FENDER:L"', 'value="REAR_DOOR:R"', 'value="FRONT_DAMAGE"', 'value="REAR_DAMAGE"'].every((v) => r.text.includes(v)));
  r = await admin.req('POST', '/jobs', [['_csrf', admin.token], ['ro', 'RO-F150'], ['year', '2025'], ['make', 'Ford'], ['model', 'F-150'], ['technicianName', 'Tech One'],
    ['repairs', 'FRONT_BUMPER_RI'], ['repairs', 'FRONT_DOOR_RI:L'], ['repairs', 'MIRROR_RI:L'], ['repairs', 'LIFTGATE_RI']]);
  const jobF = (r.location.match(/\/jobs\/(CIQ-[\w-]+)/) || [])[1];
  check('Ford F-150 job created from new checkboxes', r.status === 302 && !!jobF);
  r = await admin.req('GET', `/jobs/${jobF}`);
  check('hard copy shows Ford job aid calibrations and field rules',
    ['OEM Calibrations Required', 'Front parking aid sensors', 'Left mirror camera (360°)', 'Rear camera (tailgate / liftgate / decklid)', 'Workshop manual section',
      'CollisionIQ Field Rules — Not OEM Requirements', 'Left side mirror camera', 'Rear camera — test and verify', 'Advanced Drive Assist Systems Job Aid'].every((t) => r.text.includes(t)));
  check('hard copy cites no I-CAR calibration search', !/Calibration Requirements Search/.test(r.text));
  check('hard copy has no old-engine lines or company marking', !/SODCM Blind Spot|No rationale generated|Cueljuris/.test(r.text.split('site-footer')[0]));
  r = await admin.req('GET', `/jobs/${jobF}/edit`);
  check('edit form keeps the checked boxes', /value="FRONT_DOOR_RI:L" checked/.test(r.text) && /value="LIFTGATE_RI" checked/.test(r.text) && !/value="FRONT_DOOR_RI:R" checked/.test(r.text));
  r = await admin.req('GET', `/jobs/${jobA}/edit`);
  check('legacy "Windshield" value maps to Windshield replaced', /value="WINDSHIELD_REPLACED" checked/.test(r.text));
  if (DB) {
    DB.prepare("UPDATE jobs SET adas_eval=NULL, repair_keys=NULL, repairsPerformed='Windshield, Door / Mirror Repair' WHERE jobId=?").run(jobB);
    r = await admin.req('GET', `/jobs/${jobB}`);
    check('job saved by the old engine still renders, with a re-run note', r.status === 200 && /Saved with the original engine/.test(r.text));
    r = await admin.req('GET', `/jobs/${jobB}/edit`);
    check('old job edit form converts labels (door repair both sides)', /value="FRONT_DOOR_REPAIR:L" checked/.test(r.text) && /value="FRONT_DOOR_REPAIR:R" checked/.test(r.text) && /saved with the old checkboxes/.test(r.text));
  }

  // Photos
  heading('Photo uploads');
  r = await admin.req('GET', `/jobs/${jobA}/photos`);
  const slotIds = [...r.text.matchAll(new RegExp(`/jobs/${jobA}/photos/(\\d+)"`, 'g'))].map((m) => m[1]);
  const slotA = slotIds[0], slotA2 = slotIds[1];
  check('photo slots exist', slotIds.length >= 2, `${slotIds.length} slots`);
  r = await admin.upload(`/jobs/${jobA}/photos/${slotA}`, PNG, 'image/png', 'evil.html');
  check('valid PNG upload accepted', r.status === 302, `status ${r.status} ${r.status !== 302 ? r.text.slice(0, 80) : ''}`);
  if (DB) {
    const fp = DB.prepare('SELECT file_path FROM job_photos WHERE id=?').get(slotA).file_path;
    check('stored filename ext comes from MIME, not client name', /^[0-9a-f-]{36}\.png$/.test(fp), fp);
  }
  r = await admin.req('GET', `/jobs/${jobA}/photos/${slotA}/file`);
  check('photo served as image/png, private cache', r.status === 200 && r.headers.get('content-type').startsWith('image/png') && /private/.test(r.headers.get('cache-control') || ''), `${r.status} ${r.headers.get('content-type')}`);
  r = await admin.upload(`/jobs/${jobA}/photos/${slotA2}`, Buffer.from('<html><script>alert(1)</script></html>'), 'image/png', 'x.png');
  check('HTML disguised as image/png rejected (magic bytes)', r.status === 400, `status ${r.status}`);
  r = await admin.upload(`/jobs/${jobA}/photos/${slotA2}`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 'x.svg');
  check('SVG upload rejected', r.status === 400, `status ${r.status}`);
  r = await admin.upload(`/jobs/${jobA}/photos/${slotA2}`, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10)]), 'image/png', 'big.png');
  check('upload over 10 MB rejected', r.status === 400, `status ${r.status}`);
  r = await admin.upload(`/jobs/${jobA}/photos/${slotA2}`, PNG, 'image/png', 'x.png', false);
  check('upload without CSRF token rejected', r.status === 403, `status ${r.status}`);
  const fd2 = new FormData(); fd2.append('x', '1');
  r = await admin.req('POST', `/jobs/${jobA}/share/revoke`, fd2);
  check('multipart POST without token to non-upload route rejected', r.status === 403, `status ${r.status}`);
  r = await admin.req('GET', `/jobs/${jobB}/photos/${slotA}/file`);
  check("photo id from job A not served under job B's URL", r.status === 404, `status ${r.status}`);
  r = await admin.upload(`/jobs/${jobB}/photos/${slotA2}`, PNG, 'image/png', 'x.png');
  check("photo slot from job A not writable via job B's URL", r.status === 404, `status ${r.status}`);

  // Share links
  heading('Share links');
  r = await admin.post(`/jobs/${jobA}/share`);
  check('generate share link', r.status === 302);
  r = await admin.req('GET', `/jobs/${jobA}`);
  const shareToken = (r.text.match(/\/share\/([0-9a-f-]{36})/) || [])[1];
  check('share token is a random UUID (122-bit)', !!shareToken, shareToken);
  r = await anon.req('GET', `/share/${shareToken}`);
  check('anon can open active share link', r.status === 200 && r.text.includes('1HGCV1F30LA000001'), `status ${r.status}`);
  check('share view omits RO# and technician name', !r.text.includes('RO-SMOKE1') && !r.text.includes('Tech One'));
  check('share view sends no-referrer', r.headers.get('referrer-policy') === 'no-referrer');
  r = await admin.post(`/jobs/${jobA}/share/revoke`);
  r = await anon.req('GET', `/share/${shareToken}`);
  check('revoked share link → 404', r.status === 404, `status ${r.status}`);
  r = await anon.req('GET', `/share/${crypto.randomUUID()}`);
  check('unknown share token → 404', r.status === 404);
  r = await admin.post(`/jobs/${jobA}/share`);
  r = await admin.req('GET', `/jobs/${jobA}`);
  const liveToken = (r.text.match(/\/share\/([0-9a-f-]{36})/) || [])[1];

  // ─── Cross-shop isolation on every :id route ───────────────────────────────
  heading('Cross-shop isolation (north_admin → Metro resources)');
  const north = new Client('north_admin');
  await north.login('north_admin', 'demo1234');
  { const nl = await north.req('GET', '/'); const nj = (nl.text.match(/\/jobs\/(CIQ-[\w-]+)/) || [])[1]; await north.freshToken(`/jobs/${nj}`); }
  const metroTech2 = DB ? userId('metro_tech2') : null;
  const before = DB ? DB.prepare('SELECT status, ro, model FROM jobs WHERE jobId=?').get(jobA) : null;
  const xs = [
    ['GET', `/jobs/${jobA}`, null, [404]],
    ['GET', `/jobs/${jobA}/edit`, null, [404]],
    ['POST', `/jobs/${jobA}/edit`, { ro: 'HACKED', model: 'HACKED' }, [404]],
    ['GET', `/jobs/${jobA}/photos`, null, [404]],
    ['GET', `/jobs/${jobA}/photos/${slotA}/file`, null, [404]],
    ['UPLOAD', `/jobs/${jobA}/photos/${slotA2}`, null, [404]],
    ['POST', `/jobs/${jobA}/share`, {}, [404]],
    ['POST', `/jobs/${jobA}/share/revoke`, {}, [404]],
    ['POST', `/jobs/${jobA}/status`, { status: 'Closed' }, [404]],
    ['POST', `/admin/users/${metroTech2}/role`, { role: 'shop_admin' }, [403]],
    ['POST', `/admin/users/${metroTech2}/deactivate`, {}, [403]],
  ];
  for (const [m, p, body, expect] of xs) {
    const x = m === 'GET' ? await north.req('GET', p)
      : m === 'UPLOAD' ? await north.upload(p, PNG, 'image/png', 'x.png')
      : await north.post(p, body);
    check(`${m} ${p.replace(jobA, ':metroJob').replace(String(metroTech2), ':metroUser')} → ${expect.join('/')}`, expect.includes(x.status) && !/form token/i.test(x.text), `status ${x.status}${/form token/i.test(x.text) ? ' (CSRF, not tenant check!)' : ''}`);
  }
  if (DB) {
    const after = DB.prepare('SELECT status, ro, model FROM jobs WHERE jobId=?').get(jobA);
    check('Metro job unchanged after cross-shop attempts', JSON.stringify(before) === JSON.stringify(after));
    const t2 = DB.prepare('SELECT role, active FROM users WHERE username=?').get('metro_tech2');
    check('Metro user unchanged after cross-shop attempts', t2.role === 'technician' && t2.active === 1);
    const tok = DB.prepare('SELECT revoked FROM share_tokens WHERE token=?').get(liveToken);
    check('Metro share link not revoked by other shop', tok && tok.revoked === 0);
  }
  r = await north.req('GET', '/');
  check("north_admin job list excludes Metro's job", r.status === 200 && !r.text.includes(jobA));
  r = await north.req('GET', `/?search=RO-SMOKE`);
  check('north_admin search cannot find Metro job', !r.text.includes(jobA));

  // ─── Role matrix ───────────────────────────────────────────────────────────
  heading('Role matrix');
  const tech = new Client('metro_tech1');
  await tech.login('metro_tech1', 'demo1234');
  await tech.freshToken(`/jobs/${jobA}`);
  r = await tech.req('GET', '/admin'); check('technician blocked from /admin', denied(r), `status ${r.status}`);
  r = await tech.req('GET', '/new'); check('technician blocked from GET /new', denied(r), `status ${r.status}`);
  r = await tech.post('/jobs', jobForm); check('technician blocked from POST /jobs', denied(r), `status ${r.status}`);
  r = await tech.req('GET', `/jobs/${jobA}/edit`); check('technician blocked from GET edit', denied(r), `status ${r.status}`);
  r = await tech.post(`/jobs/${jobA}/edit`, { ro: 'TECH' }); check('technician blocked from POST edit', denied(r), `status ${r.status}`);
  r = await tech.post('/onboarding', { shop_name: 'Renamed by tech' }); check('technician blocked from POST /onboarding', denied(r), `status ${r.status}`);
  // Technicians see and work only on jobs assigned to them (Nov 2026).
  const uid = (name) => (DB ? userId(name) : 0);
  r = await tech.req('GET', `/jobs/${jobA}`); check('technician cannot open an unassigned job', r.status === 404, `status ${r.status} ${r.location || ''}`);
  r = await tech.req('GET', '/'); check('unassigned job not in the technician job list', r.status === 200 && !r.text.includes(jobA));
  r = await tech.post(`/jobs/${jobA}/assign`, { tech_ids: String(uid('metro_tech1')) });
  check('technician cannot assign', denied(r), `status ${r.status}`);
  await admin.freshToken(`/jobs/${jobA}`);
  r = await admin.req('GET', `/jobs/${jobA}`);
  check('job page offers technician assignment to shop admin', /name="tech_ids"/.test(r.text) && /Assigned Technicians/.test(r.text));
  r = await admin.post(`/jobs/${jobA}/assign`, { tech_ids: String(uid('north_tech1')) });
  check("cannot assign another shop's technician", !DB || !DB.prepare('SELECT 1 FROM job_assignments WHERE job_id=? AND user_id=?').get(jobA, uid('north_tech1')));
  for (const j of [jobA, jobB]) await admin.post(`/jobs/${j}/assign`, { tech_ids: String(uid('metro_tech1')) });
  check('shop admin assigns the technician', !DB || DB.prepare('SELECT COUNT(*) n FROM job_assignments WHERE user_id=? AND job_id IN (?,?) AND removed_at IS NULL').get(uid('metro_tech1'), jobA, jobB).n === 2);
  r = await tech.req('GET', '/'); check('assigned job appears in the technician job list', r.text.includes(jobA));
  r = await tech.req('GET', `/jobs/${jobA}`); check('technician can view an assigned job', r.status === 200);
  check('technician job page hides Edit button', !r.text.includes(`/jobs/${jobA}/edit`));
  r = await tech.req('GET', `/jobs/${jobA}/photos`);
  r = await tech.upload(`/jobs/${jobA}/photos/${slotA2}`, PNG, 'image/png', 'x.png');
  check('technician can upload photos', r.status === 302, `status ${r.status}`);
  const qc = new Client('metro_qc');
  await qc.login('metro_qc', 'demo1234'); await qc.freshToken(`/jobs/${jobA}`);
  r = await qc.post('/jobs', jobForm); check('qc_manager blocked from POST /jobs', denied(r), `status ${r.status}`);
  r = await qc.req('GET', '/admin/users'); check('qc_manager blocked from /admin/users', denied(r), `status ${r.status}`);
  const writer = new Client('metro_writer');
  await writer.login('metro_writer', 'demo1234'); await writer.freshToken('/new');
  r = await writer.post('/jobs', { ...jobForm, ro: 'RO-WRITER' }); check('service_writer can create job', r.status === 302, `status ${r.status}`);
  r = await writer.post(`/jobs/${jobA}/edit`, { ...jobForm, ro: 'RO-SMOKE1' }); check('service_writer can edit job', r.status === 302, `status ${r.status}`);
  r = await writer.req('GET', `/jobs/${jobA}/photos`);
  check('service_writer photo page shows no upload forms', !r.text.includes('enctype="multipart/form-data"'));
  r = await writer.upload(`/jobs/${jobA}/photos/${slotA2}`, PNG, 'image/png', 'x.png');
  check('service_writer blocked from uploading photos', denied(r), `status ${r.status}`);
  r = await writer.req('GET', '/admin'); check('service_writer blocked from /admin', denied(r), `status ${r.status}`);

  // ─── Calibration record (Nov 2026) ─────────────────────────────────────────
  heading('Calibration record');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const recordForm = (client, fields, files = []) => {
    const fd = new FormData();
    fd.append('_csrf', client.token);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const [buf, type, name] of files) fd.append('proof', new Blob([buf], { type }), name);
    return fd;
  };
  const today = new Date().toISOString().slice(0, 10);
  const passFields = { result: 'pass', method: 'Scan', si_reference: 'OEM SI doc 12345, 2026-10-01', tool: 'OEM scan tool', performed_by_name: 'Tech One', performed_on: today };
  await admin.freshToken(`/jobs/${jobA}`);
  r = await admin.req('GET', `/jobs/${jobA}`);
  check('job page shows the calibration record and the add form', /Calibration Record/.test(r.text) && /name="item_key"/.test(r.text) && /value="SCAN:PRE"/.test(r.text) && /documented/.test(r.text));
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'SCAN:PRE', ...passFields }, [[PDF, 'application/pdf', 'prescan.pdf'], [PNG, 'image/png', 'screen.png']]));
  check('record with PDF + photo proof saved', r.status === 302 && /\/jobs\//.test(r.location), `status ${r.status}`);
  const recRow = DB ? DB.prepare("SELECT * FROM job_calibrations WHERE job_id=? AND item_key='SCAN:PRE'").get(jobA) : null;
  const proofRows = DB && recRow ? DB.prepare('SELECT * FROM job_calibration_files WHERE calibration_id=? ORDER BY id').all(recRow.id) : [];
  check('record and 2 proof files stored', !DB || (recRow && recRow.result === 'pass' && recRow.tool === 'OEM scan tool' && proofRows.length === 2 && proofRows[0].file_path.endsWith('.pdf')));
  r = await admin.req('GET', `/jobs/${jobA}`);
  check('job page shows the record with proof links', /prescan\.pdf/.test(r.text) && /OEM SI doc 12345/.test(r.text));
  const pdfId = proofRows[0] && proofRows[0].id;
  if (pdfId) {
    r = await admin.req('GET', `/jobs/${jobA}/calibrations/files/${pdfId}`);
    check('proof PDF served to own shop as application/pdf, inline', r.status === 200 && /application\/pdf/.test(r.headers.get('content-type')) && /^inline/.test(r.headers.get('content-disposition') || ''));
    r = await anon.req('GET', `/jobs/${jobA}/calibrations/files/${pdfId}`);
    check('proof file needs login', r.status === 302 && /\/login/.test(r.location));
    r = await north.req('GET', `/jobs/${jobA}/calibrations/files/${pdfId}`);
    check('other shop cannot fetch proof file', r.status === 404);
    r = await anon.req('GET', `/share/${liveToken}`);
    check('insurer view shows the calibration record with proof links', r.status === 200 && /Calibration Record/.test(r.text) && new RegExp(`/share/${liveToken}/files/${pdfId}`).test(r.text) && !/name="item_key"/.test(r.text));
    r = await anon.req('GET', `/share/${liveToken}/files/${pdfId}`);
    check('insurer can open proof file via share link', r.status === 200 && /application\/pdf/.test(r.headers.get('content-type')));
    r = await anon.req('GET', `/share/${crypto.randomUUID()}/files/${pdfId}`);
    check('bad share token cannot open proof file', r.status === 404);
  }
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'SCAN:POST', ...passFields }, [[Buffer.from('<html><script>alert(1)</script>'), 'application/pdf', 'fake.pdf']]));
  check('fake PDF rejected', r.status === 400 && /not a valid PDF/.test(r.text));
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'SCAN:POST', ...passFields }, [[Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg']]));
  check('SVG proof rejected', r.status === 400);
  const fdNoTok = new FormData(); fdNoTok.append('item_key', 'SCAN:POST'); fdNoTok.append('result', 'pass');
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, fdNoTok);
  check('record without CSRF token rejected', r.status === 403 && /form token/i.test(r.text));
  const countBefore = DB ? DB.prepare('SELECT COUNT(*) n FROM job_calibrations').get().n : 0;
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'SCAN:POST', result: 'pass', performed_by_name: 'Tech One', performed_on: today }));
  check('scan record without tool not saved (validation)', r.status === 302 && (!DB || DB.prepare('SELECT COUNT(*) n FROM job_calibrations').get().n === countBefore));
  r = await admin.req('GET', `/jobs/${jobA}`);
  check('validation message shown on the job page', /Record not saved: .*scan tool/.test(r.text));
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'OEM:NOT_ON_THIS_JOB', ...passFields }));
  check('unknown requirement key not saved', r.status === 302 && (!DB || DB.prepare('SELECT COUNT(*) n FROM job_calibrations').get().n === countBefore));
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'ADDITIONAL', item_name: 'Rear radar alignment', ...passFields, method: 'Dynamic' }));
  check('additional calibration from OEM SI recorded', r.status === 302 && (!DB || DB.prepare("SELECT 1 FROM job_calibrations WHERE job_id=? AND item_key='ADDITIONAL:REAR_RADAR_ALIGNMENT'").get(jobA)));
  r = await north.req('POST', `/jobs/${jobA}/calibrations`, recordForm(north, { item_key: 'SCAN:POST', ...passFields }));
  check('other shop cannot add a record', r.status === 404);
  await tech.freshToken(`/jobs/${jobA}`);
  r = await tech.req('POST', `/jobs/${jobA}/calibrations`, recordForm(tech, { item_key: 'SCAN:POST', ...passFields }));
  check('technician can add a record', r.status === 302);
  await writer.freshToken(`/jobs/${jobA}`);
  r = await writer.req('GET', `/jobs/${jobA}`);
  check('service_writer sees the record but no record form', /Calibration Record/.test(r.text) && !/name="item_key"/.test(r.text));
  r = await writer.req('POST', `/jobs/${jobA}/calibrations`, recordForm(writer, { item_key: 'SCAN:POST', ...passFields }));
  check('service_writer cannot add a record', denied(r), `status ${r.status}`);
  if (recRow) {
    await admin.freshToken(`/jobs/${jobA}`);
    r = await admin.post(`/jobs/${jobA}/calibrations/${recRow.id}/void`, { void_reason: '' });
    check('void without a reason refused', r.status === 302 && !DB.prepare('SELECT voided_at FROM job_calibrations WHERE id=?').get(recRow.id).voided_at);
    r = await admin.post(`/jobs/${jobA}/calibrations/${recRow.id}/void`, { void_reason: 'Wrong VIN on scan report' });
    const v = DB.prepare('SELECT voided_at, void_reason FROM job_calibrations WHERE id=?').get(recRow.id);
    check('record voided with reason, row kept', r.status === 302 && v.voided_at && v.void_reason === 'Wrong VIN on scan report');
    r = await anon.req('GET', `/share/${liveToken}/files/${pdfId}`);
    check('voided record proof no longer served', r.status === 404);
    r = await north.post(`/jobs/${jobA}/calibrations/${recRow.id}/void`, { void_reason: 'cross shop' });
    check('other shop cannot void', r.status === 404);
  }
  // Status gate: jobB was saved by the old engine (scans + OEM SI review required).
  await admin.freshToken(`/jobs/${jobB}`);
  r = await admin.post(`/jobs/${jobB}/status`, { status: 'Calibration Complete' });
  check('Calibration Complete blocked while items are open', r.status === 302 && (!DB || DB.prepare('SELECT status FROM jobs WHERE jobId=?').get(jobB).status !== 'Calibration Complete'));
  r = await admin.req('GET', '/admin');
  check('admin page explains what is open', /cannot be marked Calibration Complete: 3 calibration record item\(s\) open/.test(r.text) && /Pre-repair scan/.test(r.text));
  await admin.freshToken(`/jobs/${jobB}`);
  for (const key of ['SCAN:PRE', 'SI:REVIEW', 'SCAN:POST']) {
    await admin.req('POST', `/jobs/${jobB}/calibrations`, recordForm(admin, { item_key: key, ...passFields }));
  }
  r = await admin.req('POST', `/jobs/${jobB}/calibrations`, recordForm(admin, { item_key: 'ADDITIONAL', item_name: 'Front camera aiming', ...passFields, result: 'fail' }));
  await admin.freshToken('/admin');
  r = await admin.post(`/jobs/${jobB}/status`, { status: 'Closed' });
  check('failed additional calibration keeps the job open', !DB || DB.prepare('SELECT status FROM jobs WHERE jobId=?').get(jobB).status !== 'Closed');
  await admin.freshToken(`/jobs/${jobB}`);
  await admin.req('POST', `/jobs/${jobB}/calibrations`, recordForm(admin, { item_key: 'ADDITIONAL', item_name: 'Front camera aiming', ...passFields, result: 'not_performed', reason: 'Customer declined; signed waiver on file' }));
  r = await admin.req('GET', `/jobs/${jobB}`);
  check('job header shows the record complete', /3\/3 documented/.test(r.text) && /All 3 required items are documented/.test(r.text));

  // ─── Sign-off, QC approval, QC override (Nov 2026) ─────────────────────────
  heading('Sign-off and QC override');
  const signoffs = (job) => DB ? DB.prepare('SELECT * FROM job_signoffs WHERE job_id=? ORDER BY id').all(job) : [];
  const statusOf = (job) => DB ? DB.prepare('SELECT status FROM jobs WHERE jobId=?').get(job).status : null;
  check('job page shows the sign-off section with tech sign-off and QC approve', /Technician sign-off:<\/strong> not signed/.test(r.text) && /signoff\/tech/.test(r.text) && /QC approval needs: no technician sign-off yet/.test(r.text));
  await admin.freshToken('/admin');
  r = await admin.post(`/jobs/${jobB}/status`, { status: 'Closed' });
  check('complete record alone cannot close the job', statusOf(jobB) !== 'Closed');
  r = await admin.req('GET', '/admin');
  check('admin page says the technician has not signed off', /technician has not signed off/.test(r.text));
  await tech.freshToken(`/jobs/${jobB}`);
  r = await tech.post(`/jobs/${jobB}/signoff/qc`);
  check('technician cannot QC-approve', denied(r), `status ${r.status}`);
  r = await tech.post(`/jobs/${jobB}/signoff/tech`);
  check('technician signs off', r.status === 302 && signoffs(jobB).some((x) => x.kind === 'tech' && x.role === 'technician'));
  await writer.freshToken(`/jobs/${jobB}`);
  r = await writer.post(`/jobs/${jobB}/signoff/tech`);
  check('service_writer cannot sign off', denied(r), `status ${r.status}`);
  r = await north.post(`/jobs/${jobB}/signoff/qc`);
  check('other shop cannot approve', r.status === 404);
  // A record change after the sign-off makes it stale.
  await admin.freshToken(`/jobs/${jobB}`);
  await new Promise((res) => setTimeout(res, 5));
  await admin.req('POST', `/jobs/${jobB}/calibrations`, recordForm(admin, { item_key: 'SCAN:POST', ...passFields, notes: 'Re-scan after road test' }));
  r = await admin.req('GET', `/jobs/${jobB}`);
  check('record change makes the tech sign-off out of date', /Technician sign-off:<\/strong> out of date/.test(r.text));
  r = await admin.post(`/jobs/${jobB}/signoff/qc`);
  check('QC approval refused while sign-off is stale', !signoffs(jobB).some((x) => x.kind === 'qc'));
  await tech.freshToken(`/jobs/${jobB}`);
  await new Promise((res) => setTimeout(res, 5));
  await tech.post(`/jobs/${jobB}/signoff/tech`);
  await admin.freshToken(`/jobs/${jobB}`);
  await new Promise((res) => setTimeout(res, 5));
  r = await admin.post(`/jobs/${jobB}/signoff/qc`);
  check('QC approves the current record', r.status === 302 && signoffs(jobB).some((x) => x.kind === 'qc' && x.role === 'shop_admin'));
  r = await admin.req('GET', `/jobs/${jobB}`);
  check('job page shows approval and a Close job button', /QC approval:<\/strong> /.test(r.text) && /signoff\/close/.test(r.text) && !/signoff\/override/.test(r.text));
  r = await anon.req('GET', `/share/${liveToken}`);
  check('insurer view shows the sign-off section without forms', /Sign-off/.test(r.text) && !/signoff\/(tech|qc|close|override)/.test(r.text));

  // Override on jobA, whose record is incomplete.
  await admin.freshToken(`/jobs/${jobA}`);
  r = await admin.post(`/jobs/${jobA}/signoff/close`);
  check('normal close refused on an incomplete record', statusOf(jobA) !== 'Closed');
  r = await admin.post(`/jobs/${jobA}/signoff/override`, { justification: 'too short', acknowledge: '1' });
  check('override needs a real justification', statusOf(jobA) !== 'Closed' && !signoffs(jobA).some((x) => x.kind === 'override'));
  r = await admin.post(`/jobs/${jobA}/signoff/override`, { justification: 'Vehicle released to the customer at their request; calibration scheduled at the dealer.' });
  check('override needs the acknowledgement box', statusOf(jobA) !== 'Closed');
  await tech.freshToken(`/jobs/${jobA}`);
  r = await tech.post(`/jobs/${jobA}/signoff/override`, { justification: 'Vehicle released to the customer at their request; calibration scheduled at the dealer.', acknowledge: '1' });
  check('technician cannot override', denied(r) && statusOf(jobA) !== 'Closed', `status ${r.status}`);
  await admin.freshToken(`/jobs/${jobA}`);
  r = await admin.post(`/jobs/${jobA}/signoff/override`, { justification: 'Vehicle released to the customer at their request; calibration scheduled at the dealer.', acknowledge: '1' });
  const ov = signoffs(jobA).find((x) => x.kind === 'override');
  check('QC override closes the job and keeps the exception record with the open items', r.status === 302 && statusOf(jobA) === 'Closed'
    && ov && /dealer/.test(ov.justification) && ['Technician sign-off', 'QC approval'].every((x) => JSON.parse(ov.open_items).includes(x)) && JSON.parse(ov.open_items).length > 2, ov && ov.open_items);
  r = await anon.req('GET', `/share/${liveToken}`);
  check('insurer view shows the override, justification and what was open', /Closed under QC override/.test(r.text) && /calibration scheduled at the dealer/.test(r.text) && /Incomplete at override<\/span> [^<]*QC approval/.test(r.text));
  r = await admin.req('GET', `/jobs/${jobA}`);
  check('closed job page shows no sign-off or record forms', !/signoff\/(tech|qc|close|override)/.test(r.text) && !/name="item_key"/.test(r.text));
  await admin.freshToken(`/jobs/${jobA}`);
  r = await admin.post(`/jobs/${jobA}/signoff/tech`);
  check('closed job: no further sign-offs', r.status === 403);
  r = await admin.req('POST', `/jobs/${jobA}/calibrations`, recordForm(admin, { item_key: 'SCAN:POST', ...passFields }));
  check('closed job: record locked', r.status === 403);
  await admin.freshToken('/admin');

  heading('Closed-job photo lock');
  await admin.freshToken('/new');
  r = await admin.post(`/jobs/${jobB}/status`, { status: 'Closed' });
  check('shop_admin can close an approved job from the admin page', r.status === 302 && (!DB || DB.prepare('SELECT status FROM jobs WHERE jobId=?').get(jobB).status === 'Closed'));
  r = await admin.req('GET', `/jobs/${jobB}/photos`);
  const slotB = (r.text.match(new RegExp(`/jobs/${jobB}/photos/(\\d+)/file`)) || [])[1] || DB?.prepare('SELECT id FROM job_photos WHERE job_id=? LIMIT 1').get(jobB).id;
  r = await admin.upload(`/jobs/${jobB}/photos/${slotB}`, PNG, 'image/png', 'x.png');
  check('shop_admin blocked from uploading to Closed job', denied(r), `status ${r.status}`);
  r = await tech.upload(`/jobs/${jobB}/photos/${slotB}`, PNG, 'image/png', 'x.png');
  check('technician blocked from uploading to Closed job', denied(r), `status ${r.status}`);
  r = await admin.post(`/jobs/${jobB}/status`, { status: 'Bogus' });
  check('invalid status value rejected', r.status === 400);

  heading('User management');
  await admin.freshToken('/admin/users');
  const meId = DB ? userId('metro_admin') : 0;
  r = await admin.post(`/admin/users/${meId}/role`, { role: 'technician' });
  check('admin cannot demote themselves', r.status === 400, `status ${r.status}`);
  r = await admin.post(`/admin/users/${meId}/deactivate`);
  check('admin cannot deactivate themselves', r.status === 400, `status ${r.status}`);
  const paId = DB ? userId('platform_admin') : 0;
  r = await admin.post(`/admin/users/${paId}/role`, { role: 'technician' });
  check('shop_admin cannot change platform_admin', denied(r), `status ${r.status}`);
  r = await admin.post('/admin/users/create', { full_name: 'X', username: 'metro_admin', password: 'longenough1', role: 'technician' });
  check('duplicate username on user create → handled', r.status === 302 && r.location.includes('error=1') && await alive());
  r = await admin.post('/admin/users/create', { full_name: 'X', username: 'sneaky', password: 'longenough1', role: 'platform_admin' });
  check('cannot create platform_admin via shop admin', r.status === 400);
  // Deactivation kills live sessions
  const tech2 = new Client('metro_tech2');
  await tech2.login('metro_tech2', 'demo1234');
  r = await tech2.req('GET', '/'); check('metro_tech2 signed in', r.status === 200);
  await admin.freshToken('/admin/users');
  r = await admin.post(`/admin/users/${userId('metro_tech2')}/deactivate`);
  check('shop_admin deactivates metro_tech2', r.status === 302);
  r = await tech2.req('GET', '/');
  check("deactivated user's live session is ended", r.status === 302 && r.location === '/login', `${r.status} ${r.location}`);
  r = await tech2.login('metro_tech2', 'demo1234');
  check('deactivated user cannot sign in', r.location.includes('error=1'));
  // Role change applies without re-login
  await admin.freshToken('/admin/users');
  await admin.post(`/admin/users/${userId('metro_qc')}/role`, { role: 'service_writer' });
  r = await qc.req('GET', '/new');
  check('role change applies to live session', r.status === 200, `status ${r.status}`);

  // ─── Platform admin ────────────────────────────────────────────────────────
  heading('Platform admin');
  const pa = new Client('platform_admin');
  r = await pa.login('platform_admin', process.env.PA_PASS || 'localadmin123');
  check('platform_admin login', r.status === 302 && r.location === '/', r.location);
  for (const p of ['/platform/shops', '/platform/billing']) {
    r = await pa.req('GET', p);
    check(`GET ${p} as platform_admin`, r.status === 200, `status ${r.status}`);
  }
  // Platform admin sees a shop's jobs only after opening access for a reason
  // the terms allow (legal, support, update). Read-only, logged privately, and
  // not shown to the shop (Nov 2026).
  r = await pa.req('GET', `/jobs/${jobA}`); check('platform_admin cannot open a shop job without opening access', r.status === 404, `status ${r.status} ${r.location || ''}`);
  r = await pa.req('GET', '/'); check('platform_admin job list is empty with no access open', r.status === 200 && !r.text.includes(jobA));
  r = await pa.req('GET', '/admin'); check('platform_admin admin page lists no shop jobs with no access open', !r.text.includes(jobA));
  r = await pa.req('GET', `/jobs/${jobA}/calibrations/files/1`); check('platform_admin cannot fetch proof files with no access open', r.status === 404);
  r = await pa.req('GET', '/new'); check('platform_admin cannot create jobs', denied(r), `status ${r.status}`);
  const shopA = DB ? DB.prepare('SELECT shop_id FROM jobs WHERE jobId=?').get(jobA).shop_id : 1;
  await pa.freshToken('/platform/shops');
  r = await pa.post(`/platform/shops/${shopA}/access`, { reason_type: 'curiosity', note: 'Just looking around the shop' });
  check('access needs a reason the terms allow', r.status === 400 && (!DB || !DB.prepare('SELECT 1 FROM platform_access').get()), `status ${r.status}`);
  r = await pa.post(`/platform/shops/${shopA}/access`, { reason_type: 'support', note: 'short' });
  check('access needs a note', r.status === 400, `status ${r.status}`);
  r = await pa.post(`/platform/shops/${shopA}/access`, { reason_type: 'support', note: 'Ticket 12: stuck photo upload' });
  check('platform_admin opens support access', r.status === 302 && (!DB || DB.prepare('SELECT 1 FROM platform_access WHERE closed_at IS NULL').get()), `status ${r.status}`);
  r = await pa.req('GET', `/jobs/${jobA}`); check('platform_admin can view the opened shop job', r.status === 200);
  r = await pa.req('GET', '/'); check('opened shop jobs listed for platform_admin', r.text.includes(jobA));
  r = await pa.req('GET', `/jobs/${jobB}/photos`);
  r = await pa.upload(`/jobs/${jobB}/photos/${slotB}`, PNG, 'image/png', 'x.png');
  check('platform_admin cannot upload, even with access open', denied(r), `status ${r.status}`);
  await pa.freshToken(`/jobs/${jobA}`);
  for (const [path, body] of [[`/jobs/${jobA}/edit`, { ro: 'PA' }], [`/jobs/${jobA}/status`, { status: 'In Progress' }], [`/jobs/${jobA}/assign`, { tech_ids: '1' }],
    [`/jobs/${jobA}/signoff/qc`, {}], [`/jobs/${jobA}/signoff/override`, { justification: 'x'.repeat(30), acknowledge: '1' }], [`/jobs/${jobA}/share`, {}]]) {
    r = await pa.post(path, body);
    check(`platform_admin read-only with access open: POST ${path.split('/').slice(3).join('/')}`, denied(r), `status ${r.status}`);
  }
  r = await pa.req('GET', '/platform/access');
  check('access log records the reason and every page viewed', r.status === 200 && r.text.includes('Ticket 12: stuck photo upload') && r.text.includes(`GET /jobs/${jobA}`));
  for (const u of [admin, tech]) {
    r = await u.req('GET', '/platform/access'); check('shop users cannot see the platform access log', denied(r), `status ${r.status}`);
  }
  r = await admin.req('GET', '/'); check('shop does not see platform access in its system', !/Support Access|platform admin/i.test(r.text));
  r = await admin.req('GET', '/admin/support'); check('shop-side support access page is gone', r.status === 404 || denied(r), `status ${r.status}`);
  const accessId = DB ? DB.prepare('SELECT id FROM platform_access WHERE closed_at IS NULL').get().id : 1;
  await pa.freshToken('/platform/shops');
  r = await pa.post(`/platform/access/${accessId}/close`, {});
  r = await pa.req('GET', `/jobs/${jobA}`); check('closing access removes it immediately', r.status === 404);
  await pa.freshToken('/platform/shops');
  const shopsBefore = DB ? DB.prepare('SELECT COUNT(*) c FROM shops').get().c : 0;
  r = await pa.post('/platform/shops/create', { shop_name: 'Dup Shop', admin_full_name: 'D', admin_username: 'metro_admin', admin_password: 'longenough1' });
  check('shops/create with taken username → 409, server alive', r.status === 409 && await alive(), `status ${r.status}`);
  if (DB) check('no orphan shop left behind', DB.prepare('SELECT COUNT(*) c FROM shops').get().c === shopsBefore);
  r = await pa.post('/platform/shops/create', { shop_name: 'New Shop', admin_full_name: 'N', admin_username: 'newshop_admin', admin_password: 'longenough1' });
  check('shops/create happy path', r.status === 302);

  // ─── Stripe / subscription ─────────────────────────────────────────────────
  heading('Stripe webhook & subscription');
  r = await anon.raw('POST', '/api/billing/webhook', '{}', 'application/json');
  check('webhook without signature → 400', r.status === 400);
  check('webhook error does not echo internals', !/No signatures|secret/i.test(r.text), r.text.slice(0, 60));
  const sendEvent = async (type, sub) => {
    const payload = JSON.stringify({ id: 'evt_' + crypto.randomUUID(), object: 'event', type, data: { object: sub } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
    return fetch(BASE + '/api/billing/webhook', { method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` } });
  };
  if (DB && WEBHOOK_SECRET) {
    DB.prepare("UPDATE shops SET stripe_customer_id='cus_test_metro' WHERE name='Metro Collision Center'").run();
    let w = await sendEvent('customer.subscription.updated', { id: 'sub_1', object: 'subscription', customer: 'cus_test_metro', status: 'trialing' });
    check('signed webhook without current_period_end → 200 (no crash)', w.status === 200 && await alive(), `status ${w.status}`);
    check('trialing stored', DB.prepare("SELECT subscription_status s FROM shops WHERE stripe_customer_id='cus_test_metro'").get().s === 'trialing');
    r = await admin.req('GET', '/'); check('trialing shop has access', r.status === 200, `status ${r.status}`);
    w = await sendEvent('customer.subscription.updated', { id: 'sub_1', object: 'subscription', customer: 'cus_test_metro', status: 'past_due', current_period_end: 1900000000 });
    r = await admin.req('GET', '/'); check('past_due shop redirected to /billing/inactive', r.status === 302 && r.location === '/billing/inactive', `${r.status} ${r.location}`);
    // Lapsed shop: newly gated routes redirect, but billing, registration, logout,
    // share revocation and existing insurer links keep working.
    const toInactive = (x) => x.status === 302 && x.location === '/billing/inactive';
    r = await admin.req('GET', '/admin/users'); check('lapsed: GET /admin/users → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    r = await admin.post('/admin/users/create', { full_name: 'L', username: 'lapsed_new', password: 'longenough1', role: 'technician' });
    check('lapsed: POST /admin/users/create → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    r = await admin.post(`/admin/users/${userId('metro_tech1')}/role`, { role: 'qc_manager' });
    check('lapsed: POST /admin/users/:id/role → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    r = await admin.post(`/admin/users/${userId('metro_tech1')}/deactivate`);
    check('lapsed: POST /admin/users/:id/deactivate → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    check('lapsed: user changes not applied', DB.prepare("SELECT role, active FROM users WHERE username='metro_tech1'").get().role === 'technician' && !DB.prepare("SELECT 1 FROM users WHERE username='lapsed_new'").get());
    r = await admin.post(`/jobs/${jobA}/status`, { status: 'In Progress' }); check('lapsed: POST /jobs/:id/status → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    r = await admin.req('GET', '/reference'); check('lapsed: GET /reference → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    r = await admin.req('GET', '/reference/lookup?make=Honda'); check('lapsed: GET /reference/lookup → /billing/inactive', toInactive(r), `${r.status} ${r.location}`);
    const sharesBefore = DB.prepare('SELECT COUNT(*) c FROM share_tokens WHERE job_id=?').get(jobA).c;
    r = await admin.post(`/jobs/${jobA}/share`); check('lapsed: POST /jobs/:id/share (create) → /billing/inactive', toInactive(r) && DB.prepare('SELECT COUNT(*) c FROM share_tokens WHERE job_id=?').get(jobA).c === sharesBefore, `${r.status} ${r.location}`);
    r = await anon.req('GET', `/share/${liveToken}`); check('lapsed: existing /share/:token link still works', r.status === 200, `status ${r.status}`);
    r = await admin.req('GET', '/billing/inactive'); check('lapsed: /billing/inactive reachable', r.status === 200);
    r = await admin.req('GET', '/register'); check('lapsed: /register reachable', r.status === 200);
    r = await admin.post(`/jobs/${jobA}/share/revoke`); check('lapsed: revoking a share link still allowed', r.status === 302 && r.location === `/jobs/${jobA}`, `${r.status} ${r.location}`);
    r = await anon.req('GET', `/share/${liveToken}`); check('lapsed: revoked link now 404', r.status === 404);
    w = await sendEvent('customer.subscription.updated', { id: 'sub_1', object: 'subscription', customer: 'cus_test_metro', status: 'active', current_period_end: 1900000000 });
    r = await admin.req('GET', '/'); check('active shop has access', r.status === 200);
  } else {
    check('webhook signed-event tests (need CIQ_DB + WEBHOOK_SECRET)', false, 'skipped');
  }
  const reg = new Client('reg'); await reg.req('GET', '/register');
  r = await reg.post('/register', { shop_name: 'S', owner_name: 'O', email: 'o@example.com', username: 'brand_new_user', password: 'longenough1', password_confirm: 'longenough1' });
  check('register without Stripe key → graceful error redirect', r.status === 302 && r.location.includes('/register?error=1') && await alive(), `${r.status} ${r.location}`);

  // ─── OEM API ───────────────────────────────────────────────────────────────
  heading('OEM evaluate API');
  const postJson = (c, body) => c.req('POST', '/api/oem/evaluate', JSON.stringify(body), { 'content-type': 'application/json' });
  await admin.freshToken('/new');
  const apiTok = admin.token;
  r = await postJson(anon, { make: 'Honda' });
  check('OEM API: anon rejected', r.status === 403 || r.status === 302, `status ${r.status}`);
  r = await postJson(admin, { make: 'Honda', lineItems: ['WINDSHIELD_REPLACED'] });
  check('OEM API: missing CSRF token rejected', r.status === 403, `status ${r.status}`);
  r = await postJson(admin, { _csrf: apiTok, make: 'Honda', model: 'Accord', year: 2021, lineItems: ['FRONT_FASCIA_REPAIR_300MM', 'WINDSHIELD_REPLACED'], dtcs: ['P2583-54'] });
  let j = {}; try { j = JSON.parse(r.text); } catch {}
  const systems = (j.calibrations || []).map((c) => c.system).sort().join(',');
  check('OEM API: Honda Accord evaluates', r.status === 200 && j.supported === true && systems === 'CAMERA,RADAR' && j.dtcActions?.length === 1, `status ${r.status} systems=${systems}`);
  check('OEM API: result carries source + scan policy', j.source?.id === 'HONDA-JA-ADSS-v12' && j.scanPolicy?.found === true);
  r = await postJson(admin, { _csrf: apiTok, make: 'Toyota', model: 'Camry', year: '2022', lineItems: ['WINDSHIELD_REPLACED'] });
  j = {}; try { j = JSON.parse(r.text); } catch {}
  check('OEM API: Toyota → scan-policy-only', r.status === 200 && j.supported === false && j.ruleDepth === 'SCAN_POLICY_ONLY');
  r = await postJson(admin, { _csrf: apiTok, make: 'Honda', lineItems: ['BOGUS_EVENT'], dtcs: ['X1234'] });
  j = {}; try { j = JSON.parse(r.text); } catch {}
  check('OEM API: unknown events/DTCs flagged', r.status === 200 && j.flags?.some((f) => f.code === 'UNKNOWN_EVENTS') && j.flags?.some((f) => f.code === 'DTC_NOT_IN_RULESET'));
  r = await postJson(admin, { _csrf: apiTok, make: 'Ford', model: 'Bronco Sport', year: 2023, lineItems: ['REAR_GATE_RI', 'FRONT_RADAR_RI', 'BATTERY_DISCONNECT'], collisionRelated: true });
  j = {}; try { j = JSON.parse(r.text); } catch {}
  const fordSystems = (j.calibrations || []).map((c) => c.system).sort().join(',');
  check('OEM API: Ford evaluates from the Ford job aid', r.status === 200 && j.ruleDepth === 'OEM_JOB_AID' && fordSystems === 'FORD_CAM_REAR,FORD_CCM' && j.flags?.some((f) => f.code === 'BATTERY_DISCONNECT_REVIEW'), `status ${r.status} systems=${fordSystems}`);
  r = await postJson(admin, { _csrf: apiTok, make: 'Lincoln', model: 'Corsair', year: 2023, lineItems: ['WINDSHIELD_REPLACED'] });
  j = {}; try { j = JSON.parse(r.text); } catch {}
  check('OEM API: any Ford / Lincoln model is covered (no model list)', r.status === 200 && j.ruleDepth === 'OEM_JOB_AID' && (j.calibrations || []).some((c) => c.system === 'FORD_IPMA'));
  r = await postJson(admin, { _csrf: apiTok, make: 'Ford', equipped: { CAMERA_360: 'yes' } }); check('OEM API: non-boolean equipped → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, make: 'Ford', equipped: ['CAMERA_360'] }); check('OEM API: array equipped → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, make: 'Ford', collisionRelated: 'true' }); check('OEM API: non-boolean collisionRelated → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, lineItems: [] }); check('OEM API: missing make → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, make: 'Honda', lineItems: 'WINDSHIELD_REPLACED' }); check('OEM API: non-array lineItems → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, make: 'Honda', year: 'abc' }); check('OEM API: bad year → 400', r.status === 400);
  r = await postJson(admin, { _csrf: apiTok, make: { $gt: '' } }); check('OEM API: object make → 400', r.status === 400);
  r = await admin.raw('POST', '/api/oem/evaluate', '{"_csrf":', 'application/json');
  check('OEM API: malformed JSON → 4xx, server alive', r.status >= 400 && r.status < 500 && await alive(), `status ${r.status}`);
  await pa.freshToken('/platform/shops');
  r = await postJson(pa, { _csrf: pa.token, make: 'Acura', model: 'MDX', year: 2022, lineItems: ['FRONT_BUMPER_RI'] });
  j = {}; try { j = JSON.parse(r.text); } catch {}
  check('OEM API: platform_admin can call it', r.status === 200 && j.supported === true, `status ${r.status}`);

  // ─── Logout ────────────────────────────────────────────────────────────────
  heading('Logout');
  r = await admin.req('GET', '/');
  check('nav logout is a POST form, not a link', /<form method="POST" action="\/logout"[^>]*>\s*<input type="hidden" name="_csrf"/.test(r.text) && !/href="\/logout"/.test(r.text));
  r = await admin.req('GET', '/logout');
  check('GET /logout does not sign out (shows confirmation)', r.status === 200 && (await admin.req('GET', '/')).status === 200);
  r = await admin.req('POST', '/logout', { _csrf: 'not-the-token' });
  check('POST /logout with bad CSRF token rejected', r.status === 403 && (await admin.req('GET', '/')).status === 200, `status ${r.status}`);
  r = await admin.post('/logout');
  check('POST /logout with token → /login', r.status === 302 && r.location === '/login', `${r.status} ${r.location}`);
  r = await admin.req('GET', '/');
  check('logout ends session', r.status === 302 && r.location === '/login');
  check('server still alive at end of suite', await alive());

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:\n  ' + failed.map((f) => `[${f.section}] ${f.name} ${f.info}`).join('\n  '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH', e); process.exit(2); });
