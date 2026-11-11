'use strict';
/**
 * CollisionIQ — Ford / Lincoln calibration rules from Ford's own documents
 * -----------------------------------------------------------------------------
 * Applies to every Ford and Lincoln. Nothing here comes from a third party;
 * all wording is CollisionIQ's, each rule cites the Ford document it comes from.
 *
 * Sources (Ford Motor Company; each marked "Authorized reproduction for Ford
 * and Lincoln service and repair"):
 *  JOB_AID   Ford / Lincoln "Advanced Drive Assist Systems Job Aid" (Sept 29, 2026).
 *            Component by component: the calibration routine and when it is
 *            required. These are the trigger rules below.
 *  ADAS_PS   Collision Position Statement "ADAS Integrity and Repair Technical
 *            Imperatives" (May 1, 2026; Ford and Lincoln editions). Defines
 *            ADAS-related repairs, requires calibration of affected components
 *            regardless of DTCs, names the WSM section for each sensor, and
 *            lists obstruction / modification / parts cautions.
 *  FASCIA_PS Collision Position Statement "Bumper Fascia Repair with ADAS
 *            Technology" (Oct 1, 2025). Refinish and repair limits for fascias.
 *  SCAN_PS   Lincoln "Pre- and Post-Diagnostic Scanning" (Oct 1, 2025); Ford's
 *            scan statement is in the OEM source register.
 *
 * Where the job aid is narrower than the May 2026 statement's general
 * definition, the job aid (newer, component-specific) decides the trigger, and
 * the result says so. Example: Ford requires no radar routine for a front
 * bumper cover replacement when the radar is undisturbed.
 */

const SOURCES = {
  JOB_AID: {
    id: 'FORD-JA-ADAS-2026-09-29',
    publisher: 'Ford Motor Company (Ford and Lincoln)',
    title: 'Advanced Drive Assist Systems Job Aid',
    date: '2026-09-29',
  },
  ADAS_PS: {
    id: 'FORD-PS-ADAS-INTEGRITY-2026-05-01',
    publisher: 'Ford Motor Company / Lincoln Motor Company',
    title: 'Collision Position Statement: ADAS Integrity and Repair Technical Imperatives',
    date: '2026-05-01',
    url: 'https://rts.i-car.com/images/pdf/oem-info/ford/statements/85186.pdf',
  },
  FASCIA_PS: {
    id: 'FORD-PS-BUMPER-FASCIA-ADAS-2025-10-01',
    publisher: 'Ford Motor Company',
    title: 'Collision Position Statement: Bumper Fascia Repair with ADAS Technology',
    date: '2025-10-01',
  },
  SCAN_PS_LINCOLN: {
    id: 'LINCOLN-PS-SCANNING-2025-10-01',
    publisher: 'Lincoln (Ford Motor Company)',
    title: 'Collision Repair Position Statement: Pre- and Post-Diagnostic Scanning During a Collision Repair Required',
    date: '2025-10-01',
  },
};

const SERVICE_INFO = {
  ford: 'fordserviceinfo.com',
  lincoln: 'lincolnserviceinfo.com',
};

// Repair events accepted for Ford / Lincoln. Most are common to every make
// (utils/fieldRules.js); the rest are Ford-family IDs from the job form.
const EVENTS = {
  FRONT_RADAR_RI: 'Front radar (CCM) removed/installed or replaced',
  FRONT_RADAR_BRACKET_RI: 'Front radar (CCM) bracket removed/installed or replaced',
  FRONT_BUMPER_BEAM_RI: 'Front bumper reinforcement (beam) removed/installed or replaced',
  FRONT_BUMPER_RI: 'Front bumper cover removed/installed or replaced',
  FRONT_BUMPER_ADJUST: 'Front bumper cover adjusted',
  FRONT_BUMPER_REPAIR_ON_CAR: 'Front bumper cover repaired or refinished on the vehicle',
  FRONT_FASCIA_REPAIR_300MM: 'Front bumper repair within 300 mm of the radar',
  FRONT_GRILLE_RI: 'Front grille removed/installed or replaced',
  FRONT_CAMERA_RI: 'Windshield camera (IPMA camera) removed/installed or replaced',
  WINDSHIELD_RI: 'Windshield removed and installed',
  WINDSHIELD_REPLACED: 'Windshield replaced',
  HUD_RI: 'Head-up display (HUD) removed/installed or replaced',
  INSTRUMENT_PANEL_RI: 'Instrument panel removed/installed or replaced',
  IPMA_MODULE_REPLACED: 'Image Processing Module A (IPMA) replaced',
  IPMB_MODULE_REPLACED: 'Image Processing Module B (IPMB) replaced',
  FRONT_CORNER_SENSOR_RI: 'Front corner radar (SODCMC / SODCMD) removed/installed or replaced',
  BLIND_SPOT_SENSOR_RI: 'Rear corner radar (SODL / SODR) removed/installed or replaced',
  TAIL_LAMP_LEFT_RI: 'Left tail lamp removed/installed or replaced',
  TAIL_LAMP_RIGHT_RI: 'Right tail lamp removed/installed or replaced',
  FRONT_PARKING_SENSOR_RI: 'Front parking aid sensor removed/installed or replaced',
  REAR_PARKING_SENSOR_RI: 'Rear parking aid sensor removed/installed or replaced',
  REAR_BUMPER_RI: 'Rear bumper cover removed/installed or replaced',
  REAR_BUMPER_REPAIR: 'Rear bumper cover repaired or refinished',
  REAR_BUMPER_BEAM_RI: 'Rear bumper reinforcement (beam) removed/installed or replaced',
  FRONT_PARKING_CAMERA_RI: 'Front (grille / emblem) camera removed/installed or replaced',
  SIDE_CAMERA_LEFT_RI: 'Left side (mirror) camera removed/installed or replaced',
  SIDE_CAMERA_RIGHT_RI: 'Right side (mirror) camera removed/installed or replaced',
  MIRROR_LEFT_RI: 'Left mirror assembly removed/installed or replaced',
  MIRROR_RIGHT_RI: 'Right mirror assembly removed/installed or replaced',
  MIRROR_LEFT_ADJUST: 'Left mirror assembly adjusted',
  MIRROR_RIGHT_ADJUST: 'Right mirror assembly adjusted',
  REAR_CAMERA_RI: 'Rear camera removed/installed or replaced',
  REAR_CAMERA_REPLACED: 'Rear camera replaced',
  REAR_GATE_RI: 'Tailgate, liftgate or decklid removed/installed or replaced',
  REAR_GATE_ADJUST: 'Tailgate, liftgate or decklid adjusted',
  CHMSL_RI: 'Third brake light (CHMSL) removed/installed or replaced',
  // Recorded for flags; not calibration triggers in the job aid.
  WHEEL_ALIGNMENT: 'Wheel alignment performed',
  SUSPENSION_REPAIR: 'Suspension repaired',
  TIRE_SIZE_CHANGE: 'Tire size changed',
  FRONT_AIRBAG_DEPLOYMENT: 'Front airbag deployment',
};

// ---- Trigger rules (from the job aid, in CollisionIQ wording) ---------------
// `triggers`: [event, why it counts]. `wsm`: section named in the May 2026 statement.
const RULES = [
  {
    id: 'FORD_CCM',
    name: 'Front center radar (Cruise Control Module, CCM)',
    location: 'Behind the front bumper cover',
    procedure: 'Cruise Control Radar Alignment: manual adjustment plus a dynamic routine with FDRS',
    wsm: '419-03',
    triggers: [
      ['FRONT_RADAR_RI', 'CCM replaced or removed/installed, even back in the same position'],
      ['FRONT_RADAR_BRACKET_RI', 'CCM bracket replaced or removed/installed'],
      ['FRONT_BUMPER_BEAM_RI', 'Front bumper beam replaced or removed/installed'],
    ],
  },
  {
    id: 'FORD_IPMA',
    name: 'Front windshield camera (IPMA camera)',
    location: 'Windshield, near the rearview mirror',
    procedure: 'Image Processing Module A (IPMA) Alignment: dynamic routine with FDRS',
    wsm: '419-07',
    triggers: [
      ['FRONT_CAMERA_RI', 'Camera replaced or removed/installed, even on the same windshield in the same position'],
      ['WINDSHIELD_REPLACED', 'Windshield replaced'],
      ['WINDSHIELD_RI', 'Windshield removed and installed: the camera comes off and goes back on (CollisionIQ reading of "camera removed and installed")'],
    ],
  },
  {
    id: 'FORD_HUD',
    name: 'Head-up display (HUD), where equipped',
    location: 'Instrument panel',
    procedure: 'Head Up Display (HUD) Module Configuration: static procedure to verify the projection',
    wsm: 'See WSM',
    triggers: [
      ['HUD_RI', 'HUD replaced or removed'],
      ['INSTRUMENT_PANEL_RI', 'Instrument panel replaced or removed'],
      ['WINDSHIELD_REPLACED', 'New windshield installed'],
    ],
  },
  {
    id: 'FORD_IPM_MODULE',
    name: 'ADAS module (IPMA / IPMB)',
    location: 'See WSM component location',
    procedure: 'Per the Workshop Manual',
    wsm: 'See WSM',
    triggers: [
      ['IPMA_MODULE_REPLACED', 'IPMA replaced'],
      ['IPMB_MODULE_REPLACED', 'IPMB replaced'],
    ],
  },
  {
    id: 'FORD_SOD_FRONT',
    name: 'Front corner radars (SODCMC / SODCMD)',
    location: 'Behind the front bumper cover corners',
    procedure: 'SODCMC / SODCMD Alignment: dynamic routine with FDRS',
    wsm: '419-04',
    triggers: [['FRONT_CORNER_SENSOR_RI', 'Corner radar replaced, moved or removed from the vehicle']],
    coverNote: 'front',
  },
  {
    id: 'FORD_SOD_REAR_LEFT',
    side: 'Left',
    name: 'Left rear corner radar (SODL) — BLIS',
    location: 'Left tail lamp or behind the rear bumper cover',
    procedure: 'SODL Alignment: dynamic routine with FDRS',
    wsm: '419-04',
    triggers: [
      ['BLIND_SPOT_SENSOR_RI', 'Corner radar replaced, moved or removed from the vehicle'],
      ['TAIL_LAMP_LEFT_RI', 'Tail lamp removed or replaced (tail-lamp-mounted sensors)'],
    ],
    coverNote: 'rear',
  },
  {
    id: 'FORD_SOD_REAR_RIGHT',
    side: 'Right',
    name: 'Right rear corner radar (SODR) — BLIS',
    location: 'Right tail lamp or behind the rear bumper cover',
    procedure: 'SODR Alignment: dynamic routine with FDRS',
    wsm: '419-04',
    triggers: [
      ['BLIND_SPOT_SENSOR_RI', 'Corner radar replaced, moved or removed from the vehicle'],
      ['TAIL_LAMP_RIGHT_RI', 'Tail lamp removed or replaced (tail-lamp-mounted sensors)'],
    ],
    coverNote: 'rear',
  },
  {
    id: 'FORD_PARK_FRONT',
    name: 'Front parking aid sensors (ultrasonic)',
    location: 'Front bumper cover',
    procedure: 'In-shop static checks: Azimuth System Check and Elevation System Check (elevation not required for corner sensors)',
    wsm: '413-13',
    triggers: [
      ['FRONT_PARKING_SENSOR_RI', 'Sensor replaced or removed from the bumper'],
      ['FRONT_BUMPER_RI', 'Bumper cover removed from the vehicle'],
    ],
    documentAsCalibration: true,
  },
  {
    id: 'FORD_PARK_REAR',
    name: 'Rear parking aid sensors (ultrasonic)',
    location: 'Rear bumper cover',
    procedure: 'In-shop static checks: Azimuth System Check and Elevation System Check (elevation not required for corner sensors)',
    wsm: '413-13',
    triggers: [
      ['REAR_PARKING_SENSOR_RI', 'Sensor replaced or removed from the bumper'],
      ['REAR_BUMPER_RI', 'Bumper cover removed from the vehicle'],
      ['REAR_BUMPER_BEAM_RI', 'Bumper removed from the vehicle'],
    ],
    documentAsCalibration: true,
  },
  {
    id: 'FORD_CAM_FRONT',
    name: 'Front 360° camera (grille / emblem)',
    location: 'Front grille or emblem',
    procedure: '360 Degree Camera Alignment: dynamic routine with FDRS',
    wsm: '413-13',
    triggers: [
      ['FRONT_PARKING_CAMERA_RI', 'Camera moved, removed or replaced'],
      ['FRONT_GRILLE_RI', 'Mounting component (grille) removed or replaced'],
      ['FRONT_BUMPER_RI', 'Mounting component (bumper) removed or replaced'],
      ['FRONT_BUMPER_ADJUST', 'Mounting component (bumper) moved'],
    ],
  },
  {
    id: 'FORD_CAM_LEFT',
    side: 'Left',
    name: 'Left mirror camera (360°)',
    location: 'Left side mirror',
    procedure: '360 Degree Camera Alignment: dynamic routine with FDRS',
    wsm: '413-13',
    triggers: [
      ['SIDE_CAMERA_LEFT_RI', 'Camera moved, removed or replaced'],
      ['MIRROR_LEFT_RI', 'Mounting component (mirror) removed or replaced'],
      ['MIRROR_LEFT_ADJUST', 'Mounting component (mirror) moved'],
    ],
  },
  {
    id: 'FORD_CAM_RIGHT',
    side: 'Right',
    name: 'Right mirror camera (360°)',
    location: 'Right side mirror',
    procedure: '360 Degree Camera Alignment: dynamic routine with FDRS',
    wsm: '413-13',
    triggers: [
      ['SIDE_CAMERA_RIGHT_RI', 'Camera moved, removed or replaced'],
      ['MIRROR_RIGHT_RI', 'Mounting component (mirror) removed or replaced'],
      ['MIRROR_RIGHT_ADJUST', 'Mounting component (mirror) moved'],
    ],
  },
  {
    id: 'FORD_CAM_REAR',
    name: 'Rear camera (tailgate / liftgate / decklid)',
    location: 'Tailgate, liftgate or decklid',
    procedure:
      '360° and IPMA-linked rear cameras: Rear View Parking Aid Camera Alignment (dynamic, FDRS). APIM- or BCM-linked rear cameras: Parking Aid Camera Initialization when the camera is replaced. Which one applies depends on the vehicle; see WSM.',
    wsm: '413-13',
    triggers: [
      ['REAR_CAMERA_RI', 'Camera moved, removed or replaced'],
      ['REAR_CAMERA_REPLACED', 'Camera replaced'],
      ['REAR_GATE_RI', 'Mounting component (tailgate / liftgate / decklid) removed or replaced'],
      ['REAR_GATE_ADJUST', 'Mounting component (tailgate / liftgate / decklid) moved'],
    ],
  },
];

function evaluateFordPosition(input, scan) {
  const events = new Set((input.events || []).map(String));
  const unknownEvents = [...events].filter((e) => !EVENTS[e]);
  const lincoln = /lincoln/i.test(String(input.make || ''));
  const flags = [];
  const calibrations = [];

  for (const r of RULES) {
    const hits = r.triggers.filter(([e]) => events.has(e));
    if (!hits.length) continue;
    calibrations.push({
      system: r.id,
      systemName: r.name,
      location: r.location,
      ...(r.side ? { side: r.side } : {}),
      required: true,
      whereEquipped: true,
      method: r.procedure,
      wsmSection: r.wsm,
      reasons: hits.map(([e, why]) => ({ event: e, label: EVENTS[e], why })),
      ...(r.documentAsCalibration
        ? { note: 'These checks set new sensor baseline values. Document them as a calibration procedure.' }
        : {}),
      source: 'JOB_AID',
    });
  }

  const has = (...ids) => ids.some((e) => events.has(e));

  // Front bumper cover off but the radar not touched: Ford says no CCM routine.
  if (has('FRONT_BUMPER_RI') && !has('FRONT_RADAR_RI', 'FRONT_RADAR_BRACKET_RI', 'FRONT_BUMPER_BEAM_RI')) {
    flags.push({
      level: 'info',
      code: 'FORD_CCM_UNDISTURBED',
      text: 'Ford job aid: no front radar (CCM) routine is required for a front bumper cover replacement if the CCM, its bracket and the bumper beam were not disturbed. If any of them was moved, removed or replaced, the CCM alignment applies. The CollisionIQ field rules still call for a radar test and verification.',
    });
  }
  // Corner radars that mount to a bumper cover leave the vehicle with it.
  if (has('FRONT_BUMPER_RI') && !has('FRONT_CORNER_SENSOR_RI')) {
    flags.push({
      level: 'warning',
      code: 'FORD_SOD_FRONT_COVER',
      text: 'Ford job aid: front corner radars (SODCMC / SODCMD) need alignment whenever they are moved or removed from the vehicle. If they came off with the front bumper cover, add them.',
    });
  }
  if (has('REAR_BUMPER_RI', 'REAR_BUMPER_BEAM_RI') && !has('BLIND_SPOT_SENSOR_RI')) {
    flags.push({
      level: 'warning',
      code: 'FORD_SOD_REAR_COVER',
      text: 'Ford job aid: rear corner radars (SODL / SODR) need alignment whenever they are moved or removed from the vehicle. If they mount behind the rear bumper cover and came off with it, add them.',
    });
  }
  if (has('REAR_BUMPER_RI') && !has('REAR_CAMERA_RI', 'REAR_CAMERA_REPLACED')) {
    flags.push({
      level: 'info',
      code: 'FORD_REAR_CAMERA_BUMPER',
      text: 'Ford job aid: a camera needs alignment when its mounting component is moved, removed or replaced. If this vehicle\'s rear camera mounts in the rear bumper, the bumper counts.',
    });
  }
  if (has('CHMSL_RI')) {
    flags.push({
      level: 'info',
      code: 'FORD_CHMSL_CAMERA',
      text: 'Third brake light camera (where equipped) is not listed in the Ford job aid. Check the WSM for this vehicle.',
    });
  }
  if (has('FRONT_BUMPER_RI', 'FRONT_BUMPER_REPAIR_ON_CAR', 'FRONT_FASCIA_REPAIR_300MM', 'REAR_BUMPER_RI', 'REAR_BUMPER_REPAIR')) {
    flags.push({
      level: 'warning',
      code: 'FORD_FASCIA_REPAIR_LIMITS',
      text: 'Ford bumper fascia statement (Oct 1, 2025): topcoat-only refinish up to 12 mils (300 microns) total, measured with an ultrasonic paint gauge. Ford does not approve fillers, reinforcement tape, hot staples, plastic welding or sonic welding on ADAS-equipped fascias; replace a fascia with substrate damage with a new Ford part. Ford has not validated aftermarket, recycled or reconditioned fascias.',
    });
  }
  if (has('WINDSHIELD_RI', 'WINDSHIELD_REPLACED')) {
    flags.push({
      level: 'warning',
      code: 'FORD_WINDSHIELD',
      text: "Ford ADAS statement (May 1, 2026): use a Ford-approved windshield (see Ford's glass replacement position) and keep tint and decals out of the camera's view near the mirror.",
    });
  }
  if (has('FRONT_RADAR_RI', 'FRONT_CAMERA_RI', 'FRONT_CORNER_SENSOR_RI', 'BLIND_SPOT_SENSOR_RI', 'FRONT_PARKING_SENSOR_RI', 'REAR_PARKING_SENSOR_RI',
    'FRONT_PARKING_CAMERA_RI', 'SIDE_CAMERA_LEFT_RI', 'SIDE_CAMERA_RIGHT_RI', 'REAR_CAMERA_RI', 'REAR_CAMERA_REPLACED', 'IPMA_MODULE_REPLACED', 'IPMB_MODULE_REPLACED')) {
    flags.push({
      level: 'critical',
      code: 'FORD_GENUINE_SENSORS',
      text: 'Ford ADAS statement (May 1, 2026): recycled, salvaged, aftermarket or reconditioned ADAS sensors and modules are not approved. Install Ford genuine parts.',
    });
  }
  if (has('WHEEL_ALIGNMENT', 'SUSPENSION_REPAIR', 'TIRE_SIZE_CHANGE')) {
    flags.push({
      level: 'warning',
      code: 'FORD_GEOMETRY',
      text: 'Ford ADAS statement (May 1, 2026): ADAS is validated only at the original ride height, wheel offset and suspension geometry; non-sanctioned lift or lowering kits and wheel/tire combinations are not supported. The Ford job aid does not list alignment or suspension work as a calibration trigger; check WSM 419-07 and 419-03 for this vehicle.',
    });
  }
  if (has('FRONT_AIRBAG_DEPLOYMENT')) {
    flags.push({
      level: 'info',
      code: 'FORD_AIRBAG_NOT_IN_JOB_AID',
      text: 'Airbag deployment is not a trigger in the Ford job aid. Check WSM 419-07 (windshield camera) and the SRS procedures for this vehicle.',
    });
  }
  if (calibrations.length) {
    flags.push({
      level: 'warning',
      code: 'FORD_EQUIPMENT_UNVERIFIED',
      text: 'Ford: each calibration applies where the vehicle has that sensor. Component locations vary by vehicle and trim; confirm equipment by VIN/build and the WSM component location.',
    });
  }
  flags.push({
    level: 'info',
    code: 'FORD_CALIBRATE_REGARDLESS_OF_DTC',
    text: 'Ford ADAS statement (May 1, 2026): calibrate every affected component whether or not a DTC is set; a misaligned sensor may set no code. Keep sensor fields of view clear of non-approved accessories, wraps, paint protection film, stickers and magnets.',
  });
  (scan.flags || []).forEach((f) => flags.push(f));
  if (unknownEvents.length) flags.push({ level: 'warning', code: 'UNKNOWN_EVENTS', text: `Unrecognized events: ${unknownEvents.join(', ')}` });

  return {
    supported: true,
    ruleDepth: 'OEM_JOB_AID',
    vehicle: { make: input.make, model: input.model || null, year: Number(input.year) || null },
    source: {
      ...SOURCES.JOB_AID,
      related: [SOURCES.ADAS_PS, SOURCES.FASCIA_PS, ...(lincoln ? [SOURCES.SCAN_PS_LINCOLN] : [])],
      procedures: `Ford Workshop Manual via ${lincoln ? SERVICE_INFO.lincoln : SERVICE_INFO.ford}; FDRS (2018–present) / IDS (1996–2017)`,
    },
    scanPolicy: scan,
    collisionRelated: input.collisionRelated === true,
    calibrations,
    operationChecks: [],
    dtcActions: (input.dtcs || []).length
      ? [{ dtcs: input.dtcs, action: 'Troubleshoot each DTC per the Ford Workshop Manual. A clean scan does not clear a calibration requirement.' }]
      : [],
    flags,
    disclaimer:
      "From Ford's ADAS job aid and position statements, which cover all Ford and Lincoln vehicles. Ford marks the job aid reference-only: component locations vary by vehicle and trim, and the Ford Workshop Manual governs.",
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = { SOURCES, EVENTS, RULES, evaluateFordPosition };
