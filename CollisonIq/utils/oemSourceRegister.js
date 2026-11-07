'use strict';
/**
 * CollisionIQ — OEM Source Register (US market)
 * Generated from OEM_ADAS_Collision_Repair_Document_Library_2026-10-29.xlsx
 * Public-document discovery index: scan policies, position statements, links.
 * NOT vehicle-specific service information. Links + short summaries only;
 * OEM documents remain manufacturer property.
 * Regenerate from the workbook rather than hand-editing the data blocks.
 */

const REGISTER_DATE = '2026-10-29';

const OEM_GROUPS = [
  {
    "group": "General Motors",
    "brands": "Chevrolet / GMC / Buick / Cadillac",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "Collision estimating & completed repair; minor damage/glass/electrical also addressed",
    "tooling": "GDS2 / MDI / Techline; follow SI",
    "sourceUpdated": "2026-03-09",
    "sourceType": "OEM PDF on GM Parts",
    "sourceUrl": "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/pre-and-post-collision-diagnostic-scans.pdf",
    "procedureSource": "GM SI / ACDelco TDS",
    "evidence": "YES - primary OEM PDF"
  },
  {
    "group": "Ford",
    "brands": "Ford / Lincoln",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "1996+; collision beyond minor outer-panel cosmetic distortion",
    "tooling": "IDS 1996-2018; FDRS 2018+; OEM interface",
    "sourceUpdated": "2025-10-01",
    "sourceType": "Ford OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/ford/statements/34781.pdf",
    "procedureSource": "Motorcraft Service workshop manual",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Honda",
    "brands": "Honda / Acura",
    "preScan": "Required preliminary scan",
    "postScan": "Required",
    "scope": "Qualifying collisions; body part replacement/electrical disconnect triggers post-scan",
    "tooling": "Honda i-HDS; body/repair manual",
    "sourceUpdated": "2025-07",
    "sourceType": "Honda OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/honda/position-statements/24823x.pdf",
    "procedureSource": "Honda ServiceExpress / TechInfo",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Toyota",
    "brands": "Toyota / Lexus / Scion",
    "preScan": "Necessary",
    "postScan": "Necessary",
    "scope": "Collision-damaged vehicles; Toyota CRIB #191 guidance",
    "tooling": "Toyota Techstream / Health Check",
    "sourceUpdated": "2021-07",
    "sourceType": "I-CAR analysis of OEM bulletin",
    "sourceUrl": "https://rts.i-car.com/crn-429.html",
    "procedureSource": "Toyota TIS / Lexus service info",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Nissan",
    "brands": "Nissan / Infiniti",
    "preScan": "Required (2008+)",
    "postScan": "Required (2008+)",
    "scope": "2007 and earlier separate recommendation; collision damage evaluation",
    "tooling": "CONSULT; Electronic Service Manual (ESM)",
    "sourceUpdated": "2025-11-01",
    "sourceType": "Nissan OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24715.pdf",
    "procedureSource": "Nissan TechInfo / CONSULT",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Stellantis",
    "brands": "Chrysler / Dodge / Jeep / Ram / Fiat / Alfa Romeo",
    "preScan": "Required within policy scope",
    "postScan": "Required within policy scope",
    "scope": "Collision events and relevant safety/security module operations",
    "tooling": "wiTECH; Stellantis service information",
    "sourceUpdated": "2025-12-01",
    "sourceType": "I-CAR compilation & OEM position",
    "sourceUrl": "https://rts.i-car.com/crn-1019.html?tmpl=component",
    "procedureSource": "Stellantis IOP / Mopar Repair Connect",
    "evidence": "Secondary index; OEM PDF may be inaccessible"
  },
  {
    "group": "Hyundai",
    "brands": "Hyundai",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "Collision involved, warning light not necessary",
    "tooling": "Hyundai OEM diagnostic software / tech info",
    "sourceUpdated": "2025-06-03",
    "sourceType": "Hyundai OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/hyundai/position-statements/31340x.pdf",
    "procedureSource": "Hyundai TechInfo",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Genesis",
    "brands": "Genesis",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "Updated 2026 OEM position, replaces older recommend wording",
    "tooling": "Genesis OEM diagnostics / tech info",
    "sourceUpdated": "2026-03-20 update",
    "sourceType": "I-CAR report of updated OEM position",
    "sourceUrl": "https://rts.i-car.com/crn-2402.html",
    "procedureSource": "Genesis TechInfo",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Kia",
    "brands": "Kia",
    "preScan": "Essential per OEM",
    "postScan": "Essential per OEM",
    "scope": "OEM statement describes scan operations as essential; verify exact model manual",
    "tooling": "Kia OEM diagnostics / KDS",
    "sourceUpdated": "2018 statement",
    "sourceType": "I-CAR OEM statement analysis",
    "sourceUrl": "https://rts.i-car.com/crn-868.html",
    "procedureSource": "Kia TechInfo",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Mazda",
    "brands": "Mazda",
    "preScan": "Required in updated policy",
    "postScan": "Required in updated policy",
    "scope": "2026 update to pre/post scan position",
    "tooling": "Mazda OEM scanner / service instructions",
    "sourceUpdated": "2026-09-03 update",
    "sourceType": "I-CAR report of OEM position",
    "sourceUrl": "https://rts.i-car.com/crn-2417.html",
    "procedureSource": "Mazda Service Info",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Subaru",
    "brands": "Subaru",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "2004+ vehicles subject to collision definition and applicable systems",
    "tooling": "Subaru Select Monitor SSM3 / SSM4; EyeSight",
    "sourceUpdated": "2020-08",
    "sourceType": "Subaru OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/subaru/position-statements/29235.pdf",
    "procedureSource": "Subaru TechInfo / EyeSight manual",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "BMW",
    "brands": "BMW / MINI",
    "preScan": "Preliminary diagnostics per SIB",
    "postScan": "Per ISTA repair plan",
    "scope": "Preliminary collision diagnostics and vehicle-specific repair plan",
    "tooling": "ISTA / BMW diagnosis / BMW TechInfo",
    "sourceUpdated": "SIB 41 05 19",
    "sourceType": "I-CAR summary of BMW service bulletin",
    "sourceUrl": "https://rts.i-car.com/crn-1356.html?tmpl=component",
    "procedureSource": "BMW TechInfo / ISTA",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Mercedes-Benz",
    "brands": "Mercedes-Benz",
    "preScan": "Highly recommended",
    "postScan": "Necessary",
    "scope": "1996+; full Xentry scan REQUIRED for collision, sensor/glass etc.",
    "tooling": "Xentry diagnostics; WIS",
    "sourceUpdated": "OEM statement undated",
    "sourceType": "MBUSA OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/mercedes-benz/position-statements/26689.pdf",
    "procedureSource": "Mercedes StarTekInfo / WIS",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Jaguar Land Rover",
    "brands": "Jaguar / Land Rover / Range Rover",
    "preScan": "Full diagnostic per collision guidance",
    "postScan": "Full diagnostic per repair guidance",
    "scope": "Collision and relevant electrical/mechanical/ADAS events",
    "tooling": "Pathfinder / SDD as applicable",
    "sourceUpdated": "2018 OEM policy",
    "sourceType": "I-CAR review of JLR global position",
    "sourceUrl": "https://rts.i-car.com/crn-1012.html?tmpl=component",
    "procedureSource": "Jaguar Land Rover TOPIx",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Audi",
    "brands": "Audi",
    "preScan": "Per manual (no standalone policy found)",
    "postScan": "Per manual (no standalone policy found)",
    "scope": "Service manual directs before/after DTC checks",
    "tooling": "ODIS / erWin repair info",
    "sourceUpdated": "2026-03-17 I-CAR",
    "sourceType": "I-CAR review of repair manual",
    "sourceUrl": "https://rts.i-car.com/crn-2405.html",
    "procedureSource": "Audi erWin / ODIS",
    "evidence": "Vehicle-specific OEM manual"
  },
  {
    "group": "Volkswagen",
    "brands": "Volkswagen",
    "preScan": "Per manual (no standalone policy found)",
    "postScan": "Per manual (no standalone policy found)",
    "scope": "Service manual directs before/after DTC checks",
    "tooling": "ODIS / erWin repair info",
    "sourceUpdated": "2026-03-17 I-CAR",
    "sourceType": "I-CAR review of repair manual",
    "sourceUrl": "https://rts.i-car.com/crn-2406.html",
    "procedureSource": "VW erWin / ODIS",
    "evidence": "Vehicle-specific OEM manual"
  },
  {
    "group": "Porsche",
    "brands": "Porsche",
    "preScan": "Not established as general position",
    "postScan": "Not established as general position",
    "scope": "Check per-model repair instructions; don't infer exemption",
    "tooling": "PIWIS / Porsche service info",
    "sourceUpdated": "2026-10 index check",
    "sourceType": "I-CAR Porsche information",
    "sourceUrl": "https://rts.i-car.com/33827.html",
    "procedureSource": "Porsche PIWIS / service manual",
    "evidence": "No blanket public position located"
  },
  {
    "group": "Volvo",
    "brands": "Volvo",
    "preScan": "Required before any/all work",
    "postScan": "Required for any work",
    "scope": "Includes glass, bumpers, sensors, disconnected batteries; battery maintainer when connected to VIDA",
    "tooling": "VIDA",
    "sourceUpdated": "2024-11 update",
    "sourceType": "Volvo OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/volvo/position-statements/75868.pdf",
    "procedureSource": "Volvo VIDA / TechInfo",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Mitsubishi",
    "brands": "Mitsubishi",
    "preScan": "See model-level collision diagnostics",
    "postScan": "See model-level diagnostics",
    "scope": "Some post-collision diagnostic procedures apply even if airbags did not deploy",
    "tooling": "MUT-III / OEM service manual",
    "sourceUpdated": "2019 Eclipse Cross example",
    "sourceType": "I-CAR model-specific example",
    "sourceUrl": "https://rts.i-car.com/crn-1085.html",
    "procedureSource": "Mitsubishi OEM ServiceInfo",
    "evidence": "Model-specific not general"
  },
  {
    "group": "Tesla",
    "brands": "Tesla",
    "preScan": "Service alerts / mode; no universal statement found",
    "postScan": "Service alerts / mode; no universal statement found",
    "scope": "Tesla event-based alerts rather than conventional OEM DTC model",
    "tooling": "Tesla Service Mode / Toolbox",
    "sourceUpdated": "2024-06-07 I-CAR",
    "sourceType": "I-CAR OEM diagnostic process",
    "sourceUrl": "https://icarfmtest.rts.i-car.com/crn-2117.html",
    "procedureSource": "Tesla Service Manuals / Toolbox",
    "evidence": "OEM diagnostic method"
  },
  {
    "group": "Rivian",
    "brands": "R1T / R1S / EDV / R2",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "2026 policy; model generation changes calibration procedure",
    "tooling": "Rivian RiDE; Rivian-certified technician",
    "sourceUpdated": "2026-04-28",
    "sourceType": "Rivian OEM PDF mirrored by I-CAR",
    "sourceUrl": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/71359x.pdf",
    "procedureSource": "Rivian repair manuals",
    "evidence": "YES - OEM PDF mirror"
  },
  {
    "group": "Lucid",
    "brands": "Lucid Air / Gravity",
    "preScan": "Required",
    "postScan": "Required",
    "scope": "Lucid OEM collision position and LDS diagnostics",
    "tooling": "Lucid Diagnostic System; authenticated access",
    "sourceUpdated": "2026-10-02 I-CAR",
    "sourceType": "I-CAR OEM policy update",
    "sourceUrl": "https://rts.i-car.com/crn-2245.html",
    "procedureSource": "Lucid OEM service info",
    "evidence": "I-CAR OEM interpretation"
  },
  {
    "group": "Polestar",
    "brands": "Polestar",
    "preScan": "Not verified public policy",
    "postScan": "Not verified public policy",
    "scope": "OEM service repair instructions must be checked",
    "tooling": "Polestar TechHub",
    "sourceUpdated": "2026-10-29",
    "sourceType": "I-CAR OEM landing page",
    "sourceUrl": "https://rts.i-car.com/oem-information/polestar.html",
    "procedureSource": "Polestar TechHub",
    "evidence": "Only service portal found"
  },
  {
    "group": "Maserati",
    "brands": "Maserati",
    "preScan": "Not verified public policy",
    "postScan": "Not verified public policy",
    "scope": "Vehicle-specific service/ADAS documents",
    "tooling": "Maserati TechInfo",
    "sourceUpdated": "2026-10-29",
    "sourceType": "I-CAR OEM landing page",
    "sourceUrl": "https://rts.i-car.com/oem-information/maserati.html",
    "procedureSource": "Maserati TechInfo",
    "evidence": "Only service portal found"
  },
  {
    "group": "Rolls-Royce",
    "brands": "Rolls-Royce",
    "preScan": "Not verified public policy",
    "postScan": "Not verified public policy",
    "scope": "BMW tech infrastructure; make/model-specific repair plan",
    "tooling": "BMW TechInfo / OEM diagnosis",
    "sourceUpdated": "2026-10-29",
    "sourceType": "I-CAR OEM landing page",
    "sourceUrl": "https://rts.i-car.com/oem-information/rolls-royce.html",
    "procedureSource": "BMW TechInfo",
    "evidence": "Only service portal found"
  }
];

const DOCUMENTS = [
  {
    "manufacturer": "GM",
    "title": "GM Pre- and Post-Collision Diagnostic Scans",
    "format": "OEM-hosted PDF",
    "category": "Pre/Post Scan",
    "issued": "2026-03-09",
    "whyItMatters": "Pre/post scan required in collision repair process; review exceptions and other repair events",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/pre-and-post-collision-diagnostic-scans.pdf",
    "notes": null
  },
  {
    "manufacturer": "GM",
    "title": "GM Advanced Driver Assistance Systems Consideration",
    "format": "OEM-hosted PDF",
    "category": "ADAS / calibration",
    "issued": "2026-06-02",
    "whyItMatters": "ADAS checks and OEM repair procedure considerations",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/advanced-driver-assistance-systems-consideration.pdf",
    "notes": null
  },
  {
    "manufacturer": "GM",
    "title": "GM Bumper Fascia with ADAS",
    "format": "OEM-hosted PDF",
    "category": "Bumper / radar",
    "issued": "2026-06-23",
    "whyItMatters": "Refinishing thickness and substrate repair restrictions; fascia ADAS integrity",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/bumper-fascia-with-adas.pdf",
    "notes": null
  },
  {
    "manufacturer": "GM",
    "title": "GM Windshield Replacement",
    "format": "OEM-hosted PDF",
    "category": "Glass / forward camera",
    "issued": "2026-09-18",
    "whyItMatters": "Genuine glass and front camera learn requirements after relevant replacement",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/trade-professionals/position-statements/02-pdfs/windshield-replacement.pdf",
    "notes": null
  },
  {
    "manufacturer": "GM",
    "title": "GM Collision Position Statements index",
    "format": "OEM-hosted index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Other collision components, repair restrictions and glass",
    "access": "Public",
    "evidenceSource": "OEM source index",
    "url": "https://www.gmparts.com/trade-professionals/position-statements",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford required pre/post diagnostic scanning",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2025-10-01",
    "whyItMatters": "1996+ and collision damage beyond minor cosmetic distortion; IDS/FDRS",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/ford/statements/34781.pdf",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford ADAS integrity and technical imperatives",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2026-05-01",
    "whyItMatters": "Calibrations per vehicle procedure; DTC absence is not proof of no need",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/ford/statements/85186.pdf",
    "notes": "Direct current OEM statement hosted at I-CAR; earlier OEM1Stop copy under maintenance"
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford Bumper Fascia with ADAS Technology",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Bumper / radar",
    "issued": "2025-10-01",
    "whyItMatters": "OEM fascia parts, mounts, repairs and sensor alignment",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/ford/statements/44470.pdf",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford Use of OEM Glass",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Glass / forward camera",
    "issued": "2025-10-01",
    "whyItMatters": "Glass can affect camera and ADAS performance",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/ford/statements/41116.pdf",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford collision position statements",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "All Ford 2025/2026 OEM repair position statements",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/ford/ford-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Lincoln collision position statements",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Separate Lincoln statement listing",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/lincoln/lincoln-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Ford / Lincoln",
    "title": "Ford ADAS repair articles and requirements",
    "format": "I-CAR ADAS index",
    "category": "ADAS / calibration",
    "issued": "2026",
    "whyItMatters": "ADAS, bumper, OEM glass, pre/post article archive",
    "access": "Public",
    "evidenceSource": "I-CAR aggregation",
    "url": "https://rts.i-car.com/oem-information/ford/ford-adas.html",
    "notes": null
  },
  {
    "manufacturer": "Honda / Acura",
    "title": "American Honda Post-Collision Diagnostic Scan and Calibration Requirements",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2025-07",
    "whyItMatters": "Preliminary scan, post scan; camera/radar inspections and calibration requirements",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/honda/position-statements/24823x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Honda / Acura",
    "title": "American Honda Post-Collision Diagnostics explanation",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2025",
    "whyItMatters": "I-CAR explanation of current Honda/Acura collision policy",
    "access": "Public",
    "evidenceSource": "I-CAR interpretation",
    "url": "https://rts.i-car.com/crn-1126.html",
    "notes": null
  },
  {
    "manufacturer": "Honda / Acura",
    "title": "American Honda official TechInfo PDF",
    "format": "OEM-hosted PDF",
    "category": "Pre/Post Scan",
    "issued": "2025-07",
    "whyItMatters": "OEM host; may require access / may time out",
    "access": "OEM PDF URL indexed; response may time out",
    "evidenceSource": "OEM statement",
    "url": "https://techinfo.honda.com/rjanisis/pubs/web/ASP04485.pdf",
    "notes": null
  },
  {
    "manufacturer": "Toyota / Lexus / Scion",
    "title": "Toyota Collision Repair Information Bulletin CRIB #191",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2021-07",
    "whyItMatters": "Health Check and scan before and after collision repair",
    "access": "Public",
    "evidenceSource": "I-CAR reporting OEM bulletin",
    "url": "https://rts.i-car.com/crn-429.html",
    "notes": null
  },
  {
    "manufacturer": "Toyota / Lexus",
    "title": "OEM calibration requirements search",
    "format": "I-CAR calibration index",
    "category": "ADAS / calibration",
    "issued": "Current matrix",
    "whyItMatters": "Model/year/configuration-specific ADAS lookup; NOT a substitute for service manual",
    "access": "Public",
    "evidenceSource": "I-CAR research matrix",
    "url": "https://rts.i-car.com/oem-calibration-requirements-search.html",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan pre/post diagnostic scans position NPSB/25-946",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2025-11-01",
    "whyItMatters": "2008+ mandatory; review older-year guidance; CONSULT",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24715.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan ADAS Components NPSB/26-971",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2026-01-01",
    "whyItMatters": "No salvaged or aftermarket ADAS sensors; calibrate after removal/replacement and alignment per ESM",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/82767.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan front radar calibration position",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Front radar",
    "issued": "2016",
    "whyItMatters": "Radar alignment checks when shifted or jolted after accident",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24718x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan vehicle glass statement",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Glass / forward camera",
    "issued": "Legacy current index",
    "whyItMatters": "Front camera / windshield repair guidance",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24711x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan sonar fascia refinishing position",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Bumper / sonar",
    "issued": "Legacy current index",
    "whyItMatters": "Sensor and fascia refinishing constraints",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24720x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan / Infiniti",
    "title": "Nissan around view monitor camera calibration",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Surround-view camera",
    "issued": "Legacy current index",
    "whyItMatters": "AVM calibration/aiming context",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/24713x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan",
    "title": "Nissan ARIYA bumper repair restrictions",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Bumper / radar",
    "issued": "2025-2026 index",
    "whyItMatters": "ARIA-specific bumper/sensor considerations",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/nissan/position-statements/50757.pdf",
    "notes": null
  },
  {
    "manufacturer": "Nissan",
    "title": "Nissan position statements master index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Several dozen Nissan collision statements",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/nissan/nissan-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Infiniti",
    "title": "Infiniti position statements master index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Infiniti scanning, ADAS, fascia, camera policies",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/infiniti/infiniti-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Stellantis / Alfa Romeo",
    "title": "Stellantis scan tool usage and diagnostics statement",
    "format": "OEM PDF (OEM1Stop; maintenance)",
    "category": "Pre/Post Scan",
    "issued": "2025-12-01",
    "whyItMatters": "Before-after collision diagnostics and safety/security systems per OEM statement",
    "access": "OEM1Stop maintenance observed",
    "evidenceSource": "OEM statement",
    "url": "https://oem1stop.com/sites/default/files/Stellantis_Scan-Tool-Usage%2812-1-25%29.pdf",
    "notes": null
  },
  {
    "manufacturer": "Stellantis / Alfa Romeo",
    "title": "Alfa Romeo collision information source",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Official Stellantis IOP and Mopar info access paths",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/alfa-romeo.html",
    "notes": null
  },
  {
    "manufacturer": "Hyundai",
    "title": "Hyundai Pre-Repair and Post-Repair System Scanning",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2025-06-03",
    "whyItMatters": "Both expressly required regardless of warning light",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/hyundai/position-statements/31340x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Hyundai",
    "title": "Hyundai position statements index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2025",
    "whyItMatters": "Scan, 2025 bumper corner radar/sonar, 2023 glass, EV battery",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/hyundai/hyundai-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Hyundai",
    "title": "Hyundai ADAS article catalog",
    "format": "I-CAR ADAS index",
    "category": "ADAS / calibration",
    "issued": "2026",
    "whyItMatters": "2026 glass, 2025 sensors and bumper repair",
    "access": "Public",
    "evidenceSource": "I-CAR aggregation",
    "url": "https://rts.i-car.com/oem-information/hyundai/hyundai-adas.html",
    "notes": null
  },
  {
    "manufacturer": "Genesis",
    "title": "Genesis updated scanning position (2026)",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2026-03-20",
    "whyItMatters": "Required pre/post in 2026 update; do not rely on prior recommendation wording",
    "access": "Public",
    "evidenceSource": "I-CAR reporting OEM update",
    "url": "https://rts.i-car.com/crn-2402.html",
    "notes": null
  },
  {
    "manufacturer": "Genesis",
    "title": "Genesis position statements index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2025",
    "whyItMatters": "Bumper sensor/ultrasonic restrictions, heating; scanning covered in I-CAR update",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/genesis/genesis-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Genesis",
    "title": "Genesis 2026 OEM news index",
    "format": "I-CAR article index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "ADAS, procedures, 2026 scan update",
    "access": "Public",
    "evidenceSource": "I-CAR aggregation",
    "url": "https://rts.i-car.com/oem-information/genesis/i-car-news-genesis.html",
    "notes": null
  },
  {
    "manufacturer": "Kia",
    "title": "Kia pre-/post-repair scanning statement review",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2018",
    "whyItMatters": "OEM describes both as essential; consult latest model guidance",
    "access": "Public",
    "evidenceSource": "I-CAR OEM interpretation",
    "url": "https://rts.i-car.com/crn-868.html",
    "notes": null
  },
  {
    "manufacturer": "Kia",
    "title": "Kia OEM repair access overview",
    "format": "I-CAR OEM page",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Access to Kia TechInfo and calibration matrix",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/kia.html",
    "notes": null
  },
  {
    "manufacturer": "Mazda",
    "title": "Mazda updated pre/post scan policy",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2026-09-03",
    "whyItMatters": "Updated 2026 OEM requirement; primary PDF from index may need access",
    "access": "Public",
    "evidenceSource": "I-CAR OEM interpretation",
    "url": "https://rts.i-car.com/crn-2417.html",
    "notes": null
  },
  {
    "manufacturer": "Mazda",
    "title": "Mazda position statements index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Lists current scan statement and aftermarket parts",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/mazda/mazda-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Mazda",
    "title": "Mazda ADAS catalog",
    "format": "I-CAR ADAS index",
    "category": "ADAS / calibration",
    "issued": "2026",
    "whyItMatters": "Bumper cover, simultaneous radar, blind spot sensor pairs",
    "access": "Public",
    "evidenceSource": "I-CAR aggregation",
    "url": "https://rts.i-car.com/oem-information/mazda/mazda-adas.html",
    "notes": null
  },
  {
    "manufacturer": "Subaru",
    "title": "Subaru Pre- and Post-Repair Scanning position",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2020-08",
    "whyItMatters": "2004+ qualifying collision; scan and EyeSight",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/subaru/position-statements/29235.pdf",
    "notes": null
  },
  {
    "manufacturer": "BMW / MINI",
    "title": "BMW SIB 41 05 19 Preliminary Diagnostics",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2019",
    "whyItMatters": "Preliminary collision diagnostic guidance, individual ISTA repair plan",
    "access": "Public",
    "evidenceSource": "I-CAR OEM interpretation",
    "url": "https://rts.i-car.com/crn-1356.html?tmpl=component",
    "notes": null
  },
  {
    "manufacturer": "Mercedes-Benz",
    "title": "MBUSA Diagnostic Repairs Following a Collision",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "OEM undated",
    "whyItMatters": "Pre highly recommended / post necessary / Xentry required for collision events",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/mercedes-benz/position-statements/26689.pdf",
    "notes": null
  },
  {
    "manufacturer": "Mercedes-Benz",
    "title": "Mercedes-Benz position statement index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Diagnostic repairs following a collision",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/mercedes-benz/mercedes-benz-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Jaguar Land Rover",
    "title": "JLR collision pre/post diagnosis global position",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2018",
    "whyItMatters": "JLRGPS-02 details diagnostic events & SDD/Pathfinder; original PDF may be missing",
    "access": "Public",
    "evidenceSource": "I-CAR OEM interpretation",
    "url": "https://rts.i-car.com/crn-1012.html?tmpl=component",
    "notes": null
  },
  {
    "manufacturer": "Audi",
    "title": "Audi before/after scan per repair manual",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2026-03-17",
    "whyItMatters": "No separate position; manual DTC guidance; VIN-specific instructions",
    "access": "Public",
    "evidenceSource": "I-CAR reading OEM manual",
    "url": "https://rts.i-car.com/crn-2405.html",
    "notes": null
  },
  {
    "manufacturer": "Volkswagen",
    "title": "VW before/after scan per repair manual",
    "format": "I-CAR OEM analysis",
    "category": "Pre/Post Scan",
    "issued": "2026-03-17",
    "whyItMatters": "No separate position; manual DTC guidance; VIN-specific instructions",
    "access": "Public",
    "evidenceSource": "I-CAR reading OEM manual",
    "url": "https://rts.i-car.com/crn-2406.html",
    "notes": null
  },
  {
    "manufacturer": "Porsche",
    "title": "Porsche OEM scanning statement status",
    "format": "I-CAR OEM page",
    "category": "Pre/Post Scan",
    "issued": "2026",
    "whyItMatters": "No general standalone published position identified; verify PIWIS/OEM manual",
    "access": "Public",
    "evidenceSource": "I-CAR OEM guidance",
    "url": "https://rts.i-car.com/33827.html",
    "notes": null
  },
  {
    "manufacturer": "Volvo",
    "title": "Volvo scanning and diagnostics position",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2024-11",
    "whyItMatters": "Both required; battery maintainer with VIDA",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/volvo/position-statements/75868.pdf",
    "notes": null
  },
  {
    "manufacturer": "Volvo",
    "title": "Volvo position statements master index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "ADAS, windshield, EV battery post collision, steering, SRS, glass",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/volvo/volvo-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Volvo",
    "title": "Volvo ADAS 2026 glass and scan index",
    "format": "I-CAR ADAS index",
    "category": "Glass / forward camera",
    "issued": "2026-06-25",
    "whyItMatters": "Updated glass policy and scanning info",
    "access": "Public",
    "evidenceSource": "I-CAR aggregation",
    "url": "https://rts.i-car.com/oem-information/volvo/volvo-adas.html",
    "notes": null
  },
  {
    "manufacturer": "Mitsubishi",
    "title": "Mitsubishi Eclipse Cross post-collision diagnostics",
    "format": "I-CAR model analysis",
    "category": "Post collision",
    "issued": "2019",
    "whyItMatters": "Even without airbag deployment model-specific diagnostic procedure may apply",
    "access": "Public",
    "evidenceSource": "I-CAR OEM procedure excerpt",
    "url": "https://rts.i-car.com/crn-1085.html",
    "notes": null
  },
  {
    "manufacturer": "Tesla",
    "title": "Tesla pre/post repair scanning and alerts discussion",
    "format": "I-CAR OEM diagnostic method",
    "category": "Pre/Post Scan",
    "issued": "2024-06-07",
    "whyItMatters": "Service alerts, Service Mode and Toolbox; not ordinary DTC workflow",
    "access": "Public",
    "evidenceSource": "I-CAR OEM interpretation",
    "url": "https://icarfmtest.rts.i-car.com/crn-2117.html",
    "notes": null
  },
  {
    "manufacturer": "Tesla",
    "title": "Tesla official Service Mode",
    "format": "OEM technical portal",
    "category": "Diagnostics",
    "issued": "Current",
    "whyItMatters": "Vehicle Service Mode; access via Tesla service instructions",
    "access": "Public",
    "evidenceSource": "OEM service portal",
    "url": "https://service.tesla.com/en-US/service-mode",
    "notes": null
  },
  {
    "manufacturer": "Tesla",
    "title": "Tesla official diagnostic software / Toolbox",
    "format": "OEM technical portal",
    "category": "Diagnostics",
    "issued": "Current",
    "whyItMatters": "Toolbox subscription and diagnostic access",
    "access": "Public",
    "evidenceSource": "OEM service portal",
    "url": "https://service.tesla.com/en-US/diagnostic-software",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian pre/post scan position",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "Pre/Post Scan",
    "issued": "2026-04-28",
    "whyItMatters": "All models; certified technician, RiDE procedure and reports",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/71359x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian R1 Gen1 calibration document",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2026-04-28",
    "whyItMatters": "R1T/R1S MY2022-2024 sensors/calibration matrix",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/86912.pdf",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian R1 Gen2 calibration document",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2026-08-10",
    "whyItMatters": "R1T/R1S MY2025+ sensor calibration matrices, bumper/glass operations",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/86913.pdf",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian R2 ADAS calibration",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2026",
    "whyItMatters": "R2 calibration repair document; verify year/model coverage",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/86914.pdf",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian EDV / commercial van ADAS guidance",
    "format": "OEM PDF (I-CAR mirror)",
    "category": "ADAS / calibration",
    "issued": "2025",
    "whyItMatters": "EDV-specific ADAS systems and restrictions",
    "access": "Public",
    "evidenceSource": "OEM statement",
    "url": "https://rts.i-car.com/images/pdf/oem-info/rivian/position-statements/71350x.pdf",
    "notes": null
  },
  {
    "manufacturer": "Rivian",
    "title": "Rivian full OEM positions index",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Rivian scanning, sensor, crash/battery, ADAS positions",
    "access": "Public",
    "evidenceSource": "I-CAR document index",
    "url": "https://rts.i-car.com/oem-information/rivian/rivian-position-statements.html",
    "notes": null
  },
  {
    "manufacturer": "Lucid",
    "title": "Lucid pre/post repair system scanning",
    "format": "I-CAR OEM report",
    "category": "Pre/Post Scan",
    "issued": "2026-10-02",
    "whyItMatters": "Lucid Diagnostic System authentication and both required",
    "access": "Public",
    "evidenceSource": "I-CAR reporting OEM statement",
    "url": "https://rts.i-car.com/crn-2245.html",
    "notes": null
  },
  {
    "manufacturer": "Lucid",
    "title": "Lucid pre/post scan official PDF via OEM1Stop",
    "format": "OEM PDF (OEM1Stop; maintenance)",
    "category": "Pre/Post Scan",
    "issued": "2024-07-17",
    "whyItMatters": "Original published OEM position; provider may be temporarily unavailable",
    "access": "OEM1Stop maintenance observed",
    "evidenceSource": "OEM statement",
    "url": "https://www.oem1stop.com/sites/default/files/Lucid_POS_Pre-and-Post-Scan%287-24%29.pdf",
    "notes": null
  },
  {
    "manufacturer": "Polestar",
    "title": "Polestar OEM access via TechHub",
    "format": "I-CAR OEM page",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Entry to official service manuals and available positions",
    "access": "Public",
    "evidenceSource": "I-CAR directory",
    "url": "https://rts.i-car.com/oem-information/polestar.html",
    "notes": null
  },
  {
    "manufacturer": "Maserati",
    "title": "Maserati official service access / ADAS index",
    "format": "I-CAR OEM page",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "TechInfo Maserati, OEM repair manuals and ADAS",
    "access": "Public",
    "evidenceSource": "I-CAR directory",
    "url": "https://rts.i-car.com/oem-information/maserati.html",
    "notes": null
  },
  {
    "manufacturer": "Rolls-Royce",
    "title": "Rolls-Royce collision service access",
    "format": "I-CAR OEM page",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "Official technical info through BMW service infrastructure",
    "access": "Public",
    "evidenceSource": "I-CAR directory",
    "url": "https://rts.i-car.com/oem-information/rolls-royce.html",
    "notes": null
  },
  {
    "manufacturer": "Multi-OEM",
    "title": "I-CAR OEM pre/post repair scanning statements list",
    "format": "I-CAR document index",
    "category": "Pre/Post Scan",
    "issued": "2026",
    "whyItMatters": "Cross-make list with links to OEM statements and interpretation",
    "access": "Public",
    "evidenceSource": "I-CAR directory",
    "url": "https://rts.i-car.com/crn-1019.html?tmpl=component",
    "notes": null
  },
  {
    "manufacturer": "Multi-OEM",
    "title": "I-CAR OEM calibration requirements search",
    "format": "I-CAR calibration matrix",
    "category": "ADAS / calibration",
    "issued": "Current",
    "whyItMatters": "Year, make, model, system calibration trigger tables; not full US coverage",
    "access": "Public",
    "evidenceSource": "I-CAR matrix",
    "url": "https://rts.i-car.com/oem-calibration-requirements-search.html",
    "notes": null
  },
  {
    "manufacturer": "Multi-OEM",
    "title": "I-CAR OEM information landing page",
    "format": "I-CAR OEM index",
    "category": "OEM library",
    "issued": "2026",
    "whyItMatters": "38 named OEM brands and service links",
    "access": "Public",
    "evidenceSource": "I-CAR directory",
    "url": "https://rts.i-car.com/oem-information.html",
    "notes": null
  }
];

const GENERIC_TRIGGERS = [
  {
    "event": "Pre-scan at intake",
    "subsystem": "Any qualifying collision",
    "checks": "Baseline vehicle health report, DTCs/modules, time/date, miles, battery state",
    "sourceToConsult": "OEM position statement + VIN-specific scanning directions",
    "evidenceToSave": "Pre-scan PDF, estimate annotations, stored faults",
    "limitation": "Not all OEMs use identical 'required' language"
  },
  {
    "event": "Visual ADAS walkaround",
    "subsystem": "Collision regardless of dashboard MIL",
    "checks": "Record sensor lenses, brackets, mounts, clips, fascia, glass and observed displacement",
    "sourceToConsult": "OEM component inspection / body repair manual",
    "evidenceToSave": "Photo set, damage map, sensor inventory",
    "limitation": "Sensor damage can be nonvisible"
  },
  {
    "event": "Front windshield replacement",
    "subsystem": "Forward camera, rain/light sensor, heads-up display",
    "checks": "Camera learn / static+dynamic as OEM directs, windshield type, glass procedures",
    "sourceToConsult": "Windshield, forward camera calibration sections",
    "evidenceToSave": "Glass part ID, calibration result, scan",
    "limitation": "Some vehicles perform dynamic only, others static+dynamic"
  },
  {
    "event": "Front bumper/fascia refinish",
    "subsystem": "Front-center radar, parking sensors, front cameras",
    "checks": "Paint thickness/type, restricted sensor zones, replace-vs-repair rules",
    "sourceToConsult": "ADAS bumper/fascia OEM statement + manual",
    "evidenceToSave": "Fascia photo, material record, paint film checks",
    "limitation": "Do NOT generalize GM 13-mil limit to other OEMs"
  },
  {
    "event": "Front fascia / radar bracket R&I",
    "subsystem": "ACC radar / AEB",
    "checks": "Radar bracket mounting, bumper dimensions, aiming procedure",
    "sourceToConsult": "Front radar aiming + bumper removal procedure",
    "evidenceToSave": "R&I record, bracket part, aiming result",
    "limitation": "Impact without replacement can still affect alignment"
  },
  {
    "event": "Rear fascia / quarter repair",
    "subsystem": "BSM rear corner radar / ultrasonic",
    "checks": "Sensor zone repairability and radar aiming criteria",
    "sourceToConsult": "OEM BSM sensor calibration + bumper policy",
    "evidenceToSave": "Rear photos, sensor measurements, calibration",
    "limitation": "Resin/filler/paint can affect radar transmission"
  },
  {
    "event": "Side mirror or camera replacement",
    "subsystem": "Side cameras, BSM indicators",
    "checks": "Camera surround-view calibration, wiring, mirror spec",
    "sourceToConsult": "Side camera aiming + replacement",
    "evidenceToSave": "Camera test image, scan record",
    "limitation": "Often equipment-dependent"
  },
  {
    "event": "Alignment / suspension/steering",
    "subsystem": "Steering-angle / camera / radar",
    "checks": "Check wheel geometry, ride height, SAS and camera/radar references",
    "sourceToConsult": "OEM alignment + ADAS trigger matrix",
    "evidenceToSave": "Before/after alignment printout, calibration results",
    "limitation": "Alignment is prerequisite on some cars and a calibration trigger on others"
  },
  {
    "event": "Structural / frame straightening",
    "subsystem": "Sensor brackets; SRS; radar sensor location",
    "checks": "Verify body dimensions, mounts, sensor angles before calibration",
    "sourceToConsult": "OEM body repair manual + ADAS calibration prerequisites",
    "evidenceToSave": "Bench measurements, photos, repair record",
    "limitation": "Calibration cannot compensate for incorrect structural geometry"
  },
  {
    "event": "Camera/radar replacement",
    "subsystem": "Sensor and ECU",
    "checks": "Model-specific coding, programming, aiming, calibration and verification",
    "sourceToConsult": "OEM component replacement + ECU setup",
    "evidenceToSave": "Part ID, calibration log, programmed configuration",
    "limitation": "Some OEMs prohibit recycled ADAS sensors"
  },
  {
    "event": "Airbag/SRS deployment",
    "subsystem": "SRS ECU, seatbelt, crash sensors",
    "checks": "Post-collision SRS checks and replacement criteria; for Honda/Acura include front passenger seat weight system operational check even with no deployment",
    "sourceToConsult": "OEM SRS post-collision inspection",
    "evidenceToSave": "SRS reports and parts record",
    "limitation": "Honda 2025 statement: seat weight sensor check after ANY collision, regardless of airbags; calibrate after applicable seat component R&I."
  },
  {
    "event": "12V battery disconnect",
    "subsystem": "All networked modules",
    "checks": "Review initialization, lost learned values, fault memory and vehicle-specific effects",
    "sourceToConsult": "OEM battery disconnect procedures",
    "evidenceToSave": "Disconnect time, voltages, relearns",
    "limitation": "Not a blanket ADAS calibration for all models"
  },
  {
    "event": "HV EV post-crash",
    "subsystem": "HV isolation and battery structures",
    "checks": "Quarantine/disable/assess per OEM qualified high-voltage safety process",
    "sourceToConsult": "EV post-collision and battery handling OEM docs",
    "evidenceToSave": "HV assessment, incident/repair record",
    "limitation": "Safety-critical; qualified personnel only"
  },
  {
    "event": "Post-repair scan",
    "subsystem": "After all repairs/calibrations",
    "checks": "All modules, code history, new faults, readiness/system state",
    "sourceToConsult": "OEM scan statement + vehicle diagnostics",
    "evidenceToSave": "Post-scan PDF, cleared DTC reasoning, screenshots",
    "limitation": "Scan alone not proof of correct aim"
  },
  {
    "event": "Dynamic calibration / road test",
    "subsystem": "When OEM requires it",
    "checks": "Prescribed speeds, lane lines, illumination, weather and road conditions",
    "sourceToConsult": "VIN-specific calibration test procedure",
    "evidenceToSave": "Conditions and completion report",
    "limitation": "Do not substitute arbitrary road test for OEM conditions"
  },
  {
    "event": "Final QC",
    "subsystem": "After scan and ADAS routine",
    "checks": "Independent verification of sensors, warning lights, repair completeness",
    "sourceToConsult": "OEM repair procedure + shop QC policy",
    "evidenceToSave": "QC signoff; scan vs calibration crosscheck",
    "limitation": "QC separation from technician is shop workflow, not every OEM mandate"
  }
];

const WORKFLOW = [
  {
    "step": "01",
    "phase": "Intake / triage",
    "action": "Record VIN, model year, trim, equipment, scan feasibility, collision direction",
    "role": "Estimation / front desk",
    "record": "VIN decode + photos + repair order",
    "caveat": "Do not guess ADAS equipment solely from trim"
  },
  {
    "step": "02",
    "phase": "Safety isolate",
    "action": "Secure hazards: SRS, structural integrity, battery and EV HV as applicable",
    "role": "Qualified technician",
    "record": "Safety log and OEM disable reference",
    "caveat": "Vehicle must be safe before touching/testing"
  },
  {
    "step": "03",
    "phase": "Pre-repair scan",
    "action": "Perform OEM-compatible full system pre-scan as early as safely possible",
    "role": "Diagnostic technician",
    "record": "Original raw scan report and DTC notes",
    "caveat": "If impossible, document WHY and state limitations"
  },
  {
    "step": "04",
    "phase": "OEM research",
    "action": "Pull scanning position and VIN-specific manual incl. all pertinent R&I operations",
    "role": "Estimator + technician",
    "record": "Document ID, revision/date, URLs/subscription",
    "caveat": "Do not treat position statement as a calibration procedure"
  },
  {
    "step": "05",
    "phase": "Damage blueprint",
    "action": "Review bumper/glass/ADAS sensors/structural mounts + affected systems",
    "role": "Estimator + collision technician",
    "record": "Collision damage map, relevant photos",
    "caveat": "Scope may change during teardown"
  },
  {
    "step": "06",
    "phase": "Repair plan & alignment",
    "action": "Write parts, body geometry, alignment, scan and calibration operations",
    "role": "Repair planner",
    "record": "Operations matrix and prerequisite list",
    "caveat": "Align and measure as OEM procedure requires"
  },
  {
    "step": "07",
    "phase": "Repair execution",
    "action": "Complete approved repairs / inspect sensor components & wiring",
    "role": "Repair team",
    "record": "Parts, work orders, photos",
    "caveat": "Use applicable OEM component/paint restrictions"
  },
  {
    "step": "08",
    "phase": "Prerequisite check",
    "action": "Confirm level surface/lighting/targets/ride-height/tires/alignment when required",
    "role": "ADAS technician",
    "record": "Preflight checklist",
    "caveat": "May vary greatly by make/model"
  },
  {
    "step": "09",
    "phase": "Calibration / programming",
    "action": "Perform specified static/dynamic aiming, coding, initialization, learning",
    "role": "ADAS technician",
    "record": "Tool output, target ID, setup notes, results",
    "caveat": "Need exact manual; no generic universal distance"
  },
  {
    "step": "10",
    "phase": "Post-repair scan",
    "action": "Full scan, resolve faults and record module status after calibrations",
    "role": "Diagnostic technician",
    "record": "Post-scan raw report",
    "caveat": "No DTC does not mean calibration was unnecessary"
  },
  {
    "step": "11",
    "phase": "Validation / road test",
    "action": "Follow OEM test drive / dynamic calibration and performance checks",
    "role": "Qualified technician",
    "record": "Drive log; OEM completion evidence",
    "caveat": "Do not test ADAS unsafely or off-spec"
  },
  {
    "step": "12",
    "phase": "Final independent QC",
    "action": "Crosscheck completed operations against OEM documentation and reports",
    "role": "QC / estimator",
    "record": "Signed checklist and customer repair packet",
    "caveat": "Independent QC is recommended shop practice"
  }
];

// -----------------------------------------------------------------------------
// Brand → OEM group lookup
// -----------------------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const EXTRA_ALIASES = {
  'General Motors': ['gm', 'chevy', 'generalmotors'],
  Stellantis: ['fca', 'chrysler', 'mopar'],
  Rivian: ['rivian'],
  Lucid: ['lucid', 'lucidmotors'],
  'Mercedes-Benz': ['mercedes', 'mb', 'mercedesbenz'],
  'Jaguar Land Rover': ['jlr', 'jaguar', 'landrover', 'rangerover'],
  BMW: ['bmw', 'mini'],
  Volkswagen: ['vw', 'volkswagen'],
};

const BRAND_INDEX = {};
for (const g of OEM_GROUPS) {
  const aliases = new Set([norm(g.group), ...(EXTRA_ALIASES[g.group] || [])]);
  String(g.brands || '').split('/').forEach((b) => aliases.add(norm(b)));
  for (const a of aliases) if (a && !BRAND_INDEX[a]) BRAND_INDEX[a] = g.group;
}

function findGroup(make) {
  const name = BRAND_INDEX[norm(make)];
  return name ? OEM_GROUPS.find((g) => g.group === name) : null;
}

// Library rows use "Ford / Lincoln", "Nissan / Infiniti", "Multi-OEM", etc.
function documentsFor(make) {
  const g = findGroup(make);
  if (!g) return [];
  const tokens = new Set([norm(g.group), ...String(g.brands).split('/').map(norm), ...(EXTRA_ALIASES[g.group] || [])]);
  return DOCUMENTS.filter((d) =>
    String(d.manufacturer).split('/').some((m) => tokens.has(norm(m)))
  );
}

const MULTI_OEM_DOCS = DOCUMENTS.filter((d) => d.manufacturer === 'Multi-OEM');

// -----------------------------------------------------------------------------
// Source freshness (older than 3 years from register date, or undated → stale)
// -----------------------------------------------------------------------------
function sourceAge(updated) {
  const m = String(updated || '').match(/(19|20)\d{2}(-\d{2})?/);
  if (!m) return { year: null, stale: true, reason: 'Undated or non-date reference' };
  const [y, mo] = m[0].split('-').map(Number);
  const months = (2026 - y) * 12 + (10 - (mo || 6));
  return { year: y, stale: months > 36, reason: months > 36 ? `Source ~${Math.round(months / 12)} years old` : null };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
function scanPolicy(make) {
  const g = findGroup(make);
  if (!g) {
    return {
      found: false,
      make,
      message: 'No OEM group in register. Absence of a public statement is not an exemption; consult the VIN-specific OEM repair manual.',
      generalSources: MULTI_OEM_DOCS,
    };
  }
  const age = sourceAge(g.sourceUpdated);
  const flags = [];
  if (age.stale) flags.push({ level: 'warning', code: 'SOURCE_STALE', text: `${g.group} scan policy: ${age.reason}. Verify current OEM position.` });
  if (/not verified|not established|no standalone|no universal|model-level|per manual/i.test(`${g.preScan} ${g.postScan}`)) {
    flags.push({ level: 'info', code: 'NO_BLANKET_POLICY', text: `${g.group} has no blanket public scan policy. Follow the VIN-specific repair manual; this is not an exemption.` });
  }
  if (/inaccessible|maintenance/i.test(`${g.evidence} ${g.sourceType}`)) {
    flags.push({ level: 'info', code: 'SOURCE_ACCESS', text: 'Primary source may be temporarily inaccessible; use the I-CAR mirror.' });
  }
  return {
    found: true,
    group: g.group,
    brands: g.brands,
    preRepairScan: g.preScan,
    postRepairScan: g.postScan,
    scope: g.scope,
    tooling: g.tooling,
    serviceInfo: g.procedureSource,
    source: { url: g.sourceUrl, type: g.sourceType, updated: g.sourceUpdated, evidenceLevel: g.evidence },
    documents: documentsFor(make),
    flags,
    registerDate: REGISTER_DATE,
  };
}

module.exports = {
  REGISTER_DATE,
  OEM_GROUPS,
  DOCUMENTS,
  GENERIC_TRIGGERS,
  WORKFLOW,
  findGroup,
  documentsFor,
  scanPolicy,
  listMakes: () => Object.keys(BRAND_INDEX).sort(),
};
