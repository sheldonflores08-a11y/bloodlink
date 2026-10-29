/**
 * backend/routes/admin.js
 * -----------------------
 * Admin/super admin module: manage users (staff/admins), roles
 * and permissions, system settings, activity logs, reports,
 * database backup + restore.
 *
 * Business rules enforced:
 *  - only super admin can manage admin/super admin accounts (rule #8)
 *  - important actions are logged (rule #14)
 * Used tables: users, permissions, settings, activity_logs, and
 * nearly everything for reports.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { get, DB_PATH } = require('../../database/db');
const { requireLogin, requireRole } = require('../middleware');
const {
  fail, ok, requireFields, strongEnoughPassword, nextCode,
  logAction, notify, getTotalsByType
} = require('../helpers');

router.use(requireLogin);

const ALL_MODULES = ['donors', 'patients', 'donations', 'inventory', 'requests',
  'locations', 'reports', 'users', 'logs', 'settings'];

/* ================= USERS (staff/admins) ================= */

/** GET /api/admin/users - list staff/admin accounts. */
router.get('/users', requireRole('admin', 'superadmin'), (req, res) => {
  const db = get();
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  // Super admin sees everyone; admin sees staff only.
  const roles = me.role === 'superadmin'
    ? ['superadmin', 'admin', 'staff']
    : ['staff'];
  const rows = db.prepare(`
    SELECT id, username, role, status, created_at, updated_at
      FROM users WHERE role IN (${roles.map(() => '?').join(',')})
     ORDER BY role, username
  `).all(...roles);
  ok(res, { users: rows });
});

/** POST /api/admin/users - create a staff account (admin or super admin). */
router.post('/users', requireRole('admin', 'superadmin'), (req, res) => {
  const db = get();
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const b = req.body || {};
  const missing = requireFields(b, ['username', 'password', 'role']);
  if (missing) return fail(res, 400, missing);

  // Rule #8: only super admin may create admin accounts.
  if (b.role === 'admin' && me.role !== 'superadmin') {
    return fail(res, 403, 'Only the Super Admin can create admin accounts.');
  }
  if (b.role === 'superadmin') {
    return fail(res, 403, 'New super admin accounts cannot be created.');
  }
  if (!['staff', 'admin'].includes(b.role)) {
    return fail(res, 400, 'Role must be staff or admin.');
  }
  const username = String(b.username).trim();
  if (username.length < 4) return fail(res, 400, 'Username must be at least 4 characters.');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return fail(res, 409, 'That username is already taken.');
  }
  if (!strongEnoughPassword(b.password)) {
    return fail(res, 400, 'Password must be 8+ characters with uppercase, lowercase, and a number.');
  }

  db.prepare(
    "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, 'active')"
  ).run(username, bcrypt.hashSync(b.password, 10), b.role);
  logAction(db, req.session.userId, 'User Created', `Created ${b.role} account "${username}"`);
  ok(res, { message: `User "${username}" created.` });
});

/** PUT /api/admin/users/:id - update username/password/role/status. */
router.put('/users/:id', requireRole('admin', 'superadmin'), (req, res) => {
  const db = get();
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return fail(res, 404, 'User not found.');

  // Rule #8: admins cannot touch admin/superadmin accounts.
  if (me.role !== 'superadmin' && ['admin', 'superadmin'].includes(target.role)) {
    return fail(res, 403, 'Only the Super Admin can manage admin accounts.');
  }
  if (target.role === 'superadmin' && target.id !== me.id) {
    return fail(res, 403, 'Super admin accounts cannot be edited.');
  }

  const b = req.body || {};
  const tx = db.transaction(() => {
    if (b.username) {
      const username = String(b.username).trim();
      if (username.length < 4) throw new Error('Username must be at least 4 characters.');
      const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, target.id);
      if (dup) throw new Error('That username is already taken.');
      db.prepare("UPDATE users SET username = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(username, target.id);
    }
    if (b.password) {
      if (!strongEnoughPassword(b.password)) throw new Error('Password must be 8+ characters with uppercase, lowercase, and a number.');
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(bcrypt.hashSync(b.password, 10), target.id);
    }
    // Rule #13: status can be toggled; deactivated users lose login.
    if (b.status && ['active', 'inactive'].includes(b.status)) {
      db.prepare("UPDATE users SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(b.status, target.id);
      if (b.status === 'inactive') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
        notify(db, target.id, 'Account Deactivated', 'Your account has been deactivated by an administrator.');
      }
    }
  });
  try { tx(); } catch (e) { return fail(res, 400, e.message); }
  logAction(db, req.session.userId, 'User Updated', `Updated "${target.username}" (${b.username || b.password ? 'account' : 'status'})`);
  ok(res, { message: 'User updated.' });
});

/* ================= PERMISSIONS / ROLES ================= */

/** GET /api/admin/permissions - permission matrix (super admin). */
router.get('/permissions', requireRole('superadmin'), (req, res) => {
  const rows = get().prepare(
    'SELECT role, module, can_access FROM permissions ORDER BY role, module'
  ).all();
  ok(res, { modules: ALL_MODULES, staff_only: rows.filter((r) => r.role === 'staff'), admin: rows.filter((r) => r.role === 'admin') });
});

/** PUT /api/admin/permissions - save permission matrix (super admin). */
router.put('/permissions', requireRole('superadmin'), (req, res) => {
  const db = get();
  const b = req.body || {};
  const tx = db.transaction(() => {
    for (const role of ['staff', 'admin']) {
      if (!b[role]) continue;
      for (const m of ALL_MODULES) {
        const allowed = b[role][m] ? 1 : 0;
        db.prepare(`
          INSERT INTO permissions (role, module, can_access) VALUES (?, ?, ?)
          ON CONFLICT (role, module) DO UPDATE SET can_access = excluded.can_access
        `).run(role, m, allowed);
      }
    }
  });
  tx();
  logAction(db, req.session.userId, 'Permissions Updated', 'Role permissions matrix was updated');
  ok(res, { message: 'Permissions saved.' });
});

/* ================= SYSTEM SETTINGS ================= */

router.get('/settings', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = get().prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  ok(res, { settings });
});

router.put('/settings', requireRole('superadmin'), (req, res) => {
  const db = get();
  const b = req.body || {};
  const allowed = ['system_name', 'map_center_lat', 'map_center_lng', 'default_zoom', 'allow_registration'];
  const tx = db.transaction(() => {
    for (const key of allowed) {
      if (b[key] !== undefined) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
          .run(key, String(b[key]));
      }
    }
  });
  tx();
  logAction(db, req.session.userId, 'Settings Updated', 'System settings were changed');
  ok(res, { message: 'Settings saved.' });
});

/* ================= ACTIVITY LOGS ================= */

router.get('/logs', requireRole('admin', 'superadmin'), (req, res) => {
  const db = get();
  const params = [];
  let where = '1=1';
  if (req.query.username) { where += ' AND u.username LIKE ?'; params.push(`%${req.query.username}%`); }
  if (req.query.action) { where += ' AND l.action LIKE ?'; params.push(`%${req.query.action}%`); }
  const rows = db.prepare(`
    SELECT l.id, l.action, l.description, l.created_at, u.username
      FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
     WHERE ${where}
     ORDER BY l.id DESC LIMIT 300
  `).all(...params);
  ok(res, { logs: rows });
});

/* ================= REPORTS ================= */

router.get('/reports/:type', requireRole('staff', 'admin', 'superadmin'), (req, res) => {
  const db = get();
  const type = req.params.type;
  const { from, to, blood_type, location_id, status } = req.query;
  const dateCol = {
    donations: 'dn.donation_date', requests: 'r.request_date'
  }[type];
  let range = '';
  const params = [];
  if (dateCol && from) { range += ` AND ${dateCol} >= ?`; params.push(from); }
  if (dateCol && to) { range += ` AND ${dateCol} <= ?`; params.push(to); }

  let rows = [];
  switch (type) {
    case 'inventory':
      rows = db.prepare(`
        SELECT i.blood_type, i.blood_units, i.status, i.expiration_date, l.location_name
          FROM blood_inventory i JOIN blood_locations l ON l.id = i.location_id
         WHERE (? = 'ALL' OR i.blood_type = ?)
           AND (? = '' OR i.location_id = ?)
           AND (? = 'ALL' OR i.status = ?)
         ORDER BY l.location_name, i.blood_type
      `).all(blood_type || 'ALL', blood_type || 'ALL',
             location_id || '', location_id || '', status || 'ALL', status || 'ALL');
      break;
    case 'donors':
      rows = db.prepare(`
        SELECT d.donor_code, d.first_name, d.middle_name, d.last_name, d.age, d.sex,
               d.contact_number, d.blood_type, d.email, d.status, d.date_registered,
               (SELECT COUNT(*) FROM donations dn WHERE dn.donor_id = d.id) AS donations
          FROM donors d WHERE (? = 'ALL' OR d.blood_type = ?)
         ORDER BY d.last_name`).all(blood_type || 'ALL', blood_type || 'ALL');
      break;
    case 'patients':
      rows = db.prepare(`
        SELECT p.patient_code, p.first_name, p.middle_name, p.last_name, p.age, p.sex,
               p.contact_number, p.blood_type_needed, p.hospital, p.status
          FROM patients p WHERE (? = 'ALL' OR p.blood_type_needed = ?)
         ORDER BY p.last_name`).all(blood_type || 'ALL', blood_type || 'ALL');
      break;
    case 'donations':
      rows = db.prepare(`
        SELECT dn.donation_date, d.donor_code, d.first_name, d.last_name, dn.blood_type,
               dn.blood_units, dn.donation_location, dn.status
          FROM donations dn JOIN donors d ON d.id = dn.donor_id
         WHERE (? = 'ALL' OR dn.blood_type = ?) AND (? = 'ALL' OR dn.status = ?) ${range}
         ORDER BY dn.donation_date DESC`)
        .all(blood_type || 'ALL', blood_type || 'ALL', status || 'ALL', status || 'ALL', ...params);
      break;
    case 'requests':
      rows = db.prepare(`
        SELECT r.request_date, p.patient_code, p.first_name, p.last_name, r.blood_type,
               r.units_needed, r.priority, r.status, r.reason, r.location
          FROM blood_requests r JOIN patients p ON p.id = r.patient_id
         WHERE (? = 'ALL' OR r.blood_type = ?) AND (? = 'ALL' OR r.status = ?) ${range}
         ORDER BY r.request_date DESC`)
        .all(blood_type || 'ALL', blood_type || 'ALL', status || 'ALL', status || 'ALL', ...params);
      break;
    case 'locations':
      rows = db.prepare(`
        SELECT l.location_name, l.address, l.contact_number, l.available_status,
               (SELECT COALESCE(SUM(i.blood_units),0) FROM blood_inventory i
                 WHERE i.location_id = l.id AND i.status = 'Available'
                   AND i.expiration_date >= date('now','localtime')) AS available_units
          FROM blood_locations l ORDER BY l.location_name`).all();
      break;
    case 'usage':
      rows = db.prepare(`
        SELECT dn.blood_type, dn.donation_date, dn.blood_units, dn.status,
               d.first_name || ' ' || d.last_name AS donor
          FROM donations dn JOIN donors d ON d.id = dn.donor_id
         WHERE dn.status = 'Verified' ${range}
         ORDER BY dn.donation_date DESC`).all(...params);
      break;
    default:
      return fail(res, 404, 'Unknown report type.');
  }
  ok(res, { report: type, rows });
});

router.get('/reports', requireRole('staff', 'admin', 'superadmin'), (req, res) => {
  const db = get();
  const totals = getTotalsByType(db);
  const by_status = db.prepare('SELECT status, COUNT(*) AS n FROM blood_requests GROUP BY status').all();
  ok(res, { report: 'summary', totals, by_status });
});

/* ================= BACKUP / RESTORE (super admin) ================= */

/** GET /api/admin/backup - download a copy of bloodlink.db */
router.get('/backup', requireRole('superadmin'), (req, res) => {
  try {
    // Use SQLite online backup so the copy is consistent.
    get().backup(path.join(DB_PATH + '.backup-tmp'));
    const stamp = new Date().toISOString().slice(0, 10);
    res.download(DB_PATH + '.backup-tmp', `bloodlink-backup-${stamp}.db`, () => {
      try { fs.unlinkSync(DB_PATH + '.backup-tmp'); } catch (e) { /* ignore */ }
    });
    logAction(get(), req.session.userId, 'Backup Created', 'Downloaded a database backup');
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Could not create the backup.');
  }
});

/** POST /api/admin/restore - replace the database file. */
router.post('/restore', requireRole('superadmin'), (req, res) => {
  // Body contains the backup file's base64 content.
  const b64 = req.body && req.body.content;
  if (!b64) return fail(res, 400, 'No backup file content received.');
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 100 || buf.toString('utf8', 0, 15).indexOf('SQLite') === -1) {
      return fail(res, 400, 'That file does not look like a valid SQLite backup.');
    }
    const backupUserId = req.session.userId;
    // Replace the DB file: stop, write, reopen.
    const { close, reopen } = require('../../database/db');
    fs.copyFileSync(DB_PATH, DB_PATH + '.pre-restore'); // safety copy
    close();
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix); } catch (e) { /* ignore */ }
    }
    fs.writeFileSync(DB_PATH, buf);
    const fresh = reopen();
    logAction(fresh, backupUserId, 'Backup Restored', 'The database was replaced with a backup file');
    ok(res, { message: 'Database restored successfully. Please log in again.' });
  } catch (e) {
    console.error(e);
    fail(res, 500, 'Could not restore the backup. The previous database is untouched.');
  }
});

module.exports = router;
