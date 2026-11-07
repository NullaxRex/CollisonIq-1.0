'use strict';
const register = require('./oemSourceRegister');
/**
 * CollisionIQ — OEM Calibration Trigger Rules: Honda & Acura
 * (All other makes: scan policy + sources from oemSourceRegister.js)
 * -----------------------------------------------------------------------------
 * Facts abstracted (paraphrased, not reproduced) from American Honda job aids
 * "Aiming Driving Support Systems", accessed via I-CAR RTS:
 *   Honda v12 (Aug 2025, supersedes v11 Nov 2022)
 *   Acura v7  (Aug 2025, supersedes v6  Mar 2021)
 * Model-specific OEM service information always governs. This module tells a
 * shop what the job aid requires and what to document — it does not replace SI.
 *
 * Usage:
 *   const oem = require('./utils/oemCalibrationRules');
 *   const result = oem.evaluate({
 *     make: 'Honda', model: 'Accord', year: 2021,
 *     events: ['FRONT_FASCIA_REPAIR_300MM', 'WINDSHIELD_REPLACED'],
 *     dtcs: ['P2583-54'],
 *     collisionRelated: true,
 *     equipped: { RADAR: true, CAMERA: true, BSI: true, MVCS: false },  // optional
 *     parts: { windshield: 'genuine' },                                 // optional
 *     conditions: { radarCoverPaintedOrWrapped: false }                 // optional
 *   });
 */

// -----------------------------------------------------------------------------
// Sources (stamp every result so the report shows which OEM revision applied)
// -----------------------------------------------------------------------------
const SOURCES = {
  Honda: {
    id: 'HONDA-JA-ADSS-v12',
    oem: 'Honda',
    title: 'Job Aid: Aiming Driving Support Systems',
    version: '12',
    published: '2025-08',
    supersedes: 'v11 (2022-11)',
    via: 'I-CAR RTS',
  },
  Acura: {
    id: 'ACURA-JA-ADSS-v7',
    oem: 'Acura',
    title: 'Job Aid: Aiming Driving Support Systems',
    version: '7',
    published: '2025-08',
    supersedes: 'v6 (2021-03)',
    via: 'I-CAR RTS',
  },
};

// -----------------------------------------------------------------------------
// Systems
// -----------------------------------------------------------------------------
const SYSTEMS = {
  RADAR: {
    name: 'Millimeter wave radar',
    features: ['ACC', 'CMBS', 'FCW', 'TJA'],
    scanToolRequired: true,
  },
  CAMERA: {
    name: 'Multipurpose / FCW-LDW camera',
    features: ['LKAS', 'LDW', 'RDM', 'AHB', 'FCW', 'CMBS'],
    scanToolRequired: true,
  },
  BSI: {
    name: 'Blind spot information radar',
    features: ['BSI', 'CTM'],
    scanToolRequired: false,
  },
  MVCS: {
    name: 'Multi view camera system',
    features: ['MVCS'],
    scanToolRequired: true,
  },
  LANEWATCH: {
    name: 'LaneWatch camera',
    features: ['LaneWatch'],
    scanToolRequired: false,
    makes: ['Honda'],
  },
};

// -----------------------------------------------------------------------------
// Repair events (use these IDs in the UI / estimate line mapping)
// Left = driver side, Right = passenger side (US-market vehicles)
// -----------------------------------------------------------------------------
const EVENTS = {
  // Radar
  RADAR_RI: 'Millimeter wave radar removed and installed',
  RADAR_REPLACED: 'Millimeter wave radar replaced',
  FRONT_FASCIA_REPAIR_300MM: 'Front bumper fascia repair within 300 mm of the radar',
  // Structural / SRS
  STRUCTURAL_REPAIR: 'Structural body repair (any location)',
  STRUCTURAL_REPAIR_REAR: 'Structural body repair at the rear of the vehicle',
  SRS_DEPLOYMENT: 'SRS deployment',
  // Camera / glass
  WINDSHIELD_RI: 'Windshield removed and installed',
  WINDSHIELD_REPLACED: 'Windshield replaced',
  CAMERA_RI: 'Multipurpose or FCW/LDW camera removed and installed',
  CAMERA_REPLACED: 'Multipurpose or FCW/LDW camera replaced',
  // BSI
  BSI_RI: 'BSI radar removed and installed',
  BSI_REPLACED: 'BSI radar replaced',
  BSI_REPLACED_DAMAGE: 'BSI radar replaced due to damage',
  BSI_MOUNT_PANEL_REPAIR: 'Body panel where the BSI radar mounts repaired or replaced',
  // Multi view camera
  MVCS_FRONT_CAMERA_RI: 'Multi view front camera removed/installed or replaced',
  REARVIEW_CAMERA_RI: 'Rearview camera removed/installed or replaced',
  MVCS_SIDE_CAMERA_LEFT_RI: 'Left side camera removed/installed or replaced',
  MVCS_SIDE_CAMERA_RIGHT_RI: 'Right side camera removed/installed or replaced',
  MIRROR_LEFT_RI: 'Left power mirror assembly removed/installed or replaced',
  MIRROR_RIGHT_RI: 'Right power mirror assembly removed/installed or replaced',
  MIRROR_COVER_LEFT_RI: 'Left mirror housing lower cover removed/installed or replaced',
  MIRROR_COVER_RIGHT_RI: 'Right mirror housing lower cover removed/installed or replaced',
  FRONT_BUMPER_RI: 'Front bumper removed/installed or replaced',
  FRONT_GRILLE_RI: 'Front grille removed/installed or replaced',
  DOOR_LEFT_RI: 'Driver door removed/installed or replaced',
  DOOR_RIGHT_RI: 'Front passenger door removed/installed or replaced',
  DOOR_LEFT_ADJUST: 'Driver door adjusted',
  DOOR_RIGHT_ADJUST: 'Front passenger door adjusted',
  DOOR_LEFT_COLLISION_REPAIR: 'Collision repair to the driver door',
  DOOR_RIGHT_COLLISION_REPAIR: 'Collision repair to the front passenger door',
  TAILGATE_RI: 'Tailgate removed/installed or replaced',
  TAILGATE_ADJUST: 'Tailgate adjusted',
  TRUNK_RI: 'Trunk lid removed/installed or replaced',
  TRUNK_ADJUST: 'Trunk lid adjusted',
  // LaneWatch (Honda)
  LANEWATCH_CAMERA_RI: 'LaneWatch camera removed/installed or replaced',
  // Alignment
  WHEEL_ALIGNMENT: 'Wheel alignment performed',
};

// -----------------------------------------------------------------------------
// Prerequisites
// -----------------------------------------------------------------------------
const PREREQS = {
  FOUR_WHEEL_ALIGNMENT_CHECK:
    'Four-wheel alignment check before aiming. If out of spec, correct it before any camera or radar aim.',
  ORDER_BY_VIN: 'Replacement unit ordered new using the VIN.',
  RADAR_BRACKET_DISTANCE:
    'Replaced radar: check radar-to-bracket distance and adjust with the adjusting bolts per SI (Removal & Installation).',
  RADAR_MOUNT_INSPECTION:
    'Radar not replaced: inspect radar bracket mounting position to the frame per SI (Mounting Position Inspection). A slightly bent bracket can pass visual inspection and still fail the aim.',
  GENUINE_WINDSHIELD:
    'OEM genuine replacement windshield installed. Aftermarket glass can cause aim failure or abnormal system operation.',
  BSI_MOUNT_CHECK_BEFORE_INSTALL:
    'BSI Radar Unit Mounting Area Check completed before installing the BSI radar.',
  BSI_MOUNT_CHECK_AFTER_REPAIR:
    'BSI Radar Unit Mounting Area Check completed after the repair is finished.',
  DTC_TROUBLESHOOT_FIRST:
    'Follow the DTC troubleshooting procedure first; aim only when the procedure instructs it.',
  CLEAR_OTHER_DTCS: 'All other indicated DTCs corrected before aiming, or the aim may fail.',
  MVCS_PICTURE_INSPECTION: 'Multi view camera picture inspection performed after aiming, per SI.',
};

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------
const BOTH = ['Honda', 'Acura'];
const rule = (id, system, events, extra = {}) => ({
  id,
  system,
  events,
  makes: BOTH,
  scope: 'FULL',
  collision: false,
  prereqs: [],
  ...extra,
});

const RULES = [
  // ---- Millimeter wave radar
  rule('RAD-01', 'RADAR', ['RADAR_RI'], { prereqs: ['RADAR_MOUNT_INSPECTION'] }),
  rule('RAD-02', 'RADAR', ['RADAR_REPLACED'], { prereqs: ['ORDER_BY_VIN', 'RADAR_BRACKET_DISTANCE'] }),
  rule('RAD-03', 'RADAR', ['FRONT_FASCIA_REPAIR_300MM'], { collision: true, prereqs: ['RADAR_MOUNT_INSPECTION'] }),
  rule('RAD-04', 'RADAR', ['STRUCTURAL_REPAIR', 'STRUCTURAL_REPAIR_REAR'], { collision: true, prereqs: ['RADAR_MOUNT_INSPECTION'] }),
  rule('RAD-05', 'RADAR', ['SRS_DEPLOYMENT'], { collision: true, prereqs: ['RADAR_MOUNT_INSPECTION'] }),

  // ---- Multipurpose / FCW-LDW camera
  rule('CAM-01', 'CAMERA', ['WINDSHIELD_RI']),
  rule('CAM-02', 'CAMERA', ['WINDSHIELD_REPLACED'], { prereqs: ['GENUINE_WINDSHIELD'] }),
  rule('CAM-03', 'CAMERA', ['CAMERA_RI']),
  rule('CAM-04', 'CAMERA', ['CAMERA_REPLACED'], { prereqs: ['ORDER_BY_VIN'] }),
  rule('CAM-05', 'CAMERA', ['STRUCTURAL_REPAIR', 'STRUCTURAL_REPAIR_REAR'], { collision: true }),
  rule('CAM-06', 'CAMERA', ['SRS_DEPLOYMENT'], { collision: true }),

  // ---- BSI radar (aim inspection)
  rule('BSI-01', 'BSI', ['BSI_RI']),
  rule('BSI-02', 'BSI', ['BSI_REPLACED']),
  rule('BSI-03', 'BSI', ['BSI_REPLACED_DAMAGE'], { collision: true, prereqs: ['BSI_MOUNT_CHECK_BEFORE_INSTALL'] }),
  rule('BSI-04', 'BSI', ['BSI_MOUNT_PANEL_REPAIR'], { collision: true, prereqs: ['BSI_MOUNT_CHECK_BEFORE_INSTALL'] }),
  rule('BSI-05', 'BSI', ['STRUCTURAL_REPAIR_REAR'], { collision: true, prereqs: ['BSI_MOUNT_CHECK_AFTER_REPAIR'] }),

  // ---- Multi view camera: aim only the affected camera(s)
  rule('MVC-F', 'MVCS', ['MVCS_FRONT_CAMERA_RI', 'FRONT_BUMPER_RI', 'FRONT_GRILLE_RI'], {
    scope: 'FRONT', prereqs: ['MVCS_PICTURE_INSPECTION'],
  }),
  rule('MVC-R', 'MVCS', ['REARVIEW_CAMERA_RI', 'TAILGATE_RI', 'TAILGATE_ADJUST'], {
    scope: 'REAR', prereqs: ['MVCS_PICTURE_INSPECTION'],
  }),
  rule('MVC-R-TRUNK', 'MVCS', ['TRUNK_RI', 'TRUNK_ADJUST'], {
    makes: ['Acura'], scope: 'REAR', prereqs: ['MVCS_PICTURE_INSPECTION'],
  }),
  rule('MVC-L', 'MVCS', [
    'MVCS_SIDE_CAMERA_LEFT_RI', 'MIRROR_LEFT_RI', 'MIRROR_COVER_LEFT_RI',
    'DOOR_LEFT_RI', 'DOOR_LEFT_ADJUST',
  ], { scope: 'LEFT_SIDE', prereqs: ['MVCS_PICTURE_INSPECTION'] }),
  rule('MVC-L-COL', 'MVCS', ['DOOR_LEFT_COLLISION_REPAIR'], {
    scope: 'LEFT_SIDE', collision: true, prereqs: ['MVCS_PICTURE_INSPECTION'],
  }),
  rule('MVC-RS', 'MVCS', [
    'MVCS_SIDE_CAMERA_RIGHT_RI', 'MIRROR_RIGHT_RI', 'MIRROR_COVER_RIGHT_RI',
    'DOOR_RIGHT_RI', 'DOOR_RIGHT_ADJUST',
  ], { scope: 'RIGHT_SIDE', prereqs: ['MVCS_PICTURE_INSPECTION'] }),
  rule('MVC-RS-COL', 'MVCS', ['DOOR_RIGHT_COLLISION_REPAIR'], {
    scope: 'RIGHT_SIDE', collision: true, prereqs: ['MVCS_PICTURE_INSPECTION'],
  }),

  // ---- LaneWatch (Honda only; passenger side)
  rule('LW-01', 'LANEWATCH', ['LANEWATCH_CAMERA_RI', 'MIRROR_RIGHT_RI', 'DOOR_RIGHT_RI', 'DOOR_RIGHT_ADJUST'], {
    makes: ['Honda'],
  }),
  rule('LW-02', 'LANEWATCH', ['DOOR_RIGHT_COLLISION_REPAIR'], { makes: ['Honda'], collision: true }),
];

// MVCS aim order when several cameras are required
const MVCS_ORDER = ['FRONT', 'REAR', 'LEFT_SIDE', 'RIGHT_SIDE'];

// -----------------------------------------------------------------------------
// DTC triggers — troubleshoot first, aim only when instructed
// -----------------------------------------------------------------------------
const DTCS = {
  'P2583-54': { system: 'RADAR', desc: 'Radar aiming incomplete' },
  'P2583-64': { system: 'RADAR', desc: 'Radar aiming error' },
  'P2583-97': { system: 'RADAR', desc: 'Dust or dirt on radar' },
  'B2A60-52': { system: 'CAMERA', desc: 'Dynamic camera aiming incomplete (multipurpose)' },
  'B2A60-54': { system: 'CAMERA', desc: 'Static aiming incomplete (multipurpose) / aiming incomplete (FCW-LDW)' },
  B18B8: { system: 'BSI', scope: 'LEFT', desc: 'Left BSI radar azimuth off alignment' },
  B1E68: { system: 'BSI', scope: 'RIGHT', desc: 'Right BSI radar azimuth off alignment' },
  'B14B3-54': { system: 'MVCS', desc: 'Multi view camera aiming incomplete' },
};

// -----------------------------------------------------------------------------
// Tools (equipment readiness check)
// -----------------------------------------------------------------------------
const TOOLS = {
  COMMON: ['Tape measure, min 33 ft (10 m)', 'Masking tape (blue painter\'s tape)', 'Marker or felt-tip pen'],
  RADAR: [
    '07AAJ-STKA210 Alignment Set',
    '07AAJ-TK8A100 Stand (replaces 07AAJ-STKA220)',
    '07AAJ-STKA200 Reflector Set',
    '07AAG-5R0A100 Gas Strut Holder, Short (model-dependent)',
    '07AAA-TGVA100 Radar Adjuster 3.5 mm (later models)',
  ],
  CAMERA: [
    '07AAJ-STKA210 Alignment Set',
    '07AAJ-TK8A100 Stand',
    '07AAK-5K0A110 Attachment Bracket',
    '07AAK-5K0A120 Stand Pole',
    '07AAK-5K0A100 Target Set',
    '07AAB-TYPA020 Target Holder Set (model-dependent)',
    '070AK-TYPA030 Target Set (model-dependent)',
    '07AAG-5R0A100 Gas Strut Holder, Short (model-dependent)',
  ],
  BSI: [
    '07AAJ-TK8A100 Stand',
    '07AAJ-TK8A150 Rim Frame',
    '07AAJ-STKA160 Target Set',
    '07AAJ-STKA170 Angle Gauge',
  ],
  MVCS: [
    '07AAJ-STKA210 Alignment Set',
    '070AK-SLEA110 8 Dot Target Sheet (two required)',
    '070AK-SLEA120 Mask Sheet',
    '07AAG-5R0A100 Gas Strut Holder, Short (model-dependent)',
  ],
  LANEWATCH: [
    '07AAJ-STKA210 Alignment Set',
    '070AK-T2AA100 LaneWatch Aiming Stand Set',
    '070AK-T2AA110 Aiming Marker',
    '07AAG-5R0A100 Gas Strut Holder, Short (model-dependent)',
  ],
};

// -----------------------------------------------------------------------------
// Pre-calibration attestation (each item = checkbox + timestamp + optional photo)
// -----------------------------------------------------------------------------
const ATTESTATION = {
  vehicle: [
    { id: 'V-SUSP', text: 'Suspension unmodified' },
    { id: 'V-TIRES', text: 'Tire sizes and pressures match the driver doorjamb label' },
    { id: 'V-FUEL', text: 'Fuel tank full' },
    { id: 'V-CARGO', text: 'Excess cargo removed (tool kit and spare stay)' },
    { id: 'V-DOORS', text: 'All doors closed' },
    { id: 'V-TRANS', text: 'Park (Neutral on M/T) with parking brake set' },
    { id: 'V-WHEELS', text: 'Wheels pointed straight ahead' },
    { id: 'V-CLEAR', text: 'Nothing on instrument panel, hood, or windshield' },
    { id: 'V-CLEAN', text: 'No dirt or debris around the radar or camera' },
  ],
  area: [
    { id: 'A-INDOOR', text: 'Indoors, well-lit area' },
    { id: 'A-OBSTRUCT', text: 'No poles or large toolboxes near the aiming area' },
    { id: 'A-METAL', text: 'Not in front of metal garage doors, shutters, or floor grates' },
    { id: 'A-GLARE', text: 'No bright lights, windows, reflectors, or target-like patterns behind or in front of targets' },
  ],
  // Clear-space requirements. These are NOT target placement dimensions.
  clearSpace: {
    RADAR: '10 m (33 ft) ahead × 5 m (16 ft) wide × 3 m (10 ft) high, clear',
    CAMERA: '10 m (33 ft) ahead × 5 m (16 ft) wide × 3 m (10 ft) high, clear',
    BSI: '4 m (13 ft) radius clear at each rear corner',
    MVCS: '1.5 m (5 ft) clear on all four sides',
    LANEWATCH: '6.5 m (21.3 ft) × 3.5 m (11.5 ft) clear',
  },
  systemSpecific: {
    RADAR: [{ id: 'S-RAD-STAND', text: 'Reflector stand kept out of the area until the scan tool instructs placement' }],
  },
};

// -----------------------------------------------------------------------------
// Vehicle-specific exceptions from the job aids
// -----------------------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function vehicleProfile(make, model, year) {
  const m = norm(model);
  const y = Number(year) || 0;
  const p = {
    noRadar: false,
    cameraMethod: 'PER_SI',          // PER_SI | STATIC_OR_DYNAMIC | DYNAMIC_ONLY
    bsiMethod: 'AIM_INSPECTION',     // AIM_INSPECTION | LEARNING_VALUE_RESET
    extraTools: {},
    notes: [],
  };

  if (make === 'Honda') {
    if (m === 'civic' && y === 2022) {
      p.noRadar = true;
      p.notes.push('No millimeter wave radar; radar functions are integrated into the multipurpose camera.');
    }
    if (m === 'civic' && y >= 2023) {
      p.notes.push('Job aid names only the 2022 Civic as radar-less. Confirm radar equipment in SI.');
    }
    if ((m === 'civic' && (y === 2022 || y === 2023)) || (m === 'crv' && y === 2023) || (m === 'pilot' && y === 2023)) {
      p.cameraMethod = 'STATIC_OR_DYNAMIC';
      p.bsiMethod = 'LEARNING_VALUE_RESET';
      p.notes.push('Camera may be aimed static or dynamic. Conventional BSI aim inspection not offered; use BSI Learning Value Reset per SI.');
    }
    if ((m === 'crosstour' && y >= 2013 && y <= 2015) || (m === 'odyssey' && y >= 2014 && y <= 2015)) {
      p.cameraMethod = 'DYNAMIC_ONLY';
    }
    if ((m === 'accord' && y >= 2013 && y <= 2015) || (m === 'accordhybrid' && y >= 2014 && y <= 2015)) {
      p.cameraMethod = 'STATIC_OR_DYNAMIC';
      p.extraTools.RADAR = ['07AAK-5K0A200 Reflector Set (2013-15 Accord / 2014-15 Accord Hybrid)', 'OTCHMLR10243 ACC Alignment Tool'];
      if (y === 2013 && m === 'accord') {
        p.notes.push('Early-production 2013 Accord may be dynamic-only. Confirm STATIC CAMERA AIMING appears in i-HDS before starting.');
      }
    }
    if (m === 'civichybrid') {
      p.cameraMethod = 'STATIC_OR_DYNAMIC';
      p.notes.push('Civic Hybrid FCW/LDW camera: static or dynamic (confirm year applicability in SI).');
    }
    if (m === 'ridgeline' && y >= 2017 && y <= 2023) {
      p.extraTools.BSI = ['07AAK-TM0A100 Rim Frame Extension'];
    }
    if (m === 'accord' || m === 'civic') {
      p.notes.push('Side-mounted radar on some years: an additional reference mark (Z2) is required. See SI.');
    }
  }

  if (make === 'Acura') {
    if (m === 'zdx' && y === 2013) {
      p.cameraMethod = 'DYNAMIC_ONLY';
    }
    if (m === 'mdx' || m === 'tlx') {
      p.notes.push('Radar mounted to the side behind the front grille.');
    }
  }

  return p;
}

// -----------------------------------------------------------------------------
// Evaluate a repair
// -----------------------------------------------------------------------------
function normalizeMake(make) {
  const m = norm(make);
  if (m === 'honda') return 'Honda';
  if (m === 'acura') return 'Acura';
  return null;
}

function evaluate(input = {}) {
  const make = normalizeMake(input.make);
  const scan = register.scanPolicy(input.make);

  if (!make) {
    // No encoded calibration rules: return scan policy, OEM sources and the
    // generic trigger checklist so the job is still documented against sources.
    return {
      supported: false,
      ruleDepth: 'SCAN_POLICY_ONLY',
      vehicle: { make: input.make || null, model: input.model || null, year: Number(input.year) || null },
      scanPolicy: scan,
      calibrations: [],
      genericTriggers: register.GENERIC_TRIGGERS,
      workflow: register.WORKFLOW,
      flags: [
        {
          level: 'warning',
          code: 'CAL_RULES_NOT_ENCODED',
          text: `Calibration trigger rules for ${input.make} are not encoded yet. Determine required calibrations from the VIN-specific OEM repair manual.`,
        },
        ...(scan.flags || []),
      ],
      disclaimer:
        'OEM scan policy and source links only. A clean scan does not mean no calibration is required.',
      evaluatedAt: new Date().toISOString(),
    };
  }

  const events = new Set((input.events || []).map(String));
  const unknownEvents = [...events].filter((e) => !EVENTS[e]);
  const dtcs = (input.dtcs || []).map((d) => String(d).toUpperCase().trim());
  const equipped = input.equipped || {};
  const profile = vehicleProfile(make, input.model, input.year);
  const flags = [];

  // ---- Fire rules
  const bySystem = {}; // system -> { scopes:Set, rules:[], prereqs:Set, collision:boolean }
  for (const r of RULES) {
    if (!r.makes.includes(make)) continue;
    const hits = r.events.filter((e) => events.has(e));
    if (!hits.length) continue;

    if (r.system === 'RADAR' && profile.noRadar) continue;
    if (equipped[r.system] === false) continue;

    const s = (bySystem[r.system] ||= { scopes: new Set(), rules: [], prereqs: new Set(), collision: false });
    s.scopes.add(r.scope);
    s.rules.push({ ruleId: r.id, triggeredBy: hits.map((e) => ({ event: e, label: EVENTS[e] })) });
    r.prereqs.forEach((p) => s.prereqs.add(p));
    if (r.collision) s.collision = true;
  }

  // ---- DTC actions
  const dtcActions = [];
  const unknownDtcs = [];
  for (const code of dtcs) {
    const d = DTCS[code];
    if (!d) { unknownDtcs.push(code); continue; }
    if (d.system === 'RADAR' && profile.noRadar) continue;
    const prereqs = ['DTC_TROUBLESHOOT_FIRST'];
    if (d.system === 'RADAR' || d.system === 'CAMERA') prereqs.push('CLEAR_OTHER_DTCS');
    dtcActions.push({
      dtc: code,
      system: d.system,
      description: d.desc,
      action: d.system === 'BSI' ? 'Aim inspection only when DTC procedure instructs' : 'Aim only when DTC procedure instructs',
      prerequisites: prereqs.map((id) => ({ id, text: PREREQS[id] })),
    });
  }

  // ---- Build calibration list
  const anyCollision = Object.values(bySystem).some((s) => s.collision) || (input.collisionRelated && Object.keys(bySystem).length > 0);

  const calibrations = Object.entries(bySystem).map(([system, s]) => {
    const prereqIds = [...s.prereqs];
    if (anyCollision && system !== 'MVCS' && system !== 'LANEWATCH') prereqIds.unshift('FOUR_WHEEL_ALIGNMENT_CHECK');

    let scope = [...s.scopes];
    if (system === 'MVCS') scope = MVCS_ORDER.filter((x) => s.scopes.has(x));

    let method = 'Per SI';
    if (system === 'CAMERA') {
      method = {
        PER_SI: 'Static and/or dynamic per SI',
        STATIC_OR_DYNAMIC: 'Static or dynamic (technician choice / conditions)',
        DYNAMIC_ONLY: 'Dynamic only',
      }[profile.cameraMethod];
    }
    if (system === 'BSI') {
      method = profile.bsiMethod === 'LEARNING_VALUE_RESET'
        ? 'BSI Learning Value Reset (conventional aim inspection not offered)'
        : 'Static laser aim inspection; if out of target, inspect mounting area';
    }
    if (system === 'RADAR') method = 'Vertical + horizontal adjustment with scan tool (method per SI)';
    if (system === 'MVCS') method = `Aim affected camera(s) only, in order: ${scope.join(' → ')}`;
    if (system === 'LANEWATCH') method = 'Static target, audio/navigation display + LaneWatch switch';

    const tools = [...TOOLS.COMMON, ...(TOOLS[system] || []), ...(profile.extraTools[system] || [])];

    return {
      system,
      systemName: SYSTEMS[system].name,
      affectedFeatures: SYSTEMS[system].features,
      required: true,
      scope,
      method,
      scanToolRequired: SYSTEMS[system].scanToolRequired,
      equipmentVerified: equipped[system] === true,
      reasons: s.rules,
      prerequisites: prereqIds.map((id) => ({ id, text: PREREQS[id] })),
      tools,
      clearSpace: ATTESTATION.clearSpace[system],
    };
  });

  // ---- Flags
  if (events.has('WHEEL_ALIGNMENT') && calibrations.length === 0 && dtcActions.length === 0) {
    flags.push({
      level: 'info',
      code: 'ALIGNMENT_ONLY_NO_CAL',
      text: 'Wheel alignment alone does not require camera/radar calibration unless SI for this model says otherwise.',
    });
  }
  if (input.parts && /after|non.?oem|non.?genuine/i.test(String(input.parts.windshield || ''))) {
    flags.push({ level: 'critical', code: 'AFTERMARKET_WINDSHIELD', text: PREREQS.GENUINE_WINDSHIELD });
  }
  if (input.parts && /after|non.?oem|non.?genuine/i.test(String(input.parts.grilleOrEmblem || ''))) {
    flags.push({
      level: 'warning',
      code: 'NONGENUINE_GRILLE_EMBLEM',
      text: 'Wrong grille or emblem base for the trim can obstruct the radar view.',
    });
  }
  if (input.conditions && input.conditions.radarCoverPaintedOrWrapped) {
    flags.push({
      level: 'critical',
      code: 'RADAR_COVER_PAINTED_WRAPPED',
      text: 'Radar cover or grille painted/wrapped. OEM: never paint or wrap; it obstructs the radar.',
    });
  }
  for (const c of calibrations) {
    if (equipped[c.system] === undefined) {
      flags.push({ level: 'warning', code: 'EQUIPMENT_UNVERIFIED', text: `${c.systemName}: confirm the vehicle is equipped (by VIN/build).` });
    }
  }
  (scan.flags || []).forEach((f) => flags.push(f));
  if (unknownEvents.length) flags.push({ level: 'warning', code: 'UNKNOWN_EVENTS', text: `Unrecognized events: ${unknownEvents.join(', ')}` });
  if (unknownDtcs.length) flags.push({ level: 'info', code: 'DTC_NOT_IN_RULESET', text: `DTCs not in job-aid rule set (check SI): ${unknownDtcs.join(', ')}` });

  // ---- Attestation for the systems being calibrated
  const systemsInPlay = new Set([...calibrations.map((c) => c.system), ...dtcActions.map((d) => d.system)]);
  const attestation = systemsInPlay.size
    ? {
        vehicle: ATTESTATION.vehicle,
        area: ATTESTATION.area,
        systemSpecific: [...systemsInPlay].flatMap((s) => ATTESTATION.systemSpecific[s] || []),
      }
    : null;

  return {
    supported: true,
    ruleDepth: 'FULL_TRIGGER_RULES',
    vehicle: { make, model: input.model || null, year: Number(input.year) || null },
    source: SOURCES[make],
    scanPolicy: scan,
    collisionRelated: anyCollision,
    calibrations,
    dtcActions,
    attestation,
    vehicleNotes: profile.notes,
    flags,
    disclaimer:
      'Derived from OEM job aid guidance. Model-specific OEM service information governs; the job aid itself states it may not list every repair that requires aiming.',
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = {
  SOURCES,
  SYSTEMS,
  EVENTS,
  PREREQS,
  RULES,
  DTCS,
  TOOLS,
  ATTESTATION,
  vehicleProfile,
  evaluate,
  listEvents: () => Object.entries(EVENTS).map(([id, label]) => ({ id, label })),
};
