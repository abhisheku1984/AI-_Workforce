import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let db;
export function getDb() {
  if (!db) {
    db = new Database(config.dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.function('now_iso', () => new Date().toISOString());
  }
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, 'migrations');

export function migrate({ quiet = false } = {}) {
  const database = getDb();
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const run = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
    run();
    if (!quiet) console.log(`[db] applied migration ${file}`);
  }
  return { applied: files.length };
}

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Wraps a function so it executes inside a single transaction.
 * Returns a transaction function (call it to run), so nested helpers can pass
 * the same wrapper around without starting a second transaction.
 */
export function tx(fn) {
  return getDb().transaction(fn);
}
