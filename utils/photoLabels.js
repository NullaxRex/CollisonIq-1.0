'use strict';

const ZONE_DISPLAY = {
  front_end:      'Front End',
  rear_end:       'Rear End',
  driver_side:    'Driver Side',
  passenger_side: 'Passenger Side',
  roof:           'Roof',
  undercarriage:  'Undercarriage',
};

function generatePhotoLabels(job) {
  const labels = [];

  // Layer 1: Fixed four-angle overview (always present)
  [
    { key: 'OVERVIEW_FRONT',     display: 'Full Vehicle \u2014 Front' },
    { key: 'OVERVIEW_REAR',      display: 'Full Vehicle \u2014 Rear' },
    { key: 'OVERVIEW_DRIVER',    display: 'Full Vehicle \u2014 Driver Side' },
    { key: 'OVERVIEW_PASSENGER', display: 'Full Vehicle \u2014 Passenger Side' },
  ].forEach(o => labels.push({ layer: 1, zone: null, ...o }));

  // Layer 1: Per-zone full context shots
  (job.impact_areas || []).forEach(zone => {
    const z = ZONE_DISPLAY[zone] || zone;
    labels.push({
      layer:   1,
      zone,
      key:     'ZONE_FULL_CONTEXT',
      display: `Impact Zone \u2014 ${z} (Full Context)`,
    });
  });

  // Layer 2: Per-zone damage detail sequence
  (job.impact_areas || []).forEach(zone => {
    const z = ZONE_DISPLAY[zone] || zone;
    [
      { key: 'DAMAGE_DETAIL_CLOSE',   display: `${z} \u2014 Damage Detail (Close)` },
      { key: 'DAMAGE_DETAIL_WIDE',    display: `${z} \u2014 Damage Detail (Wide)` },
      { key: 'ADJACENT_PANEL_LEFT',   display: `${z} \u2014 Adjacent Panel (Left)` },
      { key: 'ADJACENT_PANEL_RIGHT',  display: `${z} \u2014 Adjacent Panel (Right)` },
      { key: 'MIRROR_SIDE_UNDAMAGED', display: `${z} \u2014 Undamaged Mirror Side`, is_recommended: true },
      { key: 'IN_PROCESS_REPAIR',     display: `${z} \u2014 In-Process Repair` },
      { key: 'FINISHED_STATE',        display: `${z} \u2014 Finished State` },
    ].forEach(l => labels.push({ layer: 2, zone, ...l }));
  });

  // Layer 2: ADAS setup (conditional)
  if (job.adas_required) {
    [
      { key: 'ADAS_TARGET_PLACEMENT',   display: 'ADAS Setup \u2014 Target Placement',           is_adas: true },
      { key: 'ADAS_TOOL_CONNECTION',    display: 'ADAS Setup \u2014 Tool Connection',            is_adas: true },
      { key: 'ADAS_CALIBRATION_RESULT', display: 'ADAS Setup \u2014 Calibration Reading/Result', is_adas: true },
    ].forEach(l => labels.push({ layer: 2, zone: 'adas_setup', ...l }));
  }

  return labels;
}

module.exports = { generatePhotoLabels, ZONE_DISPLAY };
