/**
 * backend/session.js
 * ------------------
 * Very small cookie-based session manager backed by the
 * `sessions` table (so deactivated users lose access and
 * multiple browsers/servers work cleanly).
 *
 * Cookie: bl_token (HttpOnly) -> sessions.token -> users.id
 */
const crypto = require('crypto');
const { get } = require('../database/db');

const COOKIE_NAME = 'bl_token';
const COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours

/** Minimal cookie parser (avoids an extra dependency). */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Create a session row + send the cookie. */
function createSession(res, userId, role, username) {
  const db = get();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now','localtime','+12 hours'))`
  ).run(token, userId);
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
  return token;
}

/** Delete the session row + clear the cookie. */
function destroySession(req, res, done) {
  if (req.session && req.session.token) {
    get().prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  if (typeof done === 'function') done();
}

/** Express middleware: attach req.session or leave it undefined. */
function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (token) {
    const db = get();
    // Remove expired sessions lazily and load this one with its user.
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now','localtime')").run();
    const row = db.prepare(`
      SELECT s.token, u.id AS user_id, u.username, u.role, u.status AS user_status
        FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?
    `).get(token);
    if (row && row.user_status === 'active') {
      req.session = {
        token: row.token, userId: row.user_id,
        username: row.username, role: row.role
      };
    }
  }
  next();
}

module.exports = { sessionMiddleware, createSession, destroySession };
