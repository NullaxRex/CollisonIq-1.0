'use strict';
const { CAPTURED, VEHICLES } = require('./fordCalibrationMatrix');

/**
 * CollisionIQ — OEM Calibration Trigger Rules: Ford (vehicle-specific)
 * -----------------------------------------------------------------------------
 * Covers ONLY the vehicles transcribed in fordCalibrationMatrix.js (I-CAR OEM
 * Calibration Requirements Search, captured 2026-03-24):
 *   Bronco 2021–2025, Bronco Sport 2021–2025, and the 2025 F-150, F-150 Hybrid,
 *   F-150 Lightning, F-250, F-350, F-450, F-550 and F-600.
 * Every other Ford or Lincoln returns null from evaluateFord(), and the caller
 * falls back to scan policy only. Nothing here is extrapolated to other models.
 *
 * The matrix keeps I-CAR's wording verbatim. This module maps each I-CAR event
 * phrase to CollisionIQ repair events, per mounting location. An unmapped phrase
 * throws at load time, so a re-transcription can never silently drop a trigger.
 */

// -----------------------------------------------------------------------------
// Repair events (IDs used in lineItems)
// -----------------------------------------------------------------------------
const EVENTS = {
  // Windshield camera (Image Processing Module A)
  FRONT_CAMERA_RI: 'Windshield camera (IPMA) removed/installed or replaced',
  WINDSHIELD_RI: 'Windshield removed and installed',
  WINDSHIELD_REPLACED: 'Windshield replaced',
  FRONT_AIRBAG_DEPLOYMENT: 'Front airbag deployment',
  SUSPENSION_REPAIR: 'Suspension repaired',
  WHEEL_ALIGNMENT: 'Wheel alignment performed',
  TIRE_SIZE_CHANGE: 'Tire size changed',
  // Front radar (Cruise Control Module)
  FRONT_RADAR_RI: 'Front radar (Cruise Control Module) removed/installed or replaced',
  FRONT_RADAR_BRACKET_RI: 'Front radar mounting bracket removed/installed or replaced',
  COLLISION: 'Vehicle has been in a collision',
  // Front body
  FRONT_BUMPER_RI: 'Front bumper cover removed/installed or replaced',
  FRONT_BUMPER_ADJUST: 'Front bumper cover adjusted',
  FRONT_GRILLE_RI: 'Front grille removed/installed or replaced',
  FRONT_GRILLE_ADJUST: 'Front grille adjusted',
  // Cameras
  FRONT_PARKING_CAMERA_RI: 'Front parking aid camera removed/installed or replaced',
  SIDE_CAMERA_LEFT_RI: 'Left side (mirror) camera removed/installed or replaced',
  SIDE_CAMERA_RIGHT_RI: 'Right side (mirror) camera removed/installed or replaced',
  MIRROR_LEFT_RI: 'Left mirror assembly removed/installed or replaced',
  MIRROR_LEFT_ADJUST: 'Left mirror assembly adjusted',
  MIRROR_RIGHT_RI: 'Right mirror assembly removed/installed or replaced',
  MIRROR_RIGHT_ADJUST: 'Right mirror assembly adjusted',
  REAR_CAMERA_RI: 'Rear parking aid camera removed/installed or replaced',
  REAR_GATE_RI: 'Liftgate, tailgate, swing gate or deck lid removed/installed or replaced',
  REAR_GATE_ADJUST: 'Liftgate, tailgate, swing gate or deck lid adjusted',
  LIFTGATE_HANDLE_LATCH_RI: 'Liftgate handle or latch removed/installed or replaced',
  TAILGATE_HANDLE_RI: 'Tailgate handle removed/installed or replaced',
  CHMSL_CAMERA_RI: 'Center high-mounted stop lamp camera removed/installed or replaced',
  CHMSL_RI: 'Center high-mounted stop lamp removed/installed or replaced',
  CHMSL_ADJUST: 'Center high-mounted stop lamp adjusted',
  // Radar / sonar
  BLIND_SPOT_SENSOR_RI: 'Rear blind spot sensor (Side Obstacle Detection Control Module) removed/installed or replaced',
  FRONT_CORNER_SENSOR_RI: 'Front corner sensor (Side Obstacle Detection Control Module C/D) removed/installed or replaced',
  FRONT_PARKING_SENSOR_RI: 'Front parking aid sensor removed/installed or replaced',
  REAR_PARKING_SENSOR_RI: 'Rear parking aid sensor removed/installed or replaced',
  REAR_BUMPER_RI: 'Rear bumper cover removed/installed or replaced',
  // Other
  HEADLAMP_LEVELING_SENSOR_RI: 'Headlamp leveling sensor removed/installed or replaced',
};

// -----------------------------------------------------------------------------
// Location → which camera / mounting components an entry refers to
// -----------------------------------------------------------------------------
function locationKind(location) {
  const l = location.toLowerCase();
  if (l.startsWith('camera near rearview mirror')) return 'WINDSHIELD_CAMERA';
  if (l.startsWith('camera in deck lid/liftgate/tailgate')) return 'REAR_CAMERA';
  if (l.startsWith('camera in front bumper cover/grille')) return 'FRONT_CAMERA';
  if (l.startsWith('camera in side mirror (left)')) return 'SIDE_CAMERA_LEFT';
  if (l.startsWith('camera in side mirror (right)')) return 'SIDE_CAMERA_RIGHT';
  if (l.startsWith('camera in headliner/roof')) return 'CHMSL_CAMERA';
  if (l.startsWith('sensor(s) behind front bumper cover/grille (sides)')) return 'FRONT_CORNER_SENSOR';
  if (/^sensor\(s\) (in|behind) front bumper cover\/grille/.test(l)) return 'FRONT_BUMPER_SENSOR';
  if (l.startsWith('sensor(s) in quarter panel') || l.startsWith('sensor(s) in tail lamp')) return 'BLIND_SPOT_SENSOR';
  if (l.startsWith('sensor(s) in rear bumper cover')) return 'REAR_BUMPER_SENSOR';
  if (l.startsWith('sensor(s) in additional location')) return 'ADDITIONAL';
  throw new Error(`oemFordRules: unmapped I-CAR location "${location}"`);
}

const CAMERA_RI = {
  WINDSHIELD_CAMERA: ['FRONT_CAMERA_RI'],
  REAR_CAMERA: ['REAR_CAMERA_RI'],
  FRONT_CAMERA: ['FRONT_PARKING_CAMERA_RI'],
  SIDE_CAMERA_LEFT: ['SIDE_CAMERA_LEFT_RI'],
  SIDE_CAMERA_RIGHT: ['SIDE_CAMERA_RIGHT_RI'],
  CHMSL_CAMERA: ['CHMSL_CAMERA_RI'],
};

// The body component each camera is attached to (I-CAR: "any ... body component
// that camera is attached to is removed/installed, replaced, or adjusted").
const CAMERA_MOUNT = {
  REAR_CAMERA: ['REAR_GATE_RI', 'REAR_GATE_ADJUST'],
  FRONT_CAMERA: ['FRONT_BUMPER_RI', 'FRONT_BUMPER_ADJUST', 'FRONT_GRILLE_RI', 'FRONT_GRILLE_ADJUST'],
  SIDE_CAMERA_LEFT: ['MIRROR_LEFT_RI', 'MIRROR_LEFT_ADJUST'],
  SIDE_CAMERA_RIGHT: ['MIRROR_RIGHT_RI', 'MIRROR_RIGHT_ADJUST'],
  CHMSL_CAMERA: ['CHMSL_RI', 'CHMSL_ADJUST'],
};

const SENSOR_RI = {
  FRONT_BUMPER_SENSOR: { 'Cruise Control Module': ['FRONT_RADAR_RI'], 'Front Parking Aid Sensor': ['FRONT_PARKING_SENSOR_RI'] },
  FRONT_CORNER_SENSOR: ['FRONT_CORNER_SENSOR_RI'],
  BLIND_SPOT_SENSOR: ['BLIND_SPOT_SENSOR_RI'],
  REAR_BUMPER_SENSOR: ['REAR_PARKING_SENSOR_RI'],
};

function sensorEvents(kind, oemName) {
  const s = SENSOR_RI[kind];
  if (!s) return null;
  if (Array.isArray(s)) return s;
  return s[oemName] || null;
}

// -----------------------------------------------------------------------------
// I-CAR event phrase → CollisionIQ events. Returns { events, dtc, none }.
// -----------------------------------------------------------------------------
function mapPhrase(phrase, kind, oemName) {
  const p = phrase.trim();
  const out = (events) => ({ events, dtc: false, none: false });
  if (p === 'If DTC indicates') return { events: [], dtc: true, none: false };
  if (p === 'No calibration/initialization requirements found') return { events: [], dtc: false, none: true };
  if (p === 'If camera is removed/installed or replaced' && CAMERA_RI[kind]) return out(CAMERA_RI[kind]);
  if (p === 'If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted' && CAMERA_MOUNT[kind]) {
    return out([...CAMERA_RI[kind], ...CAMERA_MOUNT[kind]]);
  }
  if (p === 'If sensor is removed/installed or replaced' && sensorEvents(kind, oemName)) return out(sensorEvents(kind, oemName));
  if (p === 'If sensor mounting bracket is removed/installed or replaced' && kind === 'FRONT_BUMPER_SENSOR') return out(['FRONT_RADAR_BRACKET_RI']);
  if (p === 'If vehicle has been in a collision') return out(['COLLISION']);
  if (p === 'After front airbag deployment') return out(['FRONT_AIRBAG_DEPLOYMENT']);
  if (p === 'If suspension is repaired or aligned') return out(['SUSPENSION_REPAIR', 'WHEEL_ALIGNMENT']);
  if (p === 'If tire size is changed') return out(['TIRE_SIZE_CHANGE']);
  if (p === 'If windshield is removed/installed or replaced') return out(['WINDSHIELD_RI', 'WINDSHIELD_REPLACED']);
  if (p === 'If front bumper cover/grille is removed/installed or replaced') return out(['FRONT_BUMPER_RI', 'FRONT_GRILLE_RI']);
  if (p === 'If liftgate handle or latch is removed/installed or replaced') return out(['LIFTGATE_HANDLE_LATCH_RI']);
  if (p === 'If tailgate or tailgate handle is removed/installed or replaced') return out(['REAR_GATE_RI', 'TAILGATE_HANDLE_RI']);
  if (p === 'If high mounted stop lamp is removed/installed or replaced') return out(['CHMSL_RI']);
  if (p === 'If leveling sensor is removed/installed or replaced') return out(['HEADLAMP_LEVELING_SENSOR_RI']);
  throw new Error(`oemFordRules: unmapped I-CAR event "${p}" (${kind}, ${oemName})`);
}

// Operation checks the I-CAR note attaches to an entry with no calibration
// events ("Per the Ford Workshop manual, operation checks are required.").
// I-CAR lists no trigger for the note; CollisionIQ applies it when the sensor,
// or the bumper cover that holds it, is removed/installed or replaced.
const OPERATION_CHECK_TRIGGERS = {
  FRONT_BUMPER_SENSOR: ['FRONT_PARKING_SENSOR_RI', 'FRONT_BUMPER_RI'],
  REAR_BUMPER_SENSOR: ['REAR_PARKING_SENSOR_RI', 'REAR_BUMPER_RI'],
};
const OPERATION_CHECK_DOC_NOTE =
  'These checks set the sensor threshold values the system uses as its new baseline. Document them as a calibration procedure for insurance reimbursement.';

// -----------------------------------------------------------------------------
// Compile the matrix once at load
// -----------------------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function variantOf(location) {
  if (/\(rear view only\)/i.test(location)) return 'REAR_VIEW_ONLY';
  if (/\(with 360° view\)/i.test(location)) return 'CAMERA_360';
  return null;
}

const COMPILED = VEHICLES.map((v) => ({
  ...v,
  key: `${norm(v.model)}|${v.year}`,
  systems: v.systems.map((s, i) => {
    const kind = locationKind(s.location);
    const triggers = new Set();
    let dtcDriven = false;
    let noRequirements = false;
    for (const phrase of s.events) {
      const m = mapPhrase(phrase, kind, s.oemName);
      m.events.forEach((e) => {
        if (!EVENTS[e]) throw new Error(`oemFordRules: mapping produced unknown event ${e}`);
        triggers.add(e);
      });
      if (m.dtc) dtcDriven = true;
      if (m.none) noRequirements = true;
    }
    const operationCheck = /operation checks are required/i.test(s.note || '');
    return {
      id: `${kind}-${i + 1}`,
      kind,
      variant: variantOf(s.location),
      triggers,
      dtcDriven,
      noRequirements,
      operationCheck,
      operationCheckTriggers: operationCheck ? OPERATION_CHECK_TRIGGERS[kind] || [] : [],
      ...s,
    };
  }),
}));

const BY_KEY = new Map(COMPILED.map((v) => [v.key, v]));

// "F-250 Super Duty", "F250", "f-150 lightning" → matrix model keys
function modelKey(model) {
  let m = norm(model).replace(/superduty$/, '');
  if (m === 'f150hybrid' || m === 'f150powerboost') m = 'f150hybrid';
  return m;
}

function findVehicle(model, year) {
  const y = Number(year);
  if (!model || !Number.isInteger(y)) return null;
  return BY_KEY.get(`${modelKey(model)}|${y}`) || null;
}

const COVERAGE = [...new Set(COMPILED.map((v) => v.model))].map((model) => ({
  model,
  years: COMPILED.filter((v) => v.model === model).map((v) => v.year),
}));

function coverageText() {
  return COVERAGE.map((c) => {
    const ys = c.years;
    const span = ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}`;
    return `${c.model} ${span}`;
  }).join(', ');
}

// -----------------------------------------------------------------------------
// Evaluate a repair on a covered Ford. Returns null when the vehicle is not in
// the matrix (the caller then returns scan policy only).
// -----------------------------------------------------------------------------
function evaluateFord(input, scan) {
  const vehicle = findVehicle(input.model, input.year);
  if (!vehicle) return null;

  const events = new Set((input.events || []).map(String));
  if (input.collisionRelated === true) events.add('COLLISION');
  const unknownEvents = [...events].filter((e) => !EVENTS[e]);
  const dtcs = (input.dtcs || []).map((d) => String(d).toUpperCase().trim()).filter(Boolean);
  const equipped = input.equipped || {};
  const has360 = equipped.CAMERA_360;
  const flags = [];

  const calibrations = [];
  const operationChecks = [];
  const variantsSeen = new Set();

  for (const s of vehicle.systems) {
    if (s.variant === 'REAR_VIEW_ONLY' && has360 === true) continue;
    if (s.variant === 'CAMERA_360' && has360 === false) continue;

    const hits = [...s.triggers].filter((e) => events.has(e));
    if (hits.length) {
      if (s.variant) variantsSeen.add(s.variant);
      calibrations.push({
        system: s.id,
        systemName: s.oemName,
        location: s.location,
        variant: s.variant,
        required: true,
        reasons: hits.map((e) => ({ event: e, label: EVENTS[e] })),
        sourceEvents: s.events,
        dtcSet: s.dtcSet,
        scanToolRequired: s.scanToolRequired,
        specialToolsRequired: s.specialToolsRequired,
        ...(s.note ? { note: s.note } : {}),
      });
    }

    const opHits = s.operationCheckTriggers.filter((e) => events.has(e));
    if (opHits.length) {
      operationChecks.push({
        system: s.id,
        systemName: s.oemName,
        location: s.location,
        checks: ['Azimuth System Check', 'Elevation System Check'],
        required: true,
        reasons: opHits.map((e) => ({ event: e, label: EVENTS[e] })),
        sourceNote: s.note,
        triggerBasis: 'I-CAR lists no trigger for this note; CollisionIQ applies it when the sensor or the bumper cover holding it is removed/installed or replaced.',
        documentation: OPERATION_CHECK_DOC_NOTE,
        dtcSet: s.dtcSet,
        scanToolRequired: s.scanToolRequired,
        specialToolsRequired: s.specialToolsRequired,
      });
    }
  }

  // DTCs: I-CAR says "If DTC indicates" for these modules, without codes.
  const dtcActions = [];
  if (dtcs.length) {
    const dtcSystems = vehicle.systems.filter((s) => s.dtcDriven).map((s) => s.oemName);
    dtcActions.push({
      dtcs,
      action: 'Troubleshoot each DTC per Ford service information. Calibrate a module only when its DTC procedure directs it.',
      modulesWithDtcDrivenCalibration: [...new Set(dtcSystems)],
    });
    flags.push({
      level: 'info',
      code: 'DTC_NOT_IN_RULESET',
      text: `Ford DTC codes are not mapped to modules here. Check SI for: ${dtcs.join(', ')}`,
    });
  }

  if (variantsSeen.size && has360 === undefined) {
    flags.push({
      level: 'warning',
      code: 'CAMERA_SYSTEM_UNVERIFIED',
      text: 'Rear camera requirements differ for rear-view-only and 360° camera systems. Confirm which system the vehicle has (by VIN/build) and keep only that entry.',
    });
  }
  if (calibrations.some((c) => c.sourceEvents.some((e) => e.startsWith('If any camera')))) {
    flags.push({
      level: 'info',
      code: 'CAMERA_360_ANY_CAMERA',
      text: 'I-CAR wording for 360° cameras is "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted". If another 360° camera was also serviced, check Ford SI for whether the whole system must be calibrated.',
    });
  }
  if (events.has('COLLISION') && !calibrations.some((c) => c.reasons.some((r) => r.event === 'COLLISION'))) {
    // Only possible if the vehicle has no collision-triggered entry; say so.
    flags.push({ level: 'info', code: 'COLLISION_NO_ENTRY', text: 'No I-CAR entry for this vehicle is triggered by collision alone.' });
  }
  (scan.flags || []).forEach((f) => flags.push(f));
  if (unknownEvents.length) flags.push({ level: 'warning', code: 'UNKNOWN_EVENTS', text: `Unrecognized events: ${unknownEvents.join(', ')}` });

  return {
    supported: true,
    ruleDepth: 'VEHICLE_MATRIX',
    vehicle: { make: 'Ford', model: vehicle.model, year: vehicle.year },
    source: {
      id: `ICAR-CALV-FORD-${norm(vehicle.model).toUpperCase()}-${vehicle.year}`,
      provider: 'I-CAR OEM Calibration Requirements Search',
      title: vehicle.title,
      url: vehicle.url,
      captured: CAPTURED,
      basis: 'OEM vehicle-specific repair information (Ford), as compiled by I-CAR',
    },
    scanPolicy: scan,
    collisionRelated: events.has('COLLISION'),
    calibrations,
    operationChecks,
    dtcActions,
    flags,
    disclaimer:
      'Derived from the I-CAR OEM Calibration Requirements Search entry for this vehicle. I-CAR notes the matrix may not cover every vehicle or requirement; Ford service information governs.',
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CAPTURED,
  EVENTS,
  COVERAGE,
  coverageText,
  findVehicle,
  evaluateFord,
  listEvents: () => Object.entries(EVENTS).map(([id, label]) => ({ id, label })),
  _compiled: COMPILED,
};
