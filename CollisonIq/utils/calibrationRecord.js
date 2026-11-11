'use strict';
/**
 * CollisionIQ — Calibration record (what was actually done on the job)
 * -----------------------------------------------------------------------------
 * The rules engine says what the OEM requires. This module turns that into a
 * list of required items for the job and tracks the record the shop keeps
 * against each one: result, method, the OEM service information the tech used,
 * the tool, who did it and when, and proof files (scan reports, alignment
 * printouts, photos).
 *
 * Required items:
 *   SCAN:PRE / SCAN:POST     pre- and post-repair scans (every job)
 *   SI:REVIEW                OEM service information reviewed for this VIN —
 *                            only when CollisionIQ cannot list every OEM
 *                            calibration (scan-policy-only or partial brands,
 *                            and jobs saved before the rules engine)
 *   OEM:<id>                 each OEM calibration on the job
 *   OPCHK:<id>               each OEM operation check
 *   FIELD:<id>               each CollisionIQ field rule
 * Calibrations the tech finds in OEM service information are recorded as
 * additional items (ADDITIONAL:<name>).
 *
 * An item is closed when its latest record (not voided) is a pass, or "not
 * performed" with a reason. A fail or a missing record keeps it open, and an
 * open item blocks moving the job to Calibration Complete or Closed.
 */

const RESULTS = {
  pass: 'Pass / completed',
  fail: 'Failed',
  not_performed: 'Not performed',
};
const METHODS = ['Static', 'Dynamic', 'Static and dynamic', 'Operation check', 'Scan', 'Test drive / functional test', 'Not applicable'];
const KIND_LABEL = { scan: 'Scan', si_review: 'OEM service information', oem: 'OEM requirement', field: 'CollisionIQ field rule', additional: 'From OEM service information' };

// Proof files: scan reports are usually PDFs; photos for everything else.
const PROOF_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'application/pdf': '.pdf',
};
const MAX_PROOF_FILES = 5;

const slug = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

/** Required documentation items for a job, from its stored rules-engine result. */
function requiredItems(evalResult) {
  const r = evalResult || null;
  const scanPolicy = (r && r.scanPolicy) || {};
  const items = [{
    key: 'SCAN:PRE', kind: 'scan', name: 'Pre-repair scan',
    detail: scanPolicy.found ? `${scanPolicy.brands || scanPolicy.group} policy: ${scanPolicy.preRepairScan || 'see OEM policy'}` : 'Full-system scan before repairs',
  }];
  if (!r || r.ruleDepth === 'SCAN_POLICY_ONLY' || r.coverage === 'PARTIAL') {
    items.push({
      key: 'SI:REVIEW', kind: 'si_review', name: 'OEM service information reviewed for this VIN',
      detail: 'CollisionIQ does not list every OEM calibration for this vehicle. Record the service information you checked, then add each calibration it requires below.',
    });
  }
  const seen = new Set();
  const uniqueKey = (base) => { let k = base; let n = 2; while (seen.has(k)) k = `${base}_${n++}`; seen.add(k); return k; };
  for (const c of (r && r.calibrations) || []) {
    items.push({
      key: uniqueKey(`OEM:${c.system || slug(c.systemName)}`), kind: 'oem',
      name: `${c.systemName}${c.location && !String(c.systemName).includes(c.location) ? ` — ${c.location}` : ''}`,
      detail: c.method || '',
    });
  }
  for (const o of (r && r.operationChecks) || []) {
    items.push({
      key: uniqueKey(`OPCHK:${o.system || slug(o.systemName)}`), kind: 'oem',
      name: `${o.systemName} — ${(o.checks || []).join(', ')}`, detail: o.documentation || '',
    });
  }
  for (const v of (r && r.verifications) || []) {
    items.push({ key: uniqueKey(`FIELD:${v.id}`), kind: 'field', name: v.name, detail: '' });
  }
  items.push({
    key: 'SCAN:POST', kind: 'scan', name: 'Post-repair scan',
    detail: scanPolicy.found ? `${scanPolicy.brands || scanPolicy.group} policy: ${scanPolicy.postRepairScan || 'see OEM policy'}` : 'Full-system scan after repairs and calibrations',
  });
  return items;
}

const live = (records) => records.filter((x) => !x.voided_at);
const latestFor = (records, key) => live(records).filter((x) => x.item_key === key).sort((a, b) => b.id - a.id)[0] || null;

function itemState(record) {
  if (!record) return 'missing';
  if (record.result === 'pass') return 'done';
  if (record.result === 'not_performed') return 'not_performed';
  return 'failed';
}
const CLOSED = new Set(['done', 'not_performed']);

/** Items with their latest record and state; additional items; summary counts. */
function status(items, records) {
  const rows = items.map((it) => {
    const rec = latestFor(records, it.key);
    return { ...it, record: rec, state: itemState(rec), history: records.filter((x) => x.item_key === it.key).sort((a, b) => a.id - b.id) };
  });
  const addKeys = [...new Set(live(records).filter((x) => x.item_key.startsWith('ADDITIONAL:')).map((x) => x.item_key))];
  const additional = addKeys.map((key) => {
    const rec = latestFor(records, key);
    return { key, kind: 'additional', name: rec.item_name, record: rec, state: itemState(rec), history: records.filter((x) => x.item_key === key).sort((a, b) => a.id - b.id) };
  });
  const all = [...rows, ...additional];
  const open = all.filter((x) => !CLOSED.has(x.state));
  return {
    rows, additional,
    summary: {
      required: rows.length,
      closed: rows.filter((x) => CLOSED.has(x.state)).length,
      open: open.length,
      openNames: open.map((x) => x.name),
      complete: open.length === 0,
    },
  };
}

/**
 * Validate a submitted record. `item` is the required item, or null for an
 * additional calibration. Returns { errors: [], record } with cleaned fields.
 */
function validateRecord(input, item, today = new Date()) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const kind = item ? item.kind : 'additional';
  const rec = {
    item_key: item ? item.key : `ADDITIONAL:${slug(input.item_name)}`,
    item_name: item ? item.name : s(input.item_name, 150),
    kind,
    result: s(input.result, 20),
    method: s(input.method, 40),
    si_reference: s(input.si_reference, 300),
    tool: s(input.tool, 150),
    performed_by_name: s(input.performed_by_name, 100),
    performed_on: s(input.performed_on, 10),
    reason: s(input.reason, 500),
    notes: s(input.notes, 1000),
  };
  const errors = [];
  if (!item && (!rec.item_name || rec.item_key === 'ADDITIONAL:')) errors.push('Name the calibration from the OEM service information.');
  if (!RESULTS[rec.result]) errors.push('Choose a result.');
  if (rec.method && !METHODS.includes(rec.method)) errors.push('Choose a method from the list.');
  if (!rec.performed_by_name) errors.push('Enter who performed it.');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(rec.performed_on) ? new Date(`${rec.performed_on}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) errors.push('Enter the date it was performed.');
  else if (d.getTime() > today.getTime() + 36 * 3600 * 1000) errors.push('The date cannot be in the future.');
  if (rec.result === 'not_performed' && rec.reason.length < 5) errors.push('Explain why it was not performed.');
  if (rec.result !== 'not_performed') {
    if (['oem', 'additional', 'si_review'].includes(kind) && !rec.si_reference) {
      errors.push('Enter the OEM service information used (procedure or document name, ID and date).');
    }
    if (kind === 'scan' && !rec.tool) errors.push('Enter the scan tool used.');
  }
  return { errors, record: rec };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
const STATE_LABEL = { done: 'Documented', not_performed: 'Not performed', failed: 'Failed — open', missing: 'Not documented' };

function summaryBadge(summary) {
  const cls = summary.complete ? 'green' : summary.closed > 0 ? 'orange' : 'red';
  return `<span class="badge badge-${cls}">${summary.closed}/${summary.required} documented${summary.complete ? '' : ` · ${summary.open} open`}</span>`;
}

function recordDetails(rec, files, fileUrl) {
  if (!rec) return '';
  const line = (label, value) => (value ? `<div class="calrec-detail"><span class="calrec-label">${esc(label)}</span> ${esc(value)}</div>` : '');
  const proof = (files || []).filter((f) => f.calibration_id === rec.id);
  return `${line('Result', RESULTS[rec.result])}
    ${line('Reason not performed', rec.result === 'not_performed' ? rec.reason : '')}
    ${line('Method', rec.method)}
    ${line('OEM service information', rec.si_reference)}
    ${line('Tool', rec.tool)}
    ${line('Performed', `${rec.performed_by_name}, ${rec.performed_on}`)}
    ${line('Notes', rec.notes)}
    <div class="calrec-detail"><span class="calrec-label">Proof</span> ${proof.length
      ? proof.map((f) => (fileUrl ? `<a href="${esc(fileUrl(f))}" target="_blank" rel="noopener">${esc(f.original_name || 'file')}</a>` : esc(f.original_name || 'file'))).join(', ')
      : '<span class="calrec-noproof">none attached</span>'}</div>`;
}

/**
 * The record section for the job view (shop), the printed hard copy, and the
 * insurer view. opts: { fileUrl(f), formHtml, voidForm(rec) } — forms are
 * omitted on the insurer view and hidden when printing.
 */
function renderSection(st, files, opts = {}) {
  const row = (x) => {
    const voided = (x.history || []).filter((h) => h.voided_at);
    return `<li class="calrec-item calrec-${x.state}">
      <div class="calrec-head"><span class="calrec-state">${esc(STATE_LABEL[x.state])}</span>
        <span class="calrec-name">${esc(x.name)}</span><span class="calrec-kind">${esc(KIND_LABEL[x.kind] || '')}</span></div>
      ${x.detail && !x.record ? `<div class="calrec-detail calrec-hint">${esc(x.detail)}</div>` : ''}
      ${recordDetails(x.record, files, opts.fileUrl)}
      ${x.record && opts.voidForm ? opts.voidForm(x.record) : ''}
      ${voided.length && opts.voidForm ? `<div class="calrec-detail calrec-voided no-print">${voided.length} voided record(s): ${voided.map((v) => `${esc(RESULTS[v.result])} on ${esc(v.performed_on)} — voided: ${esc(v.void_reason)}`).join('; ')}</div>` : ''}
    </li>`;
  };
  const s = st.summary;
  return `<section class="doc-section calrec-section"><h2 class="doc-section-title">Calibration Record</h2>
    <p class="adas-basis">${s.complete
      ? `All ${s.required} required items are documented.`
      : `${s.closed} of ${s.required} required items documented. Open: ${esc(s.openNames.join('; '))}.`}
      Each record shows what was done, the OEM service information used, and who did it.</p>
    <ul class="calrec-list">${st.rows.map(row).join('')}</ul>
    ${st.additional.length ? `<h3 class="calrec-subtitle">Additional calibrations from OEM service information</h3><ul class="calrec-list">${st.additional.map(row).join('')}</ul>` : ''}
    ${opts.formHtml || ''}
  </section>`;
}

/** The add-record form (job view only). `token` is the CSRF field HTML. */
function renderForm({ action, csrf, items, defaults }) {
  const openFirst = [...items].sort((a, b) => Number(a.state !== 'missing' && a.state !== 'failed') - Number(b.state !== 'missing' && b.state !== 'failed'));
  const opts = openFirst.map((x) => `<option value="${esc(x.key)}">${esc(x.state === 'done' ? '✓ ' : x.state === 'failed' ? '✗ ' : '')}${esc(x.name)}</option>`).join('');
  return `<details class="calrec-form no-print"${defaults.open ? ' open' : ''}><summary class="btn btn-primary btn-sm">+ Record a calibration, scan or check</summary>
    <form method="POST" action="${esc(action)}" enctype="multipart/form-data" class="calrec-form-body">${csrf}
      <div class="form-group"><label>Requirement</label>
        <select name="item_key" required>${opts}<option value="ADDITIONAL">Additional calibration from OEM service information…</option></select></div>
      <div class="form-group calrec-additional"><label>Additional calibration name <span class="calrec-opt">(only for an additional calibration)</span></label><input type="text" name="item_name" maxlength="150" placeholder="e.g. Rear blind spot radar alignment"></div>
      <div class="form-row-2">
        <div class="form-group"><label>Result</label><select name="result" required><option value="">Choose…</option>${Object.entries(RESULTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Method</label><select name="method"><option value="">—</option>${METHODS.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label>OEM service information used</label><input type="text" name="si_reference" maxlength="300" placeholder="Procedure or document name, ID and date"></div>
      <div class="form-row-2">
        <div class="form-group"><label>Tool</label><input type="text" name="tool" maxlength="150" placeholder="Scan tool / calibration system"></div>
        <div class="form-group"><label>Date performed</label><input type="date" name="performed_on" value="${esc(defaults.date)}" required></div>
      </div>
      <div class="form-group"><label>Performed by</label><input type="text" name="performed_by_name" maxlength="100" value="${esc(defaults.name)}" required></div>
      <div class="form-group"><label>Reason not performed <span class="calrec-opt">(required if not performed)</span></label><input type="text" name="reason" maxlength="500" placeholder="e.g. Vehicle not equipped — confirmed by VIN build"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" maxlength="1000" rows="2"></textarea></div>
      <div class="form-group"><label>Proof — scan reports, printouts, photos (up to ${MAX_PROOF_FILES}; PDF or image, 10 MB each)</label><input type="file" name="proof" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"></div>
      <button type="submit" class="btn btn-primary">Save record</button>
    </form></details>`;
}

// ---------------------------------------------------------------------------
// Sign-off, QC approval and override (patent draft sections 4.6–4.7)
// ---------------------------------------------------------------------------
// job_signoffs rows: { id, job_id, kind: 'tech' | 'qc' | 'override', user_id,
// user_name, role, statement, justification, open_items (JSON), created_at }.
// Rows are never deleted. A tech sign-off or QC approval is current only while
// the record is unchanged after it; any new or voided record makes it stale.
const STATEMENTS = {
  tech: 'I performed or directly supervised the work recorded above, following the OEM service information listed, and the record is accurate and complete.',
  qc: 'I reviewed the calibration record and its proof for this job and approve it.',
  override: 'I am closing this job with incomplete calibration documentation. This exception is permanent and appears on the job record.',
};
// Shop roles only: the record is the shop's. QC and the shop owner are the only
// approvers; platform admin can view shop jobs but never sign, approve or close.
const QC_ROLES = ['qc_manager', 'shop_admin'];
const SIGN_ROLES = ['technician', 'qc_manager', 'shop_admin'];
const MIN_JUSTIFICATION = 20;

function lastRecordChange(records) {
  let t = '';
  for (const r of records) for (const v of [r.created_at, r.voided_at]) if (v && v > t) t = v;
  return t;
}

/** Sign-off state for a job: current tech sign-off, current QC approval, overrides, and what is allowed next. */
function signoffState(records, signoffs, summary) {
  const changed = lastRecordChange(records);
  const latest = (kind) => signoffs.filter((x) => x.kind === kind).sort((a, b) => b.id - a.id)[0] || null;
  const isCurrent = (x) => Boolean(x) && x.created_at >= changed;
  const tech = latest('tech');
  const qc = latest('qc');
  const techCurrent = isCurrent(tech) ? tech : null;
  const qcCurrent = isCurrent(qc) && techCurrent && qc.id > techCurrent.id ? qc : null;
  const approveBlockers = [];
  if (!summary.complete) approveBlockers.push(`${summary.open} record item(s) open`);
  if (!techCurrent) approveBlockers.push(tech ? 'the technician sign-off is out of date (the record changed after it)' : 'no technician sign-off yet');
  return {
    tech, techCurrent, qc, qcCurrent,
    overrides: signoffs.filter((x) => x.kind === 'override').sort((a, b) => a.id - b.id),
    history: [...signoffs].sort((a, b) => a.id - b.id),
    canTechSign: summary.complete,
    canApprove: approveBlockers.length === 0,
    approveBlockers,
    canClose: Boolean(qcCurrent),
    samePerson: Boolean(qcCurrent && techCurrent && qcCurrent.user_id === techCurrent.user_id),
  };
}

/** Why a job cannot be closed normally, or null if it can. */
function closeBlocker(state, summary) {
  if (state.canClose) return null;
  if (!summary.complete) return `${summary.open} calibration record item(s) open — ${summary.openNames.join('; ')}`;
  if (!state.techCurrent) return 'the technician has not signed off on the current record';
  return 'QC has not approved the current record';
}

function validateOverride(input) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const justification = s(input.justification, 1000);
  const errors = [];
  if (justification.length < MIN_JUSTIFICATION) errors.push(`Write a justification of at least ${MIN_JUSTIFICATION} characters.`);
  if (input.acknowledge !== '1') errors.push('Check the acknowledgement box.');
  return { errors, justification };
}

const ROLE_LABEL = { technician: 'Technician', qc_manager: 'QC manager', shop_admin: 'Shop admin', platform_admin: 'Platform admin', service_writer: 'Service writer' };
const when = (iso) => String(iso || '').replace('T', ' ').slice(0, 16) + (iso ? ' UTC' : '');

/**
 * Sign-off section. opts.forms: { csrf, base, user } on the job page (forms are
 * no-print); omitted on the insurer view.
 */
function renderSignoffs(state, summary, opts = {}) {
  const who = (x) => `${esc(x.user_name)} (${esc(ROLE_LABEL[x.role] || x.role)}), ${esc(when(x.created_at))}`;
  const lines = [];
  lines.push(state.techCurrent
    ? `<li class="signoff-ok"><strong>Technician sign-off:</strong> ${who(state.techCurrent)}<div class="calrec-detail">“${esc(state.techCurrent.statement)}”</div></li>`
    : `<li class="signoff-missing"><strong>Technician sign-off:</strong> ${state.tech ? `out of date — the record changed after ${who(state.tech)}` : 'not signed'}</li>`);
  lines.push(state.qcCurrent
    ? `<li class="signoff-ok"><strong>QC approval:</strong> ${who(state.qcCurrent)}<div class="calrec-detail">“${esc(state.qcCurrent.statement)}”</div>${state.samePerson ? '<div class="calrec-detail signoff-note">Signed off and approved by the same person.</div>' : ''}</li>`
    : `<li class="signoff-missing"><strong>QC approval:</strong> ${state.qc ? `out of date — the record or technician sign-off changed after ${who(state.qc)}` : 'not approved'}</li>`);
  for (const o of state.overrides) {
    let open = [];
    try { open = JSON.parse(o.open_items || '[]'); } catch (e) { open = []; }
    lines.push(`<li class="signoff-override"><strong>Closed under QC override:</strong> ${who(o)}
      <div class="calrec-detail"><span class="calrec-label">Justification</span> ${esc(o.justification)}</div>
      <div class="calrec-detail"><span class="calrec-label">Incomplete at override</span> ${open.length ? esc(open.join('; ')) : '—'}</div></li>`);
  }

  let forms = '';
  const f = opts.forms;
  if (f) {
    const btn = (action, label, cls = 'btn btn-primary btn-sm', extra = '') => `<form method="POST" action="${esc(f.base)}/signoff/${action}" class="signoff-form">${f.csrf}${extra}<button class="${cls}">${esc(label)}</button></form>`;
    const parts = [];
    if (SIGN_ROLES.includes(f.user.role)) {
      parts.push(state.canTechSign
        ? `<div class="signoff-step"><p class="calrec-detail">“${esc(STATEMENTS.tech)}”</p>${btn('tech', state.techCurrent ? 'Sign off again as technician' : 'Sign off as technician')}</div>`
        : '<p class="calrec-detail">Technician sign-off opens when every record item is documented.</p>');
    }
    if (QC_ROLES.includes(f.user.role)) {
      parts.push(state.canApprove
        ? `<div class="signoff-step"><p class="calrec-detail">“${esc(STATEMENTS.qc)}”</p>${btn('qc', 'Approve as QC')}</div>`
        : `<p class="calrec-detail">QC approval needs: ${esc(state.approveBlockers.join('; '))}.</p>`);
      if (state.canClose) parts.push(btn('close', 'Close job'));
      else {
        parts.push(`<details class="signoff-override-form"><summary class="btn btn-sm">Close with QC override…</summary>
          <form method="POST" action="${esc(f.base)}/signoff/override" class="calrec-form-body">${f.csrf}
            <p class="calrec-detail">Use only when the documentation cannot be completed. Open now: ${esc(summary.openNames.join('; ') || 'none')}${state.techCurrent ? '' : '; technician sign-off'}${state.qcCurrent ? '' : '; QC approval'}.</p>
            <div class="form-group"><label>Justification (at least ${MIN_JUSTIFICATION} characters)</label><textarea name="justification" maxlength="1000" rows="3" required minlength="${MIN_JUSTIFICATION}"></textarea></div>
            <label class="checkbox-label"><input type="checkbox" name="acknowledge" value="1" required><span>${esc(STATEMENTS.override)}</span></label>
            <button class="btn btn-sm signoff-danger">Close with override</button>
          </form></details>`);
      }
    }
    if (parts.length) forms = `<div class="signoff-actions no-print">${parts.join('')}</div>`;
  }

  return `<section class="doc-section signoff-section"><h2 class="doc-section-title">Sign-off</h2>
    <ul class="signoff-list">${lines.join('')}</ul>${forms}</section>`;
}

module.exports = {
  RESULTS, METHODS, PROOF_EXT, MAX_PROOF_FILES, STATEMENTS, QC_ROLES, SIGN_ROLES, MIN_JUSTIFICATION,
  requiredItems, status, validateRecord, summaryBadge, renderSection, renderForm,
  lastRecordChange, signoffState, closeBlocker, validateOverride, renderSignoffs,
};
