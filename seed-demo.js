'use strict';

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = new DatabaseSync('./collisioniq.db');

// ─── Shops ────────────────────────────────────────────────────────────────────

async function seedDemoShops() {
  const shops = [
    { name: 'Metro Collision Center',   address: '1420 Industrial Blvd, Houston TX 77001', phone: '713-555-0101' },
    { name: 'Northside Auto Repair',    address: '8801 N Freeway, Houston TX 77037',        phone: '713-555-0202' },
    { name: 'Southbelt Body Works',     address: '2200 Beltway 8 S, Houston TX 77089',      phone: '713-555-0303' },
    { name: 'Premier ADAS & Collision', address: '4455 Westheimer Rd, Houston TX 77027',    phone: '713-555-0404' },
    { name: 'Gulf Coast Auto Service',  address: '9900 Gulf Freeway, Houston TX 77017',     phone: '713-555-0505' },
  ];

  for (const shop of shops) {
    const existing = db.prepare('SELECT id FROM shops WHERE name = ?').get(shop.name);
    if (existing) {
      console.log(`  Shop already exists: ${shop.name} — skipping`);
    } else {
      db.prepare('INSERT INTO shops (name, address, phone) VALUES (?,?,?)').run(shop.name, shop.address, shop.phone);
      console.log(`  Created shop: ${shop.name}`);
    }
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function seedDemoUsers() {
  const password = await bcrypt.hash('demo1234', 10);

  const users = [
    // Metro Collision Center
    { shop: 'Metro Collision Center',   username: 'metro_admin',    role: 'shop_admin',     full_name: 'Metro Admin' },
    { shop: 'Metro Collision Center',   username: 'metro_qc',       role: 'qc_manager',     full_name: 'Metro QC Manager' },
    { shop: 'Metro Collision Center',   username: 'metro_tech1',    role: 'technician',     full_name: 'Tech One' },
    { shop: 'Metro Collision Center',   username: 'metro_tech2',    role: 'technician',     full_name: 'Tech Two' },
    { shop: 'Metro Collision Center',   username: 'metro_writer',   role: 'service_writer', full_name: 'Metro Service Writer' },
    // Northside Auto Repair
    { shop: 'Northside Auto Repair',    username: 'north_admin',    role: 'shop_admin',     full_name: 'Northside Admin' },
    { shop: 'Northside Auto Repair',    username: 'north_qc',       role: 'qc_manager',     full_name: 'Northside QC Manager' },
    { shop: 'Northside Auto Repair',    username: 'north_tech1',    role: 'technician',     full_name: 'North Tech One' },
    { shop: 'Northside Auto Repair',    username: 'north_writer',   role: 'service_writer', full_name: 'North Service Writer' },
    // Southbelt Body Works
    { shop: 'Southbelt Body Works',     username: 'south_admin',    role: 'shop_admin',     full_name: 'Southbelt Admin' },
    { shop: 'Southbelt Body Works',     username: 'south_qc',       role: 'qc_manager',     full_name: 'Southbelt QC Manager' },
    { shop: 'Southbelt Body Works',     username: 'south_tech1',    role: 'technician',     full_name: 'South Tech One' },
    { shop: 'Southbelt Body Works',     username: 'south_writer',   role: 'service_writer', full_name: 'South Service Writer' },
    // Premier ADAS & Collision
    { shop: 'Premier ADAS & Collision', username: 'premier_admin',  role: 'shop_admin',     full_name: 'Premier Admin' },
    { shop: 'Premier ADAS & Collision', username: 'premier_qc',     role: 'qc_manager',     full_name: 'Premier QC Manager' },
    { shop: 'Premier ADAS & Collision', username: 'premier_tech1',  role: 'technician',     full_name: 'Premier Tech One' },
    { shop: 'Premier ADAS & Collision', username: 'premier_tech2',  role: 'technician',     full_name: 'Premier Tech Two' },
    { shop: 'Premier ADAS & Collision', username: 'premier_writer', role: 'service_writer', full_name: 'Premier Service Writer' },
    // Gulf Coast Auto Service
    { shop: 'Gulf Coast Auto Service',  username: 'gulf_admin',     role: 'shop_admin',     full_name: 'Gulf Coast Admin' },
    { shop: 'Gulf Coast Auto Service',  username: 'gulf_qc',        role: 'qc_manager',     full_name: 'Gulf Coast QC Manager' },
    { shop: 'Gulf Coast Auto Service',  username: 'gulf_tech1',     role: 'technician',     full_name: 'Gulf Tech One' },
    { shop: 'Gulf Coast Auto Service',  username: 'gulf_writer',    role: 'service_writer', full_name: 'Gulf Service Writer' },
  ];

  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (existing) {
      console.log(`  User already exists: ${u.username} — skipping`);
      continue;
    }
    const shop = db.prepare('SELECT id FROM shops WHERE name = ?').get(u.shop);
    if (!shop) {
      console.log(`  Shop not found for user ${u.username} — skipping`);
      continue;
    }
    db.prepare('INSERT INTO users (shop_id, username, password_hash, role, full_name, active) VALUES (?,?,?,?,?,1)')
      .run(shop.id, u.username, password, u.role, u.full_name);
    console.log(`  Created user: ${u.username} (${u.role})`);
  }
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

function makeDemoJobId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `CIQ-${date}-${rand}`;
}

async function seedDemoJobs() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const demoJobs = [
    // Metro Collision Center — General Maintenance
    {
      shop: 'Metro Collision Center', techUsername: 'metro_tech1',
      track: 'general-maintenance', ro: 'RO-M001',
      vin: '1HGCV1F3XLA025410', year: '2020', make: 'Honda', model: 'Accord', trim: 'Sport',
      mileage: '45200', status: 'In Progress', repairsPerformed: 'Customer reports rough idle. Oil change due.',
    },
    {
      shop: 'Metro Collision Center', techUsername: 'metro_tech2',
      track: 'general-maintenance', ro: 'RO-M002',
      vin: '2T1BURHE0JC034301', year: '2018', make: 'Toyota', model: 'Corolla', trim: 'LE',
      mileage: '62000', status: 'Calibration Complete', repairsPerformed: 'Full inspection. Rear brakes yellow.',
    },
    // Metro Collision Center — Post-Collision
    {
      shop: 'Metro Collision Center', techUsername: 'metro_tech1',
      track: 'post-collision', collision_grade: 'MODERATE', ro: 'RO-M003',
      vin: '1G1ZD5ST4JF246849', year: '2018', make: 'Chevrolet', model: 'Malibu', trim: 'LT',
      mileage: '38900', status: 'In Progress', repairsPerformed: 'Windshield',
    },
    // Northside Auto Repair — Post-Collision
    {
      shop: 'Northside Auto Repair', techUsername: 'north_tech1',
      track: 'post-collision', collision_grade: 'MINOR', ro: 'RO-N001',
      vin: '1N4AL3AP7JC231503', year: '2018', make: 'Nissan', model: 'Altima', trim: 'S',
      mileage: '51000', status: 'Created', repairsPerformed: 'Rear Bumper',
    },
    {
      shop: 'Northside Auto Repair', techUsername: 'north_tech1',
      track: 'general-maintenance', ro: 'RO-N002',
      vin: '1FTFW1ET5DFC10312', year: '2013', make: 'Ford', model: 'F-150', trim: 'XLT',
      mileage: '97500', status: 'Calibration Complete', repairsPerformed: 'Oil change and tire rotation complete.',
    },
    // Premier ADAS & Collision — Post-Collision
    {
      shop: 'Premier ADAS & Collision', techUsername: 'premier_tech1',
      track: 'post-collision', collision_grade: 'MAJOR', ro: 'RO-P001',
      vin: '1C4RJFBG8FC198072', year: '2015', make: 'Jeep', model: 'Grand Cherokee', trim: 'Limited',
      mileage: '89000', status: 'In Progress', repairsPerformed: 'Structural Body Repair, Airbag / SRS Deployment',
    },
    {
      shop: 'Premier ADAS & Collision', techUsername: 'premier_tech2',
      track: 'post-collision', collision_grade: 'MODERATE', ro: 'RO-P002',
      vin: 'WBAJB0C51BC613615', year: '2011', make: 'BMW', model: '535i', trim: 'Base',
      mileage: '74000', status: 'Created', repairsPerformed: 'Front Bumper, Front Camera Area',
    },
    // Southbelt Body Works — General Maintenance
    {
      shop: 'Southbelt Body Works', techUsername: 'south_tech1',
      track: 'general-maintenance', ro: 'RO-S001',
      vin: '4T1BF1FK5CU147227', year: '2012', make: 'Toyota', model: 'Camry', trim: 'XLE',
      mileage: '112000', status: 'Calibration Complete', repairsPerformed: 'Tire rotation. Battery test. All green.',
    },
    {
      shop: 'Southbelt Body Works', techUsername: 'south_tech1',
      track: 'post-collision', collision_grade: 'MINOR', ro: 'RO-S002',
      vin: '1FADP3F24EL381528', year: '2014', make: 'Ford', model: 'Focus', trim: 'SE',
      mileage: '66000', status: 'In Progress', repairsPerformed: 'Door / Mirror Repair',
    },
    // Gulf Coast Auto Service — Post-Collision
    {
      shop: 'Gulf Coast Auto Service', techUsername: 'gulf_tech1',
      track: 'post-collision', collision_grade: 'MAJOR', ro: 'RO-G001',
      vin: '5NPE24AF8FH089298', year: '2015', make: 'Hyundai', model: 'Sonata', trim: 'SE',
      mileage: '94000', status: 'Closed', repairsPerformed: 'Structural Body Repair, Airbag / SRS Deployment',
    },
    {
      shop: 'Gulf Coast Auto Service', techUsername: 'gulf_tech1',
      track: 'general-maintenance', ro: 'RO-G002',
      vin: '1GNSKCKC8FR672786', year: '2015', make: 'Chevrolet', model: 'Tahoe', trim: 'LT',
      mileage: '58000', status: 'Created', repairsPerformed: 'Oil change due. AC check requested.',
    },
  ];

  const validStatuses = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];

  for (const job of demoJobs) {
    const existing = db.prepare('SELECT id FROM jobs WHERE ro = ?').get(job.ro);
    if (existing) {
      console.log(`  Job already exists: ${job.ro} — skipping`);
      continue;
    }

    const shop = db.prepare('SELECT id FROM shops WHERE name = ?').get(job.shop);
    const tech = db.prepare('SELECT id, full_name FROM users WHERE username = ?').get(job.techUsername);

    if (!shop || !tech) {
      console.log(`  Missing shop or tech for job ${job.ro} (shop=${job.shop}, tech=${job.techUsername}) — skipping`);
      continue;
    }

    const jobId      = makeDemoJobId();
    const shareToken = crypto.randomBytes(16).toString('hex');
    const shareUrl   = `/share/${shareToken}`;
    const status     = validStatuses.includes(job.status) ? job.status : 'Created';

    db.prepare(`
      INSERT INTO jobs (
        jobId, ro, vin, year, make, model, trim,
        technicianName, assigned_tech, track, collision_grade,
        mileage, service_date, repairsPerformed,
        status, shareToken, shareUrl,
        createdAt, updatedAt, shop_id, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      jobId, job.ro, job.vin, job.year, job.make, job.model, job.trim || '',
      tech.full_name, tech.full_name, job.track, job.collision_grade || null,
      job.mileage || '', today, job.repairsPerformed || '',
      status, shareToken, shareUrl,
      now, now, shop.id, tech.id
    );

    console.log(`  Created job: ${jobId} (${job.ro}) at ${job.shop}`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n--- CollisionIQ Demo Seed ---\n');

  console.log('Seeding shops...');
  await seedDemoShops();

  console.log('\nSeeding users...');
  await seedDemoUsers();

  console.log('\nSeeding jobs...');
  await seedDemoJobs();

  console.log('\n--- Seed complete ---');
  console.log('\nAll demo account password: demo1234');
  console.log('Platform admin password:   changeme123 (change this)');
  console.log('\nShops: Metro, Northside, Southbelt, Premier, Gulf Coast');
  console.log('Run again at any time — duplicate records are skipped.\n');
}

run().catch(console.error);
