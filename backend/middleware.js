/**
 * backend/middleware.js
 * ---------------------
 * Tiny guards that protect the API:
 *  - requireLogin : user must have an active session
 *  - requireRole  : only the listed roles may enter
 *  - requireModule: staff/admin pages respect the permissions table
 *
 * Used by: every route file (except public parts of auth.js).
 */
const db = require('../database/db').get;
const { fail } = require('./helpers');
const { sweepExpired } = require('./helpers');

/** Must be logged in with an active account. */
function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return fail(res, 401, 'Please log in to continue.');
  }
  // If the account was deactivated mid-session, block access.
  const user = db().prepare('SELECT status FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.status !== 'active') {
    return fail(res, 403, 'This account has been deactivated.');
  }
  next();
}

/** Role check, e.g. requireRole('staff', 'admin', 'superadmin'). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) {
      return fail(res, 403, 'You do not have permission to access this page.');
    }
    next();
  };
}

/**
 * Module permission check for staff/admin pages.
 * Reads the permissions table (managed in the Roles page).
 * Super admin always passes.
 */
function requireModule(module) {
  return (req, res, next) => {
    if (req.session.role === 'superadmin') return next();
    const database = db();
    const row = database.prepare(
      'SELECT can_access FROM permissions WHERE role = ? AND module = ?'
    ).get(req.session.role, module);
    if (!row || Number(row.can_access) !== 1) {
      return fail(res, 403, `You do not have permission to access the ${module} module.`);
    }
    next();
  };
}

/** Keep expired blood out of every response automatically. */
function autoSweep(req, res, next) {
  try { sweepExpired(db()); } catch (e) { /* non-fatal */ }
  next();
}

module.exports = { requireLogin, requireRole, requireModule, autoSweep };
