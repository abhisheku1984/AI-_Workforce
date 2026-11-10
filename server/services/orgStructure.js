import { getDb, now } from '../db/index.js';

/**
 * Dimension resolution. Business units, departments, locations and skills are
 * created from the customer's own import data when they don't exist yet.
 * Each creation is reported back to the user in the import summary so nothing
 * appears silently.
 */
export function ensureBusinessUnit(orgId, name, created) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const db = getDb();
  const code = slugCode(clean);
  const existing = db.prepare('SELECT id FROM business_units WHERE org_id = ? AND (LOWER(name) = LOWER(?) OR code = ?)')
    .get(orgId, clean, code);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO business_units (org_id, name, code, created_at) VALUES (?, ?, ?, ?)')
    .run(orgId, clean, uniqueCode(db, 'business_units', orgId, code), now());
  created?.push(`Business unit "${clean}"`);
  return info.lastInsertRowid;
}

export function ensureDepartment(orgId, name, businessUnitId, created) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const db = getDb();
  const code = slugCode(clean);
  const existing = db.prepare('SELECT id FROM departments WHERE org_id = ? AND (LOWER(name) = LOWER(?) OR code = ?)')
    .get(orgId, clean, code);
  if (existing) {
    if (businessUnitId) db.prepare('UPDATE departments SET business_unit_id = COALESCE(business_unit_id, ?) WHERE id = ?').run(businessUnitId, existing.id);
    return existing.id;
  }
  const info = db.prepare('INSERT INTO departments (org_id, business_unit_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(orgId, businessUnitId ?? null, clean, uniqueCode(db, 'departments', orgId, code), now());
  created?.push(`Department "${clean}"`);
  return info.lastInsertRowid;
}

export function ensureLocation(orgId, name, created) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM locations WHERE org_id = ? AND LOWER(name) = LOWER(?)').get(orgId, clean);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO locations (org_id, name, country, timezone, hours_per_day, working_days, holidays, created_at)
                           VALUES (?, ?, ?, ?, 8, '[1,2,3,4,5]', '[]', ?)`)
    .run(orgId, clean, 'IN', 'Asia/Kolkata', now());
  created?.push(`Location "${clean}"`);
  return info.lastInsertRowid;
}

export function ensureSkill(orgId, name, category, created) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM skills WHERE org_id = ? AND LOWER(name) = LOWER(?)').get(orgId, clean);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO skills (org_id, name, category, created_at) VALUES (?, ?, ?, ?)')
    .run(orgId, clean, category ?? null, now());
  created?.push(`Skill "${clean}"`);
  return info.lastInsertRowid;
}

export function slugCode(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'X';
}

function uniqueCode(db, table, orgId, base) {
  let code = base, i = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE org_id = ? AND code = ?`).get(orgId, code)) {
    code = `${base}-${i++}`;
  }
  return code;
}
