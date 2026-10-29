# BloodLink

**Blood Donation, Inventory, and Blood Availability Mapping System**

A web-based system for managing blood donors, patients, blood requests,
blood inventory, staff/admin users, and blood availability locations —
with a live interactive map (Leaflet + OpenStreetMap).

---

## Quick Start

Requirements: **Node.js 18+** (nothing else — the database is bundled SQLite).

```bash
npm install        # install dependencies (if not done yet)
npm run setup      # create database + load sample data
npm start          # start the server
```

Open **http://localhost:3000**

Useful commands:

| Command        | What it does                                        |
|----------------|-----------------------------------------------------|
| `npm run setup`| Creates tables + seeds sample data (only if empty)  |
| `npm run reset`| Deletes everything and re-seeds fresh sample data   |
| `npm start`    | Starts the server on port 3000                      |

---

## Default Test Accounts

| Username    | Password      | Role        |
|-------------|---------------|-------------|
| superadmin  | Super@123     | Super Admin |
| admin       | Admin@123     | Admin       |
| staff       | Staff@123     | Staff       |
| staff1      | Staff@123     | Staff       |
| donor       | Donor@123     | Donor       |
| donor2      | Donor@123     | Donor       |
| patient     | Patient@123   | Patient     |
| patient2    | Patient@123   | Patient     |

Users can also be created from the Users page (staff) or by registering
on the login page (donor/patient only).

---

## System Structure

```
BloodLinks/
├── server.js                  # Express server, routes everything
├── database/
│   ├── schema.sql             # All tables, keys, indexes (SQLite)
│   ├── db.js                  # Single shared database connection
│   └── init-db.js             # Setup/seed script (npm run setup)
├── backend/
│   ├── helpers.js             # Validation, logging, availability queries
│   ├── session.js             # Cookie sessions stored in the database
│   ├── middleware.js          # requireLogin / requireRole / requireModule
│   └── routes/
│       ├── auth.js            # login, logout, register, profile, password
│       ├── blood.js           # blood search + map data API
│       ├── donor.js           # donor's own history/stats/nearby
│       ├── patient.js         # patient's own requests
│       ├── staff.js           # donors, patients, donations, inventory,
│       │                      #   requests, locations (operations)
│       ├── admin.js           # users, permissions, settings, logs,
│       │                      #   reports, backup/restore
│       ├── dashboard.js       # role-specific dashboard numbers
│       └── notifications.js   # per-user notifications
├── public/
│   ├── index.html             # Landing page
│   ├── login.html             # Login
│   ├── register.html          # Donor / patient registration
│   ├── dashboard.html         # Role-aware dashboard
│   ├── search.html            # Blood search + live map (public)
│   ├── map.html               # Full blood availability map (public)
│   ├── profile.html           # Donor/patient self-service profile
│   ├── history.html           # Donor donation history
│   ├── donations.html         # Staff: record/verify/reject donations
│   ├── inventory.html         # Staff: blood batch management
│   ├── requests.html          # Patient submit / staff process requests
│   ├── locations.html         # Staff: blood center management + map
│   ├── donors.html            # Staff: donor records
│   ├── patients.html          # Staff: patient records
│   ├── reports.html           # Filterable reports + print/export
│   ├── users.html             # Admin: user management
│   ├── role-permissions.html  # Super admin: role permission matrix
│   ├── settings.html          # Settings + database backup/restore
│   ├── logs.html              # Activity logs
│   ├── notifications.html     # Notification inbox
│   ├── css/style.css          # Red "blood" theme, responsive
│   └── js/
│       ├── api.js             # fetch wrapper
│       ├── common.js          # toasts, modals, formatters, tables
│       ├── shell.js           # sidebar/topbar layout per role
│       └── map.js             # Leaflet map helper (markers + popups)
└── test/
    └── smoke-test.js          # 51-check end-to-end API test
```

---

## Database (SQLite)

Single file: `data/bloodlink.db` (created by `npm run setup`).

Tables: `users`, `donors`, `patients`, `donations`, `blood_inventory`,
`blood_locations`, `blood_requests`, `notifications`, `activity_logs`,
`sessions`, `settings`, `permissions`.

See `database/schema.sql` for the complete structure with foreign keys,
indexes, CHECK constraints (email, phone, blood type, age, units), and
status values.

---

## Key Features by Role

- **Donor** — register, complete profile, donation history & status, nearby locations, search blood, notifications.
- **Patient** — register, required blood type, search blood, availability map, submit/track/cancel requests, notifications.
- **Staff** — manage donors/patients, record donations, verify/reject donations (verified blood enters inventory), manage inventory batches, process requests (approve → auto-deduct inventory → notify patient), manage locations.
- **Admin** — everything staff can, plus user management, settings view, reports, activity logs.
- **Super Admin** — everything, plus create admins, role/permission matrix, system settings, database backup & restore.

---

## Business Rules Enforced

1. Only **Verified** donations are added to available inventory.
2. Blood units must belong to one of the 8 valid types (dropdowns).
3. Expired blood is swept automatically and never appears as available (search, map, reports).
4. Inventory can never go negative — approvals fail with a friendly message if stock is short.
5. Patients cannot modify inventory directly (no API access).
6. Only staff/admin/superadmin can process (approve/reject/complete) requests.
7. Admins create staff; **only Super Admin** creates/manages admin accounts.
8. Deactivated users cannot log in (and existing sessions are revoked).
9. Search and map results always come from live database data.
10. Every important action is written to activity logs.

---

## Testing

End-to-end API test (server must be running):

```bash
npm start                 # in one terminal
node test/smoke-test.js   # in another
```

Covers: login/logout, wrong password, deactivated account, registration
validation, role-based access, O+ search, map data, expired-blood
exclusion, donor history, full request workflow (submit → approve →
inventory deducted 10→8 → complete → notification), over-draw blocking,
donation verification, admin rules, permissions, all 7 reports,
notifications, profile update. **51 checks total.**

Manual walkthrough for a demo:

1. Log in as `patient` → Search Blood → pick **O+** → see locations + map markers.
2. Submit a request for 2 units of O+ (Urgent).
3. Log in as `staff` → Blood Requests → Approve it, choosing a location → inventory drops by 2 → patient gets notified.
4. Donations → verify the pending one → blood appears in Inventory and on the map.
5. Log in as `superadmin` → Users → Roles & Permissions → System Settings → backup/restore.

---

## Backup & Restore

- **Backup:** Super Admin → Settings → *Download Backup* (consistent SQLite copy).
- **Restore:** Super Admin → Settings → *Restore Backup* → choose the file → all users must log in again. A safety copy is kept at `data/bloodlink.db.pre-restore`.

---

## Troubleshooting

- **"Database not found"** → run `npm run setup` first.
- **Port 3000 in use** → `set PORT=4000 && npm start`.
- **Reset fails (files locked)** → stop the server (Ctrl+C), then `npm run reset`.
- **Map tiles don't load** → map needs internet access (OpenStreetMap CDN).
