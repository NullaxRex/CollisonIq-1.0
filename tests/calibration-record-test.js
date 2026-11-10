'use strict';
// Calibration record (CollisonIq/utils/calibrationRecord.js): required items
// per job, record validation, open/closed state and rendering. Pure unit checks.
// Usage: node tests/calibration-record-test.js
const path = require('path');
const { APP_DIR, reporter } = require('./lib');

const cr = require(path.join(APP_DIR, 'utils', 'calibrationRecord'));
const jobReport = require(path.join(APP_DIR, 'utils', 'jobReport'));
const rep = reporter();
const { check } = rep;
const evalFor = (make, model, values) => jobReport.buildJobAdas({ make, model, year: '2025', repairValues: values }).result;
const keys = (items) => items.map((i) => i.key);
let nextId = 1;
const rec = (item_key, result, extra = {}) => ({ id: nextId++, item_key, item_name: extra.item_name || item_key, result, voided_at: null, ...extra });

// ─── Required items ──────────────────────────────────────────────────────────
let items = cr.requiredItems(evalFor('Ford', 'F-150', ['FRONT_RADAR', 'MIRROR_RI:L']));
check('Ford job: pre scan first, post scan last, OEM + field items, no SI review (full rules)',
  items[0].key === 'SCAN:PRE' && items[items.length - 1].key === 'SCAN:POST' && keys(items).includes('OEM:FORD_CCM')
  && keys(items).includes('OEM:FORD_CAM_LEFT') && keys(items).includes('FIELD:FIELD_SIDE_CAMERA_LEFT') && !keys(items).includes('SI:REVIEW'), keys(items).join());
items = cr.requiredItems(evalFor('Toyota', 'Camry', ['WINDSHIELD_REPLACED']));
check('Toyota (scan policy only): SI review required', keys(items).includes('SI:REVIEW') && !keys(items).some((k) => k.startsWith('OEM:')));
items = cr.requiredItems(evalFor('Chevrolet', 'Silverado', ['WINDSHIELD_REPLACED']));
check('GM (partial): windshield camera + SI review', keys(items).includes('OEM:GM_FRONT_CAMERA') && keys(items).includes('SI:REVIEW'));
items = cr.requiredItems(null);
check('job saved by the old engine: scans + SI review', keys(items).join() === 'SCAN:PRE,SI:REVIEW,SCAN:POST');
items = cr.requiredItems(evalFor('Honda', 'Accord', ['WINDSHIELD_REPLACED']));
check('Honda: job-aid calibration item present', keys(items).some((k) => k.startsWith('OEM:CAMERA')));
check('keys unique', new Set(keys(cr.requiredItems(evalFor('Ford', 'F-150', ['BLIND_SPOT_SENSOR', 'FRONT_BUMPER_RI'])))).size
  === cr.requiredItems(evalFor('Ford', 'F-150', ['BLIND_SPOT_SENSOR', 'FRONT_BUMPER_RI'])).length);

// ─── State ───────────────────────────────────────────────────────────────────
items = cr.requiredItems(null);
let st = cr.status(items, []);
check('no records: all open', st.summary.required === 3 && st.summary.closed === 0 && !st.summary.complete && st.rows.every((r) => r.state === 'missing'));
st = cr.status(items, [rec('SCAN:PRE', 'pass'), rec('SI:REVIEW', 'not_performed', { reason: 'n/a' }), rec('SCAN:POST', 'fail')]);
check('pass and not-performed close; fail stays open', st.summary.closed === 2 && st.summary.open === 1 && st.summary.openNames.join() === 'Post-repair scan');
st = cr.status(items, [rec('SCAN:PRE', 'pass'), rec('SI:REVIEW', 'pass'), rec('SCAN:POST', 'fail'), rec('SCAN:POST', 'pass')]);
check('a later pass closes a failed item; history kept', st.summary.complete && st.rows[2].history.length === 2);
st = cr.status(items, [rec('SCAN:PRE', 'pass', { voided_at: '2026-11-10' }), rec('SI:REVIEW', 'pass'), rec('SCAN:POST', 'pass')]);
check('voided record does not count', !st.summary.complete && st.rows[0].state === 'missing' && st.rows[0].history.length === 1);
st = cr.status(items, [rec('SCAN:PRE', 'pass'), rec('SI:REVIEW', 'pass'), rec('SCAN:POST', 'pass'), rec('ADDITIONAL:REAR_RADAR', 'fail', { item_name: 'Rear radar' })]);
check('failed additional calibration keeps the job open', !st.summary.complete && st.additional.length === 1 && st.summary.openNames.join() === 'Rear radar');

// ─── Validation ──────────────────────────────────────────────────────────────
const today = new Date('2026-11-10T12:00:00Z');
const scanItem = { key: 'SCAN:PRE', kind: 'scan', name: 'Pre-repair scan' };
const oemItem = { key: 'OEM:FORD_CCM', kind: 'oem', name: 'CCM' };
const fieldItem = { key: 'FIELD:FIELD_FRONT_RADAR', kind: 'field', name: 'Front radar' };
const base = { result: 'pass', performed_by_name: 'C. Jones', performed_on: '2026-11-10' };
check('scan pass needs a tool', cr.validateRecord(base, scanItem, today).errors.some((e) => /scan tool/.test(e))
  && cr.validateRecord({ ...base, tool: 'FDRS' }, scanItem, today).errors.length === 0);
check('OEM calibration pass needs the OEM service information used', cr.validateRecord(base, oemItem, today).errors.some((e) => /OEM service information/.test(e))
  && cr.validateRecord({ ...base, si_reference: 'WSM 419-03' }, oemItem, today).errors.length === 0);
check('field rule pass needs neither', cr.validateRecord(base, fieldItem, today).errors.length === 0);
check('not performed needs a reason, but no SI or tool', cr.validateRecord({ ...base, result: 'not_performed' }, oemItem, today).errors.some((e) => /why/.test(e))
  && cr.validateRecord({ ...base, result: 'not_performed', reason: 'Not equipped per VIN build' }, oemItem, today).errors.length === 0);
check('future date, bad date, bad result, bad method rejected',
  cr.validateRecord({ ...base, performed_on: '2026-12-01' }, fieldItem, today).errors.length === 1
  && cr.validateRecord({ ...base, performed_on: '11/10/2026' }, fieldItem, today).errors.length === 1
  && cr.validateRecord({ ...base, result: 'maybe' }, fieldItem, today).errors.length === 1
  && cr.validateRecord({ ...base, method: 'Guesswork' }, fieldItem, today).errors.length === 1);
let v = cr.validateRecord({ ...base, item_name: 'Rear radar alignment', si_reference: 'SI 555' }, null, today);
check('additional: key from name, needs SI', v.errors.length === 0 && v.record.item_key === 'ADDITIONAL:REAR_RADAR_ALIGNMENT' && v.record.kind === 'additional');
check('additional without a name rejected', cr.validateRecord({ ...base, si_reference: 'SI' }, null, today).errors.some((e) => /Name the calibration/.test(e)));
check('long input trimmed', cr.validateRecord({ ...base, notes: 'x'.repeat(5000) }, fieldItem, today).record.notes.length === 1000);

// ─── Rendering ───────────────────────────────────────────────────────────────
st = cr.status(cr.requiredItems(null), [rec('SCAN:PRE', 'pass', { item_name: 'Pre-repair scan', tool: '<script>x</script>', performed_by_name: 'A', performed_on: '2026-11-10', id: 900 })]);
const html = cr.renderSection(st, [{ id: 7, calibration_id: 900, original_name: 'scan"<b>.pdf' }], { fileUrl: (f) => `/f/${f.id}` });
check('section: summary, states, proof link, escaped', /1 of 3 required items documented/.test(html) && /Not documented/.test(html)
  && /href="\/f\/7"/.test(html) && !/<script>|<b>/.test(html) && /&lt;script&gt;/.test(html));
check('insurer render has no forms', !/<form/.test(html));
const form = cr.renderForm({ action: '/jobs/X/calibrations', csrf: '<input name="_csrf">', items: st.rows, defaults: { date: '2026-11-10', name: 'C"J' } });
check('form: multipart, every item + additional, escaped default', /enctype="multipart\/form-data"/.test(form) && /value="SI:REVIEW"/.test(form)
  && /value="ADDITIONAL"/.test(form) && /value="C&quot;J"/.test(form) && /class="calrec-form no-print"/.test(form));
check('summary badge', /1\/3 documented · 2 open/.test(cr.summaryBadge(st.summary)));

console.log(rep.failures ? `\n${rep.failures} calibration record check(s) FAILED` : '\nall calibration record checks passed');
process.exit(rep.failures ? 1 : 0);
