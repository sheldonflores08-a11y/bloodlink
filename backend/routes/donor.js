/**
 * backend/routes/donor.js
 * -----------------------
 * Donor self-service: this donor's own info, donation history,
 * nearby locations, and a blood request.
 *
 * Used tables: donors, donations, users, notifications,
 * activity_logs (read), blood_locations (via helpers).
 */
const express = require('express');
const router = express.Router();
const { get } = require('../../database/db');
const { requireLogin, requireRole } = require('../middleware');
const { fail, ok, getAvailability } = require('../helpers');

router.use(requireLogin, requireRole('donor'));

/** GET /api/donor/history - my donations. */
router.get('/history', (req, res) => {
  const database = get();
  const donor = database.prepare('SELECT id FROM donors WHERE user_id = ?').get(req.session.userId);
  if (!donor) return fail(res, 404, 'Donor profile not found.');
  const rows = database.prepare(`
    SELECT id, blood_type, donation_date, blood_units, donation_location, status, created_at
      FROM donations WHERE donor_id = ?
     ORDER BY donation_date DESC
  `).all(donor.id);
  ok(res, { donations: rows });
});

/** GET /api/donor/nearby - donation locations with good stock. */
router.get('/nearby', (req, res) => {
  const database = get();
  const rows = getAvailability(database, {});
  const locs = new Map();
  for (const r of rows) {
    if (!locs.has(r.location_id)) {
      locs.set(r.location_id, {
        location_id: r.location_id, location_name: r.location_name, address: r.address,
        latitude: r.latitude, longitude: r.longitude, contact_number: r.contact_number
      });
    }
  }
  ok(res, { locations: [...locs.values()] });
});

/** GET /api/donor/stats - quick numbers for the dashboard. */
router.get('/stats', (req, res) => {
  const database = get();
  const donor = database.prepare(`
    SELECT id, blood_type, first_name,
      (SELECT COUNT(*) FROM donations dn WHERE dn.donor_id = donors.id) AS total_donations,
      (SELECT COALESCE(SUM(dn.blood_units),0) FROM donations dn WHERE dn.donor_id = donors.id AND dn.status='Verified') AS verified_units
      FROM donors WHERE user_id = ?
  `).get(req.session.userId);
  ok(res, { stats: donor });
});

module.exports = router;
