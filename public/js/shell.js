/**
 * public/js/shell.js
 * ------------------
 * Builds the shared layout (sidebar + topbar + content area)
 * for logged-in pages, based on the user's role.
 *
 * Usage in a page:
 *   Shell.init({ title: 'Blood Inventory', active: 'inventory' })
 *     .then(() => loadYourData());
 */
const NAV = {
  donor: [
    ['dashboard', 'Dashboard', 'home', '/dashboard'],
    ['profile', 'My Profile', 'user', '/profile'],
    ['history', 'Donation History', 'drop', '/history'],
    ['search', 'Search Blood', 'search', '/search'],
    ['map', 'Blood Locations', 'map', '/map'],
    ['notifications', 'Notifications', 'bell', '/notifications']
  ],
  patient: [
    ['dashboard', 'Dashboard', 'home', '/dashboard'],
    ['profile', 'My Profile', 'user', '/profile'],
    ['search', 'Search Blood', 'search', '/search'],
    ['map', 'Blood Map', 'map', '/map'],
    ['requests', 'My Requests', 'list', '/requests'],
    ['notifications', 'Notifications', 'bell', '/notifications']
  ],
  staff: [
    ['dashboard', 'Dashboard', 'home', '/dashboard'],
    ['donors', 'Donors', 'user', '/donors'],
    ['patients', 'Patients', 'user', '/patients'],
    ['donations', 'Donations', 'drop', '/donations'],
    ['inventory', 'Blood Inventory', 'box', '/inventory'],
    ['requests', 'Blood Requests', 'list', '/requests'],
    ['locations', 'Blood Locations', 'map', '/locations'],
    ['reports', 'Reports', 'doc', '/reports'],
    ['search', 'Search Blood', 'search', '/search'],
    ['map', 'Blood Map', 'map', '/map']
  ],
  admin: [
    ['dashboard', 'Dashboard', 'home', '/dashboard'],
    ['users', 'Users', 'user', '/users'],
    ['donors', 'Donors', 'user', '/donors'],
    ['patients', 'Patients', 'user', '/patients'],
    ['donations', 'Donations', 'drop', '/donations'],
    ['inventory', 'Inventory', 'box', '/inventory'],
    ['requests', 'Requests', 'list', '/requests'],
    ['locations', 'Blood Locations', 'map', '/locations'],
    ['reports', 'Reports', 'doc', '/reports'],
    ['logs', 'Activity Logs', 'log', '/logs'],
    ['settings', 'Settings', 'gear', '/settings']
  ],
  superadmin: [
    ['dashboard', 'Dashboard', 'home', '/dashboard'],
    ['users', 'Users & Admins', 'user', '/users'],
    ['donors', 'Donors', 'user', '/donors'],
    ['patients', 'Patients', 'user', '/patients'],
    ['donations', 'Donations', 'drop', '/donations'],
    ['inventory', 'Inventory', 'box', '/inventory'],
    ['requests', 'Requests', 'list', '/requests'],
    ['locations', 'Blood Locations', 'map', '/locations'],
    ['reports', 'Reports', 'doc', '/reports'],
    ['roles', 'Roles & Permissions', 'shield', '/role-permissions'],
    ['logs', 'Activity Logs', 'log', '/logs'],
    ['settings', 'System Settings', 'gear', '/settings']
  ]
};

const ICONS = {
  home: '&#9632;', user: '&#9679;', drop: '&#128167;', box: '&#128230;',
  list: '&#9776;', map: '&#128205;', bell: '&#128276;', search: '&#128269;',
  doc: '&#128196;', gear: '&#9881;', log: '&#128221;', shield: '&#128737;'
};

const Shell = {
  user: null, role: null,

  async init({ title = 'BloodLink', active = '' }) {
    try {
      const me = await API.get('/api/auth/me');
      Shell.user = me.user;
      Shell.role = me.user.role;
      Shell.profile = me.profile;
    } catch (e) {
      location.href = '/login';
      return false;
    }

    const role = Shell.role;
    const items = NAV[role] || [];
    const name = (Shell.profile && (Shell.profile.first_name || Shell.profile.last_name)
      ? `${Shell.profile.first_name} ${Shell.profile.last_name}` : Shell.user.username);
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    document.body.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand">
            <span class="drop"><span>B</span></span>
            <div><b>BloodLink</b><small>${Shell.roleLabel(role)}</small></div>
          </div>
          <nav>
            ${items.map(([key, label, icon, href]) =>
              `<a href="${href}" class="${key === active ? 'active' : ''}">
                 <span class="ico">${ICONS[icon] || '&#8226;'}</span><span class="txt">${label}</span>
               </a>`).join('')}
            <a href="#" id="logout-link"><span class="ico">&#10132;</span><span class="txt">Logout</span></a>
          </nav>
          <div class="foot">Blood donation, inventory &amp; availability mapping.</div>
        </aside>
        <div class="main-area">
          <header class="topbar">
            <h1>${UI.esc(title)}</h1>
            <button class="bell" id="bell-btn" title="Notifications">&#128276;<span class="badge-dot" id="bell-count" style="display:none">0</span></button>
            <div class="who">
              <span class="avatar">${UI.esc(initials)}</span>
              <div><b style="color:var(--ink)">${UI.esc(name)}</b><br>${Shell.roleLabel(role)}</div>
            </div>
          </header>
          <main class="content" id="page"></main>
        </div>
      </div>
      <div id="toasts"></div>`;

    document.getElementById('logout-link').onclick = async (e) => {
      e.preventDefault();
      await API.post('/api/auth/logout');
      location.href = '/login';
    };
    document.getElementById('bell-btn').onclick = () => location.href = '/notifications';

    Shell.refreshBell();
    return true;
  },

  roleLabel(role) {
    return { donor: 'Donor', patient: 'Patient', staff: 'Staff Member',
      admin: 'Administrator', superadmin: 'Super Admin' }[role] || role;
  },

  page() { return document.getElementById('page'); },

  async refreshBell() {
    try {
      const n = await API.get('/api/notifications');
      const dot = document.getElementById('bell-count');
      if (n.unread > 0) { dot.style.display = 'inline-block'; dot.textContent = n.unread; }
    } catch (e) { /* ignore */ }
  }
};
