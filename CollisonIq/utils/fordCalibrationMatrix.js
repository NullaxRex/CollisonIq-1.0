'use strict';
/**
 * CollisionIQ — Ford calibration requirements matrix (DATA ONLY)
 * -----------------------------------------------------------------------------
 * Transcribed from I-CAR "OEM Calibration Requirements Search" pages for the
 * vehicles below, printed to PDF on 2026-03-24 (one PDF per vehicle, kept in
 * the CollisionIQ project files). I-CAR states the matrix is based on OEM
 * vehicle-specific repair information; Ford service information governs.
 *
 * Event strings, OEM names, locations and notes are kept exactly as I-CAR
 * printed them. dtcSet / scanToolRequired / specialToolsRequired are the
 * Yes / No / Not identified columns of each entry.
 *
 * Do not hand-edit entries: re-export the I-CAR page and re-transcribe, so the
 * capture date stays true. Mapping of these strings to CollisionIQ repair
 * events lives in oemFordRules.js.
 */

const CAPTURED = '2026-03-24';

const VEHICLES = [
  {
    "make": "Ford",
    "model": "Bronco",
    "year": 2021,
    "title": "2021 Ford Bronco",
    "url": "https://rts.i-car.com/calv-4496.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco",
    "year": 2022,
    "title": "2022 Ford Bronco",
    "url": "https://rts.i-car.com/calv-4497.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco",
    "year": 2023,
    "title": "2023 Ford Bronco",
    "url": "https://rts.i-car.com/calv-4498.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco",
    "year": 2024,
    "title": "2024 Ford Bronco",
    "url": "https://rts.i-car.com/calv-4499.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco",
    "year": 2025,
    "title": "2025 Ford Bronco",
    "url": "https://rts.i-car.com/calv-4508.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco Sport",
    "year": 2021,
    "title": "2021 Ford Bronco Sport",
    "url": "https://rts.i-car.com/calv-4500.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If liftgate handle or latch is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: steering angle sensor, turn signal switch"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco Sport",
    "year": 2022,
    "title": "2022 Ford Bronco Sport",
    "url": "https://rts.i-car.com/calv-4501.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If liftgate handle or latch is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: steering angle sensor, turn signal switch"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco Sport",
    "year": 2023,
    "title": "2023 Ford Bronco Sport",
    "url": "https://rts.i-car.com/calv-4502.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If liftgate handle or latch is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco Sport",
    "year": 2024,
    "title": "2024 Ford Bronco Sport",
    "url": "https://rts.i-car.com/calv-4503.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If liftgate handle or latch is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "Bronco Sport",
    "year": 2025,
    "title": "2025 Ford Bronco Sport",
    "url": "https://rts.i-car.com/calv-4509.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If liftgate handle or latch is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille (Lower)",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Quarter Panel Behind Bumper Cover",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-150",
    "year": 2025,
    "title": "2025 Ford F-150",
    "url": "https://rts.i-car.com/calv-4519.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If tailgate or tailgate handle is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof",
        "oemName": "Center High Mount Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Left)",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Sides)",
        "oemName": "Side Obstacle Detection Control Module C/D",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: vehicle speed sensor, steering angle sensor, turn signal switch"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (1)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: steering angle sensor, vehicle speed sensor"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (2)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-150 Hybrid",
    "year": 2025,
    "title": "2025 Ford F-150 Hybrid",
    "url": "https://rts.i-car.com/calv-4520.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If tailgate or tailgate handle is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof",
        "oemName": "Center High Mount Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Left)",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Sides)",
        "oemName": "Side Obstacle Detection Control Module C/D",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: vehicle speed sensor, steering angle sensor, turn signal switch"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (1)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: steering angle sensor, vehicle speed sensor"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (2)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-150 Lightning",
    "year": 2025,
    "title": "2025 Ford F-150 Lightning",
    "url": "https://rts.i-car.com/calv-4521.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If tailgate or tailgate handle is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof",
        "oemName": "Center High Mount Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Left)",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille (Sides)",
        "oemName": "Side Obstacle Detection Control Module C/D",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: vehicle speed sensor, steering angle sensor, turn signal switch"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (1)",
        "oemName": "(multiple inputs)",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Not identified",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: steering angle sensor, vehicle speed sensor"
      },
      {
        "location": "Sensor(s) in Additional Location(s) (2)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp (Sides)",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-250",
    "year": 2025,
    "title": "2025 Ford F-250",
    "url": "https://rts.i-car.com/calv-4526.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (Rear View Only)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If high mounted stop lamp is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (With 360° View)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-350",
    "year": 2025,
    "title": "2025 Ford F-350",
    "url": "https://rts.i-car.com/calv-4527.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (Rear View Only)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If high mounted stop lamp is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (With 360° View)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-450",
    "year": 2025,
    "title": "2025 Ford F-450",
    "url": "https://rts.i-car.com/calv-4528.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (Rear View Only)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If high mounted stop lamp is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (With 360° View)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-550",
    "year": 2025,
    "title": "2025 Ford F-550",
    "url": "https://rts.i-car.com/calv-4529.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (Rear View Only)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If high mounted stop lamp is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (With 360° View)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  },
  {
    "make": "Ford",
    "model": "F-600",
    "year": 2025,
    "title": "2025 Ford F-600",
    "url": "https://rts.i-car.com/calv-4536.html",
    "captured": "2026-03-24",
    "systems": [
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (Rear View Only)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Deck Lid/Liftgate/Tailgate (With 360° View)",
        "oemName": "Rear Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (Rear View Only)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If high mounted stop lamp is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Headliner/Roof (With 360° View)",
        "oemName": "Center High Mounted Stop Lamp Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Left)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera in Side Mirror (Right)",
        "oemName": "Side Parking Aid Camera",
        "events": [
          "If any camera or body component that camera is attached to is removed/installed, replaced, or adjusted",
          "If DTC indicates"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Camera Near Rearview Mirror",
        "oemName": "Image Processing Module A Camera",
        "events": [
          "After front airbag deployment",
          "If camera is removed/installed or replaced",
          "If DTC indicates",
          "If suspension is repaired or aligned",
          "If tire size is changed",
          "If windshield is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      },
      {
        "location": "Sensor(s) Behind Front Bumper Cover/Grille",
        "oemName": "Cruise Control Module",
        "events": [
          "If DTC indicates",
          "If front bumper cover/grille is removed/installed or replaced",
          "If sensor is removed/installed or replaced",
          "If sensor mounting bracket is removed/installed or replaced",
          "If vehicle has been in a collision"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes"
      },
      {
        "location": "Sensor(s) in Additional Location(s)",
        "oemName": "(multiple inputs)",
        "events": [
          "If DTC indicates",
          "If leveling sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified",
        "note": "Receives input from: front headlamp leveling sensor, rear headlamp leveling sensor, vehicle speed sensor, steering angle sensor"
      },
      {
        "location": "Sensor(s) in Front Bumper Cover/Grille",
        "oemName": "Front Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Rear Bumper Cover",
        "oemName": "Rear Parking Aid Sensor",
        "events": [
          "No calibration/initialization requirements found"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Yes",
        "note": "Per the Ford Workshop manual, operation checks are required. (Azimuth System Check, Elevation System Check)"
      },
      {
        "location": "Sensor(s) in Tail Lamp",
        "oemName": "Side Obstacle Detection Control Module",
        "events": [
          "If DTC indicates",
          "If sensor is removed/installed or replaced"
        ],
        "dtcSet": "Yes",
        "scanToolRequired": "Yes",
        "specialToolsRequired": "Not identified"
      }
    ]
  }
];

module.exports = { CAPTURED, VEHICLES };
