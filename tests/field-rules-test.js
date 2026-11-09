'use strict';
// CollisionIQ universal field rules (CollisonIq/utils/fieldRules.js): body work in
// an ADAS area → calibration or, at minimum, in-shop + road test/verify, for every
// make, alongside OEM rules. Pure unit checks.
// Usage: node tests/field-rules-test.js
const path = require('path');
const { APP_DIR, reporter } = require('./lib');

const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const rep = reporter();
const { check } = rep;
const ids = (r) => r.verifications.map((v) => v.id).sort().join(',');
const has = (r, id) => r.verifications.some((v) => v.id === id);
const codes = (r) => r.flags.map((f) => f.code);
const run = (make, model, year, events) => oem.evaluate({ make, model, year, events });

const MAKES = [['Toyota', 'Camry', 2025], ['Ford', 'Bronco', 2023], ['Ford', 'Escape', 2023], ['Honda', 'Accord', 2021],
  ['Subaru', 'Outback', 2024], ['Kia', 'Telluride', 2024], ['Chevrolet', 'Silverado', 2024]];

// ─── Universal: every make, whatever the OEM side says ───────────────────────
for (const [make, model, year] of MAKES) {
  const d = run(make, model, year, ['DOOR_LEFT_RI']);
  const g = run(make, model, year, ['TAILGATE_RI']);
  const l = run(make, model, year, ['REAR_GATE_HANDLE_LATCH_RI']);
  check(`door → left side camera; tailgate and liftgate latch → rear camera + rear parking (${make} ${model})`,
    ids(d) === 'FIELD_SIDE_CAMERA_LEFT' && has(g, 'FIELD_REAR_CAMERA') && has(g, 'FIELD_REAR_PARKING')
    && has(l, 'FIELD_REAR_CAMERA') && !codes(d).includes('UNKNOWN_EVENTS') && !codes(g).includes('UNKNOWN_EVENTS'));
}
let r = run('Toyota', 'Camry', 2025, ['DOOR_LEFT_RI']);
check('applies where OEM rules are scan-policy only (Toyota)', r.ruleDepth === 'SCAN_POLICY_ONLY' && r.verifications.length === 1);
check('every item is a warning and says it is not an OEM requirement',
  r.verifications.every((v) => v.level === 'warning' && /not an OEM requirement/.test(v.basis) && /vary by model/.test(v.basis)));
check('FIELD_RULES_APPLIED warning flag added', codes(r).includes('FIELD_RULES_APPLIED'));
r = run('Ford', 'Bronco', 2022, ['LIFTGATE_HANDLE_LATCH_RI']);
check('Ford Bronco liftgate latch: I-CAR lists nothing, field rule still fires', r.calibrations.length === 0 && has(r, 'FIELD_REAR_CAMERA'));

// ─── Side cameras ────────────────────────────────────────────────────────────
r = run('Kia', 'Sorento', 2024, ['FENDER_RIGHT_REPAIR']);
check('fender pull → right side camera (door and mirror move with it)', has(r, 'FIELD_SIDE_CAMERA_RIGHT'));
r = run('Toyota', 'RAV4', 2023, ['DOOR_RIGHT_ADJUST', 'REAR_DOOR_RIGHT_RI']);
check('door adjust + rear door → one right-side entry citing both', r.verifications.filter((v) => v.side === 'Right').length === 1
  && r.verifications.find((v) => v.side === 'Right').reasons.length === 2);
r = run('Toyota', 'RAV4', 2023, ['MIRROR_RIGHT_RI', 'SIDE_PANEL_LEFT_REPAIR']);
check('right mirror + left side panel → both sides', has(r, 'FIELD_SIDE_CAMERA_LEFT') && has(r, 'FIELD_SIDE_CAMERA_RIGHT'));
check('side camera text keeps the field-rule wording', /regardless of whether camera unit was replaced/.test(r.verifications[0].text));

// ─── Front end ───────────────────────────────────────────────────────────────
r = run('Nissan', 'Rogue', 2024, ['FRONT_BUMPER_REPAIR_ON_CAR']);
check('front bumper repaired on the car, no front damage → nothing', r.verifications.length === 0);
r = run('Nissan', 'Rogue', 2024, ['FRONT_BUMPER_REPAIR_ON_CAR', 'FRONT_COLLISION_DAMAGE']);
check('on-car bumper repair + front impact damage → radar + front camera', ids(r) === 'FIELD_FRONT_CAMERA,FIELD_FRONT_RADAR');
r = run('Nissan', 'Rogue', 2024, ['FRONT_BUMPER_RI']);
check('front bumper off the car → radar + front camera', ids(r) === 'FIELD_FRONT_CAMERA,FIELD_FRONT_RADAR');
r = run('Kia', 'Sorento', 2024, ['FENDER_LEFT_REPAIR']);
check('fender hit → radar (bracket can shift) + front camera + side camera', ids(r) === 'FIELD_FRONT_CAMERA,FIELD_FRONT_RADAR,FIELD_SIDE_CAMERA_LEFT');
check('radar text explains impact energy and bracket shift', /bracket/.test(r.verifications.find((v) => v.id === 'FIELD_FRONT_RADAR').text));
r = run('Toyota', 'Camry', 2025, ['WINDSHIELD_REPLACED']);
check('windshield → front camera (basic workflow)', ids(r) === 'FIELD_FRONT_CAMERA');
r = run('Subaru', 'Outback', 2024, ['FRONT_COLLISION_DAMAGE']);
const cam = r.verifications.find((v) => v.id === 'FIELD_FRONT_CAMERA');
check('Subaru still notified, with EyeSight planning + weather note', cam && /EyeSight/.test(cam.makeNote) && /2 hours/.test(cam.makeNote) && /weather/.test(cam.makeNote));
r = run('Toyota', 'Camry', 2025, ['FRONT_COLLISION_DAMAGE']);
check('non-Subaru front camera has no Subaru note', !r.verifications.find((v) => v.id === 'FIELD_FRONT_CAMERA').makeNote);

// ─── Rear end, blind spot ↔ parking aids ─────────────────────────────────────
r = run('Hyundai', 'Tucson', 2024, ['REAR_BUMPER_REPAIR']);
check('any rear bumper work → rear camera + rear parking', has(r, 'FIELD_REAR_CAMERA') && has(r, 'FIELD_REAR_PARKING'));
r = run('Hyundai', 'Tucson', 2024, ['REAR_BUMPER_RI']);
check('rear bumper off → also blind spot (parking sensors were worked on)', has(r, 'FIELD_BLIND_SPOT'));
r = run('Mazda', 'CX-5', 2024, ['BLIND_SPOT_SENSOR_RI']);
check('blind spot work → parking sensors verified too', ids(r) === 'FIELD_BLIND_SPOT,FIELD_REAR_PARKING');
r = run('Mazda', 'CX-5', 2024, ['REAR_PARKING_SENSOR_RI']);
check('parking sensor work → blind spot verified too', has(r, 'FIELD_BLIND_SPOT') && has(r, 'FIELD_REAR_PARKING'));
r = run('Honda', 'CR-V', 2023, ['BSI_RI']);
check('Honda BSI: OEM calibration kept + field verifications added', r.calibrations.some((c) => c.system === 'BSI') && has(r, 'FIELD_REAR_PARKING'));

// ─── OEM side unchanged ──────────────────────────────────────────────────────
r = run('Honda', 'Accord', 2021, ['DOOR_LEFT_RI']);
check('Honda keeps its OEM rule for the same event (MVCS)', r.calibrations.some((c) => c.system === 'MVCS') && has(r, 'FIELD_SIDE_CAMERA_LEFT'));
r = run('Ford', 'F-150', 2025, ['FRONT_BUMPER_RI'], );
check('Ford F-150 front bumper: I-CAR calibrations kept + field items added',
  r.calibrations.some((c) => c.systemName === 'Cruise Control Module') && has(r, 'FIELD_FRONT_RADAR'));
r = run('Toyota', 'Camry', 2025, ['BATTERY_DISCONNECT']);
check('battery alone → no field items', r.verifications.length === 0 && codes(r).includes('BATTERY_DISCONNECT_REVIEW'));

console.log(rep.failures ? `\n${rep.failures} field rule check(s) FAILED` : '\nall field rule checks passed');
process.exit(rep.failures ? 1 : 0);
