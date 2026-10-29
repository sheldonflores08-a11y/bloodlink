/**
 * server.js
 * ---------
 * BloodLink main server. Starts Express, serves the frontend,
 * and mounts every API module.
 *
 * Run order:
 *   1. npm run setup        (creates database + sample data)
 *   2. npm start            (starts this server on port 3000)
 * Then open http://localhost:3000
 */
const path = require('path');
const express = require('express');

// Make sure the database exists before answering any request.
const { get } = require('./database/db');
const init = get();
const fs = require('fs');
const tables = init.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
).get();
if (!tables) {
  console.error('Database not found. Run "npm run setup" first, then "npm start".');
  process.exit(1);
}

const { sessionMiddleware } = require('./backend/session');
const { autoSweep } = require('./backend/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' }));       // allow large restore payloads
app.use(sessionMiddleware);                    // attach req.session
app.use(autoSweep);                            // keep expired blood out

// Frontend static files.
app.use(express.static(path.join(__dirname, 'public')));

// API routes.
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/blood', require('./backend/routes/blood'));

// Public read-only settings (system name + map defaults only).
app.get('/api/settings', (req, res) => {
  const rows = get().prepare(
    "SELECT key, value FROM settings WHERE key IN ('system_name','map_center_lat','map_center_lng','default_zoom','allow_registration')"
  ).all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ ok: true, settings });
});

app.use('/api/donor', require('./backend/routes/donor'));
app.use('/api/patient', require('./backend/routes/patient'));
app.use('/api/staff', require('./backend/routes/staff'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/notifications', require('./backend/routes/notifications'));
app.use('/api/dashboard', require('./backend/routes/dashboard'));

// Every other HTML page.
const pages = [
  'index', 'login', 'register', 'dashboard', 'profile', 'history', 'notifications',
  'search', 'map', 'donors', 'patients', 'donations', 'inventory',
  'requests', 'locations', 'reports', 'users', 'role-permissions', 'settings', 'logs'
];
for (const p of pages) {
  app.get('/' + (p === 'index' ? '' : p), (req, res) =>
    res.sendFile(path.join(__dirname, 'public', p === 'index' ? 'index.html' : p + '.html')));
}

// Friendly 404 for unknown API endpoints.
app.use('/api', (req, res) =>
  res.status(404).json({ ok: false, message: 'Endpoint not found.' }));

// Global error handler (no raw SQL errors to the browser).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Something went wrong on the server. Please try again.' });
});

app.listen(PORT, () => {
  console.log('BloodLink is running at http://localhost:' + PORT);
});
