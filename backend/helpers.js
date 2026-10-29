/**
 * backend/helpers.js
 * ------------------
 * Small reusable functions used across the whole backend:
 *  - friendly JSON responses
 *  - input validation (blood type, email, phone, ...)
 *  - ID/code generation (DON-00001, PAT-00001)
 *  - activity logging + notifications
 *  - blood availability queries (single source of truth
 *    for the search page and the map)
 *
 * Used by: every route file.
 */

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Send a friendly error message (never a raw SQL error). */
function fail(res, status, message) {
  res.status(status).json({ ok: false, message });
}

/** Send a success payload. */
function ok(res, data = {}) {
  res.json({ ok: true, ...data });
}

/** Check that required fields exist and are not empty strings.
 *  Returns null when everything is fine, otherwise a friendly message. */
function requireFields(body, fields) {
  for (const f of fields) {
    const v = body?.[f];
    if (v === undefined || v === null || String(v).trim() === '') {
      const pretty = f.replace(/_/g, ' ');
      return `Please provide a value for "${pretty}".`;
    }
  }
  return null;
}

function validBloodType(t) { return BLOOD_TYPES.includes(t); }

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e)); }

/** Accept common PH phone formats: 09xx..., +639..., 639... (10-13 digits). */
function validPhone(p) {
  const digits = String(p).replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function validPositiveInt(n) {
  return Number.isInteger(Number(n)) && Number(n) > 0;
}

function validDate(s) {
  return !Number.isNaN(Date.parse(String(s)));
}

function validAge(a) {
  return Number.isInteger(Number(a)) && Number(a) > 0 && Number(a) < 120;
}

/** Basic password rules: min 8 chars, one uppercase, one lowercase, one number. */
function strongEnoughPassword(p) {
  return typeof p === 'string' &&
    p.length >= 8 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /\d/.test(p);
}

/** Generate the next unique code like DON-00007. */
function nextCode(db, table, column, prefix) {
  const row = db
    .prepare(`SELECT ${column} AS last FROM ${table} ORDER BY id DESC LIMIT 1`)
    .get();
  let n = 0;
  if (row && row.last) {
    const m = String(row.last).match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10);
  }
  return `${prefix}-${String(n + 1).padStart(5, '0')}`;
}

/** Write one row in activity_logs. */
function logAction(db, userId, action, description) {
  db.prepare(
    'INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)'
  ).run(userId || null, action, description);
}

/** Send one notification to a user. */
function notify(db, userId, title, message) {
  if (!userId) return;
  db.prepare(
    'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)'
  ).run(userId, title, message);
}

/** Mark expired batches as Expired. Called before availability queries
 *  and on a timer, so expired blood never shows as available. */
function sweepExpired(db) {
  const info = db.prepare(
    `UPDATE blood_inventory
        SET status = 'Expired', updated_at = datetime('now','localtime')
      WHERE status = 'Available'
        AND expiration_date < date('now','localtime')`
  ).run();
  return info.changes;
}

/**
 * AVAILABLE BLOOD SUMMARY
 * Returns per location: total available units grouped by blood type.
 * Rules enforced here:
 *   - only batches with status 'Available' count
 *   - expired batches never count (also swept beforehand)
 *   - only Active locations appear
 *
 * Returns rows like:
 * { location_id, location_name, address, latitude, longitude,
 *   contact_number, blood_type, units, last_updated }
 */
function getAvailability(db, filters = {}) {
  sweepExpired(db);
  const where = [
    "i.status = 'Available'",
    "l.available_status = 'Active'",
    "i.expiration_date >= date('now','localtime')"
  ];
  const params = [];
  if (filters.bloodType) { where.push('i.blood_type = ?'); params.push(filters.bloodType); }
  if (filters.locationId) { where.push('i.location_id = ?'); params.push(Number(filters.locationId)); }

  return db.prepare(`
    SELECT l.id AS location_id, l.location_name, l.address,
           l.latitude, l.longitude, l.contact_number,
           i.blood_type, SUM(i.blood_units) AS units, MAX(i.updated_at) AS last_updated
      FROM blood_inventory i
      JOIN blood_locations l ON l.id = i.location_id
     WHERE ${where.join(' AND ')}
     GROUP BY l.id, i.blood_type
     ORDER BY units DESC
  `).all(...params);
}

/** Totals per blood type across all locations (used by search + dashboards). */
function getTotalsByType(db) {
  sweepExpired(db);
  return db.prepare(`
    SELECT blood_type, SUM(blood_units) AS units
      FROM blood_inventory
     WHERE status = 'Available'
       AND expiration_date >= date('now','localtime')
     GROUP BY blood_type
  `).all();
}

module.exports = {
  BLOOD_TYPES, fail, ok, requireFields,
  validBloodType, validEmail, validPhone, validPositiveInt,
  validDate, validAge, strongEnoughPassword,
  nextCode, logAction, notify, sweepExpired,
  getAvailability, getTotalsByType
};
