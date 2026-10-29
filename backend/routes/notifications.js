/**
 * backend/routes/notifications.js
 * -------------------------------
 * Notifications for the logged-in user (any role).
 * Used tables: notifications.
 */
const express = require('express');
const router = express.Router();
const { get } = require('../../database/db');
const { requireLogin } = require('../middleware');
const { ok, fail } = require('../helpers');

router.use(requireLogin);

/** GET /api/notifications */
router.get('/', (req, res) => {
  const rows = get().prepare(`
    SELECT id, title, message, status, created_at
      FROM notifications WHERE user_id = ?
     ORDER BY id DESC
  `).all(req.session.userId);
  const unread = rows.filter((n) => n.status === 'unread').length;
  ok(res, { notifications: rows, unread });
});

/** PUT /api/notifications/:id/read - mark one as read. */
router.put('/:id/read', (req, res) => {
  const info = get().prepare(
    "UPDATE notifications SET status = 'read' WHERE id = ? AND user_id = ?"
  ).run(req.params.id, req.session.userId);
  if (!info.changes) return fail(res, 404, 'Notification not found.');
  ok(res, { message: 'Marked as read.' });
});

/** PUT /api/notifications/read-all - mark all as read. */
router.put('/read-all', (req, res) => {
  get().prepare(
    "UPDATE notifications SET status = 'read' WHERE user_id = ?"
  ).run(req.session.userId);
  ok(res, { message: 'All notifications marked as read.' });
});

module.exports = router;
