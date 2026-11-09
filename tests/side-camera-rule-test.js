'use strict';
// CollisionIQ field rule: door, mirror or side panel work → side mirror camera
// inspection and verification, all makes. Pure unit checks.
// Usage: node tests/side-camera-rule-test.js
const path = require('path');
const { APP_DIR, reporter } = require('./lib');

const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const rep = reporter();
const { check } = rep;
const codes = (r) => r.flags.map((f) => f.code);
const sides = (r) => r.verifications.map((v) => v.side).join(',');

const MAKES = [['Toyota', 'Camry', 2022], ['Ford', 'Bronco', 2023], ['Ford', 'Escape', 2023], ['Honda', 'Accord', 2021], ['Subaru', 'Outback', 2024]];
for (const [make, model, year] of MAKES) {
  const r = oem.evaluate({ make, model, year, events: ['DOOR_LEFT_RI'] });
  check(`driver door R&I → left side camera verification (${make} ${model})`, sides(r) === 'Left' && !codes(r).includes('UNKNOWN_EVENTS'));
}

let r = oem.evaluate({ make: 'Toyota', model: 'RAV4', year: 2023, events: ['MIRROR_RIGHT_RI', 'SIDE_PANEL_LEFT_REPAIR'] });
check('right mirror + left side panel → both sides', sides(r) === 'Left,Right');
r = oem.evaluate({ make: 'Toyota', model: 'RAV4', year: 2023, events: ['DOOR_RIGHT_COLLISION_REPAIR', 'DOOR_RIGHT_ADJUST'] });
check('two right-side events → one right-side entry citing both', r.verifications.length === 1 && r.verifications[0].reasons.length === 2);
r = oem.evaluate({ make: 'Ford', model: 'Bronco', year: 2023, events: ['MIRROR_LEFT_ADJUST'] });
check('Ford mirror adjust → verification and the OEM side camera calibration', sides(r) === 'Left' && r.calibrations.some((c) => c.location === 'Camera in Side Mirror (Left)'));
r = oem.evaluate({ make: 'Toyota', model: 'Camry', year: 2022, events: ['WINDSHIELD_REPLACED'] });
check('no door/mirror/side panel work → no verification', Array.isArray(r.verifications) && r.verifications.length === 0);

const v = oem.evaluate({ make: 'Kia', model: 'Telluride', year: 2024, events: ['DOOR_LEFT_RI'] }).verifications[0];
check('entry carries the field-rule wording', /regardless of whether camera unit was replaced/.test(v.text));
check('entry says it is not an OEM requirement', /not an OEM requirement/.test(v.basis));

r = oem.evaluate({ make: 'Honda', model: 'Accord', year: 2021, events: ['DOOR_LEFT_RI'] });
check('Honda keeps its OEM rules for the same event (MVCS)', r.calibrations.some((c) => c.system === 'MVCS') && sides(r) === 'Left');
r = oem.evaluate({ make: 'Honda', model: 'Accord', year: 2021, events: ['SIDE_PANEL_LEFT_REPAIR'] });
check('Honda: side panel event handled here, not flagged unknown', sides(r) === 'Left' && !codes(r).includes('UNKNOWN_EVENTS'));

console.log(rep.failures ? `\n${rep.failures} side camera rule check(s) FAILED` : '\nall side camera rule checks passed');
process.exit(rep.failures ? 1 : 0);
