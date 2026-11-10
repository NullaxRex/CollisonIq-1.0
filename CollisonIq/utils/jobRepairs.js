'use strict';
/**
 * CollisionIQ — Job form repair options → rules-engine repair events
 * -----------------------------------------------------------------------------
 * Each checkbox on the job form maps to the repair event IDs that
 * oemCalibrationRules.evaluate() understands. Most IDs are common to every make
 * (utils/fieldRules.js EVENTS / ALIASES). Where Honda/Acura (job aid) or a
 * Ford / Lincoln (Ford job aid) uses its own ID for the same work, `honda` / `ford`
 * override the default list.
 *
 * Form values: "KEY" for one-sided items, "KEY:L" / "KEY:R" for sided ones.
 * Sided event templates use {S}, replaced with LEFT or RIGHT.
 *
 * Jobs saved before Nov 2026 stored only the old checkbox labels; LEGACY maps
 * those labels to the closest current options so the job can be re-evaluated.
 */

const GROUPS = [
  {
    id: 'front',
    title: 'Front end',
    options: [
      { key: 'FRONT_DAMAGE', label: 'Front collision damage (any — incl. fender hit or minor bumper contact)', events: ['FRONT_COLLISION_DAMAGE'], collision: true },
      { key: 'FRONT_BUMPER_RI', label: 'Front bumper cover R&I / replaced', events: ['FRONT_BUMPER_RI'] },
      { key: 'FRONT_BUMPER_ADJUST', label: 'Front bumper cover adjusted', events: ['FRONT_BUMPER_ADJUST'] },
      { key: 'FRONT_BUMPER_REPAIR', label: 'Front bumper repaired / refinished on car', events: ['FRONT_BUMPER_REPAIR_ON_CAR'] },
      { key: 'FRONT_FASCIA_300MM', label: 'Front bumper repair within 300 mm of radar', events: ['FRONT_FASCIA_REPAIR_300MM'] },
      { key: 'FRONT_GRILLE', label: 'Grille R&I / replaced', events: ['FRONT_GRILLE_RI'] },
      { key: 'FRONT_RADAR', label: 'Front radar R&I / replaced', events: ['FRONT_RADAR_RI'], honda: ['RADAR_RI'] },
      { key: 'FRONT_RADAR_BRACKET', label: 'Front radar bracket R&I / replaced', events: ['FRONT_RADAR_BRACKET_RI'] },
      { key: 'FRONT_BEAM', label: 'Front bumper reinforcement (beam) R&I / replaced', events: ['FRONT_BUMPER_BEAM_RI'] },
      { key: 'FRONT_PARKING_CAMERA', label: 'Front (grille / bumper) camera R&I / replaced', events: [], honda: ['MVCS_FRONT_CAMERA_RI'], ford: ['FRONT_PARKING_CAMERA_RI'] },
      { key: 'FRONT_PARKING_SENSOR', label: 'Front parking sensor R&I / replaced', events: ['FRONT_PARKING_SENSOR_RI'] },
      { key: 'FRONT_CORNER_SENSOR', label: 'Front corner sensor R&I / replaced', events: ['FRONT_CORNER_SENSOR_RI'] },
    ],
  },
  {
    id: 'glass',
    title: 'Windshield and front camera',
    options: [
      { key: 'WINDSHIELD_REPLACED', label: 'Windshield replaced', events: ['WINDSHIELD_REPLACED'] },
      { key: 'WINDSHIELD_RI', label: 'Windshield R&I', events: ['WINDSHIELD_RI'] },
      { key: 'FRONT_CAMERA', label: 'Windshield camera R&I / replaced', events: ['FRONT_CAMERA_RI'], honda: ['CAMERA_RI'] },
    ],
  },
  {
    id: 'sides',
    title: 'Doors, mirrors and sides — check the side worked on',
    options: [
      { key: 'FRONT_DOOR_RI', label: 'Front door R&I / replaced', sided: true, events: ['DOOR_{S}_RI'] },
      { key: 'FRONT_DOOR_ADJUST', label: 'Front door adjusted', sided: true, events: ['DOOR_{S}_ADJUST'] },
      { key: 'FRONT_DOOR_REPAIR', label: 'Front door collision repair', sided: true, events: ['DOOR_{S}_COLLISION_REPAIR'] },
      { key: 'REAR_DOOR', label: 'Rear door R&I / repaired / adjusted', sided: true, events: ['REAR_DOOR_{S}_RI'] },
      { key: 'MIRROR_RI', label: 'Mirror R&I / replaced', sided: true, events: ['MIRROR_{S}_RI'] },
      { key: 'MIRROR_ADJUST', label: 'Mirror adjusted', sided: true, events: ['MIRROR_{S}_ADJUST'] },
      { key: 'SIDE_CAMERA', label: 'Side (mirror) camera R&I / replaced', sided: true, events: ['SIDE_CAMERA_{S}_RI'], honda: ['MVCS_SIDE_CAMERA_{S}_RI'] },
      { key: 'FENDER', label: 'Fender repaired / replaced / pulled', sided: true, events: ['FENDER_{S}_REPAIR'] },
      { key: 'SIDE_PANEL', label: 'Quarter panel / rocker repaired or replaced', sided: true, events: ['SIDE_PANEL_{S}_REPAIR'] },
      { key: 'TAIL_LAMP', label: 'Tail lamp R&I / replaced', sided: true, events: ['TAIL_LAMP_{S}_RI'] },
      { key: 'BLIND_SPOT_SENSOR', label: 'Rear blind spot sensor R&I / replaced', events: ['BLIND_SPOT_SENSOR_RI'], honda: ['BSI_RI'] },
    ],
  },
  {
    id: 'rear',
    title: 'Rear end',
    options: [
      { key: 'REAR_DAMAGE', label: 'Rear collision damage (any)', events: ['REAR_COLLISION_DAMAGE'], collision: true },
      { key: 'REAR_BUMPER_RI', label: 'Rear bumper cover R&I / replaced', events: ['REAR_BUMPER_RI'] },
      { key: 'REAR_BUMPER_REPAIR', label: 'Rear bumper repaired / refinished on car', events: ['REAR_BUMPER_REPAIR'] },
      { key: 'REAR_BEAM', label: 'Rear bumper reinforcement (beam) R&I / replaced', events: ['REAR_BUMPER_BEAM_RI'] },
      { key: 'LIFTGATE_RI', label: 'Liftgate / tailgate R&I / replaced', events: ['REAR_GATE_RI'], honda: ['TAILGATE_RI'] },
      { key: 'LIFTGATE_ADJUST', label: 'Liftgate / tailgate adjusted', events: ['REAR_GATE_ADJUST'], honda: ['TAILGATE_ADJUST'] },
      { key: 'TRUNK_RI', label: 'Trunk lid R&I / replaced', events: ['REAR_GATE_RI'], honda: ['TRUNK_RI'] },
      { key: 'TRUNK_ADJUST', label: 'Trunk lid adjusted', events: ['REAR_GATE_ADJUST'], honda: ['TRUNK_ADJUST'] },
      { key: 'REAR_HANDLE_LATCH', label: 'Liftgate / tailgate / trunk handle or latch R&I', events: ['REAR_GATE_HANDLE_LATCH_RI'] },
      { key: 'REAR_CAMERA', label: 'Rear camera R&I / replaced', events: ['REAR_CAMERA_RI'], honda: ['REARVIEW_CAMERA_RI'] },
      { key: 'REAR_PARKING_SENSOR', label: 'Rear parking sensor R&I / replaced', events: ['REAR_PARKING_SENSOR_RI'] },
      { key: 'CHMSL', label: 'Third brake light (CHMSL) R&I / replaced', events: [], ford: ['CHMSL_RI'] },
    ],
  },
  {
    id: 'other',
    title: 'Structural, mechanical and other',
    options: [
      { key: 'STRUCTURAL_FRONT', label: 'Structural repair — front', events: [], honda: ['STRUCTURAL_REPAIR'], collision: true, review: 'Structural / frame straightening' },
      { key: 'STRUCTURAL_REAR', label: 'Structural repair — rear', events: [], honda: ['STRUCTURAL_REPAIR_REAR'], collision: true, review: 'Structural / frame straightening' },
      { key: 'SRS', label: 'Airbag / SRS deployment', events: [], honda: ['SRS_DEPLOYMENT'], ford: ['FRONT_AIRBAG_DEPLOYMENT'], collision: true, review: 'Airbag/SRS deployment' },
      { key: 'HUD', label: 'Head-up display R&I / replaced', events: [], ford: ['HUD_RI'] },
      { key: 'INSTRUMENT_PANEL', label: 'Instrument panel R&I / replaced', events: [], ford: ['INSTRUMENT_PANEL_RI'] },
      { key: 'ALIGNMENT', label: 'Wheel alignment', events: [], honda: ['WHEEL_ALIGNMENT'], ford: ['WHEEL_ALIGNMENT'] },
      { key: 'SUSPENSION', label: 'Suspension repair', events: [], ford: ['SUSPENSION_REPAIR'] },
      { key: 'TIRE_SIZE', label: 'Tire size changed', events: [], ford: ['TIRE_SIZE_CHANGE'] },
      { key: 'BATTERY', label: '12V battery disconnected', events: ['BATTERY_DISCONNECT'] },
      { key: 'EV_HYBRID', label: 'EV / hybrid vehicle', events: [], review: 'HV EV post-crash' },
      { key: 'OTHER', label: 'Other', events: [] },
    ],
  },
];

const OPTIONS = GROUPS.flatMap((g) => g.options);
const BY_KEY = new Map(OPTIONS.map((o) => [o.key, o]));
const SIDES = { L: { word: 'Left', id: 'LEFT' }, R: { word: 'Right', id: 'RIGHT' } };

// Old checkbox labels (before Nov 2026) → current values.
const LEGACY = {
  'Windshield': ['WINDSHIELD_REPLACED'],
  'Front Camera Area': ['FRONT_CAMERA'],
  'Front Bumper': ['FRONT_BUMPER_RI'],
  'Rear Bumper': ['REAR_BUMPER_RI'],
  'Radar': ['FRONT_RADAR'],
  'Structural Body Repair': ['STRUCTURAL_FRONT'],
  'Airbag / SRS Deployment': ['SRS'],
  'Wheel Alignment': ['ALIGNMENT'],
  'Suspension': ['SUSPENSION'],
  'Door / Mirror Repair': ['FRONT_DOOR_REPAIR:L', 'FRONT_DOOR_REPAIR:R'],
  'EV / Hybrid Vehicle': ['EV_HYBRID'],
  'Other': ['OTHER'],
};

/** Parse one form value; returns { option, side } or null. */
function parseValue(v) {
  const [key, side] = String(v || '').split(':');
  const option = BY_KEY.get(key);
  if (!option) return null;
  if (option.sided) return SIDES[side] ? { option, side } : null;
  return side === undefined ? { option, side: null } : null;
}

/** Display label stored on the job and printed (never contains a comma). */
function valueLabel(v) {
  const p = parseValue(v);
  if (!p) return null;
  return p.side ? `${p.option.label} (${SIDES[p.side].word})` : p.option.label;
}

/**
 * Clean a submitted list of values. Old labels are converted; anything unknown
 * is dropped. Returns de-duplicated values in form order.
 */
function normalizeValues(values) {
  const out = [];
  for (const raw of values || []) {
    const v = String(raw).trim();
    const list = LEGACY[v] || [v];
    for (const x of list) if (parseValue(x) && !out.includes(x)) out.push(x);
  }
  const order = OPTIONS.flatMap((o) => (o.sided ? [`${o.key}:L`, `${o.key}:R`] : [o.key]));
  return out.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Rule family for the vehicle: 'honda', 'ford' (covered models only) or 'default'. */
function family(make, model, year) {
  const m = String(make || '').toLowerCase().replace(/[^a-z]/g, '');
  if (m === 'honda' || m === 'acura') return 'honda';
  if (m === 'ford' || m === 'lincoln') return 'ford';
  return 'default';
}

/**
 * Turn form values into the evaluate() input for this vehicle.
 * Returns { events, collisionRelated, reviewEvents }.
 */
function toEvents(values, { make, model, year } = {}) {
  const fam = family(make, model, year);
  const events = [];
  const reviewEvents = [];
  let collisionRelated = false;
  for (const v of normalizeValues(values)) {
    const { option, side } = parseValue(v);
    const templates = option[fam] || option.events;
    for (const t of templates) {
      const e = side ? t.replace('{S}', SIDES[side].id) : t;
      if (!events.includes(e)) events.push(e);
    }
    if (option.collision) collisionRelated = true;
    if (option.review && !reviewEvents.includes(option.review)) reviewEvents.push(option.review);
  }
  return { events, collisionRelated, reviewEvents, family: fam };
}

module.exports = { GROUPS, OPTIONS, LEGACY, parseValue, valueLabel, normalizeValues, family, toEvents };
