'use strict';
// GM (Chevrolet, Buick, GMC, Cadillac) rules from GM's own collision position
// statements, Sept 18, 2026 (CollisonIq/utils/oemGmPosition.js). Pure unit checks.
// Usage: node tests/gm-rules-test.js
const path = require('path');
const fs = require('fs');
const { APP_DIR, reporter } = require('./lib');

const oem = require(path.join(APP_DIR, 'utils', 'oemCalibrationRules'));
const gm = require(path.join(APP_DIR, 'utils', 'oemGmPosition'));
const jobReport = require(path.join(APP_DIR, 'utils', 'jobReport'));
const rep = reporter();
const { check } = rep;
const run = (make, events) => oem.evaluate({ make, model: 'X', year: 2025, events });
const codes = (r) => r.flags.map((f) => f.code);

check('GM sources are GM-hosted statements dated 2026-09-18',
  Object.values(gm.SOURCES).every((s) => s.date === '2026-09-18' && s.url.startsWith('https://www.gmparts.com/')));
check('GM module cites no third party', !/i-car/i.test(fs.readFileSync(path.join(APP_DIR, 'utils', 'oemGmPosition.js'), 'utf8')));

for (const make of ['Chevrolet', 'Chevy', 'GMC', 'Buick', 'Cadillac']) {
  const r = run(make, ['WINDSHIELD_REPLACED']);
  check(`${make}: windshield replaced → windshield camera calibration/learn, partial coverage, OE glass flag`,
    r.ruleDepth === 'OEM_POSITION_STATEMENT' && r.coverage === 'PARTIAL' && r.calibrations.map((c) => c.system).join() === 'GM_FRONT_CAMERA'
    && codes(r).includes('GM_OE_GLASS') && codes(r).includes('GM_OTHER_CALIBRATIONS_IN_SI'));
}
let r = run('Chevrolet', ['FRONT_CAMERA_RI']);
check('camera removed/reinstalled → windshield camera calibration + genuine ADAS parts flag', r.calibrations.length === 1 && codes(r).includes('GM_GENUINE_ADAS_PARTS'));
r = run('Chevrolet', ['WINDSHIELD_RI']);
check('windshield R&I → windshield camera calibration', r.calibrations.length === 1);
r = run('GMC', ['FRONT_BUMPER_RI']);
check('bumper cover R&I → no invented GM calibration; SI line, 13-mil fascia flag; field rules still apply',
  r.calibrations.length === 0 && codes(r).includes('GM_OTHER_CALIBRATIONS_IN_SI') && /13 mils/.test(r.flags.find((f) => f.code === 'GM_FASCIA_REPAIR_LIMITS').text)
  && r.verifications.some((v) => v.id === 'FIELD_FRONT_RADAR'));
r = run('Buick', ['WHEEL_ALIGNMENT']);
check('alignment → no calibration, modifications flag pointing to GM SI', r.calibrations.length === 0 && codes(r).includes('GM_MODIFICATIONS') && !codes(r).includes('UNKNOWN_EVENTS'));
r = run('Cadillac', ['FRONT_RADAR_RI', 'DOOR_LEFT_RI']);
check('common events pass to field rules; no unknown-event flag', !codes(r).includes('UNKNOWN_EVENTS') && r.verifications.some((v) => v.id === 'FIELD_SIDE_CAMERA_LEFT'));

const built = jobReport.buildJobAdas({ make: 'Chevrolet', model: 'Equinox', year: '2025', repairValues: ['FRONT_BUMPER_RI', 'WINDSHIELD_REPLACED'] });
const html = jobReport.renderSections(built.result);
check('hard copy: GM basis (partial), windshield camera, SI line, GM statement links',
  built.result.basis.kind === 'partial' && /General Motors/.test(built.result.basis.text) && /Front view windshield camera/.test(html)
  && /vehicle-specific: determine them from the OEM service information/.test(html) && /gmparts\.com/.test(html));
check('job list text names the SI line', /Other Chevrolet calibrations are vehicle-specific/.test(built.columns.adasSystems));
check('Toyota and Honda unaffected', run('Toyota', ['WINDSHIELD_REPLACED']).ruleDepth === 'SCAN_POLICY_ONLY'
  && oem.evaluate({ make: 'Honda', model: 'Accord', year: 2021, events: ['WINDSHIELD_REPLACED'] }).ruleDepth === 'FULL_TRIGGER_RULES');

console.log(rep.failures ? `\n${rep.failures} GM rules check(s) FAILED` : '\nall GM rules checks passed');
process.exit(rep.failures ? 1 : 0);
