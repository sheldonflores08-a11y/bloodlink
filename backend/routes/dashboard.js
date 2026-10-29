/**
 * backend/routes/dashboard.js
 * ---------------------------
 * Role-specific dashboard numbers. Used tables: almost all.
 */
const express = require('express');
const router = express.Router();
const { get } = require('../../database/db');
const { requireLogin } = require('../middleware');
const { ok, getTotalsByType, sweepExpired } = require('../helpers');

router.use(requireLogin);

router.get('/', (req, res) => {
  const db = get();
  sweepExpired(db);
  const role = req.session.role;
  const data = {};

  if (role === 'admin' || role === 'superadmin' || role === 'staff') {
    const c = (sql, params) => db.prepare(sql).get(...(params || [])).n;
    data.counts = {
      donors: c("SELECT COUNT(*) AS n FROM donors WHERE status='active'"),
      patients: c("SELECT COUNT(*) AS n FROM patients WHERE status='active'"),
      staff: c("SELECT COUNT(*) AS n FROM users WHERE role='staff' AND status='active'"),
      total_units: c("SELECT COALESCE(SUM(blood_units),0) AS n FROM blood_inventory WHERE status='Available' AND expiration_date >= date('now','localtime')"),
      pending_requests: c("SELECT COUNT(*) AS n FROM blood_requests WHERE status='Pending'"),
      approved_requests: c("SELECT COUNT(*) AS n FROM blood_requests WHERE status IN ('Approved','Processing')"),
      locations: c("SELECT COUNT(*) AS n FROM blood_locations WHERE available_status='Active'"),
      pending_donations: c("SELECT COUNT(*) AS n FROM donations WHERE status='Pending'")
    };
    data.recent_donations = db.prepare(`
      SELECT dn.id, dn.blood_type, dn.blood_units, dn.donation_date, dn.status,
             d.first_name, d.last_name
        FROM donations dn JOIN donors d ON d.id = dn.donor_id
       ORDER BY dn.created_at DESC LIMIT 5`).all();
    data.recent_requests = db.prepare(`
      SELECT r.id, r.blood_type, r.units_needed, r.priority, r.status, r.created_at,
             p.first_name, p.last_name
        FROM blood_requests r JOIN patients p ON p.id = r.patient_id
       ORDER BY r.created_at DESC LIMIT 5`).all();
    data.by_type = getTotalsByType(db);
    if (role !== 'staff') {
      data.recent_logs = db.prepare(`
        SELECT l.action, l.description, l.created_at, u.username
          FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.id DESC LIMIT 5`).all();
    }
    if (role === 'superadmin') {
      data.users_total = c('SELECT COUNT(*) AS n FROM users');
      data.users_inactive = c("SELECT COUNT(*) AS n FROM users WHERE status='inactive'");
    }
  } else {
    // donor / patient dashboards are assembled on the frontend
    data.greeting = `Hello, ${req.session.username}!`;
  }
  ok(res, { dashboard: data, role });
});

module.exports = router;
