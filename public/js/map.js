/**
 * public/js/map.js
 * ----------------
 * Leaflet map helper used by the public map/search pages,
 * donor "nearby" view, and staff blood-locations page.
 * Markers + popups are built from live API data so the map
 * ALWAYS reflects the current inventory (business rule #10/#11).
 */
const BloodMap = {
  map: null,
  markers: [],
  detailsHandler: null, // optional callback(locationId) for "View Details"

  /** Create the map inside #containerId. Uses settings from DB when available. */
  async create(containerId) {
    let center = [17.03, 121.9], zoom = 10;
    try {
      const s = await API.get('/api/settings'); // public read-only settings
      if (s.settings) {
        if (s.settings.map_center_lat) center[0] = Number(s.settings.map_center_lat);
        if (s.settings.map_center_lng) center[1] = Number(s.settings.map_center_lng);
        if (s.settings.default_zoom) zoom = Number(s.settings.default_zoom);
      }
    } catch (e) { /* use defaults */ }

    BloodMap.map = L.map(containerId).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(BloodMap.map);
    return BloodMap.map;
  },

  /** Render markers for locations returned by /api/blood/map or /api/blood/search. */
  render(locations, highlightType) {
    for (const m of BloodMap.markers) BloodMap.map.removeLayer(m);
    BloodMap.markers = [];

    for (const loc of locations) {
      const blood = loc.blood || {};
      const rows = Object.entries(blood)
        .map(([t, u]) => `<div><span>${t}</span><b>${u} unit(s)</b></div>`).join('');
      const total = Object.values(blood).reduce((s, u) => s + u, 0);

      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${highlightType ? '#c0152e' : '#8f0f22'};color:#fff;
          padding:4px 8px;border-radius:14px;border:2px solid #fff;
          box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:11px;font-weight:700;white-space:nowrap">
          ${UI.esc(highlightType ? highlightType + ' ' + (blood[highlightType] || 0) : total)} unit(s)</div>`,
        iconSize: [null, 26], iconAnchor: [30, 24]
      });

      const marker = L.marker([loc.latitude, loc.longitude], { icon }).addTo(BloodMap.map);
      marker.bindPopup(`
        <div style="min-width:210px">
          <div class="pop-title">${UI.esc(loc.location_name)}</div>
          <div class="small muted">${UI.esc(loc.address)}</div>
          <div class="pop-blood">${rows || '<div class="muted">No blood available right now.</div>'}</div>
          <div class="small">Contact: ${UI.esc(loc.contact_number || '-')}</div>
          <div style="margin-top:8px">
            <a href="#" onclick="BloodMap.viewDetails(${loc.location_id});return false">View Details</a>
          </div>
        </div>`);
      BloodMap.markers.push(marker);
    }

    if (BloodMap.markers.length > 0) {
      const g = L.featureGroup(BloodMap.markers);
      BloodMap.map.fitBounds(g.getBounds().pad(0.15));
    }
  },

  viewDetails(locationId) {
    if (BloodMap.detailsHandler) BloodMap.detailsHandler(locationId);
  },

  destroy() {
    for (const m of BloodMap.markers) BloodMap.map.removeLayer(m);
    BloodMap.markers = [];
    if (BloodMap.map) { BloodMap.map.remove(); BloodMap.map = null; }
  }
};
