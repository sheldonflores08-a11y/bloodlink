/**
 * backend/routes/blood.js
 * -----------------------
 * Blood search + map data API. This is the bridge between
 * the database and the Leaflet map / search results.
 *
 * Used tables: blood_inventory, blood_locations.
 * Connections: frontend search.html, map.js, app.js.
 *
 * Business rules enforced:
 *  - search results ALWAYS come from the database
 *  - expired/unavailable blood never appears as available
 *  - only Active locations are mapped
 */
const express = require('express');
const router = express.Router();
const { get } = require('../../database/db');
const {
  fail, ok, validBloodType, getAvailability, getTotalsByType, BLOOD_TYPES
} = require('../helpers');

/** GET /api/blood/types - the 8 official blood types (for dropdowns). */
router.get('/types', (req, res) => ok(res, { types: BLOOD_TYPES }));

/**
 * GET /api/blood/search?blood_type=O+&location_id=2
 * Main search endpoint for patients/donors.
 * Returns matching locations and per-type totals.
 */
router.get('/search', (req, res) => {
  const database = get();
  const bloodType = String(req.query.blood_type || 'ALL').trim().toUpperCase();
  const locationId = req.query.location_id || null;

  if (bloodType !== 'ALL' && !validBloodType(bloodType)) {
    return fail(res, 400, 'Invalid blood type. Please select one of the standard types.');
  }

  const rows = getAvailability(database,
    bloodType === 'ALL' ? { locationId } : { bloodType, locationId });

  // Group rows by location so the results list is easy to read.
  const locations = [];
  for (const r of rows) {
    let loc = locations.find((l) => l.location_id === r.location_id);
    if (!loc) {
      loc = {
        location_id: r.location_id, location_name: r.location_name,
        address: r.address, latitude: r.latitude, longitude: r.longitude,
        contact_number: r.contact_number, units: []
      };
      locations.push(loc);
    }
    loc.units.push({ blood_type: r.blood_type, units: r.units, last_updated: r.last_updated });
  }

  // Totals per blood type (shown above the result list).
  const totals = {};
  for (const t of getTotalsByType(database)) totals[t.blood_type] = t.units;

  const selectedTotal = bloodType === 'ALL' ? null : locations.reduce(
    (sum, l) => sum + (l.units.find(u => u.blood_type === bloodType)?.units || 0), 0);

  ok(res, {
    blood_type: bloodType,
    locations,
    totals,
    selected_total: selectedTotal,
    result_count: locations.length
  });
});

/** GET /api/blood/map - every active location with ALL its available blood.
 *  Powers the interactive Leaflet map. */
router.get('/map', (req, res) => {
  const database = get();
  const rows = getAvailability(database, {});

  // Group per location: each marker shows every blood type it has.
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.location_id)) {
      map.set(r.location_id, {
        location_id: r.location_id, location_name: r.location_name,
        address: r.address, latitude: r.latitude, longitude: r.longitude,
        contact_number: r.contact_number, available_status: 'Active', blood: {}
      });
    }
    map.get(r.location_id).blood[r.blood_type] = r.units;
  }
  ok(res, { locations: [...map.values()] });
});

module.exports = router;
