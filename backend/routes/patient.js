/**
 * backend/routes/patient.js
 * -------------------------
 * Patient self-service: submit blood requests, track them.
 * Patients can NEVER modify inventory (business rule #5).
 * Used tables: patients, blood_requests, users, activity_logs.
 */
const express = require('express');
const router = express.Router();
const { get } = require('../../database/db');
const { requireLogin, requireRole } = require('../middleware');
const { fail, ok, validBloodType, validPositiveInt, logAction } = require('../helpers');

router.use(requireLogin, requireRole('patient'));

function myPatient(database, userId) {
  return database.prepare("SELECT * FROM patients WHERE user_id = ? AND status = 'active'").get(userId);
}

/** GET /api/patient/requests - my requests only. */
router.get('/requests', (req, res) => {
  const database = get();
  const patient = myPatient(database, req.session.userId);
  if (!patient) return fail(res, 404, 'Patient profile not found.');
  const rows = database.prepare(`
    SELECT r.*, u.username AS processed_by_user
      FROM blood_requests r LEFT JOIN users u ON u.id = r.processed_by
     WHERE r.patient_id = ?
     ORDER BY r.created_at DESC
  `).all(patient.id);
  ok(res, { requests: rows });
});

/** POST /api/patient/requests - submit a new blood request. */
router.post('/requests', (req, res) => {
  const database = get();
  const patient = myPatient(database, req.session.userId);
  if (!patient) return fail(res, 404, 'Patient profile not found.');

  const b = req.body || {};
  if (!b.blood_type || !validBloodType(b.blood_type)) return fail(res, 400, 'Please select a valid blood type.');
  if (!validPositiveInt(b.units_needed)) return fail(res, 400, 'Units needed must be a positive whole number.');
  if (!b.reason || !String(b.reason).trim()) return fail(res, 400, 'Please provide a reason for the request.');

  database.prepare(`
    INSERT INTO blood_requests (patient_id, blood_type, units_needed, priority, reason, location, status)
    VALUES (?, ?, ?, ?, ?, ?, 'Pending')
  `).run(patient.id, b.blood_type, Number(b.units_needed),
    ['Normal', 'Urgent', 'Critical'].includes(b.priority) ? b.priority : 'Normal',
    String(b.reason).trim(), b.location || patient.hospital);

  logAction(database, req.session.userId, 'Request Submitted',
    `${patient.patient_code} requested ${b.units_needed} unit(s) of ${b.blood_type}`);
  ok(res, { message: 'Blood request submitted. Staff will review it shortly.' });
});

/** PUT /api/patient/requests/:id/cancel - cancel my own PENDING request. */
router.put('/requests/:id/cancel', (req, res) => {
  const database = get();
  const patient = myPatient(database, req.session.userId);
  if (!patient) return fail(res, 404, 'Patient profile not found.');
  const request = database.prepare(
    'SELECT * FROM blood_requests WHERE id = ? AND patient_id = ?'
  ).get(req.params.id, patient.id);
  if (!request) return fail(res, 404, 'Request not found.');
  if (request.status !== 'Pending') return fail(res, 400, 'Only pending requests can be cancelled.');

  database.prepare("UPDATE blood_requests SET status = 'Cancelled', processed_by = ? WHERE id = ?")
    .run(req.session.userId, request.id);
  logAction(database, req.session.userId, 'Request Cancelled', `${patient.patient_code} cancelled request #${request.id}`);
  ok(res, { message: 'Request cancelled.' });
});

module.exports = router;
