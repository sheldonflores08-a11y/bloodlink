/**
 * backend/routes/staff.js
 * -----------------------
 * Operational modules used by staff (and admin/super admin):
 *   donors, patients, donations, inventory, requests, locations.
 *
 * Used tables: donors, patients, donations, blood_inventory,
 * blood_requests, blood_locations, users, notifications, activity_logs.
 *
 * Business rules enforced here:
 *  - unverified donations NEVER reach inventory
 *  - approving a request deducts the blood from inventory
 *    (FIFO: oldest expiration first) and notifies the patient
 *  - inventory can never go negative
 *  - expired blood is swept out automatically
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { get } = require('../../database/db');
const { requireLogin, requireRole, requireModule } = require('../middleware');
const {
  fail, ok, requireFields, validBloodType, validEmail, validPhone,
  validPositiveInt, validDate, validAge, nextCode, logAction, notify,
  sweepExpired
} = require('../helpers');

const OPS = ['staff', 'admin', 'superadmin'];
router.use(requireLogin, requireRole(...OPS), (req, res, next) => next());

/* ================= helpers local to staff routes ================= */

/** Get the patient's user_id (for notifications). */
function patientUser(database, patientId) {
  return database.prepare('SELECT user_id FROM patients WHERE id = ?').get(patientId)?.user_id || null;
}

/**
 * Deduct `unitsNeeded` of `bloodType` from a location, using the oldest
 * expiring batches first. Returns { ok, message }. Run inside the caller's
 * transaction for safety.
 */
function consumeUnits(database, bloodType, locationId, unitsNeeded) {
  const batches = database.prepare(`
    SELECT id, blood_units FROM blood_inventory
     WHERE blood_type = ? AND location_id = ?
       AND status = 'Available'
       AND expiration_date >= date('now','localtime')
     ORDER BY expiration_date ASC, id ASC
  `).all(bloodType, locationId);

  const total = batches.reduce((s, b) => s + b.blood_units, 0);
  const loc = database.prepare('SELECT location_name FROM blood_locations WHERE id = ?').get(locationId);
  if (total < unitsNeeded) {
    return { ok: false, message: `Only ${total} unit(s) of ${bloodType} are available at ${loc ? loc.location_name : 'this location'}.` };
  }

  let remaining = unitsNeeded;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.blood_units, remaining);
    const leftOver = b.blood_units - take;
    database.prepare(`
      UPDATE blood_inventory
         SET blood_units = ?,
             status = CASE WHEN ? = 0 THEN 'Used' ELSE status END,
             updated_at = datetime('now','localtime')
       WHERE id = ?
    `).run(leftOver, leftOver, b.id);
    remaining -= take;
  }
  return { ok: true, message: 'Blood reserved from inventory.' };
}

/* ================= shared dropdowns ================= */

/** GET /api/staff/dropdowns - IDs/names for form selects. */
router.get('/dropdowns', (req, res) => {
  const database = get();
  const donors = database.prepare(
    "SELECT id, donor_code, first_name, last_name, blood_type FROM donors WHERE status='active' ORDER BY last_name"
  ).all();
  const patients = database.prepare(
    "SELECT id, patient_code, first_name, last_name, blood_type_needed FROM patients WHERE status='active' ORDER BY last_name"
  ).all();
  const locations = database.prepare(
    "SELECT id, location_name FROM blood_locations WHERE available_status='Active' ORDER BY location_name"
  ).all();
  ok(res, { donors, patients, locations });
});

/* ================= DONORS ================= */

router.get('/donors', requireModule('donors'), (req, res) => {
  const database = get();
  const search = (req.query.search || '').trim();
  const params = [];
  let where = '1=1';
  if (search) {
    where = `(d.first_name LIKE ? OR d.last_name LIKE ? OR d.donor_code LIKE ? OR d.blood_type LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const rows = database.prepare(`
    SELECT d.*, u.status AS user_status,
           (SELECT COUNT(*) FROM donations dn WHERE dn.donor_id = d.id) AS donation_count,
           (SELECT COALESCE(SUM(dn.blood_units),0) FROM donations dn WHERE dn.donor_id = d.id AND dn.status='Verified') AS verified_units
      FROM donors d JOIN users u ON u.id = d.user_id
     WHERE ${where}
     ORDER BY d.last_name, d.first_name
  `).all(...params);
  ok(res, { donors: rows });
});

router.post('/donors', requireModule('donors'), (req, res) => {
  const database = get();
  const b = req.body || {};
  const missing = requireFields(b, ['first_name', 'last_name', 'age', 'sex', 'contact_number', 'address', 'blood_type', 'email']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validEmail(b.email)) return fail(res, 400, 'Please enter a valid email address.');
  if (!validAge(b.age)) return fail(res, 400, 'Please enter a valid age.');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  try {
    const tx = database.transaction(() => {
      const code = nextCode(database, 'donors', 'donor_code', 'DON');
      const username = code.toLowerCase().replace('-', '');
      const userId = database.prepare(
        "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'donor', 'active')"
      ).run(username, bcrypt.hashSync('Blood@' + code, 10)).lastInsertRowid;
      database.prepare(`
        INSERT INTO donors (user_id, donor_code, first_name, middle_name, last_name, age, sex,
          contact_number, address, blood_type, email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, code, b.first_name, b.middle_name || null, b.last_name, Number(b.age), b.sex,
        b.contact_number, b.address, b.blood_type, b.email);
      return { code, username, password: 'Blood@' + code };
    });
    const out = tx();
    logAction(database, req.session.userId, 'Donor Added', `${out.code} (default login ${out.username})`);
    ok(res, { message: `Donor saved. Login: ${out.username} / ${out.password}`, donor: out });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Could not save the donor. Please check the details and try again.');
  }
});

router.put('/donors/:id', requireModule('donors'), (req, res) => {
  const database = get();
  const donor = database.prepare('SELECT * FROM donors WHERE id = ?').get(req.params.id);
  if (!donor) return fail(res, 404, 'Donor not found.');
  const b = req.body || {};
  const missing = requireFields(b, ['first_name', 'last_name', 'age', 'sex', 'contact_number', 'address', 'blood_type', 'email']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validEmail(b.email)) return fail(res, 400, 'Please enter a valid email address.');
  if (!validAge(b.age)) return fail(res, 400, 'Please enter a valid age.');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  database.prepare(`
    UPDATE donors SET first_name=?, middle_name=?, last_name=?, age=?, sex=?,
      contact_number=?, address=?, blood_type=?, email=?
     WHERE id=?
  `).run(b.first_name, b.middle_name || null, b.last_name, Number(b.age), b.sex,
    b.contact_number, b.address, b.blood_type, b.email, donor.id);
  logAction(database, req.session.userId, 'Donor Updated', `Updated ${donor.donor_code}`);
  ok(res, { message: 'Donor updated.' });
});

router.put('/donors/:id/status', requireModule('donors'), (req, res) => {
  const database = get();
  const donor = database.prepare('SELECT * FROM donors WHERE id = ?').get(req.params.id);
  if (!donor) return fail(res, 404, 'Donor not found.');
  const newStatus = donor.status === 'active' ? 'inactive' : 'active';
  const tx = database.transaction(() => {
    database.prepare('UPDATE donors SET status = ? WHERE id = ?').run(newStatus, donor.id);
    database.prepare("UPDATE users SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newStatus, donor.user_id); // keep login account in sync
  });
  tx();
  logAction(database, req.session.userId, 'Donor Status', `${donor.donor_code} set to ${newStatus}`);
  ok(res, { message: `Donor ${newStatus === 'active' ? 'activated' : 'deactivated'}.` });
});

/* ================= PATIENTS ================= */

router.get('/patients', requireModule('patients'), (req, res) => {
  const database = get();
  const search = (req.query.search || '').trim();
  const params = [];
  let where = '1=1';
  if (search) {
    where = `(p.first_name LIKE ? OR p.last_name LIKE ? OR p.patient_code LIKE ? OR p.blood_type_needed LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const rows = database.prepare(`
    SELECT p.*, u.status AS user_status,
           (SELECT COUNT(*) FROM blood_requests r WHERE r.patient_id = p.id) AS request_count
      FROM patients p JOIN users u ON u.id = p.user_id
     WHERE ${where}
     ORDER BY p.last_name, p.first_name
  `).all(...params);
  ok(res, { patients: rows });
});

router.post('/patients', requireModule('patients'), (req, res) => {
  const database = get();
  const b = req.body || {};
  const missing = requireFields(b, ['first_name', 'last_name', 'age', 'sex', 'contact_number', 'address', 'blood_type_needed', 'hospital']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type_needed)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validAge(b.age)) return fail(res, 400, 'Please enter a valid age.');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  try {
    const tx = database.transaction(() => {
      const code = nextCode(database, 'patients', 'patient_code', 'PAT');
      const username = code.toLowerCase().replace('-', '');
      const userId = database.prepare(
        "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'patient', 'active')"
      ).run(username, bcrypt.hashSync('Blood@' + code, 10)).lastInsertRowid;
      database.prepare(`
        INSERT INTO patients (user_id, patient_code, first_name, middle_name, last_name, age, sex,
          contact_number, address, blood_type_needed, hospital, medical_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, code, b.first_name, b.middle_name || null, b.last_name, Number(b.age), b.sex,
        b.contact_number, b.address, b.blood_type_needed, b.hospital, b.medical_notes || null);
      return { code, username, password: 'Blood@' + code };
    });
    const out = tx();
    logAction(database, req.session.userId, 'Patient Added', `${out.code} (default login ${out.username})`);
    ok(res, { message: `Patient saved. Login: ${out.username} / ${out.password}`, patient: out });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Could not save the patient. Please check the details and try again.');
  }
});

router.put('/patients/:id', requireModule('patients'), (req, res) => {
  const database = get();
  const patient = database.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return fail(res, 404, 'Patient not found.');
  const b = req.body || {};
  const missing = requireFields(b, ['first_name', 'last_name', 'age', 'sex', 'contact_number', 'address', 'blood_type_needed', 'hospital']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type_needed)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validAge(b.age)) return fail(res, 400, 'Please enter a valid age.');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  database.prepare(`
    UPDATE patients SET first_name=?, middle_name=?, last_name=?, age=?, sex=?,
      contact_number=?, address=?, blood_type_needed=?, hospital=?, medical_notes=?
     WHERE id=?
  `).run(b.first_name, b.middle_name || null, b.last_name, Number(b.age), b.sex,
    b.contact_number, b.address, b.blood_type_needed, b.hospital, b.medical_notes || null, patient.id);
  logAction(database, req.session.userId, 'Patient Updated', `Updated ${patient.patient_code}`);
  ok(res, { message: 'Patient updated.' });
});

router.put('/patients/:id/status', requireModule('patients'), (req, res) => {
  const database = get();
  const patient = database.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return fail(res, 404, 'Patient not found.');
  const newStatus = patient.status === 'active' ? 'inactive' : 'active';
  const tx = database.transaction(() => {
    database.prepare('UPDATE patients SET status = ? WHERE id = ?').run(newStatus, patient.id);
    database.prepare("UPDATE users SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newStatus, patient.user_id);
  });
  tx();
  logAction(database, req.session.userId, 'Patient Status', `${patient.patient_code} set to ${newStatus}`);
  ok(res, { message: `Patient ${newStatus === 'active' ? 'activated' : 'deactivated'}.` });
});

/* ================= DONATIONS ================= */

router.get('/donations', requireModule('donations'), (req, res) => {
  const database = get();
  const params = [];
  const clauses = [];
  if (req.query.status) { clauses.push('dn.status = ?'); params.push(req.query.status); }
  if (req.query.donor_id) { clauses.push('dn.donor_id = ?'); params.push(Number(req.query.donor_id)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = database.prepare(`
    SELECT dn.*, d.donor_code, d.first_name, d.last_name, d.blood_type AS donor_blood_type,
           u.username AS recorded_by_user
      FROM donations dn
      JOIN donors d ON d.id = dn.donor_id
      LEFT JOIN users u ON u.id = dn.recorded_by
     ${where}
     ORDER BY dn.donation_date DESC, dn.id DESC
  `).all(...params);
  ok(res, { donations: rows });
});

/** Record a donation (starts as Pending - NOT yet in inventory). */
router.post('/donations', requireModule('donations'), (req, res) => {
  const database = get();
  const b = req.body || {};
  const missing = requireFields(b, ['donor_id', 'blood_type', 'donation_date', 'blood_units', 'donation_location']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validPositiveInt(b.blood_units)) return fail(res, 400, 'Blood units must be a positive whole number.');
  if (!validDate(b.donation_date)) return fail(res, 400, 'Please enter a valid donation date.');

  const donor = database.prepare("SELECT * FROM donors WHERE id = ? AND status='active'").get(b.donor_id);
  if (!donor) return fail(res, 404, 'That donor was not found or is inactive.');

  database.prepare(`
    INSERT INTO donations (donor_id, blood_type, donation_date, blood_units, donation_location, status, recorded_by)
    VALUES (?, ?, ?, ?, ?, 'Pending', ?)
  `).run(donor.id, b.blood_type, b.donation_date.slice(0, 10), Number(b.blood_units), b.donation_location, req.session.userId);

  logAction(database, req.session.userId, 'Donation Recorded',
    `${Number(b.blood_units)} unit(s) of ${b.blood_type} from ${donor.donor_code}`);
  ok(res, { message: 'Donation recorded. Verify it to add the blood to inventory.' });
});

/** Verify a donation -> blood becomes available inventory. */
router.put('/donations/:id/verify', requireModule('donations'), (req, res) => {
  const database = get();
  const donation = database.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!donation) return fail(res, 404, 'Donation not found.');
  if (donation.status !== 'Pending') return fail(res, 400, 'Only pending donations can be verified.');

  const b = req.body || {};
  const locationId = Number(b.location_id || 0);
  const location = database.prepare("SELECT * FROM blood_locations WHERE id = ? AND available_status='Active'").get(locationId);
  if (!location) return fail(res, 400, 'Please choose the blood location receiving these units.');

  const expiration = b.expiration_date || (() => {
    const d = new Date(); d.setDate(d.getDate() + 35); return d.toISOString().slice(0, 10);
  })();
  if (!validDate(expiration)) return fail(res, 400, 'Please enter a valid expiration date.');

  const tx = database.transaction(() => {
    database.prepare("UPDATE donations SET status='Verified' WHERE id = ?").run(donation.id);
    // merge into an existing active batch when possible
    const batch = database.prepare(`
      SELECT id FROM blood_inventory
       WHERE blood_type = ? AND location_id = ? AND status = 'Available'
       ORDER BY id DESC LIMIT 1
    `).get(donation.blood_type, locationId);
    if (batch) {
      database.prepare(`
        UPDATE blood_inventory
           SET blood_units = blood_units + ?, updated_at = datetime('now','localtime')
         WHERE id = ?
      `).run(donation.blood_units, batch.id);
    } else {
      database.prepare(`
        INSERT INTO blood_inventory (blood_type, blood_units, location_id, expiration_date, status)
        VALUES (?, ?, ?, ?, 'Available')
      `).run(donation.blood_type, donation.blood_units, locationId, expiration);
    }
  });
  tx();

  const donor = database.prepare('SELECT d.*, u.id AS uid FROM donors d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(donation.donor_id);
  if (donor) notify(database, donor.uid, 'Donation Verified',
    `Your donation of ${donation.blood_units} unit(s) of ${donation.blood_type} was verified. Thank you for saving lives!`);

  logAction(database, req.session.userId, 'Donation Verified',
    `${donation.blood_units} unit(s) of ${donation.blood_type} added to ${location.location_name}`);
  ok(res, { message: 'Donation verified. Blood added to inventory.' });
});

router.put('/donations/:id/reject', requireModule('donations'), (req, res) => {
  const database = get();
  const donation = database.prepare('SELECT * FROM donations WHERE id = ?').get(req.params.id);
  if (!donation) return fail(res, 404, 'Donation not found.');
  if (donation.status !== 'Pending') return fail(res, 400, 'Only pending donations can be rejected.');

  database.prepare("UPDATE donations SET status='Rejected' WHERE id = ?").run(donation.id);
  const donor = database.prepare('SELECT u.id AS uid FROM donors d JOIN users u ON u.id = d.user_id WHERE d.id = ?').get(donation.donor_id);
  if (donor) notify(database, donor.uid, 'Donation Rejected',
    `Your donation of ${donation.blood_units} unit(s) of ${donation.blood_type} on ${donation.donation_date} was not approved.`);
  logAction(database, req.session.userId, 'Donation Rejected', `Rejected donation #${donation.id}`);
  ok(res, { message: 'Donation rejected.' });
});

/* ================= BLOOD INVENTORY ================= */

router.get('/inventory', requireModule('inventory'), (req, res) => {
  sweepExpired(get());
  const database = get();
  const clauses = [];
  const params = [];
  if (req.query.blood_type) { clauses.push('i.blood_type = ?'); params.push(req.query.blood_type); }
  if (req.query.location_id) { clauses.push('i.location_id = ?'); params.push(Number(req.query.location_id)); }
  if (req.query.status) { clauses.push('i.status = ?'); params.push(req.query.status); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = database.prepare(`
    SELECT i.*, l.location_name
      FROM blood_inventory i JOIN blood_locations l ON l.id = i.location_id
     ${where}
     ORDER BY i.expiration_date ASC
  `).all(...params);
  ok(res, { inventory: rows });
});

/** Manually add a blood batch. */
router.post('/inventory', requireModule('inventory'), (req, res) => {
  const database = get();
  const b = req.body || {};
  const missing = requireFields(b, ['blood_type', 'blood_units', 'location_id', 'expiration_date']);
  if (missing) return fail(res, 400, missing);
  if (!validBloodType(b.blood_type)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validPositiveInt(b.blood_units)) return fail(res, 400, 'Blood units must be a positive whole number.');
  if (!validDate(b.expiration_date)) return fail(res, 400, 'Please enter a valid expiration date.');

  const location = database.prepare("SELECT * FROM blood_locations WHERE id = ? AND available_status='Active'").get(Number(b.location_id));
  if (!location) return fail(res, 400, 'Please choose a valid active blood location.');

  database.prepare(`
    INSERT INTO blood_inventory (blood_type, blood_units, location_id, expiration_date, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(b.blood_type, Number(b.blood_units), location.id, b.expiration_date.slice(0, 10), b.status || 'Available');

  logAction(database, req.session.userId, 'Inventory Added',
    `${b.blood_units} unit(s) of ${b.blood_type} at ${location.location_name}`);
  ok(res, { message: 'Blood batch added to inventory.' });
});

/** Update a batch's units / status / expiration. Units can never go negative. */
router.put('/inventory/:id', requireModule('inventory'), (req, res) => {
  const database = get();
  const batch = database.prepare('SELECT i.*, l.location_name FROM blood_inventory i JOIN blood_locations l ON l.id=i.location_id WHERE i.id = ?').get(req.params.id);
  if (!batch) return fail(res, 404, 'Inventory batch not found.');
  const b = req.body || {};

  let units = batch.blood_units;
  if (b.blood_units !== undefined) {
    if (!Number.isInteger(Number(b.blood_units)) || Number(b.blood_units) < 0) {
      return fail(res, 400, 'Blood units cannot be negative.');
    }
    units = Number(b.blood_units);
  }

  let status = batch.status;
  const allowed = ['Available', 'Reserved', 'Used', 'Expired', 'Unavailable'];
  if (b.status !== undefined) {
    if (!allowed.includes(b.status)) return fail(res, 400, 'Invalid inventory status.');
    status = b.status;
  }

  let expiration = batch.expiration_date;
  if (b.expiration_date !== undefined) {
    if (!validDate(b.expiration_date)) return fail(res, 400, 'Please enter a valid expiration date.');
    expiration = b.expiration_date.slice(0, 10);
  }

  database.prepare(`
    UPDATE blood_inventory
       SET blood_units = ?, status = ?, expiration_date = ?, updated_at = datetime('now','localtime')
     WHERE id = ?
  `).run(units, status, expiration, batch.id);

  logAction(database, req.session.userId, 'Inventory Updated',
    `${batch.blood_type} @ ${batch.location_name} -> ${units} unit(s), ${status}`);
  ok(res, { message: 'Inventory updated.' });
});

/** Delete a batch. Prefer this only for Expired/Used/Unavailable batches. */
router.delete('/inventory/:id', requireModule('inventory'), (req, res) => {
  const database = get();
  const batch = database.prepare('SELECT i.*, l.location_name FROM blood_inventory i JOIN blood_locations l ON l.id=i.location_id WHERE i.id = ?').get(req.params.id);
  if (!batch) return fail(res, 404, 'Inventory batch not found.');
  if (!['Expired', 'Used', 'Unavailable'].includes(batch.status)) {
    return fail(res, 400, 'Only Expired, Used or Unavailable batches can be removed. Mark the batch status first.');
  }
  database.prepare('DELETE FROM blood_inventory WHERE id = ?').run(batch.id);
  logAction(database, req.session.userId, 'Inventory Removed',
    `Removed ${batch.blood_type} batch @ ${batch.location_name}`);
  ok(res, { message: 'Batch removed from inventory.' });
});

/* ================= BLOOD REQUESTS ================= */

router.get('/requests', requireModule('requests'), (req, res) => {
  const database = get();
  const clauses = [];
  const params = [];
  if (req.query.status) { clauses.push('r.status = ?'); params.push(req.query.status); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = database.prepare(`
    SELECT r.*, p.patient_code, p.first_name, p.last_name, p.hospital, p.contact_number AS patient_contact,
           u.username AS processed_by_user
      FROM blood_requests r
      JOIN patients p ON p.id = r.patient_id
      LEFT JOIN users u ON u.id = r.processed_by
     ${where}
     ORDER BY CASE r.priority WHEN 'Critical' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END,
              r.created_at DESC
  `).all(...params);
  ok(res, { requests: rows });
});

/**
 * Process a request. Body: { status, location_id }
 *  - Approved : needs a location_id, deducts blood from inventory
 *  - Completed: finishes an approved request
 *  - Rejected / Cancelled: no inventory change (Cancel only from Pending)
 */
router.put('/requests/:id/status', requireModule('requests'), (req, res) => {
  const database = get();
  const request = database.prepare('SELECT * FROM blood_requests WHERE id = ?').get(req.params.id);
  if (!request) return fail(res, 404, 'Blood request not found.');

  const b = req.body || {};
  const newStatus = b.status;
  const patient = database.prepare('SELECT p.*, u.id AS uid FROM patients p JOIN users u ON u.id=p.user_id WHERE p.id = ?').get(request.patient_id);
  const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'the patient';

  const setStatus = (status) => database.prepare(
    "UPDATE blood_requests SET status = ?, processed_by = ? WHERE id = ?"
  ).run(status, req.session.userId, request.id);

  if (newStatus === 'Approved' || newStatus === 'Processing') {
    if (!['Pending', 'Processing'].includes(request.status)) {
      return fail(res, 400, `Cannot move a request from "${request.status}" to "${newStatus}".`);
    }
    const location = database.prepare("SELECT * FROM blood_locations WHERE id = ? AND available_status='Active'")
      .get(Number(b.location_id || 0));
    if (newStatus === 'Approved') {
      if (!location) return fail(res, 400, 'Please choose the blood location to release these units from.');
      const tx = database.transaction(() => {
        const result = consumeUnits(database, request.blood_type, location.id, request.units_needed);
        if (!result.ok) throw new Error(result.message);
        setStatus('Approved');
      });
      try { tx(); } catch (e) { return fail(res, 409, e.message); }
      if (patient) notify(database, patient.uid, 'Blood Request Approved',
        `Your request for ${request.units_needed} unit(s) of ${request.blood_type} was approved. Blood will be released from ${location.location_name}.`);
      logAction(database, req.session.userId, 'Request Approved',
        `Request #${request.id}: ${request.units_needed} unit(s) of ${request.blood_type} from ${location.location_name}`);
      return ok(res, { message: 'Request approved and blood reserved from inventory.' });
    }
    setStatus('Processing');
    logAction(database, req.session.userId, 'Request Processing', `Request #${request.id} is being processed`);
    return ok(res, { message: 'Request marked as processing.' });
  }

  if (newStatus === 'Completed') {
    if (!['Approved', 'Processing'].includes(request.status)) {
      return fail(res, 400, 'Only approved or processing requests can be completed.');
    }
    setStatus('Completed');
    if (patient) notify(database, patient.uid, 'Blood Request Completed',
      `Your request for ${request.units_needed} unit(s) of ${request.blood_type} has been completed. Get well soon!`);
    logAction(database, req.session.userId, 'Request Completed', `Request #${request.id} completed for ${patientName}`);
    return ok(res, { message: 'Request marked as completed.' });
  }

  if (newStatus === 'Rejected') {
    if (!['Pending', 'Processing'].includes(request.status)) {
      return fail(res, 400, 'Only pending or processing requests can be rejected.');
    }
    setStatus('Rejected');
    if (patient) notify(database, patient.uid, 'Blood Request Rejected',
      `Your request for ${request.units_needed} unit(s) of ${request.blood_type} was not approved. Please contact the blood center for details.`);
    logAction(database, req.session.userId, 'Request Rejected', `Request #${request.id} rejected`);
    return ok(res, { message: 'Request rejected.' });
  }

  if (newStatus === 'Cancelled') {
    if (request.status !== 'Pending') {
      return fail(res, 400, 'Only pending requests can be cancelled.');
    }
    setStatus('Cancelled');
    if (patient) notify(database, patient.uid, 'Blood Request Cancelled',
      `Your request for ${request.units_needed} unit(s) of ${request.blood_type} was cancelled.`);
    logAction(database, req.session.userId, 'Request Cancelled', `Request #${request.id} cancelled`);
    return ok(res, { message: 'Request cancelled.' });
  }

  return fail(res, 400, 'Invalid request status.');
});

/* ================= BLOOD LOCATIONS ================= */

router.get('/locations', requireModule('locations'), (req, res) => {
  const database = get();
  sweepExpired(database);
  const rows = database.prepare(`
    SELECT l.*,
      (SELECT COALESCE(SUM(i.blood_units),0) FROM blood_inventory i
        WHERE i.location_id = l.id AND i.status = 'Available'
          AND i.expiration_date >= date('now','localtime')) AS available_units
      FROM blood_locations l
     ORDER BY l.location_name
  `).all();
  ok(res, { locations: rows });
});

router.post('/locations', requireModule('locations'), (req, res) => {
  const database = get();
  const b = req.body || {};
  const missing = requireFields(b, ['location_name', 'address', 'latitude', 'longitude', 'contact_number']);
  if (missing) return fail(res, 400, missing);
  const lat = Number(b.latitude), lng = Number(b.longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return fail(res, 400, 'Please enter a valid latitude (-90 to 90).');
  if (Number.isNaN(lng) || lng < -180 || lng > 180) return fail(res, 400, 'Please enter a valid longitude (-180 to 180).');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  database.prepare(`
    INSERT INTO blood_locations (location_name, address, latitude, longitude, contact_number, available_status)
    VALUES (?, ?, ?, ?, ?, 'Active')
  `).run(b.location_name, b.address, lat, lng, b.contact_number);
  logAction(database, req.session.userId, 'Location Added', `Added ${b.location_name}`);
  ok(res, { message: 'Blood location added.' });
});

router.put('/locations/:id', requireModule('locations'), (req, res) => {
  const database = get();
  const location = database.prepare('SELECT * FROM blood_locations WHERE id = ?').get(req.params.id);
  if (!location) return fail(res, 404, 'Blood location not found.');
  const b = req.body || {};
  const missing = requireFields(b, ['location_name', 'address', 'latitude', 'longitude', 'contact_number']);
  if (missing) return fail(res, 400, missing);
  const lat = Number(b.latitude), lng = Number(b.longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return fail(res, 400, 'Please enter a valid latitude (-90 to 90).');
  if (Number.isNaN(lng) || lng < -180 || lng > 180) return fail(res, 400, 'Please enter a valid longitude (-180 to 180).');
  if (!validPhone(b.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');

  database.prepare(`
    UPDATE blood_locations
       SET location_name=?, address=?, latitude=?, longitude=?, contact_number=?,
           updated_at = datetime('now','localtime')
     WHERE id = ?
  `).run(b.location_name, b.address, lat, lng, b.contact_number, location.id);
  logAction(database, req.session.userId, 'Location Updated', `Updated ${b.location_name}`);
  ok(res, { message: 'Blood location updated.' });
});

/** Archive/unarchive a location (safe "delete"). */
router.put('/locations/:id/status', requireModule('locations'), (req, res) => {
  const database = get();
  const location = database.prepare('SELECT * FROM blood_locations WHERE id = ?').get(req.params.id);
  if (!location) return fail(res, 404, 'Blood location not found.');
  const newStatus = location.available_status === 'Active' ? 'Inactive' : 'Active';
  database.prepare("UPDATE blood_locations SET available_status=?, updated_at=datetime('now','localtime') WHERE id = ?")
    .run(newStatus, location.id);
  logAction(database, req.session.userId, 'Location Status', `${location.location_name} set to ${newStatus}`);
  ok(res, { message: `Location ${newStatus === 'Active' ? 'activated' : 'deactivated'}.` });
});

module.exports = router;
