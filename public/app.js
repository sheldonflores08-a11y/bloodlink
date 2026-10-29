const $ = (selector) => document.querySelector(selector);
const state = { user: null, profile: null, map: null, markers: [] };
const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({ ok: false, message: 'Invalid server response.' }));
  if (!response.ok || data.ok === false) throw new Error(data.message || 'Request failed.');
  return data;
}
function showToast(message, error = false) { const toast = $('#toast'); toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`; setTimeout(() => { toast.className = 'toast'; }, 3200); }
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function bloodSelect(name = 'blood_type', includeAll = false) { return `<select name="${name}">${includeAll ? '<option value="ALL">All blood types</option>' : '<option value="">Select blood type</option>'}${bloodTypes.map((type) => `<option>${type}</option>`).join('')}</select>`; }

async function start() {
  try { const data = await api('/api/auth/me'); state.user = data.user; state.profile = data.profile; openApp(); }
  catch { $('#auth').classList.remove('hidden'); }
  bindAuth();
}
function bindAuth() {
  document.querySelectorAll('[data-auth]').forEach((tab) => tab.onclick = () => {
    document.querySelectorAll('[data-auth]').forEach((item) => item.classList.toggle('active', item === tab));
    $('#login-form').classList.toggle('hidden', tab.dataset.auth !== 'login'); $('#register-form').classList.toggle('hidden', tab.dataset.auth !== 'register');
  });
  $('#login-form').onsubmit = async (event) => { event.preventDefault(); try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData(event.target)) }); showToast(data.message); state.user = (await api('/api/auth/me')).user; state.profile = (await api('/api/auth/me')).profile; openApp(); } catch (error) { showToast(error.message, true); } };
  $('#register-form').onsubmit = async (event) => { event.preventDefault(); const values = formData(event.target); try { const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(values) }); showToast(data.message); state.user = (await api('/api/auth/me')).user; state.profile = (await api('/api/auth/me')).profile; openApp(); } catch (error) { showToast(error.message, true); } };
}
function openApp() { $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); renderNav(); navigate('dashboard'); }
function renderNav() {
  const role = state.user.role; const items = [{ id: 'dashboard', label: 'Dashboard' }, { id: 'search', label: 'Find blood' }, { id: 'map', label: 'Blood map' }, { id: 'notifications', label: 'Notifications' }];
  if (role === 'donor') items.splice(1, 0, { id: 'donations', label: 'My donations' });
  if (role === 'patient') items.splice(1, 0, { id: 'requests', label: 'My requests' });
  if (['staff', 'admin', 'superadmin'].includes(role)) items.push({ id: 'operations', label: 'Operations' });
  if (['admin', 'superadmin'].includes(role)) items.push({ id: 'users', label: 'Users & reports' });
  $('#role-label').textContent = `${state.user.role} workspace / ${state.user.username}`;
  $('#nav').innerHTML = items.map((item) => `<button class="nav-button" data-page="${item.id}">${item.label}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach((button) => button.onclick = () => { navigate(button.dataset.page); $('.sidebar').classList.remove('open'); });
  $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
  $('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
}
function navigate(page) { $('#page-title').textContent = page === 'search' ? 'Find available blood' : page[0].toUpperCase() + page.slice(1); $('#nav').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.page === page)); ({ dashboard: renderDashboard, search: renderSearch, map: renderMap, notifications: renderNotifications, donations: renderDonations, requests: renderRequests, operations: renderOperations, users: renderUsers }[page] || renderDashboard)(); }

async function renderDashboard() {
  const content = $('#content');
  try {
    const data = await api('/api/dashboard'); const dashboard = data.dashboard;
    if (['staff', 'admin', 'superadmin'].includes(state.user.role)) {
      const c = dashboard.counts; content.innerHTML = `<div class="cards">${[['Active donors', c.donors], ['Active patients', c.patients], ['Available units', c.total_units], ['Pending requests', c.pending_requests], ['Active locations', c.locations], ['Pending donations', c.pending_donations]].map(([label, value]) => `<div class="card"><small>${label}</small><div class="metric">${value}</div></div>`).join('')}</div><div class="grid-2"><section class="panel"><h3>Blood availability</h3><div class="result-list">${(dashboard.by_type || []).map((item) => `<div class="result"><strong>${item.blood_type} <span class="badge">${item.units} units</span></strong></div>`).join('') || '<div class="empty">No blood is available.</div>'}</div></section><section class="panel"><h3>Recent requests</h3>${table((dashboard.recent_requests || []).map((item) => [item.blood_type, `${item.first_name} ${item.last_name}`, item.units_needed, item.status]), ['Type', 'Patient', 'Units', 'Status'])}</section></div>`;
    } else { const name = state.profile ? `${state.profile.first_name} ${state.profile.last_name}` : state.user.username; content.innerHTML = `<section class="panel"><p class="eyebrow">Welcome back</p><h3>${esc(name)}</h3><p class="muted">${state.user.role === 'donor' ? `Blood type: ${esc(state.profile?.blood_type || 'Complete your profile')}` : `Blood needed: ${esc(state.profile?.blood_type_needed || 'Complete your profile')}`}</p><button class="primary" onclick="navigate('search')">Search blood availability</button></section>`; }
  } catch (error) { content.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
}
function table(rows, headings) { if (!rows.length) return '<div class="empty">No records found.</div>'; return `<div class="table-wrap"><table class="data-table"><thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
async function renderSearch() { $('#content').innerHTML = `<section class="panel"><div class="toolbar"><select id="search-type">${bloodTypes.map((type) => `<option>${type}</option>`).join('')}<option value="ALL">All types</option></select><button id="search-button">Search database</button></div><div id="search-results" class="result-list"></div></section>`; $('#search-button').onclick = runSearch; await runSearch(); }
async function runSearch() { const type = $('#search-type').value; try { const data = await api(`/api/blood/search?blood_type=${encodeURIComponent(type)}`); const results = $('#search-results'); if (!data.locations.length) { results.innerHTML = `<div class="empty">No ${type === 'ALL' ? '' : type + ' '}blood is currently available.</div>`; return; } results.innerHTML = data.locations.map((location) => `<article class="result"><strong>${esc(location.location_name)}</strong><span>${esc(location.address)} · ${esc(location.contact_number)}</span><p>${location.units.map((unit) => `<span class="badge">${unit.blood_type}: ${unit.units} units</span>`).join(' ')}</p></article>`).join(''); } catch (error) { showToast(error.message, true); } }
async function renderMap() { $('#content').innerHTML = '<section class="panel"><div id="map" class="map"></div></section>'; const data = await api('/api/blood/map'); state.map = L.map('map').setView([17.03, 121.9], 10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map); data.locations.forEach((location) => { const blood = Object.entries(location.blood).map(([type, units]) => `${type} — ${units} units`).join('<br>'); L.marker([location.latitude, location.longitude]).addTo(state.map).bindPopup(`<b>${esc(location.location_name)}</b><br>${esc(location.address)}<br><br>${blood}<br><br>${esc(location.contact_number)}`); }); }
async function renderNotifications() { try { const data = await api('/api/notifications'); $('#content').innerHTML = `<section class="panel"><div class="toolbar"><button id="read-all">Mark all as read</button></div>${data.notifications.map((item) => `<article class="result"><strong>${esc(item.title)} ${item.status === 'unread' ? '<span class="badge red">New</span>' : ''}</strong><span>${esc(item.message)}</span></article>`).join('') || '<div class="empty">You have no notifications.</div>'}</section>`; $('#read-all').onclick = async () => { await api('/api/notifications/read-all', { method: 'PUT' }); renderNotifications(); }; } catch (error) { $('#content').innerHTML = `<div class="notice">${esc(error.message)}</div>`; } }
async function renderDonations() { try { const data = await api('/api/donor/history'); $('#content').innerHTML = `<section class="panel"><h3>Donation history</h3>${table(data.donations.map((item) => [item.donation_date, item.blood_type, item.blood_units, item.status]), ['Date', 'Blood type', 'Units', 'Status'])}</section>`; } catch (error) { $('#content').innerHTML = `<div class="notice">${esc(error.message)}</div>`; } }
async function renderRequests() { try { const data = await api('/api/patient/requests'); $('#content').innerHTML = `<section class="panel"><h3>Submit a blood request</h3><form id="request-form" class="auth-form"><div class="form-grid"><label>Blood type${bloodSelect()}</label><label>Units needed<input name="units_needed" type="number" min="1" required></label></div><div class="form-grid"><label>Priority<select name="priority"><option>Normal</option><option>Urgent</option><option>Critical</option></select></label><label>Hospital or location<input name="location"></label></div><label>Reason<textarea name="reason" rows="3" required></textarea></label><button class="primary" type="submit">Submit request</button></form></section><section class="panel"><h3>My blood requests</h3>${table(data.requests.map((item) => [item.request_date, item.blood_type, item.units_needed, item.priority, item.status]), ['Date', 'Type', 'Units', 'Priority', 'Status'])}</section>`; $('#request-form').onsubmit = async (event) => { event.preventDefault(); try { const result = await api('/api/patient/requests', { method: 'POST', body: JSON.stringify(formData(event.target)) }); showToast(result.message); renderRequests(); } catch (error) { showToast(error.message, true); } }; } catch (error) { $('#content').innerHTML = `<div class="notice">${esc(error.message)}</div>`; } }
async function renderOperations() { try { const [inventory, requests] = await Promise.all([api('/api/staff/inventory'), api('/api/staff/requests')]); $('#content').innerHTML = `<div class="grid-2"><section class="panel"><h3>Inventory</h3>${table(inventory.inventory.map((item) => [item.blood_type, item.blood_units, item.location_name, item.expiration_date, item.status]), ['Type', 'Units', 'Location', 'Expires', 'Status'])}</section><section class="panel"><h3>Requests</h3>${table(requests.requests.map((item) => [item.id, item.blood_type, item.units_needed, item.priority, item.status]), ['#', 'Type', 'Units', 'Priority', 'Status'])}</section></div>`; } catch (error) { $('#content').innerHTML = `<div class="notice">${esc(error.message)}</div>`; } }
async function renderUsers() { try { const data = await api('/api/admin/users'); $('#content').innerHTML = `<section class="panel"><h3>Managed accounts</h3>${table(data.users.map((item) => [item.username, item.role, item.status, item.created_at]), ['Username', 'Role', 'Status', 'Created'])}</section>`; } catch (error) { $('#content').innerHTML = `<div class="notice">${esc(error.message)}</div>`; } }
start();
