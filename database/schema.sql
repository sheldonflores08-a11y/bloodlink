-- =====================================================
-- BLOODLINK DATABASE SCHEMA (SQLite)
-- Blood Donation, Inventory, and Blood Availability
-- Mapping System
-- =====================================================
-- This file creates all tables and indexes.
-- Sample data is inserted by database/init-db.js
-- (npm run setup), because passwords must be hashed
-- and dates must be relative to "today".
-- =====================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------
-- USERS : all accounts (donors, patients, staff,
-- admins and the super admin) live in this one table.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('donor','patient','staff','admin','superadmin')),
    status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- DONORS : profile of every registered blood donor.
-- Linked to users through user_id.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS donors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    donor_code      TEXT    NOT NULL UNIQUE,              -- system ID e.g. DON-00001
    first_name      TEXT    NOT NULL,
    middle_name     TEXT,
    last_name       TEXT    NOT NULL,
    age             INTEGER NOT NULL CHECK (age > 0 AND age < 120),
    sex             TEXT    NOT NULL CHECK (sex IN ('Male','Female')),
    contact_number  TEXT    NOT NULL,
    address         TEXT    NOT NULL,
    blood_type      TEXT    NOT NULL CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    email           TEXT    NOT NULL,
    date_registered TEXT    NOT NULL DEFAULT (date('now','localtime')),
    status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

-- -----------------------------------------------------
-- PATIENTS : profile of every patient who needs blood.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    patient_code         TEXT    NOT NULL UNIQUE,          -- system ID e.g. PAT-00001
    first_name           TEXT    NOT NULL,
    middle_name          TEXT,
    last_name            TEXT    NOT NULL,
    age                  INTEGER NOT NULL CHECK (age > 0 AND age < 120),
    sex                  TEXT    NOT NULL CHECK (sex IN ('Male','Female')),
    contact_number       TEXT    NOT NULL,
    address              TEXT    NOT NULL,
    blood_type_needed    TEXT    NOT NULL CHECK (blood_type_needed IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    hospital             TEXT    NOT NULL,
    medical_notes        TEXT,
    status               TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

-- -----------------------------------------------------
-- DONATIONS : every donation recorded for a donor.
-- Business rule: only donations with status 'Verified'
-- are added to blood inventory.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_id          INTEGER NOT NULL REFERENCES donors(id),
    blood_type        TEXT    NOT NULL CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    donation_date     TEXT    NOT NULL,
    blood_units       INTEGER NOT NULL CHECK (blood_units > 0),
    donation_location TEXT    NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Rejected')),
    recorded_by       INTEGER REFERENCES users(id),       -- staff/admin who recorded it
    created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- BLOOD LOCATIONS : blood centers/hospitals shown on map
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS blood_locations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name    TEXT    NOT NULL,
    address          TEXT    NOT NULL,
    latitude         REAL    NOT NULL,
    longitude        REAL    NOT NULL,
    contact_number   TEXT    NOT NULL,
    available_status TEXT    NOT NULL DEFAULT 'Active' CHECK (available_status IN ('Active','Inactive')),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- BLOOD INVENTORY : batches of blood per location.
-- A batch has a blood type, unit count, location and
-- expiration date. Expired batches are never "Available".
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS blood_inventory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    blood_type      TEXT    NOT NULL CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    blood_units     INTEGER NOT NULL CHECK (blood_units >= 0),   -- can never be negative
    location_id     INTEGER NOT NULL REFERENCES blood_locations(id),
    expiration_date TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'Available'
                    CHECK (status IN ('Available','Reserved','Used','Expired','Unavailable')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- BLOOD REQUESTS : requests submitted by patients.
-- Workflow: Pending -> Approved/Rejected -> Completed
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS blood_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   INTEGER NOT NULL REFERENCES patients(id),
    blood_type   TEXT    NOT NULL CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    units_needed INTEGER NOT NULL CHECK (units_needed > 0),
    request_date TEXT    NOT NULL DEFAULT (date('now','localtime')),
    priority     TEXT    NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal','Urgent','Critical')),
    reason       TEXT    NOT NULL,
    location     TEXT,                                     -- hospital/facility requesting from
    status       TEXT    NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending','Approved','Rejected','Processing','Completed','Cancelled')),
    processed_by INTEGER REFERENCES users(id),            -- staff/admin who processed it
    created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- NOTIFICATIONS : messages sent to users.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- SESSIONS : server-side session storage (token cookie
-- points at one row here). Log out/deactivate revokes.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- -----------------------------------------------------
-- SETTINGS : small key/value system settings.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- -----------------------------------------------------
-- PERMISSIONS : which role can open which module.
-- Managed by the Roles page (super admin).
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    role       TEXT    NOT NULL,
    module     TEXT    NOT NULL,
    can_access INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (role, module)
);

-- -----------------------------------------------------
-- ACTIVITY LOGS : auditable record of important actions.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,
    description TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ===================== INDEXES =======================
CREATE INDEX IF NOT EXISTS idx_donors_blood        ON donors(blood_type);
CREATE INDEX IF NOT EXISTS idx_donations_donor     ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_status    ON donations(status);
CREATE INDEX IF NOT EXISTS idx_inventory_type      ON blood_inventory(blood_type);
CREATE INDEX IF NOT EXISTS idx_inventory_location  ON blood_inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_status    ON blood_inventory(status);
CREATE INDEX IF NOT EXISTS idx_requests_patient    ON blood_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_requests_status     ON blood_requests(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user           ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_created        ON activity_logs(created_at);
