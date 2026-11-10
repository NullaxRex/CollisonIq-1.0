'use strict';
/**
 * CollisionIQ — Job ADAS report (job form → rules engine → hard copy)
 * -----------------------------------------------------------------------------
 * buildJobAdas() runs the job's repairs through oemCalibrationRules.evaluate()
 * (Honda/Acura job aid, covered Fords from the I-CAR matrix, scan policy for
 * every other make, plus the CollisionIQ universal field rules). The full result
 * is stored on the job as JSON (jobs.adas_eval) and printed by renderSections().
 *
 * It also fills the older text columns (adasSystems, rationale, ...) so the job
 * list, search and any older view keep working.
 *
 * Nothing here invents a requirement: every printed line comes from the rules
 * engine, the OEM source register, or is labeled as a CollisionIQ field rule.
 */
const oemRules = require('./oemCalibrationRules');
const register = require('./oemSourceRegister');
const repairs = require('./jobRepairs');

const LIABILITY =
  'Failure to perform required ADAS calibrations after collision repair may result in system malfunction, creating safety hazards and legal liability. Always follow OEM repair procedures.';

// Register fields to print for each review item. The SRS entry's "checks" text
// carries a Honda seat-weight claim that has not been verified against the job
// aids yet, so only its source and evidence fields print.
const REVIEW_FIELDS = {
  'Structural / frame straightening': ['checks', 'sourceToConsult', 'evidenceToSave', 'limitation'],
  'Airbag/SRS deployment': ['subsystem', 'sourceToConsult', 'evidenceToSave'],
  'HV EV post-crash': ['checks', 'sourceToConsult', 'evidenceToSave', 'limitation'],
};

function reviewItems(names) {
  return names
    .map((name) => {
      const t = (register.GENERIC_TRIGGERS || []).find((g) => g.event === name);
      if (!t) return null;
      const fields = REVIEW_FIELDS[name] || ['checks', 'sourceToConsult', 'evidenceToSave'];
      return { event: t.event, ...Object.fromEntries(fields.filter((f) => t[f]).map((f) => [f, t[f]])) };
    })
    .filter(Boolean);
}

function scanText(value, policy) {
  if (!policy || !policy.found || !value) {
    return 'RECOMMENDED — No OEM scan policy on file for this make. Follow the VIN-specific OEM repair information.';
  }
  const prefix = /required|necessary|essential|mandat/i.test(value) ? 'REQUIRED' : 'RECOMMENDED';
  return `${prefix} — ${policy.brands || policy.group} scan policy: ${value}`;
}

function ruleBasis(result, make) {
  if (result.ruleDepth === 'VEHICLE_MATRIX') {
    const s = result.source;
    return { kind: 'oem', text: `${s.title} — ${s.provider}, captured ${s.captured}. ${s.basis}.`, url: s.url };
  }
  if (result.ruleDepth === 'FULL_TRIGGER_RULES') {
    const s = result.source || {};
    return { kind: 'oem', text: `${s.oem} ${s.title}, version ${s.version} (${s.published}), via ${s.via}.`, url: null };
  }
  return {
    kind: 'none',
    text: `No OEM calibration trigger rules are encoded for ${make || 'this make'}${result.vehicle && result.vehicle.model ? ` ${result.vehicle.model}` : ''}. Determine required calibrations from the VIN-specific OEM repair manual. Scan policy and the CollisionIQ field rules below still apply.`,
    url: null,
  };
}

const uniq = (a) => [...new Set(a)];
const reasonLabels = (c) =>
  uniq((c.reasons || []).flatMap((r) => (r.triggeredBy ? r.triggeredBy.map((t) => t.label) : [r.label])));

/**
 * @param {{make,model,year,repairValues:string[]}} job
 * @returns {{ result, columns, adasRequired }}
 */
function buildJobAdas({ make, model, year, repairValues }) {
  const values = repairs.normalizeValues(repairValues);
  const { events, collisionRelated, reviewEvents, family } = repairs.toEvents(values, { make, model, year });
  const y = /^\d{4}$/.test(String(year || '')) ? Number(year) : null;
  const result = make
    ? oemRules.evaluate({ make, model: model || null, year: y, events, ...(collisionRelated ? { collisionRelated: true } : {}) })
    : {
        supported: false,
        ruleDepth: 'SCAN_POLICY_ONLY',
        vehicle: { make: null, model: model || null, year: y },
        scanPolicy: { found: false },
        calibrations: [],
        verifications: require('./fieldRules').apply('', events),
        flags: [{ level: 'warning', code: 'MAKE_MISSING', text: 'No make entered. Enter the make to apply OEM rules and scan policy.' }],
      };

  result.input = { repairValues: values, repairLabels: values.map(repairs.valueLabel), events, collisionRelated, family };
  result.reviewItems = reviewItems(reviewEvents);
  result.basis = ruleBasis(result, make);

  const cals = result.calibrations || [];
  const ops = result.operationChecks || [];
  const vers = result.verifications || [];
  const scan = result.scanPolicy || {};

  const systems = [
    ...(result.ruleDepth === 'SCAN_POLICY_ONLY'
      ? [`[OEM] Calibrations not encoded for ${make || 'this make'} — determine from VIN-specific OEM service information`]
      : []),
    ...cals.map((c) => `[OEM] ${c.systemName}${c.location ? ` — ${c.location}` : ''}`),
    ...ops.map((o) => `[OEM operation check] ${o.systemName} — ${o.checks.join(', ')}`),
    ...vers.map((v) => `[CollisionIQ field rule] ${v.name}`),
  ];
  const rationale = [
    ...cals.map((c) => `${c.systemName}: triggered by ${reasonLabels(c).join('; ')}`),
    ...ops.map((o) => `${o.systemName} operation check: triggered by ${reasonLabels(o).join('; ')}`),
    ...vers.map((v) => `${v.name}: triggered by ${reasonLabels(v).join('; ')}`),
    result.basis.text,
  ];
  const notes = [
    ...(result.vehicleNotes || []),
    ...vers.filter((v) => v.makeNote).map((v) => v.makeNote),
  ];

  return {
    result,
    adasRequired: cals.length + ops.length + vers.length > 0 || result.ruleDepth === 'SCAN_POLICY_ONLY',
    columns: {
      repairsPerformed: result.input.repairLabels.join(', '),
      adasSystems: (systems.length ? systems : ['No ADAS calibration flagged for the reported repairs on this vehicle']).join('\n'),
      rationale: rationale.join('\n'),
      liabilityWarning: LIABILITY,
      makeSpecificNotes: uniq(notes).join('\n'),
      preScanRequired: scanText(scan.preRepairScan, scan),
      postScanRequired: scanText(scan.postRepairScan, scan),
      approvedScanTool: scan.tooling || 'Consult OEM service information',
    },
  };
}

// ---------------------------------------------------------------------------
// Hard copy
// ---------------------------------------------------------------------------
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? u : null);
const link = (u) => (safeUrl(u) ? ` <a class="adas-src-link" href="${esc(u)}" rel="noopener noreferrer" target="_blank">${esc(u)}</a>` : '');
const detail = (label, value) => (value ? `<div class="adas-detail"><span class="adas-detail-label">${esc(label)}</span> ${value}</div>` : '');
const list = (a) => a.map(esc).join('; ');
const SHOWN_ELSEWHERE = new Set(['FIELD_RULES_APPLIED', 'CAL_RULES_NOT_ENCODED']);

function renderCalibration(c) {
  const head = `${esc(c.systemName)}${c.location ? ` <span class="adas-loc">— ${esc(c.location)}</span>` : ''}`;
  return `<li class="adas-item adas-item-rich"><span class="adas-flag">&#9888;</span><div class="adas-body">
    <div class="adas-name">${head}</div>
    ${detail('Triggered by', list(reasonLabels(c)))}
    ${detail('Method', c.method ? esc(c.method) : '')}
    ${detail('OEM trigger wording', c.sourceEvents ? list(c.sourceEvents) : '')}
    ${detail('Note', c.note ? esc(c.note) : '')}
    ${detail('Prerequisites', c.prerequisites && c.prerequisites.length ? list(c.prerequisites.map((p) => p.text)) : '')}
    ${detail('Scan tool required', typeof c.scanToolRequired === 'boolean' ? (c.scanToolRequired ? 'Yes' : 'No') : esc(c.scanToolRequired))}
    ${detail('Special tools', c.specialToolsRequired ? esc(c.specialToolsRequired) : (c.tools && c.tools.length ? list(c.tools) : ''))}
    ${detail('Clear space', c.clearSpace ? esc(c.clearSpace) : '')}
  </div></li>`;
}

function renderOperationCheck(o) {
  return `<li class="adas-item adas-item-rich"><span class="adas-flag">&#9888;</span><div class="adas-body">
    <div class="adas-name">${esc(o.systemName)} — ${esc(o.checks.join(', '))} <span class="adas-loc">— ${esc(o.location)}</span></div>
    ${detail('Triggered by', list(reasonLabels(o)))}
    ${detail('OEM note', esc(o.sourceNote))}
    ${detail('Trigger basis', esc(o.triggerBasis))}
    ${detail('Documentation', esc(o.documentation))}
  </div></li>`;
}

function renderVerification(v) {
  return `<li class="adas-item adas-item-rich"><span class="adas-flag field-flag">&#9873;</span><div class="adas-body">
    <div class="adas-name">${esc(v.name)}</div>
    ${detail('Triggered by', list(reasonLabels(v)))}
    <div class="adas-detail">${esc(v.text)}</div>
    ${v.makeNote ? `<div class="adas-detail adas-make-note">${esc(v.makeNote)}</div>` : ''}
  </div></li>`;
}

/**
 * Sections for the job view / hard copy. `opts.insurer` omits the shop checklist.
 */
function renderSections(result, opts = {}) {
  const cals = result.calibrations || [];
  const ops = result.operationChecks || [];
  const vers = result.verifications || [];
  const basis = result.basis || {};
  const scan = result.scanPolicy || {};
  const scanSource = scan.source || {};
  const flags = (result.flags || []).filter((f) => !SHOWN_ELSEWHERE.has(f.code));

  const oemItems = cals.length
    ? cals.map(renderCalibration).join('')
    : `<li class="adas-item adas-none-rich"><span class="adas-flag">${basis.kind === 'none' ? '&#9888;' : '&#10003;'}</span><span>${
        basis.kind === 'none'
          ? 'OEM calibrations for this vehicle come from the VIN-specific OEM service information (not encoded in CollisionIQ).'
          : 'No OEM calibration is triggered by the reported repairs, per the source below.'
      }</span></li>`;

  const parts = [];
  parts.push(`<section class="doc-section"><h2 class="doc-section-title">Rule Basis</h2>
    <p class="adas-basis adas-basis-${esc(basis.kind)}">${esc(basis.text)}${link(basis.url)}</p></section>`);

  if (scan.found) {
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">Scan Policy Source</h2>
      <p class="adas-basis">${scan.scope ? `Scope: ${esc(scan.scope)}. ` : ''}Source: ${esc(scanSource.type || '')}${scanSource.updated ? `, ${esc(scanSource.updated)}` : ''}.${link(scanSource.url)}</p>
      ${scan.serviceInfo ? `<p class="adas-basis">Service information: ${esc(scan.serviceInfo)}</p>` : ''}</section>`);
  }

  parts.push(`<section class="doc-section adas-section"><h2 class="doc-section-title">OEM Calibrations Required</h2><ul class="adas-list">${oemItems}</ul></section>`);

  if (ops.length) {
    parts.push(`<section class="doc-section adas-section"><h2 class="doc-section-title">OEM Operation Checks</h2><ul class="adas-list">${ops.map(renderOperationCheck).join('')}</ul></section>`);
  }

  if (vers.length) {
    parts.push(`<section class="doc-section field-rules-section"><h2 class="doc-section-title">CollisionIQ Field Rules — Not OEM Requirements</h2>
      <p class="adas-basis">${esc(vers[0].basis)} Body work in an ADAS area calls for a calibration or, at a minimum, an extensive in-shop and on-road test and verification, because impact energy does not stop at the damaged panels.</p>
      <ul class="adas-list">${vers.map(renderVerification).join('')}</ul></section>`);
  }

  if ((result.dtcActions || []).length) {
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">DTC Actions</h2><ul class="rationale-list">${result.dtcActions
      .map((d) => `<li>${esc(d.dtc || (d.dtcs || []).join(', '))}: ${esc(d.action)}</li>`)
      .join('')}</ul></section>`);
  }

  const reviews = result.reviewItems || [];
  if (flags.length || reviews.length) {
    const flagItems = flags.map((f) => `<li class="review-${esc(f.level)}"><strong>${esc(f.level === 'critical' ? 'CRITICAL' : f.level === 'warning' ? 'Review' : 'Note')}:</strong> ${esc(f.text)}</li>`);
    const reviewLis = reviews.map((r) => `<li class="review-warning"><strong>${esc(r.event)}:</strong> ${[
      r.subsystem && `Affects ${r.subsystem}.`,
      r.checks && `${r.checks}.`,
      r.sourceToConsult && `Consult: ${r.sourceToConsult}.`,
      r.evidenceToSave && `Save: ${r.evidenceToSave}.`,
      r.limitation && `${r.limitation}.`,
    ].filter(Boolean).map(esc).join(' ')}</li>`);
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">Review Items</h2><ul class="rationale-list review-list">${[...flagItems, ...reviewLis].join('')}</ul></section>`);
  }

  if ((result.vehicleNotes || []).length) {
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">Vehicle Notes</h2><ul class="rationale-list">${result.vehicleNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>`);
  }

  if (!opts.insurer && result.attestation) {
    const a = result.attestation;
    const box = (i) => `<li><span class="attest-box">&#9744;</span> ${esc(i.text)}</li>`;
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">Pre-Calibration Checklist (OEM job aid)</h2>
      <ul class="attest-list">${[...a.vehicle, ...a.area, ...a.systemSpecific].map(box).join('')}</ul></section>`);
  }

  if (result.disclaimer) {
    parts.push(`<section class="doc-section"><h2 class="doc-section-title">Source Limits</h2><p class="adas-basis">${esc(result.disclaimer)}</p></section>`);
  }
  return parts.join('\n');
}

/** Parse the stored JSON; null for jobs saved before the new engine was wired in. */
function parseStored(json) {
  if (!json) return null;
  try {
    const r = JSON.parse(json);
    return r && typeof r === 'object' ? r : null;
  } catch (e) {
    return null;
  }
}

module.exports = { LIABILITY, buildJobAdas, renderSections, parseStored };
