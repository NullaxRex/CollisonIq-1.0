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

// ─── Sign-off, QC approval, override ─────────────────────────────────────────
{
  const items = cr.requiredItems(null);
  const done = [rec('SCAN:PRE', 'pass', { created_at: '2026-11-10T10:00:00.000Z' }), rec('SI:REVIEW', 'pass', { created_at: '2026-11-10T10:01:00.000Z' }),
    rec('SCAN:POST', 'pass', { created_at: '2026-11-10T10:02:00.000Z' })];
  const sum = cr.status(items, done).summary;
  const so = (id, kind, at, user_id = 1) => ({ id, kind, created_at: at, user_id, user_name: `U${user_id}`, role: kind === 'tech' ? 'technician' : 'qc_manager', statement: cr.STATEMENTS[kind] });
  let s = cr.signoffState(done, [], sum);
  check('complete record, no sign-offs: tech can sign, QC cannot approve, cannot close',
    s.canTechSign && !s.canApprove && /no technician sign-off/.test(s.approveBlockers.join()) && !s.canClose && /technician has not signed/.test(cr.closeBlocker(s, sum)));
  s = cr.signoffState(done, [so(1, 'tech', '2026-11-10T11:00:00.000Z')], sum);
  check('current tech sign-off: QC can approve', s.techCurrent && s.canApprove && !s.canClose && /QC has not approved/.test(cr.closeBlocker(s, sum)));
  s = cr.signoffState(done, [so(1, 'tech', '2026-11-10T11:00:00.000Z', 1), so(2, 'qc', '2026-11-10T11:05:00.000Z', 2)], sum);
  check('tech + QC current: can close, different people', s.canClose && !s.samePerson && cr.closeBlocker(s, sum) === null);
  s = cr.signoffState(done, [so(1, 'tech', '2026-11-10T11:00:00.000Z', 3), so(2, 'qc', '2026-11-10T11:05:00.000Z', 3)], sum);
  check('same person signs and approves: flagged', s.canClose && s.samePerson && /same person/.test(cr.renderSignoffs(s, sum)));
  const later = [...done, rec('SCAN:POST', 'pass', { created_at: '2026-11-10T12:00:00.000Z' })];
  s = cr.signoffState(later, [so(1, 'tech', '2026-11-10T11:00:00.000Z', 1), so(2, 'qc', '2026-11-10T11:05:00.000Z', 2)], cr.status(items, later).summary);
  check('record change after approval: both stale, cannot close', !s.techCurrent && !s.qcCurrent && !s.canClose && /out of date/.test(cr.renderSignoffs(s, sum)));
  const voided = done.map((r, i) => (i === 0 ? { ...r, voided_at: '2026-11-10T12:00:00.000Z' } : r));
  s = cr.signoffState(voided, [so(1, 'tech', '2026-11-10T11:00:00.000Z')], cr.status(items, voided).summary);
  check('a void after sign-off also makes it stale; incomplete blocks sign-off', !s.techCurrent && !s.canTechSign);
  s = cr.signoffState(done, [so(1, 'qc', '2026-11-10T11:05:00.000Z', 2), so(2, 'tech', '2026-11-10T11:06:00.000Z', 1)], sum);
  check('QC approval before the latest tech sign-off is not current', !s.qcCurrent && !s.canClose);
  const ov = { id: 9, kind: 'override', created_at: '2026-11-10T13:00:00.000Z', user_id: 2, user_name: 'Q<b>', role: 'qc_manager', justification: 'Released <script>', open_items: JSON.stringify(['Post-repair scan', 'QC approval']) };
  const html = cr.renderSignoffs(cr.signoffState(done, [ov], sum), sum);
  check('override renders justification and open items, escaped, no forms', /Closed under QC override/.test(html) && /Post-repair scan; QC approval/.test(html)
    && !/<script>|<b>/.test(html) && !/<form/.test(html));
  check('override validation: length and acknowledgement', cr.validateOverride({ justification: 'short', acknowledge: '1' }).errors.length === 1
    && cr.validateOverride({ justification: 'x'.repeat(25) }).errors.length === 1 && cr.validateOverride({ justification: 'x'.repeat(25), acknowledge: '1' }).errors.length === 0);
  const forms = (role) => cr.renderSignoffs(cr.signoffState(done, [], cr.status(cr.requiredItems(null), []).summary), cr.status(cr.requiredItems(null), []).summary,
    { forms: { csrf: '', base: '/jobs/X', user: { role } } });
  check('forms by role: technician signs only, QC sees override, service writer sees none',
    !/signoff\/override/.test(forms('technician')) && /Technician sign-off opens/.test(forms('technician'))
    && /signoff\/override/.test(forms('qc_manager')) && !/<form/.test(forms('service_writer')));
}

// ─── Record summary (top of hard copy / insurer view) ────────────────────────
{
  const items = cr.requiredItems(evalFor('Ford', 'F-150', ['FRONT_RADAR', 'MIRROR_RI:L']));
  const at = (m) => `2026-11-10T10:${String(m).padStart(2, '0')}:00.000Z`;
  const so = (id, kind, t, user_id) => ({ id, kind, created_at: t, user_id, user_name: `U${user_id}`, role: kind === 'tech' ? 'technician' : 'qc_manager', statement: cr.STATEMENTS[kind] });
  const sumOf = (records, signoffs, files = [], status = 'In Progress') => {
    const st = cr.status(items, records);
    return cr.recordSummary(st, files, cr.signoffState(records, signoffs, st.summary), status);
  };
  let sum = sumOf([], []);
  check('summary, nothing recorded: incomplete, every item open, groups split by source',
    sum.verdict === 'incomplete' && sum.openCount === items.length && sum.done === 0
    && sum.groups.map((g) => g.label).join('|') === 'OEM requirements|CollisionIQ field rules|Pre- and post-repair scans'
    && sum.groups.reduce((n, g) => n + g.total, 0) === items.length, sum.groups.map((g) => `${g.label}:${g.total}`).join());

  const full = items.map((it, i) => (it.key.startsWith('FIELD:')
    ? rec(it.key, 'not_performed', { reason: 'Mirror camera not equipped (VIN build)', created_at: at(i) })
    : rec(it.key, 'pass', { created_at: at(i) })));
  const withProof = full.filter((r) => r.result === 'pass').slice(1).map((r) => ({ calibration_id: r.id }));
  sum = sumOf(full, [], withProof);
  check('summary, all closed, no sign-off: awaiting sign-off; not performed listed with reason',
    sum.verdict === 'awaiting_signoff' && sum.openCount === 0 && sum.notPerformed.length === items.filter((x) => x.kind === 'field').length
    && sum.notPerformed.every((x) => /VIN build/.test(x.reason)));
  check('summary flags a documented item with no proof file', sum.noProof.length === 1 && sum.noProof[0] === 'Pre-repair scan', sum.noProof.join());

  sum = sumOf(full, [so(1, 'tech', at(58), 1), so(2, 'qc', at(59), 2)], withProof, 'Closed');
  check('summary, tech + QC current: complete', sum.verdict === 'complete' && sum.tech && sum.qc && !sum.samePerson);
  let html = cr.renderSummary(sum);
  check('complete summary renders verdict, counts, sign-offs and job status',
    /Documentation complete/.test(html) && /U1, 2026-11-10 10:58 UTC/.test(html) && /U2, 2026-11-10 10:59 UTC/.test(html)
    && /Job status: Closed/.test(html) && /Not performed<\/div>/.test(html) && /Documented without a proof file/.test(html) && !/>Open<\/div>/.test(html));

  const changed = [...full, rec(items[0].key, 'pass', { created_at: '2026-11-10T11:30:00.000Z' })];
  sum = sumOf(changed, [so(1, 'tech', at(58), 1), so(2, 'qc', at(59), 2)]);
  check('summary, record changed after approval: sign-offs shown out of date', sum.verdict === 'awaiting_signoff' && sum.techStale && sum.qcStale
    && /out of date/.test(cr.renderSummary(sum)));

  const failed = full.map((r) => (r.item_key === 'SCAN:POST' ? { ...r, result: 'fail' } : r));
  sum = sumOf(failed, []);
  html = cr.renderSummary(sum);
  check('summary, a failed item: incomplete, listed as open', sum.verdict === 'incomplete' && sum.open.length === 1
    && /Post-repair scan — Failed — open/.test(html) && /recsum-open-cell/.test(html));

  const ov = { id: 9, kind: 'override', created_at: at(59), user_id: 2, user_name: 'Q<b>', role: 'qc_manager', justification: 'Released <script>', open_items: '[]' };
  sum = sumOf(failed, [ov], [], 'Closed');
  html = cr.renderSummary(sum);
  check('summary, override: verdict is override with justification, escaped', sum.verdict === 'override'
    && /Closed under QC override/.test(html) && /Released &lt;script&gt;/.test(html) && !/<script>|<b>/.test(html));

  const toyota = cr.requiredItems(evalFor('Toyota', 'Camry', ['WINDSHIELD_REPLACED']));
  const tst = cr.status(toyota, [rec('ADDITIONAL:FRONT_CAMERA', 'pass', { item_name: 'Front camera aiming' })]);
  sum = cr.recordSummary(tst, [], cr.signoffState([], [], tst.summary), '');
  check('summary, scan-policy brand: partial note; SI review and additional items grouped as OEM service information',
    sum.partialRules && sum.groups.some((g) => g.label === 'From OEM service information' && g.total === 2 && g.done === 1)
    && /does not list every OEM calibration/.test(cr.renderSummary(sum)));
}

console.log(rep.failures ? `\n${rep.failures} calibration record check(s) FAILED` : '\nall calibration record checks passed');
process.exit(rep.failures ? 1 : 0);
