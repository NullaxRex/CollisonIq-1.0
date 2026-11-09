'use strict';
// Ford calibration trigger rules (CollisonIq/utils/oemFordRules.js) and the
// 12V battery disconnect flag. Pure unit checks: no server, no database.
// Usage: node tests/ford-rules-test.js
const path = require('path');
const { APP_DIR, reporter } = require('./lib');

const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const ford = require(path.join(APP_DIR, 'utils', 'oemFordRules'));
const { VEHICLES } = require(path.join(APP_DIR, 'utils', 'fordCalibrationMatrix'));
const rep = reporter();
const { check } = rep;

const run = (input) => oem.evaluate({ make: 'Ford', ...input });
const names = (r) => r.calibrations.map((c) => c.systemName).sort();
const flagCodes = (r) => r.flags.map((f) => f.code);
const entry = (model, year, oemName, locStart) =>
  VEHICLES.find((v) => v.model === model && v.year === year).systems.find(
    (s) => s.oemName === oemName && (!locStart || s.location.startsWith(locStart)),
  );

// ─── Matrix ──────────────────────────────────────────────────────────────────
check('matrix: 18 vehicles, 196 I-CAR entries', VEHICLES.length === 18 && VEHICLES.reduce((n, v) => n + v.systems.length, 0) === 196);
check('matrix: every vehicle has an I-CAR URL and capture date', VEHICLES.every((v) => /^https:\/\/rts\.i-car\.com\/calv-\d+\.html$/.test(v.url) && v.captured === '2026-03-24'));
check('matrix: every entry has Yes/No/Not identified columns', VEHICLES.every((v) => v.systems.every((s) =>
  ['dtcSet', 'scanToolRequired', 'specialToolsRequired'].every((k) => ['Yes', 'No', 'Not identified'].includes(s[k])))));
check('matrix: every I-CAR phrase maps (module loaded)', ford._compiled.length === 18);

// Spot checks against the source PDFs
const ipma25 = entry('Bronco', 2025, 'Image Processing Module A');
check('source: 2025 Bronco IPMA has its 6 events', ipma25 && ipma25.events.length === 6 && ipma25.events.includes('If tire size is changed'));
const rps23 = entry('Bronco Sport', 2023, 'Rear Parking Aid Sensor');
// This table breaks across a page in the PDF; the columns must still read Yes / Yes / Yes.
check('source: 2023 Bronco Sport rear parking sensor (table split across pages) = Yes / Yes / Yes',
  rps23 && rps23.dtcSet === 'Yes' && rps23.scanToolRequired === 'Yes' && rps23.specialToolsRequired === 'Yes');
const sod23 = entry('Bronco Sport', 2023, 'Side Obstacle Detection Control Module');
check('source: 2023 Bronco Sport blind spot module = Yes / Not identified / Not identified',
  sod23 && sod23.dtcSet === 'Yes' && sod23.scanToolRequired === 'Not identified' && sod23.specialToolsRequired === 'Not identified');
const chmsl = entry('F-250', 2025, 'Center High Mounted Stop Lamp Camera', 'Camera in Headliner/Roof (Rear View Only)');
check('source: 2025 F-250 CHMSL camera (rear view only) triggers on stop lamp R&I',
  chmsl && chmsl.events.includes('If high mounted stop lamp is removed/installed or replaced'));
const sodcm = entry('Bronco', 2021, 'Side Obstacle Detection Control Module');
check('source: 2021 Bronco blind spot module lists no calibration requirement',
  sodcm && sodcm.events.length === 1 && sodcm.events[0] === 'No calibration/initialization requirements found');

// ─── Triggers ────────────────────────────────────────────────────────────────
let r = run({ model: 'Bronco Sport', year: 2022, events: ['LIFTGATE_HANDLE_LATCH_RI'] });
check('liftgate handle/latch → Bronco Sport rear camera', r.supported && r.ruleDepth === 'VEHICLE_MATRIX' && names(r).join() === 'Rear Parking Aid Camera');
r = run({ model: 'Bronco', year: 2022, events: ['LIFTGATE_HANDLE_LATCH_RI'] });
check('liftgate handle/latch → nothing on Bronco (not in its I-CAR entry)', r.calibrations.length === 0);
r = run({ model: 'F-150', year: 2025, events: ['TAILGATE_HANDLE_RI'], equipped: { CAMERA_360: false } });
check('tailgate handle → F-150 rear camera (rear view only)', names(r).join() === 'Rear Parking Aid Camera' && r.calibrations[0].variant === 'REAR_VIEW_ONLY');

const tireAll = VEHICLES.every((v) => {
  const x = run({ model: v.model, year: v.year, events: ['TIRE_SIZE_CHANGE'] });
  return x.calibrations.length === 1 && /^Image Processing Module A/.test(x.calibrations[0].systemName);
});
check('tire size change → IPMA camera on all 18 vehicles', tireAll);
const collAll = VEHICLES.every((v) => {
  const x = run({ model: v.model, year: v.year, collisionRelated: true });
  return x.calibrations.some((c) => c.systemName === 'Cruise Control Module' && c.reasons.some((e) => e.event === 'COLLISION'));
});
check('collision → Cruise Control Module radar on all 18 vehicles', collAll);
r = run({ model: 'F-150', year: 2025, events: ['COLLISION'] });
check('COLLISION line item works like collisionRelated', r.collisionRelated === true && names(r).includes('Cruise Control Module'));
r = run({ model: 'Bronco', year: 2024, events: ['FRONT_AIRBAG_DEPLOYMENT'] });
check('front airbag deployment → IPMA camera', names(r).join() === 'Image Processing Module A');
r = run({ model: 'Bronco', year: 2024, events: ['WHEEL_ALIGNMENT'] });
check('alignment → IPMA camera (Ford: "If suspension is repaired or aligned")', names(r).join() === 'Image Processing Module A');
r = run({ model: 'F-350', year: 2025, events: ['HEADLAMP_LEVELING_SENSOR_RI'] });
check('headlamp leveling sensor → multiple-inputs entry on Super Duty', names(r).join() === '(multiple inputs)');
r = run({ model: 'F-150 Lightning', year: 2025, events: ['FRONT_CORNER_SENSOR_RI'] });
check('front corner sensor → SODCM C/D on F-150 Lightning', names(r).join() === 'Side Obstacle Detection Control Module C/D');
r = run({ model: 'Bronco', year: 2023, events: ['BLIND_SPOT_SENSOR_RI'] });
check('blind spot sensor on Bronco → no calibration (I-CAR lists none)', r.calibrations.length === 0);

// Operation checks (azimuth / elevation)
r = run({ model: 'F-150', year: 2025, events: ['FRONT_BUMPER_RI'], equipped: { CAMERA_360: true } });
check('F-150 front bumper R&I → front camera + radar calibrations',
  names(r).join() === 'Cruise Control Module,Front Parking Aid Camera');
check('F-150 front bumper R&I → front parking sensor operation checks',
  r.operationChecks.length === 1 && r.operationChecks[0].systemName === 'Front Parking Aid Sensor'
  && r.operationChecks[0].checks.join() === 'Azimuth System Check,Elevation System Check'
  && /Per the Ford Workshop manual/.test(r.operationChecks[0].sourceNote));
r = run({ model: 'Bronco Sport', year: 2024, events: ['REAR_PARKING_SENSOR_RI'] });
check('rear parking sensor R&I → operation check, no calibration', r.calibrations.length === 0 && r.operationChecks.length === 1);

// Camera system variants
r = run({ model: 'Bronco', year: 2023, events: ['REAR_CAMERA_RI'] });
check('rear camera, system unknown → both entries + CAMERA_SYSTEM_UNVERIFIED',
  r.calibrations.length === 2 && flagCodes(r).includes('CAMERA_SYSTEM_UNVERIFIED'));
r = run({ model: 'Bronco', year: 2023, events: ['REAR_CAMERA_RI'], equipped: { CAMERA_360: true } });
check('rear camera, 360° confirmed → only the 360° entry', r.calibrations.length === 1 && r.calibrations[0].variant === 'CAMERA_360'
  && !flagCodes(r).includes('CAMERA_SYSTEM_UNVERIFIED') && flagCodes(r).includes('CAMERA_360_ANY_CAMERA'));
r = run({ model: 'Bronco', year: 2023, events: ['REAR_CAMERA_RI'], equipped: { CAMERA_360: false } });
check('rear camera, rear view only → only that entry', r.calibrations.length === 1 && r.calibrations[0].variant === 'REAR_VIEW_ONLY');
r = run({ model: 'Bronco', year: 2023, events: ['MIRROR_LEFT_RI'] });
check('left mirror R&I → left side camera only', r.calibrations.length === 1 && r.calibrations[0].location === 'Camera in Side Mirror (Left)');

// Result shape
r = run({ model: 'Bronco', year: 2021, events: ['WINDSHIELD_REPLACED'] });
const c0 = r.calibrations[0] || {};
check('result carries I-CAR source, scan policy and verbatim events',
  r.source.url === 'https://rts.i-car.com/calv-4496.html' && r.source.captured === '2026-03-24'
  && r.scanPolicy && r.scanPolicy.found === true && Array.isArray(c0.sourceEvents) && c0.scanToolRequired === 'Yes');
r = run({ model: 'Bronco', year: 2021, events: ['BOGUS'], dtcs: ['U0100'] });
check('Ford: unknown events and DTCs flagged', flagCodes(r).includes('UNKNOWN_EVENTS') && flagCodes(r).includes('DTC_NOT_IN_RULESET') && r.dtcActions.length === 1);

// ─── Coverage boundaries ─────────────────────────────────────────────────────
check('model aliases: "F-250 Super Duty", "f250", "Bronco-Sport"',
  run({ model: 'F-250 Super Duty', year: 2025, events: [] }).supported
  && run({ model: 'f250', year: '2025', events: [] }).supported
  && run({ model: 'Bronco-Sport', year: 2021, events: [] }).supported);
r = run({ model: 'Escape', year: 2023, events: ['WINDSHIELD_REPLACED'] });
check('uncovered Ford → scan policy only + FORD_MODEL_NOT_COVERED', !r.supported && r.ruleDepth === 'SCAN_POLICY_ONLY' && flagCodes(r).includes('FORD_MODEL_NOT_COVERED'));
r = run({ model: 'F-150', year: 2024, events: ['WINDSHIELD_REPLACED'] });
check('F-150 2024 (only 2025 exported) → not extrapolated', !r.supported && flagCodes(r).includes('FORD_MODEL_NOT_COVERED'));
r = oem.evaluate({ make: 'Lincoln', model: 'Aviator', year: 2024, events: [] });
check('Lincoln → scan policy only', !r.supported && flagCodes(r).includes('FORD_MODEL_NOT_COVERED'));
r = run({ model: 'Bronco', events: [] });
check('Ford without a year → scan policy only', !r.supported);

// ─── Battery disconnect (all makes) ──────────────────────────────────────────
for (const [make, model, year] of [['Honda', 'Accord', 2021], ['Toyota', 'Camry', 2022], ['Ford', 'Bronco', 2023], ['Ford', 'Escape', 2023]]) {
  const x = oem.evaluate({ make, model, year, events: ['BATTERY_DISCONNECT'] });
  check(`battery disconnect → review flag, no calibration (${make} ${model})`,
    flagCodes(x).includes('BATTERY_DISCONNECT_REVIEW') && x.calibrations.length === 0 && !flagCodes(x).includes('UNKNOWN_EVENTS'));
}
const bf = oem.evaluate({ make: 'Honda', model: 'Accord', year: 2021, events: ['BATTERY_DISCONNECT'] }).flags.find((f) => f.code === 'BATTERY_DISCONNECT_REVIEW');
check('battery flag quotes the register: not a blanket ADAS calibration', /Not a blanket ADAS calibration/i.test(bf.text));

// ─── Honda unchanged ─────────────────────────────────────────────────────────
r = oem.evaluate({ make: 'Honda', model: 'Accord', year: 2021, events: ['FRONT_FASCIA_REPAIR_300MM', 'WINDSHIELD_REPLACED'], dtcs: ['P2583-54'] });
check('Honda Accord result unchanged', r.ruleDepth === 'FULL_TRIGGER_RULES' && r.calibrations.map((c) => c.system).sort().join() === 'CAMERA,RADAR');

console.log(rep.failures ? `\n${rep.failures} Ford rules check(s) FAILED` : '\nall Ford rules checks passed');
process.exit(rep.failures ? 1 : 0);
