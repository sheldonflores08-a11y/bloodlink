/**
 * test/smoke-test.js
 * ------------------
 * End-to-end API test against a RUNNING server.
 * Verifies: auth, roles, search, map, inventory deduction,
 * request workflow, admin functions, and security rules.
 *
 * Usage:  node test/smoke-test.js  (server must be running on :3000)
 */
const BASE = 'http://localhost:3000';

let passed = 0, failed = 0;
const tokens = {}; // username -> cookie string

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { username, body } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (username && tokens[username]) opts.headers.Cookie = tokens[username];
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const cookie = res.headers.get('set-cookie');
  if (cookie && username) tokens[username] = cookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, data };
}

async function login(username, password) {
  // Store the returned session cookie under the account's username.
  return req('POST', '/api/auth/login', { username, body: { username, password } });
}

(async () => {
  console.log('=== 1. AUTHENTICATION ===');
  let r = await login('staff', 'Staff@123');
  check('staff login works', r.status === 200 && r.data.ok);
  r = await login('admin', 'Admin@123');
  check('admin login works', r.status === 200 && r.data.ok);
  r = await login('superadmin', 'Super@123');
  check('superadmin login works', r.status === 200 && r.data.ok);
  r = await login('patient', 'Patient@123');
  check('patient login works', r.status === 200 && r.data.ok);
  r = await login('donor', 'Donor@123');
  check('donor login works', r.status === 200 && r.data.ok);

  r = await login('staff', 'WrongPass@1');
  check('wrong password rejected', r.status === 401);
  r = await login('disabled', 'Disabled@123');
  check('deactivated account blocked', r.status === 403);

  console.log('=== 2. REGISTRATION ===');
  r = await req('POST', '/api/auth/register', {
    username: 'guest',
    body: {
      username: 'newdonor', password: 'Test@12345', role: 'donor',
      first_name: 'Nova', last_name: 'Test', age: 30, sex: 'Male',
      contact_number: '09171112223', address: 'Test City', blood_type: 'AB-',
      email: 'nova@test.com'
    }
  });
  check('donor registration works', r.status === 200 && r.data.ok, JSON.stringify(r.data));
  r = await req('POST', '/api/auth/register', {
    username: 'guest',
    body: {
      username: 'newdonor', password: 'Test@12345', role: 'donor',
      first_name: 'Dup', last_name: 'Test', age: 30, sex: 'Male',
      contact_number: '09171112224', address: 'Test City', blood_type: 'A+',
      email: 'dup@test.com'
    }
  });
  check('duplicate username rejected', r.status === 409);
  r = await req('POST', '/api/auth/register', {
    username: 'guest',
    body: {
      username: 'hacker', password: 'Test@12345', role: 'admin',
      first_name: 'Bad', last_name: 'Actor', age: 30, sex: 'Male',
      contact_number: '09171112225', address: 'Nowhere', blood_type: 'A+',
      email: 'hacker@test.com'
    }
  });
  check('self-registering as admin blocked', r.status === 400);
  r = await req('POST', '/api/auth/register', {
    username: 'guest',
    body: {
      username: 'weakpw', password: 'short', role: 'donor',
      first_name: 'Weak', last_name: 'Pw', age: 30, sex: 'Male',
      contact_number: '09171112226', address: 'Test', blood_type: 'O+',
      email: 'weak@test.com'
    }
  });
  check('weak password rejected', r.status === 400);

  console.log('=== 3. ROLE-BASED ACCESS ===');
  r = await req('GET', '/api/staff/inventory', { username: 'donor' });
  check('donor cannot open staff inventory', r.status === 403);
  r = await req('GET', '/api/admin/users', { username: 'patient' });
  check('patient cannot open admin users', r.status === 403);
  r = await req('GET', '/api/staff/inventory', { username: 'staff' });
  check('staff can open inventory', r.status === 200);
  r = await req('GET', '/api/admin/users', { username: 'admin' });
  check('admin can open users', r.status === 200);

  console.log('=== 4. BLOOD SEARCH ===');
  r = await req('GET', '/api/blood/search?blood_type=O%2B&location_id=');
  check('O+ search returns locations', r.status === 200 && r.data.locations.length >= 3);
  const op = r.data.locations.reduce((s, l) => s + (l.units.find(u => u.blood_type === 'O+')?.units || 0), 0);
  check('O+ total matches expected (>=18)', op >= 18, `got ${op}`);
  r = await req('GET', '/api/blood/search?blood_type=ALL');
  check('ALL-type search returns totals for 8 types', r.status === 200 && Object.keys(r.data.totals).length >= 7);
  r = await req('GET', '/api/blood/search?blood_type=XX');
  check('invalid blood type rejected', r.status === 400);

  console.log('=== 5. MAP DATA ===');
  r = await req('GET', '/api/blood/map');
  check('map returns 5 locations', r.status === 200 && r.data.locations.length === 5, `got ${r.data.locations && r.data.locations.length}`);
  const sm = (r.data.locations || []).find(l => l.location_name === 'San Mariano Blood Center');
  check('San Mariano has O+ on map', !!sm && (sm.blood['O+'] || 0) === 10);
  // Expired batch check: Isabela Blood Bank O+ should be 5 (the expired 4 must NOT count)
  const isabela = (r.data.locations || []).find(l => l.location_name === 'Isabela Blood Bank');
  check('expired batch excluded (Isabela O+ is 5, not 9)', isabela && isabela.blood['O+'] === 5, `got ${isabela && isabela.blood['O+']}`);

  console.log('=== 6. DONOR FLOW ===');
  r = await req('GET', '/api/donor/history', { username: 'donor' });
  check('donor sees own donation history', r.status === 200 && r.data.donations.length === 2);
  r = await req('GET', '/api/donor/stats', { username: 'donor' });
  check('donor stats: 2 units verified', r.status === 200 && r.data.stats.verified_units === 2);

  console.log('=== 7. PATIENT REQUEST WORKFLOW (full cycle) ===');
  // 7a. patient searches for blood first
  r = await req('GET', '/api/blood/search?blood_type=O%2B', { username: 'patient' });
  check('patient search works', r.status === 200);
  // 7b. patient submits a request for 2 units of O+
  r = await req('POST', '/api/patient/requests', {
    username: 'patient',
    body: { blood_type: 'O+', units_needed: 2, priority: 'Urgent', reason: 'Smoke test transfusion' }
  });
  check('patient submits request', r.status === 200 && r.data.ok, JSON.stringify(r.data));
  // 7c. find the request id
  r = await req('GET', '/api/staff/requests', { username: 'staff' });
  const newReq = (r.data.requests || []).find(x => x.reason === 'Smoke test transfusion');
  check('staff sees the new request', !!newReq);
  // 7d. record O+ stock at San Mariano BEFORE approve
  r = await req('GET', '/api/staff/inventory?blood_type=O%2B&location_id=1', { username: 'staff' });
  const before = (r.data.inventory || []).reduce((s, b) => s + (b.status === 'Available' ? b.blood_units : 0), 0);
  check('O+ stock at San Mariano before approve is 10', before === 10, `got ${before}`);
  // 7e. staff approves from San Mariano (location 1) — should deduct 2
  r = await req('PUT', `/api/staff/requests/${newReq.id}/status`, {
    username: 'staff', body: { status: 'Approved', location_id: 1 }
  });
  check('staff approves request', r.status === 200, JSON.stringify(r.data));
  // 7f. verify inventory decreased
  r = await req('GET', '/api/staff/inventory?blood_type=O%2B&location_id=1', { username: 'staff' });
  const after = (r.data.inventory || []).reduce((s, b) => s + (b.status === 'Available' ? b.blood_units : 0), 0);
  check('inventory deducted from 10 to 8', after === 8, `got ${after}`);
  // 7g. complete the request
  r = await req('PUT', `/api/staff/requests/${newReq.id}/status`, { username: 'staff', body: { status: 'Completed' } });
  check('staff completes request', r.status === 200);
  // 7h. patient sees the completed request
  r = await req('GET', '/api/patient/requests', { username: 'patient' });
  const mine = (r.data.requests || []).find(x => x.id === newReq.id);
  check('patient sees completed status', mine && mine.status === 'Completed');

  console.log('=== 8. CANNOT OVER-DRAW INVENTORY ===');
  r = await req('POST', '/api/patient/requests', {
    username: 'patient', body: { blood_type: 'AB+', units_needed: 999, priority: 'Normal', reason: 'Overdraw test' }
  });
  r = await req('GET', '/api/staff/requests', { username: 'staff' });
  const overReq = (r.data.requests || []).find(x => x.reason === 'Overdraw test');
  r = await req('PUT', `/api/staff/requests/${overReq.id}/status`, { username: 'staff', body: { status: 'Approved', location_id: 2 } });
  check('over-draw approval blocked', r.status === 409, JSON.stringify(r.data));

  console.log('=== 9. DONATION VERIFICATION ===');
  r = await req('GET', '/api/staff/donations?status=Pending', { username: 'staff' });
  const pend = r.data.donations[0];
  check('pending donation exists', !!pend);
  if (pend) {
    const b4 = await req('GET', '/api/staff/inventory?blood_type=B%2B&location_id=4', { username: 'staff' });
    const beforeB = (b4.data.inventory || []).reduce((s, b) => s + (b.status === 'Available' ? b.blood_units : 0), 0);
    r = await req('PUT', `/api/staff/donations/${pend.id}/verify`, {
      username: 'staff', body: { location_id: 4, expiration_date: '2026-10-01' }
    });
    check('staff verifies pending donation', r.status === 200, JSON.stringify(r.data));
    const b5 = await req('GET', '/api/staff/inventory?blood_type=B%2B&location_id=4', { username: 'staff' });
    const afterB = (b5.data.inventory || []).reduce((s, b) => s + (b.status === 'Available' ? b.blood_units : 0), 0);
    check('verified donation added B+ to inventory', afterB === beforeB + pend.blood_units, `${beforeB} -> ${afterB}`);
  }

  console.log('=== 10. ADMIN / SUPER ADMIN ===');
  r = await req('POST', '/api/admin/users', {
    username: 'superadmin', body: { username: 'staff99', password: 'Staff@9999', role: 'staff' }
  });
  check('superadmin creates staff account', r.status === 200, JSON.stringify(r.data));
  r = await req('POST', '/api/admin/users', {
    username: 'admin', body: { username: 'admin99', password: 'Admin@9999', role: 'admin' }
  });
  check('admin CANNOT create admin account (rule #8)', r.status === 403, JSON.stringify(r.data));
  r = await req('GET', '/api/admin/settings', { username: 'admin' });
  check('admin can read settings', r.status === 200);
  r = await req('PUT', '/api/admin/settings', { username: 'superadmin', body: { default_zoom: 11 } });
  check('superadmin updates settings', r.status === 200);
  r = await req('GET', '/api/admin/logs', { username: 'superadmin' });
  check('activity logs recorded', r.status === 200 && r.data.logs.length > 5);
  r = await req('GET', '/api/admin/permissions', { username: 'superadmin' });
  check('permission matrix returned', r.status === 200 && Array.isArray(r.data.admin));

  console.log('=== 11. REPORTS ===');
  for (const t of ['inventory', 'donors', 'patients', 'donations', 'requests', 'locations', 'usage']) {
    r = await req('GET', `/api/admin/reports/${t}`, { username: 'admin' });
    check(`report: ${t}`, r.status === 200 && Array.isArray(r.data.rows), `status ${r.status}`);
  }

  console.log('=== 12. NOTIFICATIONS ===');
  r = await req('GET', '/api/notifications', { username: 'patient' });
  check('patient received workflow notifications', r.status === 200 && r.data.notifications.length >= 3);

  console.log('=== 13. PROFILE UPDATE ===');
  r = await req('PUT', '/api/auth/profile', {
    username: 'donor',
    body: { contact_number: '09179999999', address: 'Updated Address, Isabela' }
  });
  check('donor can update allowed profile fields', r.status === 200);

  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
