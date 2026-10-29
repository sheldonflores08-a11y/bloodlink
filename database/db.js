/**
 * database/db.js
 * --------------
 * Opens (once) the SQLite database used by the whole system.
 * Other files use it like:  const db = require('../database/db'); db.get()...
 *
 * Database file location: /data/bloodlink.db
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bloodlink.db');

let instance = null; // single shared connection

/** Open the database (creates the /data folder if missing). */
function open() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');   // faster reads/writes
  db.pragma('foreign_keys = ON');    // enforce relationships
  return db;
}

/** Get the shared connection (opens it on first use). */
function get() {
  if (!instance) instance = open();
  return instance;
}

/** Close the shared connection (used by backup restore). */
function close() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/** Reopen after a close() (used by backup restore). */
function reopen() {
  close();
  return get();
}

module.exports = { get, close, reopen, DB_PATH, DATA_DIR };
