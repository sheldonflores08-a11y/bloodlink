/**
 * backend/routes/auth.js
 * ----------------------
 * Authentication: register, login, logout, session check, profile.
 * Used tables: users, donors, patients, activity_logs.
 * Connections: used by frontend login-page.html / app.js.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../../database/db').get;
const { createSession, destroySession } = require('../session');
const {
  fail, ok, requireFields, validEmail, validPhone, validAge,
  validBloodType, strongEnoughPassword, nextCode, logAction
} = require('../helpers');

/** POST /api/auth/register - create a donor OR patient account. */
router.post('/register', (req, res) => {
  const database = db();
  const body = req.body || {};

  const missing = requireFields(body, [
    'username', 'password', 'role', 'first_name', 'last_name',
    'age', 'sex', 'contact_number', 'address', 'blood_type'
  ]);
  if (missing) return fail(res, 400, missing);

  // Only donors and patients can self-register.
  const role = String(body.role).toLowerCase();
  if (!['donor', 'patient'].includes(role)) {
    return fail(res, 400, 'Only donors and patients can register online.');
  }

  const username = String(body.username).trim();
  if (username.length < 4) return fail(res, 400, 'Username must be at least 4 characters.');

  // No duplicate usernames.
  if (database.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return fail(res, 409, 'That username is already taken. Please choose another.');
  }

  if (!strongEnoughPassword(body.password)) {
    return fail(res, 400, 'Password must be 8+ characters with uppercase, lowercase, and a number.');
  }
  if (!validEmail(body.email)) return fail(res, 400, 'Please enter a valid email address.');
  if (!validAge(body.age)) return fail(res, 400, 'Please enter a valid age (1-119).');
  if (!['Male', 'Female'].includes(body.sex)) return fail(res, 400, 'Please select a valid sex.');
  if (!validPhone(body.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');
  if (!validBloodType(body.blood_type)) return fail(res, 400, 'Please select a valid blood type.');

  // Patients also need a hospital and the exact blood type they need.
  if (role === 'patient' && !body.hospital) {
    return fail(res, 400, 'Please provide the hospital name.');
  }

  const tx = database.transaction(() => {
    const user = database.prepare(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES (?, ?, ?, 'active')`
    ).run(username, bcrypt.hashSync(body.password, 10), role);

    const userId = user.lastInsertRowid;

    if (role === 'donor') {
      const code = nextCode(database, 'donors', 'donor_code', 'DON');
      database.prepare(
        `INSERT INTO donors (user_id, donor_code, first_name, middle_name, last_name,
           age, sex, contact_number, address, blood_type, email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, code, body.first_name, body.middle_name || null, body.last_name,
        Number(body.age), body.sex, body.contact_number, body.address,
        body.blood_type, body.email);
    } else {
      const code = nextCode(database, 'patients', 'patient_code', 'PAT');
      database.prepare(
        `INSERT INTO patients (user_id, patient_code, first_name, middle_name, last_name,
           age, sex, contact_number, address, blood_type_needed, hospital, medical_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, code, body.first_name, body.middle_name || null, body.last_name,
        Number(body.age), body.sex, body.contact_number, body.address,
        body.blood_type, body.hospital, body.medical_notes || null);
    }

    logAction(database, userId, 'Register', `${username} registered as ${role}`);
    return userId;
  });

  try {
    const userId = tx();
    // Auto-login after registration.
    createSession(res, userId, role, username);
    ok(res, { message: `Welcome, ${body.first_name}! Your ${role} account was created.`, role });
  } catch (err) {
    console.error(err);
    fail(res, 500, 'Something went wrong while creating your account. Please try again.');
  }
});

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  const database = db();
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 400, 'Please enter both username and password.');

  const user = database.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return fail(res, 401, 'Invalid username or password.');
  }

  // Deactivated users cannot log in (business rule #13).
  if (user.status !== 'active') {
    return fail(res, 403, 'This account has been deactivated. Please contact an administrator.');
  }

  createSession(res, user.id, user.role, user.username);
  logAction(database, user.id, 'Login', `${user.username} logged in`);
  ok(res, { message: 'Login successful.', role: user.role });
});

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  destroySession(req, res, () => ok(res, { message: 'Logged out.' }));
});

/** GET /api/auth/me - profile info for the logged-in user. */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return fail(res, 401, 'Not logged in.');
  const database = db();
  const user = database.prepare(
    'SELECT id, username, role, status FROM users WHERE id = ?'
  ).get(req.session.userId);
  if (!user) return fail(res, 401, 'Session expired. Please log in again.');

  let profile = null;
  if (user.role === 'donor') {
    profile = database.prepare(
      "SELECT id AS profile_id, donor_code, first_name, middle_name, last_name, age, sex, contact_number, address, blood_type, email, date_registered FROM donors WHERE user_id = ? AND status = 'active'"
    ).get(user.id);
  } else if (user.role === 'patient') {
    profile = database.prepare(
      "SELECT id AS profile_id, patient_code, first_name, middle_name, last_name, age, sex, contact_number, address, blood_type_needed, hospital, medical_notes FROM patients WHERE user_id = ? AND status = 'active'"
    ).get(user.id);
  }

  ok(res, { user, profile });
});

/** PUT /api/auth/profile - update permitted profile fields. */
router.put('/profile', (req, res) => {
  if (!req.session.userId) return fail(res, 401, 'Not logged in.');
  const database = db();
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return fail(res, 401, 'Session expired.');

  const body = req.body || {};

  if (user.role === 'donor') {
    const check = requireFields(body, ['contact_number', 'address']);
    if (check) return fail(res, 400, check);
    if (!validPhone(body.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');
    database.prepare('UPDATE donors SET contact_number = ?, address = ? WHERE user_id = ?')
      .run(body.contact_number, body.address, user.id);
  } else if (user.role === 'patient') {
    const check = requireFields(body, ['contact_number', 'address', 'hospital']);
    if (check) return fail(res, 400, check);
    if (!validPhone(body.contact_number)) return fail(res, 400, 'Please enter a valid contact number.');
    database.prepare('UPDATE patients SET contact_number = ?, address = ?, hospital = ? WHERE user_id = ?')
      .run(body.contact_number, body.address, body.hospital, user.id);
  } else {
    return fail(res, 403, 'Staff and admin profiles are managed in the Users module.');
  }

  logAction(database, user.id, 'Profile Update', `${user.username} updated their profile`);
  ok(res, { message: 'Profile updated.' });
});

/** PUT /api/auth/password - change own password. */
router.put('/password', (req, res) => {
  if (!req.session.userId) return fail(res, 401, 'Not logged in.');
  const database = db();
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  const { current, next } = req.body || {};
  if (!current || !next) return fail(res, 400, 'Please provide current and new passwords.');
  if (!bcrypt.compareSync(String(current), user.password_hash)) {
    return fail(res, 400, 'Current password is incorrect.');
  }
  if (!strongEnoughPassword(next)) {
    return fail(res, 400, 'New password must be 8+ characters with uppercase, lowercase, and a number.');
  }

  database.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(bcrypt.hashSync(String(next), 10), user.id);
  ok(res, { message: 'Password changed.' });
});

module.exports = router;
