'use strict';
/**
 * CollisionIQ — Universal field rules (all makes)
 * -----------------------------------------------------------------------------
 * Shop rules from the founder (I-CAR PL3 ADAS technician). They are NOT OEM
 * requirements. They apply to every make and model, on top of whatever the OEM
 * rules return, including when OEM information lists no calibration or says
 * requirements vary by model.
 *
 * Core principle: body work in an ADAS area calls for a calibration or, at a
 * minimum, an extensive in-shop and on-road test and verification. Impact
 * energy does not stop at the damaged panels.
 *
 * Each result goes in `verifications`, with the events that triggered it.
 */

// Repair events every make accepts. A make whose own rules also use an ID
// (e.g. Honda DOOR_LEFT_RI, Ford REAR_GATE_RI) still receives it.
const EVENTS = {
  // Doors, mirrors, side panels, fenders
  DOOR_LEFT_RI: 'Driver door removed/installed or replaced',
  DOOR_RIGHT_RI: 'Front passenger door removed/installed or replaced',
  DOOR_LEFT_ADJUST: 'Driver door adjusted',
  DOOR_RIGHT_ADJUST: 'Front passenger door adjusted',
  DOOR_LEFT_COLLISION_REPAIR: 'Collision repair to the driver door',
  DOOR_RIGHT_COLLISION_REPAIR: 'Collision repair to the front passenger door',
  REAR_DOOR_LEFT_RI: 'Left rear door removed/installed, replaced, adjusted or repaired',
  REAR_DOOR_RIGHT_RI: 'Right rear door removed/installed, replaced, adjusted or repaired',
  MIRROR_LEFT_RI: 'Left mirror assembly removed/installed or replaced',
  MIRROR_RIGHT_RI: 'Right mirror assembly removed/installed or replaced',
  FENDER_LEFT_REPAIR: 'Left front fender repaired, replaced or pulled',
  FENDER_RIGHT_REPAIR: 'Right front fender repaired, replaced or pulled',
  SIDE_PANEL_LEFT_REPAIR: 'Left side panel repaired or replaced (quarter panel or rocker)',
  SIDE_PANEL_RIGHT_REPAIR: 'Right side panel repaired or replaced (quarter panel or rocker)',
  // Front end
  FRONT_COLLISION_DAMAGE: 'Collision damage anywhere at the front (including a fender hit or minor bumper contact)',
  FRONT_BUMPER_RI: 'Front bumper cover removed/installed or replaced',
  FRONT_BUMPER_REPAIR_ON_CAR: 'Front bumper cover repaired or refinished while still on the vehicle',
  FRONT_GRILLE_RI: 'Front grille removed/installed or replaced',
  FRONT_RADAR_RI: 'Front radar removed/installed or replaced',
  FRONT_RADAR_BRACKET_RI: 'Front radar mounting bracket removed/installed or replaced',
  FRONT_CAMERA_RI: 'Windshield (front) camera removed/installed or replaced',
  WINDSHIELD_RI: 'Windshield removed and installed',
  WINDSHIELD_REPLACED: 'Windshield replaced',
  // Rear end
  REAR_COLLISION_DAMAGE: 'Collision damage anywhere at the rear',
  REAR_GATE_RI: 'Liftgate, tailgate, swing gate or trunk lid removed/installed or replaced',
  REAR_GATE_ADJUST: 'Liftgate, tailgate, swing gate or trunk lid adjusted',
  REAR_GATE_HANDLE_LATCH_RI: 'Liftgate, tailgate or trunk handle or latch removed/installed or replaced',
  REAR_BUMPER_RI: 'Rear bumper cover removed/installed or replaced',
  REAR_BUMPER_REPAIR: 'Rear bumper cover repaired or refinished',
  REAR_CAMERA_RI: 'Rear camera removed/installed or replaced',
  // Sensors
  BLIND_SPOT_SENSOR_RI: 'Blind spot sensor removed/installed, replaced or its mount repaired',
  FRONT_PARKING_SENSOR_RI: 'Front parking aid sensor removed/installed or replaced',
  REAR_PARKING_SENSOR_RI: 'Rear parking aid sensor removed/installed or replaced',
};

// Make-specific IDs (Honda job aid, Ford matrix) that mean the same work.
const ALIASES = {
  TAILGATE_RI: 'Tailgate removed/installed or replaced',
  TAILGATE_ADJUST: 'Tailgate adjusted',
  TRUNK_RI: 'Trunk lid removed/installed or replaced',
  TRUNK_ADJUST: 'Trunk lid adjusted',
  LIFTGATE_HANDLE_LATCH_RI: 'Liftgate handle or latch removed/installed or replaced',
  TAILGATE_HANDLE_RI: 'Tailgate handle removed/installed or replaced',
  REARVIEW_CAMERA_RI: 'Rearview camera removed/installed or replaced',
  MIRROR_LEFT_ADJUST: 'Left mirror assembly adjusted',
  MIRROR_RIGHT_ADJUST: 'Right mirror assembly adjusted',
  MIRROR_COVER_LEFT_RI: 'Left mirror housing lower cover removed/installed or replaced',
  MIRROR_COVER_RIGHT_RI: 'Right mirror housing lower cover removed/installed or replaced',
  MVCS_SIDE_CAMERA_LEFT_RI: 'Left side camera removed/installed or replaced',
  MVCS_SIDE_CAMERA_RIGHT_RI: 'Right side camera removed/installed or replaced',
  SIDE_CAMERA_LEFT_RI: 'Left side (mirror) camera removed/installed or replaced',
  SIDE_CAMERA_RIGHT_RI: 'Right side (mirror) camera removed/installed or replaced',
  FRONT_BUMPER_ADJUST: 'Front bumper cover adjusted',
  FRONT_FASCIA_REPAIR_300MM: 'Front bumper fascia repair within 300 mm of the radar',
  RADAR_RI: 'Millimeter wave radar removed and installed',
  RADAR_REPLACED: 'Millimeter wave radar replaced',
  CAMERA_RI: 'Multipurpose or FCW/LDW camera removed and installed',
  CAMERA_REPLACED: 'Multipurpose or FCW/LDW camera replaced',
  BSI_RI: 'BSI radar removed and installed',
  BSI_REPLACED: 'BSI radar replaced',
  BSI_REPLACED_DAMAGE: 'BSI radar replaced due to damage',
  BSI_MOUNT_PANEL_REPAIR: 'Body panel where the BSI radar mounts repaired or replaced',
  FRONT_CORNER_SENSOR_RI: 'Front corner sensor removed/installed or replaced',
};

const label = (e) => EVENTS[e] || ALIASES[e] || e;

// ---- Trigger sets --------------------------------------------------------------
const SIDE = {
  Left: ['DOOR_LEFT_RI', 'DOOR_LEFT_ADJUST', 'DOOR_LEFT_COLLISION_REPAIR', 'REAR_DOOR_LEFT_RI', 'MIRROR_LEFT_RI', 'MIRROR_LEFT_ADJUST',
    'MIRROR_COVER_LEFT_RI', 'FENDER_LEFT_REPAIR', 'SIDE_PANEL_LEFT_REPAIR', 'MVCS_SIDE_CAMERA_LEFT_RI', 'SIDE_CAMERA_LEFT_RI'],
  Right: ['DOOR_RIGHT_RI', 'DOOR_RIGHT_ADJUST', 'DOOR_RIGHT_COLLISION_REPAIR', 'REAR_DOOR_RIGHT_RI', 'MIRROR_RIGHT_RI', 'MIRROR_RIGHT_ADJUST',
    'MIRROR_COVER_RIGHT_RI', 'FENDER_RIGHT_REPAIR', 'SIDE_PANEL_RIGHT_REPAIR', 'MVCS_SIDE_CAMERA_RIGHT_RI', 'SIDE_CAMERA_RIGHT_RI'],
};

// Front structure: anything beyond an on-car bumper repair, or any front damage.
// FRONT_BUMPER_REPAIR_ON_CAR is deliberately absent: alone it does not trigger.
const FRONT = ['FRONT_COLLISION_DAMAGE', 'FRONT_BUMPER_RI', 'FRONT_BUMPER_ADJUST', 'FRONT_GRILLE_RI', 'FRONT_FASCIA_REPAIR_300MM',
  'FRONT_RADAR_RI', 'FRONT_RADAR_BRACKET_RI', 'RADAR_RI', 'RADAR_REPLACED', 'FENDER_LEFT_REPAIR', 'FENDER_RIGHT_REPAIR'];
const FRONT_CAMERA = [...FRONT, 'WINDSHIELD_RI', 'WINDSHIELD_REPLACED', 'FRONT_CAMERA_RI', 'CAMERA_RI', 'CAMERA_REPLACED'];

const REAR_GATE = ['REAR_GATE_RI', 'REAR_GATE_ADJUST', 'REAR_GATE_HANDLE_LATCH_RI', 'TAILGATE_RI', 'TAILGATE_ADJUST', 'TRUNK_RI',
  'TRUNK_ADJUST', 'LIFTGATE_HANDLE_LATCH_RI', 'TAILGATE_HANDLE_RI'];
const REAR_END = [...REAR_GATE, 'REAR_COLLISION_DAMAGE', 'REAR_BUMPER_RI', 'REAR_BUMPER_REPAIR'];
const BLIND_SPOT_WORK = ['BLIND_SPOT_SENSOR_RI', 'BSI_RI', 'BSI_REPLACED', 'BSI_REPLACED_DAMAGE', 'BSI_MOUNT_PANEL_REPAIR', 'FRONT_CORNER_SENSOR_RI'];
const PARKING_WORK = ['FRONT_PARKING_SENSOR_RI', 'REAR_PARKING_SENSOR_RI', 'REAR_BUMPER_RI', 'REAR_COLLISION_DAMAGE'];

const MINIMUM = 'Calibrate, or at a minimum perform an extensive in-shop and on-road test and verification, and document it.';
const BASIS =
  'CollisionIQ field rule (all makes), not an OEM requirement. It applies even where OEM information lists no calibration or says requirements vary by model.';

const RULES = [
  {
    id: 'FIELD_SIDE_CAMERA',
    sided: true,
    triggers: SIDE,
    name: (side) => `${side} side mirror camera — calibration / verification`,
    text: `Side mirror camera(s) must be inspected and verified through calibration setup procedure. Confirm lens clarity, correct aim, and full system function regardless of whether camera unit was replaced. Door work, a door adjustment or a fender pull (pulling the fender back forward moves the door, and the mirror with it) all count. ${MINIMUM}`,
  },
  {
    id: 'FIELD_FRONT_RADAR',
    triggers: FRONT,
    name: () => 'Front radar — calibration / test',
    text: `${MINIMUM} Impact energy does not stop at the damaged panels: a fender hit or a small bumper contact in the right spot can shift the radar bracket. A front bumper repaired while still on the car, with no front impact damage, does not trigger this on its own.`,
  },
  {
    id: 'FIELD_FRONT_CAMERA',
    triggers: FRONT_CAMERA,
    name: () => 'Front camera — calibration',
    text: `Treat front camera calibration as part of the basic workflow for front-end and windshield work; the front camera increasingly relies on radar and other systems. ${MINIMUM}`,
    makeNotes: {
      subaru: 'Subaru EyeSight: plan ahead. Calibration needs the Subaru special tool and can take about 2 hours for a tech not trained on Subaru; check the weather forecast before scheduling any road verification.',
    },
  },
  {
    id: 'FIELD_REAR_CAMERA',
    triggers: [...REAR_END, 'REAR_CAMERA_RI', 'REARVIEW_CAMERA_RI'],
    name: () => 'Rear camera — test and verify',
    text: 'Rear cameras are mounted to the trunk lid, liftgate or tailgate on nearly all vehicles, so any rear-end work triggers them. Test and verify function, view and guidelines; attach the OEM paperwork for the procedure used.',
  },
  {
    id: 'FIELD_REAR_PARKING',
    triggers: [...REAR_END, 'REAR_PARKING_SENSOR_RI', ...BLIND_SPOT_WORK],
    name: () => 'Rear parking aid sensors — verify and test (where equipped)',
    text: 'Verify and test the rear parking aid sensors after rear-end work, and whenever the blind spot sensors were worked on (the two systems are checked together).',
  },
  {
    id: 'FIELD_BLIND_SPOT',
    triggers: [...BLIND_SPOT_WORK, ...PARKING_WORK],
    name: () => 'Blind spot system — verify and test (where equipped)',
    text: 'Verify and test the blind spot system whenever its sensors or the parking aid sensors were worked on (the two systems are checked together).',
  },
];

function apply(make, events) {
  const has = new Set(events);
  const m = String(make || '').toLowerCase();
  const out = [];
  for (const r of RULES) {
    const groups = r.sided ? Object.entries(r.triggers) : [[null, r.triggers]];
    for (const [side, triggers] of groups) {
      const hits = [...new Set(triggers)].filter((e) => has.has(e));
      if (!hits.length) continue;
      const note = r.makeNotes && Object.entries(r.makeNotes).find(([k]) => m.includes(k));
      out.push({
        id: side ? `${r.id}_${side.toUpperCase()}` : r.id,
        ...(side ? { side } : {}),
        name: r.name(side),
        required: true,
        level: 'warning',
        text: r.text,
        ...(note ? { makeNote: note[1] } : {}),
        reasons: hits.map((e) => ({ event: e, label: label(e) })),
        basis: BASIS,
      });
    }
  }
  return out;
}

module.exports = { EVENTS, ALIASES, RULES, apply };
