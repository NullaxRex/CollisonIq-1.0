'use strict';
// Ford / Lincoln calibration rules from Ford's own documents
// (CollisonIq/utils/oemFordPosition.js): the Ford/Lincoln ADAS Job Aid
// (Sept 29, 2026) and the ADAS Integrity (May 1, 2026) and Bumper Fascia
// (Oct 1, 2025) position statements. Pure unit checks.
// Usage: node tests/ford-rules-test.js
const path = require('path');
const fs = require('fs');
const { APP_DIR, reporter } = require('./lib');

const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const ford = require(path.join(APP_DIR, 'utils', 'oemFordPosition'));
const rep = reporter();
const { check } = rep;
const run = (o) => oem.evaluate({ make: 'Ford', model: 'F-150', year: 2025, ...o });
const ids = (r) => r.calibrations.map((c) => c.system).sort().join(',');
const flagCodes = (r) => r.flags.map((f) => f.code);

// ─── No third-party data left in the product ─────────────────────────────────
const utils = path.join(APP_DIR, 'utils');
check('I-CAR matrix files removed', !fs.existsSync(path.join(utils, 'fordCalibrationMatrix.js')) && !fs.existsSync(path.join(utils, 'oemFordRules.js')));
const fordSrc = fs.readFileSync(path.join(utils, 'oemFordPosition.js'), 'utf8');
check('Ford module cites Ford documents, not the I-CAR calibration search',
  !/calv-\d+|OEM Calibration Requirements Search|I-CAR OEM/i.test(fordSrc) && ford.SOURCES.JOB_AID.date === '2026-09-29');
check('every Ford rule has a WSM reference, a procedure and triggers that are known events',
  ford.RULES.every((r) => r.wsm && r.procedure && r.triggers.length && r.triggers.every(([e, why]) => ford.EVENTS[e] && why)));

// ─── Applies to every Ford and Lincoln ───────────────────────────────────────
for (const [make, model, year] of [['Ford', 'F-150', 2025], ['Ford', 'F-150', 2021], ['Ford', 'Escape', 2023], ['Ford', 'Bronco', 2022],
  ['Lincoln', 'Aviator', 2024], ['Ford', 'Mustang Mach-E', 2024], ['Ford', 'F-250 Super Duty', 2019], ['Ford', '', '']]) {
  const r = oem.evaluate({ make, model, year, events: ['WINDSHIELD_REPLACED'] });
  check(`windshield replaced → IPMA camera + HUD, job aid basis (${make} ${model || 'no model'} ${year || ''})`,
    r.ruleDepth === 'OEM_JOB_AID' && ids(r) === 'FORD_HUD,FORD_IPMA' && !flagCodes(r).includes('UNKNOWN_EVENTS'));
}

// ─── Front radar (CCM) ───────────────────────────────────────────────────────
let r = run({ events: ['FRONT_BUMPER_RI'] });
check('front bumper cover R&I alone → no CCM (radar undisturbed), flagged', !ids(r).includes('FORD_CCM') && flagCodes(r).includes('FORD_CCM_UNDISTURBED'));
check('front bumper cover R&I → front parking sensor checks + front 360° camera', ids(r) === 'FORD_CAM_FRONT,FORD_PARK_FRONT');
check('front bumper cover R&I → corner radar and fascia refinish flags',
  flagCodes(r).includes('FORD_SOD_FRONT_COVER') && /12 mils/.test(r.flags.find((f) => f.code === 'FORD_FASCIA_REPAIR_LIMITS').text));
for (const e of ['FRONT_RADAR_RI', 'FRONT_RADAR_BRACKET_RI', 'FRONT_BUMPER_BEAM_RI']) {
  r = run({ events: [e] });
  check(`${e} → CCM alignment (419-03)`, ids(r).includes('FORD_CCM') && r.calibrations.find((c) => c.system === 'FORD_CCM').wsmSection === '419-03'
    && !flagCodes(r).includes('FORD_CCM_UNDISTURBED'));
}
r = run({ events: ['FRONT_BUMPER_REPAIR_ON_CAR'] });
check('on-car bumper repair → no calibration, fascia refinish limits flagged', r.calibrations.length === 0 && flagCodes(r).includes('FORD_FASCIA_REPAIR_LIMITS'));

// ─── Windshield camera, HUD, modules ─────────────────────────────────────────
r = run({ events: ['FRONT_CAMERA_RI'] });
check('camera R&I → IPMA only (no HUD)', ids(r) === 'FORD_IPMA' && flagCodes(r).includes('FORD_GENUINE_SENSORS'));
r = run({ events: ['WINDSHIELD_RI'] });
check('windshield R&I → IPMA (camera off and on), no HUD (not a new windshield)', ids(r) === 'FORD_IPMA'
  && /CollisionIQ reading/.test(r.calibrations[0].reasons[0].why));
r = run({ events: ['INSTRUMENT_PANEL_RI'] });
check('instrument panel R&I → HUD configuration', ids(r) === 'FORD_HUD');
r = run({ events: ['IPMB_MODULE_REPLACED'] });
check('IPMB replaced → ADAS module per WSM', ids(r) === 'FORD_IPM_MODULE');

// ─── Corner radars ───────────────────────────────────────────────────────────
r = run({ events: ['TAIL_LAMP_RIGHT_RI'] });
check('right tail lamp R&I → SODR alignment only', ids(r) === 'FORD_SOD_REAR_RIGHT' && r.calibrations[0].side === 'Right');
r = run({ events: ['BLIND_SPOT_SENSOR_RI'] });
check('rear corner radar R&I → SODL and SODR entries', ids(r) === 'FORD_SOD_REAR_LEFT,FORD_SOD_REAR_RIGHT');
r = run({ events: ['FRONT_CORNER_SENSOR_RI'] });
check('front corner radar R&I → SODCMC / SODCMD (419-04)', ids(r) === 'FORD_SOD_FRONT' && r.calibrations[0].wsmSection === '419-04');
r = run({ events: ['REAR_BUMPER_RI'] });
check('rear bumper cover R&I → rear parking sensor checks; corner radar and bumper camera flags',
  ids(r) === 'FORD_PARK_REAR' && flagCodes(r).includes('FORD_SOD_REAR_COVER') && flagCodes(r).includes('FORD_REAR_CAMERA_BUMPER'));
check('parking sensor checks are documented as a calibration', /calibration procedure/.test(r.calibrations[0].note));

// ─── Cameras ─────────────────────────────────────────────────────────────────
r = run({ events: ['MIRROR_LEFT_RI'] });
check('left mirror R&I → left mirror camera only', ids(r) === 'FORD_CAM_LEFT');
r = run({ events: ['MIRROR_RIGHT_ADJUST'] });
check('right mirror adjusted (moved) → right mirror camera', ids(r) === 'FORD_CAM_RIGHT');
r = run({ events: ['DOOR_LEFT_RI'] });
check('door R&I → no Ford calibration (field rules cover the mirror camera)', r.calibrations.length === 0
  && r.verifications.some((v) => v.id === 'FIELD_SIDE_CAMERA_LEFT'));
r = run({ events: ['REAR_GATE_RI'] });
check('tailgate R&I → rear camera, both routines described', ids(r) === 'FORD_CAM_REAR' && /Initialization/.test(r.calibrations[0].method));
r = run({ events: ['FRONT_GRILLE_RI'] });
check('grille R&I → front 360° camera', ids(r) === 'FORD_CAM_FRONT');
r = run({ events: ['CHMSL_RI'] });
check('CHMSL R&I → no calibration, flagged as not in the job aid', r.calibrations.length === 0 && flagCodes(r).includes('FORD_CHMSL_CAMERA'));

// ─── Not triggers in the job aid ─────────────────────────────────────────────
r = run({ events: ['WHEEL_ALIGNMENT', 'TIRE_SIZE_CHANGE'] });
check('alignment / tire size → no calibration, geometry flag pointing to the WSM', r.calibrations.length === 0 && flagCodes(r).includes('FORD_GEOMETRY'));
r = run({ events: ['FRONT_AIRBAG_DEPLOYMENT'] });
check('airbag deployment → no calibration, flagged', r.calibrations.length === 0 && flagCodes(r).includes('FORD_AIRBAG_NOT_IN_JOB_AID'));

// ─── Result shape ────────────────────────────────────────────────────────────
r = oem.evaluate({ make: 'Lincoln', model: 'Nautilus', year: 2024, events: ['FRONT_RADAR_RI', 'NOT_AN_EVENT'], dtcs: ['U0235'] });
check('Lincoln: Lincoln service info and scan statement cited',
  /lincolnserviceinfo\.com/.test(r.source.procedures) && r.source.related.some((s) => /Scanning/.test(s.title)));
check('unknown events flagged; DTCs get a WSM troubleshooting action', flagCodes(r).includes('UNKNOWN_EVENTS') && r.dtcActions.length === 1);
check('every Ford result says where equipped and calibrate regardless of DTC',
  r.calibrations.every((c) => c.whereEquipped) && flagCodes(r).includes('FORD_CALIBRATE_REGARDLESS_OF_DTC') && flagCodes(r).includes('FORD_EQUIPMENT_UNVERIFIED'));

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
check('Honda Accord result unchanged; Honda named as publisher', r.ruleDepth === 'FULL_TRIGGER_RULES'
  && r.calibrations.map((c) => c.system).sort().join() === 'CAMERA,RADAR' && r.source.publisher === 'American Honda Motor Co., Inc.' && !r.source.via);

console.log(rep.failures ? `\n${rep.failures} Ford rules check(s) FAILED` : '\nall Ford rules checks passed');
process.exit(rep.failures ? 1 : 0);
