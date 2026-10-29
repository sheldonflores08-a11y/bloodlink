/**
 * database/init-db.js
 * -------------------
 * Creates all tables and inserts realistic SAMPLE DATA.
 *
 *   npm run setup    -> creates tables + seeds data (only if the DB is empty)
 *   npm run reset    -> deletes the database file and seeds from scratch
 *
 * Used tables: users, donors, patients, donations, blood_locations,
 * blood_inventory, blood_requests, notifications, activity_logs,
 * settings, permissions.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { get, close, DB_PATH } = require('./db');

const RESET = process.argv.includes('--reset');

// ---------- helpers for dates relative to today ----------
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function datetimeFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------- 1. optional reset ----------
if (RESET) {
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch (e) {
      if (e.code !== 'ENOENT') console.error(`  (could not delete ${path.basename(DB_PATH)}${suffix}: ${e.message})`);
    }
  }
  // Hard-fail if ANY file survived (e.g. locked by a running server).
  const left = ['', '-wal', '-shm'].filter((s) => fs.existsSync(DB_PATH + s));
  if (left.length) {
    console.error('');
    console.error('Reset failed: database files are still locked.');
    console.error('Stop the BloodLink server (Ctrl+C where "npm start" runs), then retry.');
    process.exit(1);
  }
  console.log('Old database removed.');
}

const db = get();
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema); // CREATE TABLE IF NOT EXISTS - safe to repeat

// ---------- 2. seed data (only when empty) ----------
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount > 0) {
  console.log('Database already contains data. Nothing to seed.');
  console.log('Use "npm run reset" to rebuild the sample database.');
  process.exit(0);
}

const hash = (pw) => bcrypt.hashSync(pw, 10);

db.transaction(() => {
  // ========== USERS (one per role) ==========
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`);
  const addUser = (username, password, role, age) =>
    insertUser.run(username, hash(password), role, datetimeFromNow(-age), datetimeFromNow(-age)).lastInsertRowid;

  const superAdminId = addUser('superadmin', 'Super@123', 'superadmin', 300);
  const adminId      = addUser('admin',      'Admin@123',  'admin',      260);
  const staffId      = addUser('staff',      'Staff@123',  'staff',      240);
  const staff2Id     = addUser('staff1',     'Staff@123',  'staff',      200);
  const donorUserId  = addUser('donor',      'Donor@123',  'donor',      180);
  const donor2UserId = addUser('donor2',     'Donor@123',  'donor',      120);
  const patientUserId = addUser('patient',   'Patient@123','patient',    150);
  const patient2UserId = addUser('patient2', 'Patient@123','patient',     90);
  const disabledUserId = addUser('disabled', 'Disabled@123','donor',      60);
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run('inactive', disabledUserId);

  // ========== DONORS ==========
  const insertDonor = db.prepare(
    `INSERT INTO donors (user_id, donor_code, first_name, middle_name, last_name, age, sex,
       contact_number, address, blood_type, email, date_registered, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`);
  insertDonor.run(donorUserId,  'DON-00001', 'Juan', 'Santos',  'Dela Cruz', 29, 'Male',
    '09171234567', 'San Mariano, Isabela',   'O+',  'juan.delacruz@email.com',   daysFromNow(-170));
  insertDonor.run(donor2UserId, 'DON-00002', 'Maria', 'Reyes',  'Lopez',     26, 'Female',
    '09187654321', 'Ilagan City, Isabela',   'B+',  'maria.lopez@email.com',     daysFromNow(-110));

  // ========== PATIENTS ==========
  const insertPatient = db.prepare(
    `INSERT INTO patients (user_id, patient_code, first_name, middle_name, last_name, age, sex,
       contact_number, address, blood_type_needed, hospital, medical_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`);
  insertPatient.run(patientUserId,  'PAT-00001', 'Pedro', 'Garcia',  'Santos',   54, 'Male',
    '09201112222', 'Isabela City, Isabela', 'O-', 'Isabela General Hospital',
    'Scheduled surgery, needs O- units.');
  insertPatient.run(patient2UserId, 'PAT-00002', 'Ana', 'Torres',    'Reyes',    31, 'Female',
    '09993334444', 'San Mariano, Isabela',  'A+', 'San Mariano District Hospital',
    'Post-partum transfusion support.');

  // ========== BLOOD LOCATIONS (real coordinates around Isabela, PH) ==========
  const insertLocation = db.prepare(
    `INSERT INTO blood_locations (location_name, address, latitude, longitude, contact_number,
       available_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`);
  const loc = (name, address, lat, lng, phone, age) =>
    insertLocation.run(name, address, lat, lng, phone, datetimeFromNow(-age), datetimeFromNow(-age)).lastInsertRowid;

  const locSanMariano = loc('San Mariano Blood Center', 'San Mariano, Isabela',            17.0831, 122.1894, '(078) 305-1111', 300);
  const locIsabela    = loc('Isabela Blood Bank',       'Isabela City, Isabela',            16.9710, 121.8243, '(078) 305-2222', 300);
  const locHospital   = loc('Isabela General Hospital', 'Isabela City, Isabela',            16.9790, 121.8120, '(078) 305-3333', 280);
  const locIlagan     = loc('Ilagan Regional Medical Center', 'Ilagan City, Isabela',       17.1472, 121.8886, '(078) 305-4444', 250);
  const locRoxas      = loc('Roxas Community Blood Unit', 'Roxas, Isabela',                 17.1010, 121.6070, '(078) 305-5555', 200);

  // ========== BLOOD INVENTORY ==========
  // Expiration dates are in the future so the blood is "available".
  // One expired batch is included to prove rule #3 (expired never shows).
  const insertInv = db.prepare(
    `INSERT INTO blood_inventory (blood_type, blood_units, location_id, expiration_date, status, updated_at)
     VALUES (?, ?, ?, ?, 'Available', ?)`);
  const inv = (type, units, locId, expInDays, updatedDaysAgo = 3) =>
    insertInv.run(type, units, locId, daysFromNow(expInDays), datetimeFromNow(-updatedDaysAgo)).lastInsertRowid;

  // San Mariano Blood Center
  inv('A+',  5, locSanMariano, 21);
  inv('A-',  2, locSanMariano, 18);
  inv('B+',  8, locSanMariano, 25);
  inv('O+', 10, locSanMariano, 30);
  inv('O-',  3, locSanMariano, 15);
  // Isabela Blood Bank
  inv('A+',  4, locIsabela, 22);
  inv('AB+', 6, locIsabela, 28);
  inv('O+',  5, locIsabela, 26);
  inv('AB-', 2, locIsabela, 12);
  inv('B-',  3, locIsabela, 20, 6);
  // Isabela General Hospital
  inv('O+',  3, locHospital, 10);
  inv('B+',  4, locHospital, 16);
  inv('A+',  6, locHospital, 24);
  inv('A-',  1, locHospital, 9);
  // Ilagan Regional Medical Center
  inv('O-',  2, locIlagan, 14);
  inv('AB+', 3, locIlagan, 19);
  inv('B+',  5, locIlagan, 27);
  // Roxas Community Blood Unit — smaller stock
  inv('O+',  2, locRoxas, 13);
  inv('A-',  1, locRoxas, 11);
  // Expired batch (must NEVER appear as available)
  inv('O+', 4, locIsabela, -5, 40);

  // ========== DONATIONS ==========
  const insertDonation = db.prepare(
    `INSERT INTO donations (donor_id, blood_type, donation_date, blood_units, donation_location,
       status, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // older, verified donations (their blood is already part of inventory)
  insertDonation.run(1, 'O+', daysFromNow(-40), 1, 'San Mariano Blood Center', 'Verified',  staffId, datetimeFromNow(-40));
  insertDonation.run(1, 'O+', daysFromNow(-90), 1, 'San Mariano Blood Center', 'Verified',  staffId, datetimeFromNow(-90));
  insertDonation.run(2, 'B+', daysFromNow(-20), 1, 'Ilagan Regional Medical Center', 'Verified', staff2Id, datetimeFromNow(-20));
  // recent donation still waiting for staff verification (NOT in inventory yet)
  insertDonation.run(2, 'B+', daysFromNow(-1), 1, 'Ilagan Regional Medical Center', 'Pending', staff2Id, datetimeFromNow(-1));

  // ========== BLOOD REQUESTS ==========
  const insertRequest = db.prepare(
    `INSERT INTO blood_requests (patient_id, blood_type, units_needed, request_date, priority,
       reason, location, status, processed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertRequest.run(1, 'O-', 1, daysFromNow(-10), 'Urgent',
    'Pre-operative transfusion for scheduled surgery', 'Isabela General Hospital',
    'Completed', adminId, datetimeFromNow(-8));
  insertRequest.run(2, 'A+', 2, daysFromNow(-2), 'Normal',
    'Ongoing treatment, needs A+ support', 'San Mariano District Hospital',
    'Pending', null, datetimeFromNow(-2));

  // ========== NOTIFICATIONS (welcome/sample) ==========
  const insertNotification = db.prepare(
    'INSERT INTO notifications (user_id, title, message, status, created_at) VALUES (?, ?, ?, ?, ?)');
  insertNotification.run(donorUserId, 'Welcome to BloodLink!',
    'Thank you for registering as a blood donor. Complete your profile to get started.', 'unread', datetimeFromNow(-1));
  insertNotification.run(donorUserId, 'Donation Verified',
    'Your donation on ' + daysFromNow(-40) + ' was verified. Thank you for saving lives!', 'unread', datetimeFromNow(-39));
  insertNotification.run(patientUserId, 'Request Completed',
    'Your blood request for 1 unit(s) of O- has been completed. Get well soon!', 'unread', datetimeFromNow(-8));
  insertNotification.run(patient2UserId, 'Request Pending',
    'Your request for 2 unit(s) of A+ was received and is pending review.', 'unread', datetimeFromNow(-2));

  // ========== ACTIVITY LOGS ==========
  const insertLog = db.prepare(
    'INSERT INTO activity_logs (user_id, action, description, created_at) VALUES (?, ?, ?, ?)');
  insertLog.run(superAdminId, 'Setup', 'System initialized with sample data', datetimeFromNow(-1));
  insertLog.run(adminId, 'Request Processed', 'Marked request #1 (O-, PAT-00001) as Completed', datetimeFromNow(-8));
  insertLog.run(staffId, 'Donation Recorded', 'Recorded donation of 1 unit O+ for DON-00001', datetimeFromNow(-40));

  // ========== SETTINGS ==========
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('system_name', 'BloodLink');
  insertSetting.run('map_center_lat', '17.03');
  insertSetting.run('map_center_lng', '121.9');
  insertSetting.run('default_zoom', '10');
  insertSetting.run('allow_registration', '1');

  // ========== PERMISSIONS (role -> module access defaults) ==========
  const modules = [
    'donors', 'patients', 'donations', 'inventory', 'requests',
    'locations', 'reports', 'users', 'logs', 'settings'
  ];
  const insertPerm = db.prepare('INSERT INTO permissions (role, module, can_access) VALUES (?, ?, ?)');
  const withAccess = {
    staff: ['donors', 'patients', 'donations', 'inventory', 'requests', 'locations', 'reports'],
    admin: ['donors', 'patients', 'donations', 'inventory', 'requests', 'locations', 'reports', 'users', 'logs', 'settings']
  };
  for (const role of ['staff', 'admin']) {
    for (const m of modules) {
      insertPerm.run(role, m, withAccess[role].includes(m) ? 1 : 0);
    }
  }
})(); // execute transaction; rolls back on any error

console.log('Tables created and sample data seeded successfully!');
console.log('');
console.log('Default test accounts (username / password):');
console.log('  superadmin  / Super@123');
console.log('  admin       / Admin@123');
console.log('  staff       / Staff@123');
console.log('  staff1      / Staff@123');
console.log('  donor       / Donor@123');
console.log('  donor2      / Donor@123');
console.log('  patient     / Patient@123');
console.log('  patient2    / Patient@123');
close();
