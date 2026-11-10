'use strict';
/**
 * CollisionIQ — GM (Chevrolet, Buick, GMC, Cadillac) rules from GM's own statements
 * -----------------------------------------------------------------------------
 * Sources: General Motors Collision Position Statements, each dated Sept 18,
 * 2026 and marked "Reproduction authorized solely for service or repair of
 * General Motors vehicles". All wording here is CollisionIQ's.
 *   ADAS       "Advanced Driver Assistance Systems (ADAS)"
 *   WINDSHIELD "Windshield Replacement"
 *   FASCIA     "Bumper Fascia Repair with ADAS Technology"
 *
 * GM publishes no brand-wide trigger table (no job aid like Ford's or Honda's).
 * The statements give one brand-wide calibration trigger, for the front view
 * windshield camera; every other calibration is vehicle-specific in GM service
 * information. Results say so (coverage: 'PARTIAL').
 */

const URL_BASE = 'https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/';
const SOURCES = {
  ADAS: { title: 'Collision Position Statement: Advanced Driver Assistance Systems (ADAS)', date: '2026-09-18', url: `${URL_BASE}advanced-driver-assistance-systems-consideration.pdf` },
  WINDSHIELD: { title: 'Collision Position Statement: Windshield Replacement', date: '2026-09-18', url: `${URL_BASE}windshield-replacement.pdf` },
  FASCIA: { title: 'Collision Position Statement: Bumper Fascia Repair with ADAS Technology', date: '2026-09-18', url: `${URL_BASE}bumper-fascia-with-adas.pdf` },
};

// Events GM rules read. Most are common to every make (utils/fieldRules.js).
const EVENTS = {
  FRONT_CAMERA_RI: 'Front view windshield camera removed/installed or replaced',
  WINDSHIELD_RI: 'Windshield removed and installed',
  WINDSHIELD_REPLACED: 'Windshield replaced',
  FRONT_BUMPER_RI: 'Front bumper cover removed/installed or replaced',
  FRONT_BUMPER_REPAIR_ON_CAR: 'Front bumper cover repaired or refinished on the vehicle',
  FRONT_FASCIA_REPAIR_300MM: 'Front bumper repair near the radar',
  REAR_BUMPER_RI: 'Rear bumper cover removed/installed or replaced',
  REAR_BUMPER_REPAIR: 'Rear bumper cover repaired or refinished',
  FRONT_RADAR_RI: 'Front radar removed/installed or replaced',
  FRONT_RADAR_BRACKET_RI: 'Front radar bracket removed/installed or replaced',
  FRONT_CORNER_SENSOR_RI: 'Front corner sensor removed/installed or replaced',
  BLIND_SPOT_SENSOR_RI: 'Blind spot sensor removed/installed or replaced',
  FRONT_PARKING_SENSOR_RI: 'Front parking sensor removed/installed or replaced',
  REAR_PARKING_SENSOR_RI: 'Rear parking sensor removed/installed or replaced',
  REAR_CAMERA_RI: 'Rear camera removed/installed or replaced',
  SIDE_CAMERA_LEFT_RI: 'Left side camera removed/installed or replaced',
  SIDE_CAMERA_RIGHT_RI: 'Right side camera removed/installed or replaced',
  // Recorded for flags only.
  WHEEL_ALIGNMENT: 'Wheel alignment performed',
  SUSPENSION_REPAIR: 'Suspension repaired',
  TIRE_SIZE_CHANGE: 'Tire size changed',
};

const GM_MAKES = ['chevrolet', 'chevy', 'gmc', 'buick', 'cadillac'];
const isGm = (make) => GM_MAKES.includes(String(make || '').toLowerCase().replace(/[^a-z]/g, ''));

function evaluateGmPosition(input, scan) {
  const events = new Set((input.events || []).map(String));
  const has = (...ids) => ids.some((e) => events.has(e));
  const calibrations = [];
  const flags = [];

  const camHits = [
    ['FRONT_CAMERA_RI', 'Front view windshield camera removed, reinstalled or replaced'],
    ['WINDSHIELD_REPLACED', 'Windshield removed and replaced'],
    ['WINDSHIELD_RI', 'Windshield removed and replaced (reinstalled)'],
  ].filter(([e]) => events.has(e));
  if (camHits.length) {
    calibrations.push({
      system: 'GM_FRONT_CAMERA',
      systemName: 'Front view windshield camera',
      location: 'Windshield',
      required: true,
      whereEquipped: true,
      method: 'Service point calibration / learn procedure per GM service information for this vehicle',
      reasons: camHits.map(([e, why]) => ({ event: e, label: EVENTS[e], why })),
      source: 'WINDSHIELD',
    });
  }

  flags.push({
    level: 'warning',
    code: 'GM_OTHER_CALIBRATIONS_IN_SI',
    text: 'GM publishes no brand-wide calibration table. Apart from the windshield camera, required calibrations are vehicle-specific: determine them from GM service information (SI) for this VIN.',
  });
  if (has('WINDSHIELD_RI', 'WINDSHIELD_REPLACED')) {
    flags.push({
      level: 'critical',
      code: 'GM_OE_GLASS',
      text: 'GM windshield statement (Sept 18, 2026): GM prohibits aftermarket or non-GM OE glass for windshield replacement. Do not cover or modify the windshield blackout area.',
    });
  }
  if (has('FRONT_BUMPER_RI', 'FRONT_BUMPER_REPAIR_ON_CAR', 'FRONT_FASCIA_REPAIR_300MM', 'REAR_BUMPER_RI', 'REAR_BUMPER_REPAIR')) {
    flags.push({
      level: 'warning',
      code: 'GM_FASCIA_REPAIR_LIMITS',
      text: 'GM bumper fascia statement (Sept 18, 2026): on ADAS-equipped bumpers, refinish only, with total paint no more than 13 mils anywhere on the cover, verified with a non-metallic paint film gauge. Any substrate damage (gouges, tears) means replace; no filler or reinforcement tape. GM prohibits aftermarket, reconditioned and salvage fascias. ADAS sensors may be mounted to the inside of the cover, out of sight.',
    });
  }
  if (has('FRONT_CAMERA_RI', 'FRONT_RADAR_RI', 'FRONT_RADAR_BRACKET_RI', 'FRONT_CORNER_SENSOR_RI', 'BLIND_SPOT_SENSOR_RI', 'FRONT_PARKING_SENSOR_RI',
    'REAR_PARKING_SENSOR_RI', 'REAR_CAMERA_RI', 'SIDE_CAMERA_LEFT_RI', 'SIDE_CAMERA_RIGHT_RI')) {
    flags.push({
      level: 'critical',
      code: 'GM_GENUINE_ADAS_PARTS',
      text: 'GM ADAS statement (Sept 18, 2026): only new GM Genuine ADAS components are approved, including radars, cameras, sensors, control modules, wiring, brackets and mounting hardware. Salvaged, recycled, reconditioned, remanufactured and aftermarket ADAS parts are prohibited.',
    });
  }
  if (has('WHEEL_ALIGNMENT', 'SUSPENSION_REPAIR', 'TIRE_SIZE_CHANGE')) {
    flags.push({
      level: 'warning',
      code: 'GM_MODIFICATIONS',
      text: 'GM ADAS statement (Sept 18, 2026): non-genuine lift or lowering kits, wheels, tires, suspension or steering parts that change ride height, alignment angles or handling are not recommended; they can degrade ADAS features. Check GM SI for calibration after alignment or suspension work on this vehicle.',
    });
  }
  flags.push({
    level: 'info',
    code: 'GM_ACCESSORIES',
    text: 'GM ADAS statement (Sept 18, 2026): protective covers or film, wraps, stickers, window tint, magnets, hood protectors, push bars, bike or cargo racks, light bars and oversized roof cargo can all affect ADAS performance.',
  });
  (scan.flags || []).forEach((f) => flags.push(f));

  return {
    supported: true,
    ruleDepth: 'OEM_POSITION_STATEMENT',
    coverage: 'PARTIAL',
    vehicle: { make: input.make, model: input.model || null, year: Number(input.year) || null },
    source: {
      publisher: 'General Motors',
      title: SOURCES.WINDSHIELD.title,
      date: SOURCES.WINDSHIELD.date,
      related: [SOURCES.ADAS, SOURCES.FASCIA],
      procedures: 'GM service information (SI); GDS2 / Techline',
    },
    scanPolicy: scan,
    collisionRelated: input.collisionRelated === true,
    calibrations,
    operationChecks: [],
    dtcActions: [],
    flags,
    disclaimer:
      "From General Motors' collision position statements (Sept 18, 2026). They state one brand-wide calibration trigger, the windshield camera; all other calibration requirements are vehicle-specific in GM service information.",
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = { SOURCES, EVENTS, isGm, evaluateGmPosition };
