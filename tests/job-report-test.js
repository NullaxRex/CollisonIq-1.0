'use strict';
// Job form → rules engine → hard copy (CollisonIq/utils/jobRepairs.js, jobReport.js).
// Acceptance tests are the three production jobs from Nov 9, 2026 that printed
// the old keyword engine's output. Pure unit checks.
// Usage: node tests/job-report-test.js
const path = require('path');
const { APP_DIR, reporter } = require('./lib');

const jobRepairs = require(path.join(APP_DIR, 'utils', 'jobRepairs'));
const jobReport = require(path.join(APP_DIR, 'utils', 'jobReport'));
const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const ford = require(path.join(APP_DIR, 'utils', 'oemFordPosition'));
const rep = reporter();
const { check } = rep;

const build = (make, model, year, values) => jobReport.buildJobAdas({ make, model, year, repairValues: values });
const calNames = (r) => r.calibrations.map((c) => `${c.systemName} @ ${c.location}`);
const verIds = (r) => r.verifications.map((v) => v.id).sort();
const codes = (r) => r.flags.map((f) => f.code);

// ─── Every option maps only to events its rule family knows ──────────────────
const ALL = jobRepairs.OPTIONS.flatMap((o) => (o.sided ? [`${o.key}:L`, `${o.key}:R`] : [o.key]));
const known = {
  honda: new Set([...Object.keys(oem.EVENTS), ...Object.keys(oem.COMMON_EVENTS)]),
  ford: new Set([...Object.keys(ford.EVENTS), ...Object.keys(oem.COMMON_EVENTS)]),
  default: new Set(Object.keys(oem.COMMON_EVENTS)),
};
for (const [make, model, year, fam] of [['Honda', 'Accord', 2022, 'honda'], ['Acura', 'MDX', 2022, 'honda'], ['Ford', 'F-150', 2025, 'ford'],
  ['Ford', 'Escape', 2023, 'ford'], ['Lincoln', 'Corsair', 2024, 'ford'], ['Toyota', 'Camry', 2025, 'default'], ['Subaru', 'Outback', 2024, 'default']]) {
  const t = jobRepairs.toEvents(ALL, { make, model, year });
  const bad = t.events.filter((e) => !known[fam].has(e));
  const r = build(make, model, year, ALL);
  check(`every checkbox maps to known events (${make} ${model}, ${fam})`, t.family === fam && bad.length === 0 && !codes(r.result).includes('UNKNOWN_EVENTS'), bad.join(','));
}

// ─── Values: sides, legacy labels, junk ──────────────────────────────────────
check('legacy "Door / Mirror Repair" → door repair both sides',
  JSON.stringify(jobRepairs.normalizeValues(['Door / Mirror Repair'])) === JSON.stringify(['FRONT_DOOR_REPAIR:L', 'FRONT_DOOR_REPAIR:R']));
check('legacy labels convert; unknown values and bad sides dropped',
  JSON.stringify(jobRepairs.normalizeValues(['Front Bumper', 'Rear Bumper', 'Windshield', 'nope', 'FENDER:X', 'FENDER', 'FRONT_BUMPER_RI:L']))
  === JSON.stringify(['FRONT_BUMPER_RI', 'WINDSHIELD_REPLACED', 'REAR_BUMPER_RI']));
check('sided labels name the side and contain no comma',
  jobRepairs.valueLabel('MIRROR_RI:R') === 'Mirror R&I / replaced (Right)' && ALL.every((v) => !jobRepairs.valueLabel(v).includes(',')));
check('liftgate maps to Honda TAILGATE_RI and Ford/other REAR_GATE_RI',
  jobRepairs.toEvents(['LIFTGATE_RI'], { make: 'Honda', model: 'CR-V', year: 2023 }).events.join() === 'TAILGATE_RI'
  && jobRepairs.toEvents(['LIFTGATE_RI'], { make: 'Ford', model: 'F-150', year: 2025 }).events.join() === 'REAR_GATE_RI'
  && jobRepairs.toEvents(['LIFTGATE_RI'], { make: 'Toyota', model: 'RAV4', year: 2024 }).events.join() === 'REAR_GATE_RI');
check('collision damage boxes set collisionRelated; door work alone does not',
  jobRepairs.toEvents(['REAR_DAMAGE'], {}).collisionRelated === true && jobRepairs.toEvents(['FRONT_DOOR_RI:L'], {}).collisionRelated === false);

// ─── Acceptance 1: CIQ-20261109-4905, 2025 Toyota Camry, windshield + door/mirror
{
  const { result: r, columns } = build('Toyota', 'Camry', '2025', ['WINDSHIELD_REPLACED', 'FRONT_DOOR_RI:L', 'MIRROR_RI:L']);
  check('Camry: scan policy only, no invented OEM calibrations', r.ruleDepth === 'SCAN_POLICY_ONLY' && r.calibrations.length === 0 && r.basis.kind === 'none');
  check('Camry: side mirror camera (left), blind spot, front camera, post-repair test field rules', verIds(r).join() === 'FIELD_BLIND_SPOT,FIELD_FRONT_CAMERA,FIELD_POST_REPAIR_TEST,FIELD_SIDE_CAMERA_LEFT', verIds(r).join());
  check('Camry: Toyota scan policy printed with source', /^REQUIRED — Toyota.*scan policy: Necessary$/.test(columns.preScanRequired) && columns.approvedScanTool.includes('Techstream') && /crn-429/.test(r.scanPolicy.source.url));
  check('Camry: no old-engine "PCS Static Calibration" line', !/PCS Static/.test(columns.adasSystems));
}

// ─── Acceptance 2: CIQ-20261109-8437, 2025 F-150, front bumper + door/mirror ─
// Ford job aid (Sept 29, 2026): a bumper cover replacement needs no radar routine
// if the radar is undisturbed; the field rules still call for a radar test.
{
  const { result: r, columns } = build('Ford', 'F-150', '2025', ['FRONT_BUMPER_RI', 'FRONT_DOOR_RI:L', 'MIRROR_RI:L', 'FRONT_DOOR_RI:R', 'MIRROR_RI:R']);
  const sys = r.calibrations.map((c) => c.system).sort().join();
  check('F-150 #8437: front parking sensor checks, front 360° camera, both mirror cameras (Ford job aid)',
    sys === 'FORD_CAM_FRONT,FORD_CAM_LEFT,FORD_CAM_RIGHT,FORD_PARK_FRONT', sys);
  check('F-150 #8437: no radar routine for the bumper cover alone, explained', !sys.includes('FORD_CCM') && codes(r).includes('FORD_CCM_UNDISTURBED'));
  check('F-150 #8437: no blind spot module calibration for door work', !/SOD/.test(sys));
  check('F-150 #8437: no "static" claim for the radar', !/Static/i.test(columns.adasSystems));
  check('F-150 #8437: side camera field rules both sides + front radar/camera',
    ['FIELD_FRONT_CAMERA', 'FIELD_FRONT_RADAR', 'FIELD_SIDE_CAMERA_LEFT', 'FIELD_SIDE_CAMERA_RIGHT'].every((id) => verIds(r).includes(id)));
  check('F-150 #8437: Ford job aid basis, no I-CAR anywhere', r.basis.kind === 'oem' && /Ford Motor Company/.test(r.basis.text) && /Job Aid \(2026-09-29\)/.test(r.basis.text)
    && !/I-CAR/.test(JSON.stringify(r.calibrations) + r.basis.text + columns.rationale) && !/No rationale/.test(columns.rationale));
}

// ─── Acceptance 3: CIQ-20261109-6755, 2025 F-150, every checkbox ─────────────
{
  const { result: r, adasRequired } = build('Ford', 'F-150', '2025', ALL);
  const sys = r.calibrations.map((c) => c.system).sort().join();
  check('F-150 #6755: every Ford job aid component the form can reach',
    sys === 'FORD_CAM_FRONT,FORD_CAM_LEFT,FORD_CAM_REAR,FORD_CAM_RIGHT,FORD_CCM,FORD_HUD,FORD_IPMA,FORD_PARK_FRONT,FORD_PARK_REAR,FORD_SOD_FRONT,FORD_SOD_REAR_LEFT,FORD_SOD_REAR_RIGHT', sys);
  check('F-150 #6755: every calibration names its WSM section and procedure', r.calibrations.every((c) => c.wsmSection && c.method));
  check('F-150 #6755: every field rule applies',
    ['FIELD_BLIND_SPOT', 'FIELD_FRONT_CAMERA', 'FIELD_FRONT_RADAR', 'FIELD_POST_REPAIR_TEST', 'FIELD_REAR_CAMERA', 'FIELD_REAR_PARKING', 'FIELD_SIDE_CAMERA_LEFT', 'FIELD_SIDE_CAMERA_RIGHT'].every((id) => verIds(r).includes(id)), verIds(r).join());
  check('F-150 #6755: battery, structural, SRS and EV review items; CHMSL and geometry flags', codes(r).includes('BATTERY_DISCONNECT_REVIEW') && r.reviewItems.length === 3 && adasRequired
    && codes(r).includes('FORD_CHMSL_CAMERA') && codes(r).includes('FORD_GEOMETRY'));
  check('SRS review item omits the unverified register "checks" text', !r.reviewItems.find((x) => /SRS/.test(x.event)).checks);
}

// ─── Honda path still gets job-aid calibrations ──────────────────────────────
{
  const { result: r } = build('Honda', 'Accord', '2020', ['WINDSHIELD_REPLACED']);
  check('Honda windshield → job-aid camera calibration with source and checklist',
    r.ruleDepth === 'FULL_TRIGGER_RULES' && r.calibrations.some((c) => c.system === 'CAMERA') && r.attestation && /Job Aid/.test(r.basis.text));
}

// ─── Hard copy rendering ─────────────────────────────────────────────────────
{
  const { result } = build('Ford', 'F-150', '2025', ['FRONT_RADAR', 'MIRROR_RI:L', 'REAR_HANDLE_LATCH']);
  const html = jobReport.renderSections(JSON.parse(JSON.stringify(result)));
  check('hard copy: OEM and field-rule sections with Ford procedure and WSM section', /OEM Calibrations Required/.test(html)
    && /CollisionIQ Field Rules — Not OEM Requirements/.test(html) && /Cruise Control Module/.test(html) && /Workshop manual section<\/span> 419-03/.test(html));
  check('hard copy: Ford statement linked, no I-CAR calibration search', /href="https:\/\/rts\.i-car\.com\/images\/pdf\/oem-info\/ford\//.test(html) && !/Calibration Requirements Search/.test(html));
  const evil = build('<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '2025', ['FRONT_DOOR_RI:L']).result;
  const h2 = jobReport.renderSections(evil);
  check('hard copy: make/model escaped', !/<script>|<img/i.test(h2) && /&lt;script&gt;/.test(h2));
  const insurer = jobReport.renderSections(build('Honda', 'Accord', '2020', ['WINDSHIELD_REPLACED']).result, { insurer: true });
  check('insurer view omits the shop checklist', !/Pre-Calibration Checklist/.test(insurer) && /OEM Calibrations Required/.test(insurer));
  check('parseStored tolerates junk', jobReport.parseStored('{bad') === null && jobReport.parseStored(null) === null);
  const none = build('', '', '', ['FRONT_DOOR_RI:L']);
  check('no make: field rules still apply, flagged', none.result.verifications.length === 3 && codes(none.result).includes('MAKE_MISSING'));
}

// ─── OEM documents for the repair (source register) ──────────────────────────
{
  const titles = (mk, md, v) => build(mk, md, '2025', v).result.oemDocuments.map((d) => d.title);
  const n = titles('Nissan', 'Rogue', ['WINDSHIELD_REPLACED', 'FRONT_BUMPER_RI']);
  check('Nissan windshield + bumper: ADAS components, glass and radar statements',
    ['Nissan ADAS Components NPSB/26-971', 'Nissan vehicle glass statement', 'Nissan front radar calibration position'].every((t) => n.includes(t)), n.join(' ; '));
  check('Nissan Rogue: no ARIYA-only or Infiniti-only documents, no repeat of the scan statement',
    !n.some((t) => /ARIYA|Infiniti|pre\/post/i.test(t)));
  check('Nissan Ariya: ARIYA bumper document shown', titles('Nissan', 'Ariya', ['FRONT_BUMPER_RI']).includes('Nissan ARIYA bumper repair restrictions'));
  check('GM windshield: windshield statement, not the fascia one',
    titles('Chevrolet', 'Silverado', ['WINDSHIELD_REPLACED']).includes('GM Windshield Replacement') && !titles('Chevrolet', 'Silverado', ['WINDSHIELD_REPLACED']).includes('GM Bumper Fascia with ADAS'));
  check('no repairs checked: no documents', titles('Toyota', 'Camry', []).length === 0);
  const html = jobReport.renderSections(build('Nissan', 'Rogue', '2025', ['WINDSHIELD_REPLACED']).result);
  check('hard copy: OEM documents section with links', /OEM Documents for This Repair/.test(html) && /href="https:\/\/rts\.i-car\.com\/images\/pdf\/oem-info\/nissan\//.test(html));
}

// ─── High-voltage vehicles detected from make/model ──────────────────────────
{
  const hv = (mk, md, v = ['FRONT_DOOR_RI:L']) => build(mk, md, '2025', v).result.reviewItems.find((x) => x.event === 'HV EV post-crash');
  check('Tesla, Rivian, F-150 Lightning, Ioniq 5, F-150 Hybrid: HV review item, marked as detected',
    [['Tesla', 'Model Y'], ['Rivian', 'R1S'], ['Ford', 'F-150 Lightning'], ['Hyundai', 'Ioniq 5'], ['Ford', 'F-150 Hybrid']].every(([a, b]) => (hv(a, b) || {}).detected));
  check('gas Camry and F-150: no HV item', !hv('Toyota', 'Camry') && !hv('Ford', 'F-150'));
  const box = hv('Toyota', 'Camry', ['EV_HYBRID']);
  check('EV box checked: one HV item, not marked as detected', box && !box.detected && build('Tesla', 'Model 3', '2025', ['EV_HYBRID']).result.reviewItems.filter((x) => x.event === 'HV EV post-crash').length === 1);
}

console.log(rep.failures ? `\n${rep.failures} job report check(s) FAILED` : '\nAll job report checks passed');
process.exit(rep.failures ? 1 : 0);
