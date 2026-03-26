'use strict';

/**
 * CollisionIQ ADAS Trigger Engine
 * Evaluates repairs performed and flags required ADAS calibrations
 * based on vehicle make and repair type.
 * All scan requirement data sourced from official OEM position statements.
 */

/**
 * @param {string} make
 * @param {string} model
 * @param {string} year
 * @param {string[]} repairs  - array of repair strings from the form
 * @returns {{
 *   adasSystems: string,
 *   rationale: string,
 *   liabilityWarning: string,
 *   makeSpecificNotes: string,
 *   preScanRequired: string,
 *   postScanRequired: string,
 *   approvedScanTool: string,
 *   sourceCitation: string
 * }}
 */
function runADASEngine(make, model, year, repairs) {
  const makeLower = (make || '').toLowerCase().trim();
  const modelLower = (model || '').toLowerCase().trim();
  const repairsLower = (repairs || []).map(r => r.toLowerCase());

  const adasSystems = [];
  const rationaleItems = [];
  let liabilityWarning = '';
  let makeSpecificNotes = '';
  let preScanRequired  = 'RECOMMENDED';
  let postScanRequired = 'RECOMMENDED';
  let approvedScanTool = 'Consult OEM service information for approved diagnostic tool';
  let sourceCitation   = 'OEM Position Statement';

  // Check if any of the given keywords appear in any repair item
  const hasRepair = (...keywords) =>
    keywords.some(kw => repairsLower.some(r => r.includes(kw.toLowerCase())));

  // Check if repairs include door or mirror-related work (gate for side obstacle output)
  const hasDoorRepair = () => hasRepair(
    'door',
    'mirror',
    'door / mirror repair',
    'door/mirror repair',
    'door harness',
    'door module',
    'driver front door',
    'passenger front door',
    'driver rear door',
    'passenger rear door'
  );

  // ─── Toyota / Lexus / Scion ───────────────────────────────────────────────
  if (
    makeLower.includes('toyota') ||
    makeLower.includes('lexus') ||
    makeLower.includes('scion')
  ) {
    preScanRequired  = 'STRONGLY RECOMMENDED — Toyota CRIB 191';
    postScanRequired = 'REQUIRED if collision affects electrical systems — Toyota CRIB 191';
    approvedScanTool = 'Toyota Techstream or Techstream Lite';
    sourceCitation   = 'Toyota CRIB 191';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Pre-Collision System (PCS) — Static Calibration Required');
      rationaleItems.push(
        'Windshield or front camera area repair detected: PCS static calibration required per TSB-0411. ' +
        'Calibration board required. Minimum 30 ft bay space required.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Front Radar — Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Front radar calibration required per OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Blind Spot Monitor (BSM) — Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Blind Spot Monitor calibration required.'
      );
    }
    if (hasRepair('wheel alignment', 'alignment', 'suspension')) {
      adasSystems.push('Dynamic Calibration — Required After Alignment');
      rationaleItems.push(
        'Wheel alignment or suspension repair detected: Dynamic calibration required after alignment ' +
        'to re-establish sensor geometry.'
      );
    }
    liabilityWarning =
      'ADAS calibration required per OEM repair procedures. Failure to calibrate may result in ' +
      'system malfunction and liability exposure.';
    makeSpecificNotes =
      'Toyota/Lexus requires Techstream scan before and after calibration. Verify DTCs cleared post-calibration.';
  }

  // ─── Ford / Lincoln ───────────────────────────────────────────────────────
  else if (makeLower.includes('ford') || makeLower.includes('lincoln')) {
    preScanRequired  = 'REQUIRED — all collision repairs 2010 and newer';
    postScanRequired = 'REQUIRED — all collision repairs 2010+';
    approvedScanTool = 'Ford IDS or FDRS (Ford Diagnosis and Repair System)';
    sourceCitation   = 'Ford Collision Position Statement — December 10, 2018';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('IPMA Calibration Required (Dynamic)');
      rationaleItems.push(
        'Windshield or front camera area repair detected: Image Processing Module A (IPMA) ' +
        'dynamic calibration required.'
      );
    }
    if (hasRepair('front bumper')) {
      adasSystems.push('Front Radar Calibration Required');
      rationaleItems.push(
        'Front bumper repair detected: Front radar calibration required per Ford OEM procedure.'
      );
    }
    if (hasRepair('front bumper', 'rear bumper')) {
      adasSystems.push(
        'Front/Rear Parking Aid Sensors — Azimuth and Elevation System Check Required per Ford Workshop Manual ' +
        'Section 413-13A (front) and Section 413-13 (rear). NOTE: Ford Workshop Manual classifies this as an ' +
        '\'operation check\' but this procedure generates new sensor threshold values used for object detection — ' +
        'document as calibration procedure for insurance reimbursement purposes. Requires controlled setup. ' +
        'Use Ford IDS or FDRS to complete and verify.'
      );
      rationaleItems.push(
        'Front or rear bumper repair detected: Parking Aid Sensor Azimuth and Elevation System Check required ' +
        'per Ford WSM Section 413-13A (front) / Section 413-13 (rear).'
      );
    }
    liabilityWarning =
      'Ford ADAS calibration required. Dynamic calibration requires 25+ mph on clearly marked roads.';
    makeSpecificNotes =
      'Ford IPMA calibration is dynamic — no target board needed. Requires 10+ mile drive cycle on highway.';
  }

  // ─── General Motors (Chevy / GMC / Buick / Cadillac) ─────────────────────
  else if (
    makeLower.includes('chevy') ||
    makeLower.includes('chevrolet') ||
    makeLower.includes('gmc') ||
    makeLower.includes('buick') ||
    makeLower.includes('cadillac')
  ) {
    preScanRequired  = 'REQUIRED — all collision repairs';
    postScanRequired = 'REQUIRED — no unresolved DTCs';
    approvedScanTool = 'GM GDS2';
    sourceCitation   = 'GM OEM Position Statement';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Forward Camera Calibration Required');
      rationaleItems.push(
        'Windshield or front camera area repair detected: Forward camera calibration required.'
      );
    }
    if (hasRepair('front bumper')) {
      adasSystems.push('Front Radar Calibration Required');
      rationaleItems.push(
        'Front bumper repair detected: Front radar calibration required per GM OEM procedure.'
      );
    }
    liabilityWarning =
      'GM ADAS calibration required per OEM procedures.';
    makeSpecificNotes =
      'GM camera calibration may be static or dynamic depending on model year. Verify with GDS2.';
  }

  // ─── FCA / Stellantis (Chrysler / Dodge / Ram / Jeep / Fiat / Alfa Romeo) ─
  else if (
    makeLower.includes('chrysler') ||
    makeLower.includes('dodge') ||
    makeLower.includes('ram') ||
    makeLower.includes('jeep') ||
    makeLower.includes('fiat') ||
    makeLower.includes('alfa romeo') ||
    makeLower.includes('stellantis') ||
    makeLower.includes('fca')
  ) {
    preScanRequired  = 'REQUIRED — all FCA vehicles 1996+ per Collision Bulletin 31-002-19';
    postScanRequired = 'REQUIRED — all FCA vehicles 1996+ per Collision Bulletin 31-002-19';
    approvedScanTool = 'Mopar wiTECH (techauthority.com)';
    sourceCitation   = 'FCA Collision Bulletin 31-002-19';

    if (hasRepair('windshield', 'glass')) {
      adasSystems.push('Post-Scan Required — SRS Air Bag Squib Status Verification');
      rationaleItems.push(
        'Windshield or glass repair detected: Post-scan required using wiTECH. ' +
        'SRS airbag squib status must be verified after any deployment.'
      );
    }
    if (hasRepair('front bumper', 'front camera', 'camera')) {
      adasSystems.push('Forward Camera & Radar Calibration Required');
      rationaleItems.push(
        'Front bumper or camera repair detected: Forward camera and radar calibration required per FCA procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Blind Spot Monitoring Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Blind spot monitoring system calibration required per FCA procedure.'
      );
    }
    if (hasRepair('disassembly', 'battery', 'airbag', 'air bag', 'srs')) {
      adasSystems.push('Full System Scan Required — Battery Disconnect / Airbag Deployment');
      rationaleItems.push(
        'Disassembly, battery disconnect, or airbag deployment detected: Full system scan required with wiTECH.'
      );
    }
    liabilityWarning =
      'FCA requires Mopar wiTECH scan before AND after all collision repairs. SRS airbag squib status MUST be verified ' +
      'after any airbag deployment using wiTECH.';
    makeSpecificNotes =
      'All safety systems including SRS, ORC, forward camera, radar, and blind spot monitoring MUST be scanned for DTCs. ' +
      'Airbag squib status must be verified with wiTECH prior to removing deployed airbags.';
  }

  // ─── Honda / Acura ────────────────────────────────────────────────────────
  // Source: American Honda — Aiming Driving Support Systems Job Aid v12 (August 2025)
  //         Acura — Aiming Driving Support Systems Job Aid v7 (August 2025)
  //         American Honda — Post-Collision Diagnostic Scan and Calibration Requirements v6 (July 2025)
  else if (makeLower.includes('honda') || makeLower.includes('acura')) {
    // ── Steps 2 & 10: Source citation and scan language ──────────────────────
    sourceCitation =
      'American Honda — Aiming Driving Support Systems Job Aid v12 (August 2025); ' +
      'Acura — Aiming Driving Support Systems Job Aid v7 (August 2025); ' +
      'American Honda — Post-Collision Diagnostic Scan and Calibration Requirements v6 (July 2025)';

    preScanRequired =
      'REQUIRED — Pre-repair scan required on all Honda/Acura collision jobs. ' +
      'Perform during repair estimation phase to identify existing DTCs before repair begins. ' +
      'Absence of dashboard warning lights does NOT waive this requirement — ' +
      'many DTCs do not illuminate indicators.';

    postScanRequired =
      'REQUIRED — Post-repair scan required on all Honda/Acura collision jobs. ' +
      'Any repair requiring disconnection of electrical components requires a post-repair scan ' +
      'to confirm reconnection and proper function. Body part replacement always requires a post-repair scan.';

    // ── Step 3: Approved scan tool ────────────────────────────────────────────
    approvedScanTool =
      "i-HDS with Denso DST-i VCI (Honda factory-authorized only). 'OEM Compatible' or 'OEM-C' labeled " +
      'scan tools have NOT been validated by American Honda and cannot be recorded as an OEM Diagnostic Scan.';

    // ── Step 4: Structural damage definition (governs radar/camera/BSI triggers) ─
    const HONDA_STRUCTURAL_DAMAGE_DEF =
      'Structural damage means any damage beyond minor cosmetic abrasions to the welded, riveted, or bonded ' +
      'parts of the main unibody, as well as the bumper reinforcements, door intrusion beams, or bolt-on ' +
      'front bulkheads.';

    const hasStructural = hasRepair(
      'structural', 'unibody', 'frame', 'bumper reinforcement', 'door intrusion beam', 'front bulkhead'
    );
    const hasFrontStructural = hasStructural;
    const hasRearStructural  = hasRepair(
      'rear structural', 'rear unibody', 'rear frame', 'rear bumper reinforcement'
    );
    const hasSRS = hasRepair('airbag', 'srs', 'air bag', 'deployed');

    // ── Step 5A: Front Millimeter Wave Radar ─────────────────────────────────
    if (hasRepair('front bumper') || hasFrontStructural || hasSRS || hasRepair('radar')) {
      adasSystems.push('Front Millimeter Wave Radar — Aiming Required');
      rationaleItems.push(
        'Front Millimeter Wave Radar — Aiming Required (STATIC). ' +
        'Triggered by: front bumper repair/replacement, structural body repair, airbag/SRS deployment, ' +
        'or radar unit removed/replaced (order replacement by VIN). ' +
        'Pre-condition: 4-wheel alignment check required before radar aiming if calibration is collision-related. ' +
        'Source: Honda Job Aid v12 / Acura Job Aid v7 (August 2025). ' +
        'Structural damage definition (August 2025): ' + HONDA_STRUCTURAL_DAMAGE_DEF
      );
    }

    // ── Step 5B: Multipurpose Camera / FCW-LDW Camera (Windshield-Mounted) ───
    if (hasRepair('windshield') || hasFrontStructural || hasSRS) {
      adasSystems.push('Multipurpose Camera / FCW-LDW Camera — Aiming Required');
      rationaleItems.push(
        'Multipurpose Camera / FCW-LDW Camera — Aiming Required (STATIC). ' +
        'Triggered by: windshield repair/replacement, structural body repair, or airbag/SRS deployment. ' +
        'OE PARTS REQUIRED: Honda/Acura genuine replacement windshield required. ' +
        'Aftermarket windshield will cause camera aiming failure. Order by VIN. ' +
        'Pre-condition: 4-wheel alignment check required before camera aiming if calibration is collision-related. ' +
        'Source: Honda Job Aid v12 / Acura Job Aid v7 (August 2025).'
      );
    }

    // ── Step 5C: Blind Spot Information (BSI) Radar — Rear ───────────────────
    if (hasRepair('rear bumper') || hasRearStructural) {
      adasSystems.push('BSI Radar (Blind Spot Information) — Aiming Required');
      rationaleItems.push(
        'BSI Radar (Blind Spot Information) — Aiming Required (STATIC). ' +
        'Triggered by: rear bumper repair/replacement or rear structural body repair ' +
        '(rear-of-vehicle only — front structural rule does NOT apply to BSI). ' +
        'Pre-condition: Perform BSI Mounting Area Check before installing replacement unit. ' +
        'Inspect replacement rear bumper cover for damage in radar wave emission range before installation — ' +
        'cracks, dents, or gouges in this zone require replacement, not repair. ' +
        'Source: Honda Job Aid v12 / Acura Job Aid v7 (August 2025) + ' +
        'American Honda Non-Repairable Zones on Bumper Covers v1 (September 2024).'
      );
    }

    // ── Step 5D: LaneWatch Camera (Honda only) ───────────────────────────────
    if (makeLower.includes('honda') && hasRepair('door', 'mirror', 'passenger door', 'passenger side')) {
      adasSystems.push('LaneWatch Camera — Aiming Required (Honda only)');
      rationaleItems.push(
        'LaneWatch Camera — Aiming Required (Honda only, STATIC). ' +
        'Triggered by: door/mirror repair (passenger side) or front passenger door removed, replaced, or adjusted. ' +
        'NOTE: LaneWatch aiming does not require i-HDS. Uses audio/nav unit with LaneWatch switch. ' +
        'Not accessible via i-HDS scan — refer to techinfo.honda.com for procedure. ' +
        'Source: Honda Job Aid v12 (August 2025).'
      );
    }

    // ── Step 5E: Multi View Camera System (MVCS) ─────────────────────────────
    const mvcsTriggers = [];
    if (hasRepair('front bumper'))                                          mvcsTriggers.push('front camera');
    if (hasRepair('windshield') && !mvcsTriggers.includes('front camera')) mvcsTriggers.push('front camera (windshield)');
    if (hasRepair('driver', 'driver door', 'driver mirror', 'driver side')) mvcsTriggers.push('left side camera');
    if (hasRepair('passenger door', 'passenger mirror', 'passenger side'))  mvcsTriggers.push('right side camera');
    if (hasRepair('rear bumper'))                                           mvcsTriggers.push('rear camera');

    if (mvcsTriggers.length > 0) {
      adasSystems.push('Multi View Camera System (MVCS) — Aiming Required');
      rationaleItems.push(
        'Multi View Camera System (MVCS) — Aiming Required (STATIC). ' +
        'Cameras requiring aiming: ' + mvcsTriggers.join(', ') + '. ' +
        'NOTE: Aim only the camera(s) applicable to the component removed, replaced, or adjusted. ' +
        'It is not necessary to aim all four cameras unless all applicable components were affected. ' +
        'Source: Honda Job Aid v12 / Acura Job Aid v7 (August 2025).'
      );
    }

    // ── Step 6: 4-Wheel Alignment Pre-Condition (any ADAS trigger from collision) ─
    if (adasSystems.length > 0) {
      rationaleItems.push(
        '4-Wheel Alignment Check Required — Honda/Acura OEM Rule (August 2025): ' +
        'If aiming a radar or camera is necessary due to a collision, a four-wheel alignment check MUST be performed. ' +
        'If wheel alignment is not within specifications, it must be corrected BEFORE aiming or calibrating any camera or radar. ' +
        'NOTE: Alignment alone (e.g., tire replacement + alignment) does NOT require ADAS recalibration unless ' +
        'service info specifically states otherwise.'
      );
    }

    // ── Step 7A: Front Passenger Seat Weight Sensor (mandatory — every job) ──
    rationaleItems.push(
      'MANDATORY: Front passenger seat weight sensor (SWS/ODS) inspection required after ANY collision ' +
      'regardless of damage severity and even if no airbags deployed. ' +
      'Requires scan tool verification of empty-seat detection. ' +
      'Controls front passenger airbag operation and PASSENGER AIRBAG OFF indicator.'
    );

    // ── Step 7B: Battery Reconnect Reset Procedures (mandatory — every job) ──
    rationaleItems.push(
      'Battery Reconnect Reset Required: After collision repairs and battery reconnection, verify and perform ' +
      'reset procedures for: Audio/Navigation system, Steering Angle Position Sensor, engine idle speed learn, ' +
      'power windows/tailgate/moonroof/power sliding door (position and pinch detection), ' +
      "keyless access and immobilizer/security system. Search 'Reset' at techinfo.honda.com for " +
      'vehicle-specific reset procedure list.'
    );

    // ── Step 8: OE Parts Warning Flags ───────────────────────────────────────
    if (hasRepair('windshield')) {
      rationaleItems.push(
        'OE PARTS REQUIRED: Honda/Acura genuine replacement windshield required for all models with forward camera (2013-present). ' +
        'Aftermarket windshield causes aiming failure. ' +
        'For HUD-equipped vehicles (2014+): non-OE windshield causes double image in HUD display. ' +
        'Order by VIN — no visual difference exists between OE HUD and non-HUD glass.'
      );
    }
    if (hasRepair('front bumper', 'grille', 'front grille', 'radar cover')) {
      rationaleItems.push(
        'OE PARTS REQUIRED: Front grille and radar-area emblem are radar-transparent by design. ' +
        'Non-OE grille parts obstruct radar and will trigger DTC P2583-97. ' +
        'Wrong trim-level parts also obstruct radar even if they fit physically. ' +
        'Do not paint radar covers or apply wraps to any grille or radar cover.'
      );
    }
    if (hasRepair('rear bumper')) {
      rationaleItems.push(
        'OE PARTS REQUIRED: Non-Honda Genuine rear bumper covers may differ in material or thickness, ' +
        'affecting BSI radar performance. Cracks, dents, or gouges within the BSI radar wave emission range ' +
        'CANNOT be repaired — replacement required. ' +
        'Paint scratches in emission range: sand and repaint entire emission zone — do NOT blend.'
      );
    }

    // ── Step 9: Rationale and liability warning ───────────────────────────────
    liabilityWarning =
      'Honda/Acura ADAS calibration required. Dynamic calibration requires a four-wheel alignment check before any aiming procedure. ' +
      'All replacement radar, camera, and sensor units must be ordered by VIN. ' +
      "'OEM Compatible' scan tools are not accepted for Honda/Acura OEM scan documentation — " +
      'i-HDS with Denso DST-i VCI required.';

    makeSpecificNotes =
      'Honda/Acura ADAS calibration required per American Honda Aiming Driving Support Systems Job Aid v12 (Honda) ' +
      'and v7 (Acura), August 2025, and Post-Collision Diagnostic Scan and Calibration Requirements v6, July 2025.';
  }

  // ─── Nissan / Infiniti ────────────────────────────────────────────────────
  else if (makeLower.includes('nissan') || makeLower.includes('infiniti')) {
    preScanRequired  = 'RECOMMENDED — all Nissan 1996+ per Position Statement NPSB/18-409';
    postScanRequired = 'REQUIRED — ALL Nissan vehicles 2008 and newer per Position Statement NPSB/18-409';
    approvedScanTool = 'Nissan/Infiniti CONSULT diagnostic scan tool (nissan-techinfo.com)';
    sourceCitation   = 'Nissan Position Statement NPSB/18-409';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Front Camera Calibration Required');
      rationaleItems.push(
        'Windshield or front camera repair detected: Front camera calibration required per Nissan CONSULT procedure.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Front Radar Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Front radar calibration required per Nissan OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Rear Sonar / Blind Spot Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Rear sonar and blind spot calibration required per Nissan OEM procedure.'
      );
    }
    if (hasRepair('wheel alignment', 'alignment', 'suspension')) {
      adasSystems.push('Dynamic Calibration Required After Alignment');
      rationaleItems.push(
        'Wheel alignment or suspension repair detected: Dynamic calibration required per Nissan OEM procedure.'
      );
    }
    liabilityWarning =
      'Nissan requires post-repair diagnostic scan on ALL 2008+ vehicles. Dashboard warning lights are NOT acceptable ' +
      'to determine scan necessity. All DTCs must be resolved before delivery.';
    makeSpecificNotes =
      'Use CONSULT with most up-to-date software. DTCs may be triggered by repair process even without collision damage ' +
      'to that system. Refer to Electronic Service Manual (ESM).';
  }

  // ─── Kia / Hyundai / Genesis ──────────────────────────────────────────────
  else if (
    makeLower.includes('kia') ||
    makeLower.includes('hyundai') ||
    makeLower.includes('genesis')
  ) {
    preScanRequired  = 'IMPERATIVE/RECOMMENDED — all collision repairs per Kia/Hyundai position statements';
    postScanRequired = 'REQUIRED — all systems must communicate with no DTCs per Kia/Hyundai position statements';
    approvedScanTool = 'Kia/Hyundai GDS (Global Diagnostic System) — recommended OEM tool';
    sourceCitation   = 'Kia/Hyundai OEM Position Statements';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Smart Cruise Control (SCC) Front Camera Calibration Required');
      rationaleItems.push(
        'Windshield or front camera repair detected: Smart Cruise Control (SCC) front camera calibration ' +
        'required per Kia/Hyundai OEM procedure.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Front Radar Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Front radar calibration required per Kia/Hyundai OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Rear Cross Traffic Alert Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Rear Cross Traffic Alert calibration required per Kia/Hyundai OEM procedure.'
      );
    }
    if (hasRepair('wheel alignment', 'alignment', 'suspension')) {
      adasSystems.push('Dynamic Calibration Required After Alignment/Suspension Repair');
      rationaleItems.push(
        'Wheel alignment or suspension repair detected: Dynamic calibration required per Kia/Hyundai OEM procedure.'
      );
    }
    liabilityWarning =
      'Kia and Hyundai position statements state scanning is NOT optional — it is an essential task both during ' +
      'pre-repair estimation and after repairs are complete. All systems must be functioning as originally designed.';
    makeSpecificNotes =
      'Post-repair scan must confirm all systems communicating and functioning as originally engineered. ' +
      'DTC indicator lights may NOT illuminate for all stored codes.';
  }

  // ─── Subaru ───────────────────────────────────────────────────────────────
  else if (makeLower.includes('subaru')) {
    preScanRequired  = 'RECOMMENDED — 2004 and newer per Subaru of America Position Statement July 2017';
    postScanRequired = 'RECOMMENDED — critical to ensure all calibrations and reinitializations performed';
    approvedScanTool = 'Subaru SSM4 diagnostic tool or asTech remote device (techinfo.subaru.com)';
    sourceCitation   = 'Subaru of America Position Statement, July 2017';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('EyeSight Dual-Camera Calibration Required — Static (SST Tools Required)');
      rationaleItems.push(
        'Windshield or front camera repair detected: EyeSight dual-camera system requires static calibration ' +
        'using Subaru SST tools — cannot be performed with generic equipment. SSM4 preferred; asTech acceptable.'
      );
    }
    if (hasRepair('front bumper')) {
      adasSystems.push('Front Grille Radar Calibration Required');
      rationaleItems.push(
        'Front bumper repair detected: Front grille radar calibration required per Subaru OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Rear Camera & Sonar Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Rear camera and sonar calibration required per Subaru OEM procedure.'
      );
    }
    liabilityWarning =
      'Subaru EyeSight is a dual-camera system requiring specialized calibration after any windshield or ' +
      'front camera area repair. Post-repair scan critical to confirm reinitializations complete.';
    makeSpecificNotes =
      'EyeSight calibration requires Subaru SST tools — cannot be performed with generic equipment. ' +
      'SSM4 preferred; asTech device acceptable alternative. Refer to STIS at techinfo.subaru.com.';
  }

  // ─── Mazda ────────────────────────────────────────────────────────────────
  else if (makeLower.includes('mazda')) {
    preScanRequired  = 'RECOMMENDED — all collision repairs per Mazda North American Operations Position Statement January 2018';
    postScanRequired = 'RECOMMENDED — all collision repairs per Mazda North American Operations Position Statement January 2018';
    approvedScanTool = 'Mazda diagnostic tool — procedures available at oem1stop.com';
    sourceCitation   = 'Mazda North American Operations Position Statement, January 2018';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Front Camera Calibration Required');
      rationaleItems.push(
        'Windshield or front camera repair detected: Front camera calibration required per Mazda OEM procedure.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Radar Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Radar calibration required per Mazda OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Rear Sonar Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Rear sonar calibration required per Mazda OEM procedure.'
      );
    }
    liabilityWarning =
      'Mazda recommends pre and post-repair scanning on all collision damage repairs. DTCs will be stored ' +
      'if sensors, cameras, or radars were damaged.';
    makeSpecificNotes =
      'Use Mazda Genuine Parts for all repairs. Repair procedures, scanning, and reprogramming information available at oem1stop.com.';
  }

  // ─── Mercedes-Benz ────────────────────────────────────────────────────────
  else if (
    makeLower.includes('mercedes') ||
    makeLower.includes('benz')
  ) {
    preScanRequired  = 'HIGHLY RECOMMENDED — per MBUSA Position Statement';
    postScanRequired = 'REQUIRED — all collisions, windshield replacements, and R&Is per MBUSA Position Statement';
    approvedScanTool = 'Mercedes-Benz XENTRY diagnostic system — Startime for labor times';
    sourceCitation   = 'MBUSA Position Statement';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Stereo Multi-Purpose Camera (MPC) Calibration Required — Static');
      rationaleItems.push(
        'Windshield or front camera repair detected: Stereo Multi-Purpose Camera (MPC) static calibration required ' +
        'per MBUSA procedure. XENTRY required.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Distronic Radar Calibration Required — DTR Control Unit Initialization');
      rationaleItems.push(
        'Front bumper or radar repair detected: Distronic radar calibration required — initialization of DTR control unit ' +
        'per Mercedes-Benz OEM procedure.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push('Blind Spot Assist / Rear Radar Calibration Required');
      rationaleItems.push(
        'Rear bumper repair detected: Blind Spot Assist / rear radar calibration required per MBUSA procedure.'
      );
    }
    if (hasRepair('airbag', 'air bag', 'srs')) {
      adasSystems.push('Steering Wheel & Steering Column Tube Replacement Required — Post Airbag Deployment');
      rationaleItems.push(
        'Airbag deployment detected: Per MBUSA position statement, steering wheel AND steering column tube ' +
        'must be replaced — internal damage may not be externally visible.'
      );
    }
    liabilityWarning =
      'MBUSA requires all safety system codes be diagnosed, repaired, and cleared. If codes found during diagnostic tests, ' +
      'printouts must be made and stored in vehicle file. No aftermarket parts of any kind on collision repairs.';
    makeSpecificNotes =
      'Distronic calibration required after replacement of DTR controller unit, steering column tube module, or yaw rate sensor. ' +
      'If airbag deployed, steering wheel AND steering column tube must be replaced — internal damage may not be externally visible.';
  }

  // ─── Jaguar / Land Rover / Range Rover ────────────────────────────────────
  else if (
    makeLower.includes('jaguar') ||
    makeLower.includes('land rover') ||
    makeLower.includes('range rover')
  ) {
    preScanRequired  = 'RECOMMENDED — all Jaguar Land Rover vehicles per JLRGPS 02v2';
    postScanRequired = 'REQUIRED — all collisions regardless of appearance of damage per JLRGPS 02v2';
    approvedScanTool = 'JLR Pathfinder diagnostic tool — TOPIx technical portal (topix.jaguar.com / topix.landrover.com)';
    sourceCitation   = 'JLRGPS 02v2';

    if (hasRepair('windshield')) {
      adasSystems.push('Windscreen Camera Calibration Required — Rain/Light Sensor Evaluation Required');
      rationaleItems.push(
        'Windshield repair detected: Windscreen camera calibration required. Rain and light sensor evaluation ' +
        'required per JLR workshop manual via TOPIx portal.'
      );
    }
    if (hasRepair('front bumper', 'front camera', 'radar')) {
      adasSystems.push('Front Radar Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Front radar calibration required per JLR workshop manual.'
      );
    }
    if (hasRepair('rear bumper', 'parking sensor')) {
      adasSystems.push('Parking Sensor Calibration Required');
      rationaleItems.push(
        'Rear bumper or parking sensor repair detected: Parking sensor calibration required per JLR procedure.'
      );
    }
    // Flag full Pathfinder scan for any collision job
    adasSystems.push('Full Pathfinder Diagnostic Scan Required — All JLR Collision Repairs');
    rationaleItems.push(
      'Jaguar/Land Rover requires full Pathfinder diagnostic scan on ALL collision repairs regardless of damage appearance. ' +
      'Many safety systems require calibration, normalisation, or coding after any collision.'
    );
    liabilityWarning =
      'Jaguar Land Rover requires post-repair diagnostic scan and calibration on ALL collision repairs regardless of damage appearance. ' +
      'Many safety systems require calibration, normalisation, or coding after collision.';
    makeSpecificNotes =
      'Use TOPIx portal for all repair procedures — continually updated and model-specific. Full Pathfinder scan required for: ' +
      'any collision, windshield replacement, bumper removal, SRS sensors, parking sensors, wiring harnesses, seats, or interior trim panels.';
  }

  // ─── Volvo ────────────────────────────────────────────────────────────────
  else if (makeLower.includes('volvo')) {
    preScanRequired  = 'REQUIRED — 1996+ per Volvo Car USA Position Statement';
    postScanRequired = 'REQUIRED — 1996+ per Volvo Car USA Position Statement';
    approvedScanTool = 'Volvo VIDA (Vehicle Information and Diagnostics for Aftersales)';
    sourceCitation   = 'Volvo Car USA Position Statement';

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push('Camera & Sensor Calibration Required — Cameras/Sensors Located on Glass');
      rationaleItems.push(
        'Windshield or front camera repair detected: Camera and sensor calibration required. ' +
        'Multiple cameras and sensors are located on or adjacent to the windshield glass — all require calibration per VIDA.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push('Autonomous Drive Sensor Calibration Required');
      rationaleItems.push(
        'Front bumper or radar repair detected: Autonomous drive sensor calibration required per Volvo VIDA procedure.'
      );
    }
    if (hasRepair('rear bumper', 'mirror')) {
      adasSystems.push('PDC Sensor & Camera Calibration Required');
      rationaleItems.push(
        'Rear bumper or mirror repair detected: PDC sensor and camera calibration required per Volvo VIDA procedure.'
      );
    }
    if (hasRepair('battery', 'battery disconnect')) {
      adasSystems.push('System Initialization Required — Battery Disconnect');
      rationaleItems.push(
        'Battery disconnect detected: System initialization required per Volvo VIDA procedure.'
      );
    }
    liabilityWarning =
      'Volvo requires pre and post-repair scanning on all 1996+ vehicles. Any safety or autonomous systems activated ' +
      'during collision may require initialization, calibration, or replacement.';
    makeSpecificNotes =
      'Refer to VIDA for latest technical guidelines. Scan required for: windshield replacement, bumper removal, ' +
      'SRS sensors, PDC sensors, exterior mirrors, autonomous drive sensors, headlights, wiring harnesses, seats, ' +
      'interior trim panels, or battery disconnect.';
  }

  // ─── Tesla ────────────────────────────────────────────────────────────────
  else if (makeLower.includes('tesla')) {
    preScanRequired  = 'REQUIRED — Tesla Toolbox diagnostic software required before repair. Not standard OBDII compatible.';
    postScanRequired = 'REQUIRED — Tesla Toolbox diagnostic software required after all component replacements.';
    approvedScanTool = 'Tesla Toolbox 3 Diagnostic Software (service.tesla.com — subscription required)';
    sourceCitation   = 'Tesla Service Manual (service.tesla.com)';

    // Always flag HV isolation and alert review for ALL Tesla jobs
    adasSystems.push(
      'HIGH VOLTAGE ISOLATION REQUIRED — Vehicle Electrical Isolation Procedure MUST be performed before any repair work begins. ' +
      'See vehicle-specific Service Manual. HV-certified technician required.'
    );
    rationaleItems.push(
      'ALL Tesla jobs: High voltage isolation procedure is mandatory before any repair work begins per Tesla Service Manual.'
    );
    adasSystems.push(
      'Tesla Alert Review Required — Post-repair review of all stored Tesla alerts via Toolbox. ' +
      'Tesla does not use standard DTCs — alert system is event-based, not fault-based.'
    );
    rationaleItems.push(
      'ALL Tesla jobs: Post-repair Toolbox alert review required. Tesla alert system is event-based, not standard DTC-based.'
    );

    if (hasRepair('windshield', 'front camera')) {
      adasSystems.push(
        'Autopilot Forward Camera Calibration Required — Drive cycle calibration via Service menu > Camera Calibration. ' +
        'Requires clear road driving after repair.'
      );
      rationaleItems.push(
        'Windshield or front camera area repair detected: Autopilot forward camera drive cycle calibration required ' +
        'via touchscreen Service menu — not a static target board procedure.'
      );
    }
    if (hasRepair('front bumper', 'radar')) {
      adasSystems.push(
        'Front Radar Calibration Required — Toolbox verification required after radar unit replacement or adjustment.'
      );
      rationaleItems.push(
        'Front bumper or radar repair detected: Front radar calibration required via Tesla Toolbox.'
      );
    }
    if (hasRepair('rear bumper')) {
      adasSystems.push(
        'Rear Camera and Ultrasonic Sensor Verification Required — Toolbox operation check required.'
      );
      rationaleItems.push(
        'Rear bumper repair detected: Rear camera and ultrasonic sensor operation check required via Toolbox.'
      );
    }
    if (hasRepair('side mirror', 'door', 'mirror')) {
      adasSystems.push(
        'Side Pillar Camera Calibration Required — B-pillar and repeater cameras require Toolbox verification. ' +
        'Even structural shifts near mounting points require calibration check.'
      );
      rationaleItems.push(
        'Door or mirror repair detected: Side pillar / B-pillar camera calibration check required via Toolbox.'
      );
    }
    if (hasRepair('wheel alignment', 'alignment', 'suspension')) {
      adasSystems.push(
        'Autopilot Camera Recalibration Required — Suspension or alignment changes affect camera geometry. ' +
        'Drive cycle recalibration required.'
      );
      rationaleItems.push(
        'Wheel alignment or suspension repair detected: Autopilot camera recalibration required via drive cycle.'
      );
    }
    liabilityWarning =
      'Tesla requires Toolbox diagnostic software before and after ALL component replacements. Tesla alerts are NOT standard DTCs — ' +
      'do not rely on OBDII scan tools. High voltage isolation procedure MANDATORY before repair begins. ' +
      'Failure to follow Tesla repair procedures may void warranty and create liability exposure.';
    makeSpecificNotes =
      'Tesla collision repair information available FREE at service.tesla.com — no login required for Collision Repair Procedures. ' +
      'Toolbox 3 subscription required for diagnostic software. HV gloves minimum Class 0 (1000V) rating required. ' +
      'HV battery underside inspection required per TN-18-16-001 (Model 3/Y) or TN-14-16-004 (Model S/X) if any underside damage suspected. ' +
      'Tesla does not publish a traditional pre/post scan position statement — scan requirements are embedded in each service manual procedure. ' +
      'Camera calibration is a DRIVE CYCLE procedure via touchscreen Service menu, not a static target board calibration.';
  }

  // ─── Default (all other makes) ────────────────────────────────────────────
  else {
    preScanRequired  = 'RECOMMENDED';
    postScanRequired = 'RECOMMENDED';
    approvedScanTool = 'Consult OEM service information for approved diagnostic tool';
    sourceCitation   = 'OEM Position Statement';

    if (hasRepair('windshield')) {
      adasSystems.push('Front Camera/Sensor Inspection and Calibration Required');
      rationaleItems.push(
        'Windshield repair detected: Front camera/sensor inspection and calibration required. ' +
        'Consult OEM service information for this vehicle.'
      );
    }
    liabilityWarning =
      'ADAS calibration may be required. Verify OEM repair procedures for this vehicle.';
    makeSpecificNotes =
      'Consult OEM service information to confirm calibration requirements and procedures.';
  }

  // ─── Universal: Door / Mirror Repair ──────────────────────────────────────
  // Side obstacle / side-object output is ONLY triggered by door or mirror-related repair work.
  // It does NOT trigger for windshield, front bumper, rear bumper, hood, or fender alone.
  if (hasDoorRepair()) {
    adasSystems.push(
      'Side Mirror Camera(s) — Inspection and Verification Required: Side mirror cameras must be inspected and ' +
      'verified through calibration setup procedure after any door or mirror work regardless of whether camera unit ' +
      'was replaced. Confirm lens clarity, correct aim, and full system function. Lens contamination, angle shift from ' +
      'reinstallation, heat exposure, and physical shock can all affect camera accuracy without visible damage.'
    );
    rationaleItems.push(
      'Door or mirror repair detected: Universal side mirror camera inspection and verification required per best practices.'
    );

    // Side obstacle / side-object system check — only because door/mirror repair is present
    adasSystems.push(
      'Side Obstacle / Side Object System Check: Required only when door or mirror repair is performed, if equipped. ' +
      'Verify side obstacle / side-object system operation if equipped. ' +
      'Test and verify related side-object / lane-change assist functions after repair.'
    );
    rationaleItems.push(
      'Reason: Door / mirror area repairs may affect side-object detection, lane-change assist, mirror-mounted components, or related modules depending on vehicle equipment.'
    );

    // Make-specific blind spot / side obstacle flags
    if (makeLower.includes('toyota') || makeLower.includes('lexus') || makeLower.includes('scion')) {
      adasSystems.push(
        'Blind Spot Monitor (BSM) — Operation Check Required if equipped. Rear quarter panel radar units may be affected by door or side panel work.'
      );
      rationaleItems.push('Toyota/Lexus: Blind Spot Monitor operation check required after door/mirror repair.');
    } else if (makeLower.includes('ford') || makeLower.includes('lincoln')) {
      adasSystems.push(
        'Side Obstacle Detection Control Module (SODCM) — Operation Check Required. May affect Lane Change Assist function ' +
        'depending on trim level. Azimuth and Elevation System Check required per Ford WSM Section 413-13A.'
      );
      rationaleItems.push('Ford/Lincoln: SODCM operation check required after door/mirror repair per Ford WSM Section 413-13A.');
    } else if (makeLower.includes('honda') || makeLower.includes('acura')) {
      // LaneWatch and MVCS are handled in the main Honda/Acura block above.
      // This branch intentionally left as a no-op to avoid double-flagging.
    } else if (
      makeLower.includes('chevy') || makeLower.includes('chevrolet') ||
      makeLower.includes('gmc') || makeLower.includes('buick') || makeLower.includes('cadillac')
    ) {
      adasSystems.push('Side Blind Zone Alert — Operation Check Required if equipped.');
      rationaleItems.push('GM: Side Blind Zone Alert operation check required after door/mirror repair.');
    } else if (
      makeLower.includes('chrysler') || makeLower.includes('dodge') ||
      makeLower.includes('ram') || makeLower.includes('jeep') ||
      makeLower.includes('fiat') || makeLower.includes('stellantis') || makeLower.includes('fca')
    ) {
      adasSystems.push('Blind Spot Monitoring / ParkSense Side Sensors — Operation Check Required if equipped.');
      rationaleItems.push('FCA/Stellantis: Blind Spot Monitoring / ParkSense operation check required after door/mirror repair.');
    } else if (makeLower.includes('kia') || makeLower.includes('hyundai') || makeLower.includes('genesis')) {
      adasSystems.push(
        'Blind Spot Collision Warning / Surround View Monitor Side Cameras — Calibration Required if equipped.'
      );
      rationaleItems.push('Kia/Hyundai/Genesis: Blind Spot Collision Warning / Surround View Monitor calibration required after door/mirror repair.');
    } else if (makeLower.includes('mercedes') || makeLower.includes('benz')) {
      adasSystems.push('Blind Spot Assist Side Radar — Operation Check Required.');
      rationaleItems.push('Mercedes-Benz: Blind Spot Assist side radar operation check required after door/mirror repair.');
    } else if (makeLower.includes('nissan') || makeLower.includes('infiniti')) {
      adasSystems.push('Blind Spot Warning / Moving Object Detection — Operation Check Required if equipped.');
      rationaleItems.push('Nissan/Infiniti: Blind Spot Warning / Moving Object Detection operation check required after door/mirror repair.');
    } else if (makeLower.includes('subaru')) {
      adasSystems.push('Blind Spot Detection Side Radar — Operation Check Required if equipped.');
      rationaleItems.push('Subaru: Blind Spot Detection side radar operation check required after door/mirror repair.');
    } else {
      adasSystems.push(
        'Blind Spot / Side Obstacle Detection — Inspect and verify all side-mounted sensors and cameras per OEM procedure if equipped.'
      );
      rationaleItems.push('Universal: Blind Spot / Side Obstacle Detection inspection required after door/mirror repair.');
    }
  }

  // ─── Universal: EV / Hybrid High Voltage ──────────────────────────────────
  const evMakes = ['tesla', 'rivian', 'lucid'];
  const evModelKeywords = ['lightning', 'bolt', 'volt', 'ioniq', 'ev6', 'leaf', 'mach-e', 'id.4', 'bz4x', 'prius prime', 'rav4 prime', 'silverado ev', 'sierra ev'];
  const isEVRepair = hasRepair('ev / hybrid vehicle', 'ev/hybrid vehicle');
  const isEVMake   = evMakes.some(em => makeLower.includes(em));
  const isEVModel  = evModelKeywords.some(kw => modelLower.includes(kw.toLowerCase()));

  if (isEVRepair || isEVMake || isEVModel) {
    adasSystems.push(
      '\u26A1 HIGH VOLTAGE SYSTEM \u2014 EV/Hybrid Safety Protocol Required: ' +
      'Pre-repair: Confirm high voltage isolation per OEM procedure before beginning any repair work. ' +
      'HV-certified technician required for any work near battery, drive unit, or HV components. ' +
      'PPE required: Class 0 minimum (1000V) HV insulating gloves, safety glasses. ' +
      'Post-repair: HV system integrity verification required before returning vehicle to service. ' +
      'Refer to OEM Emergency Response Guide and vehicle-specific service manual for HV disable procedure.'
    );
    rationaleItems.push(
      'EV/Hybrid vehicle detected: Universal high voltage safety protocol required. HV isolation must be confirmed before repair.'
    );
  }

  // ─── Universal: Post-Repair Test & Verify ─────────────────────────────────
  // Required for all collision / wreck repair jobs regardless of calibration status.
  // This is an operational verification layer — it does not replace required scan or calibration items.
  adasSystems.push(
    'Post-Repair Test & Verify: Required — ' +
    'Vehicle involved in collision repair. Confirm proper operation of impacted driver-assist / safety systems after repairs are complete.'
  );
  rationaleItems.push(
    'Post-Repair Test & Verify: Required. Reason: Vehicle involved in collision repair. ' +
    'Confirm proper operation of impacted driver-assist / safety systems after repairs.'
  );

  return {
    adasSystems: adasSystems.join('\n'),
    rationale: rationaleItems.join('\n'),
    liabilityWarning,
    makeSpecificNotes,
    preScanRequired,
    postScanRequired,
    approvedScanTool,
    sourceCitation
  };
}

module.exports = { runADASEngine };
