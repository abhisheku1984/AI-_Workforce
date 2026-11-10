/**
 * Import pipeline: stage → map → validate → commit.
 *
 * Data separation & lineage:
 *  - The uploaded file is stored unmodified under data/uploads with a SHA-256 checksum.
 *  - Raw cell values are kept per row in import_rows.raw and are never mutated.
 *  - Mapping/typing produces import_rows.normalized.
 *  - Only an explicit commit copies normalized rows into the master tables, and it is
 *    transactional: either the whole batch applies or nothing does.
 */
import { getDb, now, tx } from '../db/index.js';
import { getSchema } from './schemas.js';
import { validateRow, naturalKeyOf } from './validate.js';
import {
  ensureBusinessUnit, ensureDepartment, ensureLocation, ensureSkill,
} from '../services/orgStructure.js';

export function stageImport({ orgId, userId, entityType, filename, storedPath, format, size, checksum, headers, rows, mapping }) {
  const db = getDb();
  const schema = getSchema(entityType);
  return tx(() => {
    const imp = db.prepare(
      `INSERT INTO imports (org_id, uploaded_by, entity_type, filename, stored_path, format, size_bytes, checksum,
        status, mapping, headers, rows_total, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?, ?, ?)`
    ).run(orgId, userId, entityType, filename, storedPath, format, size, checksum,
      mapping ? JSON.stringify(mapping) : null, JSON.stringify(headers), rows.length, now(), now());

    const importId = imp.lastInsertRowid;
    const ins = db.prepare(
      `INSERT INTO import_rows (org_id, import_id, row_number, raw, normalized, status, issues)
       VALUES (?, ?, ?, ?, NULL, 'pending', '[]')`
    );
    for (const r of rows) ins.run(orgId, importId, r.rowNumber, JSON.stringify(r.values));
    return { importId, schema: schema.label, rowsTotal: rows.length };
  })();
}

export function mapImport({ orgId, importId, mapping }) {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(importId, orgId);
  if (!imp) throw Object.assign(new Error('Import not found.'), { status: 404 });
  const schema = getSchema(imp.entity_type);

  // Mapping must cover every required field exactly once.
  const targets = Object.values(mapping);
  const dupes = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dupes.length) throw Object.assign(new Error(`Each field can only be mapped once (duplicated: ${[...new Set(dupes)].join(', ')}).`), { status: 400 });
  const missing = schema.fields.filter((f) => f.required && !targets.includes(f.key)).map((f) => f.label);
  if (missing.length) throw Object.assign(new Error(`Required fields not mapped: ${missing.join(', ')}.`), { status: 400 });
  const validKeys = new Set(schema.fields.map((f) => f.key));
  const unknown = targets.filter((t) => !validKeys.has(t));
  if (unknown.length) throw Object.assign(new Error(`Unknown target fields: ${unknown.join(', ')}.`), { status: 400 });

  db.prepare(`UPDATE imports SET mapping = ?, status = 'mapped', updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(mapping), now(), importId);
  return { mapped: Object.keys(mapping).length };
}

/**
 * Validate every staged row. Duplicate detection:
 *  1. Same natural key twice inside the file → later row flagged 'duplicate'.
 *  2. Same natural key already exists in the master table → flagged as an UPDATE
 *     (info), not an error, so re-uploads refresh data rather than duplicating it.
 */
export function validateImport({ orgId, importId }) {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(importId, orgId);
  if (!imp) throw Object.assign(new Error('Import not found.'), { status: 404 });
  if (!imp.mapping) throw Object.assign(new Error('Map the columns before validating.'), { status: 400 });
  const mapping = JSON.parse(imp.mapping);
  const rows = db.prepare('SELECT * FROM import_rows WHERE import_id = ? ORDER BY row_number').all(importId);

  const seenKeys = new Map();
  let valid = 0, invalid = 0, warnings = 0, duplicates = 0;
  const counts = { errors: {}, warnings: {} };

  const run = tx(() => {
    for (const row of rows) {
      const raw = JSON.parse(row.raw);
      const res = validateRow(imp.entity_type, raw, mapping);
      let status = res.status;
      const issues = [...res.issues.map((i) => ({ ...i }))];

      if (status !== 'invalid') {
        const key = naturalKeyOf(imp.entity_type, res.normalized);
        if (seenKeys.has(key)) {
          status = 'duplicate';
          duplicates += 1;
          issues.push({
            code: 'DUPLICATE_IN_FILE', severity: 'warning',
            message: `Duplicate of row ${seenKeys.get(key)} in this file (same ${getSchema(imp.entity_type).naturalKey.join(' + ')}). This row will be skipped.`,
          });
        } else {
          seenKeys.set(key, row.row_number);
          const exists = findByNaturalKey(imp.entity_type, orgId, res.normalized);
          if (exists) {
            issues.push({
              code: 'EXISTING_RECORD', severity: 'info',
              message: `An existing record matches this row — it will be updated rather than duplicated.`,
            });
          }
        }
      }

      if (status === 'invalid') invalid += 1;
      else if (status === 'duplicate') { /* counted separately */ }
      else if (status === 'warning') warnings += 1;
      else valid += 1;

      for (const i of issues) {
        const bucket = i.severity === 'error' ? counts.errors : i.severity === 'warning' ? counts.warnings : null;
        if (bucket) bucket[i.code] = (bucket[i.code] || 0) + 1;
      }

      db.prepare('UPDATE import_rows SET normalized = ?, status = ?, issues = ? WHERE id = ?')
        .run(JSON.stringify(res.normalized), status, JSON.stringify(issues), row.id);
    }

    db.prepare(`UPDATE imports SET status = 'validated', rows_valid = ?, rows_invalid = ?, duplicate_rows = ?,
                updated_at = ? WHERE id = ?`)
      .run(valid, invalid, duplicates, now(), importId);
  });
  run();

  return {
    rowsTotal: rows.length, rowsValid: valid, rowsInvalid: invalid, rowsDuplicate: duplicates,
    rowsWarning: warnings, issueCounts: counts,
  };
}

function findByNaturalKey(entityType, orgId, n) {
  const db = getDb();
  switch (entityType) {
    case 'employees':
      return db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(orgId, n.employee_code);
    case 'projects':
      return db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(orgId, n.code);
    case 'invoices':
      return db.prepare('SELECT id FROM invoices WHERE org_id = ? AND invoice_number = ?').get(orgId, n.invoice_number);
    case 'allocation' || 'allocations':
      return null;
    case 'allocations': {
      const e = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(orgId, n.employee_code);
      const p = db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(orgId, n.project_code);
      if (!e || !p) return null;
      return db.prepare('SELECT id FROM allocations WHERE org_id = ? AND employee_id = ? AND project_id = ? AND start_date = ?')
        .get(orgId, e.id, p.id, n.start_date);
    }
    case 'timesheets': {
      const e = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(orgId, n.employee_code);
      const p = n.project_code ? db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(orgId, n.project_code) : null;
      if (!e) return null;
      return db.prepare(`SELECT id FROM timesheets WHERE org_id = ? AND employee_id = ? AND IFNULL(project_id,0) = IFNULL(?,0)
                         AND work_date = ? AND billable = ?`)
        .get(orgId, e.id, p?.id ?? null, n.work_date, n.billable === 'no' ? 0 : 1);
    }
    case 'demand': {
      const p = db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(orgId, n.project_code);
      if (!p) return null;
      return db.prepare('SELECT id FROM project_demand WHERE org_id = ? AND project_id = ? AND role_title = ? AND start_date = ?')
        .get(orgId, p.id, n.role_title, n.start_date);
    }
    case 'skills': {
      const e = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(orgId, n.employee_code);
      if (!e) return null;
      const s = db.prepare('SELECT id FROM skills WHERE org_id = ? AND LOWER(name) = LOWER(?)').get(orgId, n.skill);
      if (!s) return null;
      return db.prepare('SELECT id FROM employee_skills WHERE employee_id = ? AND skill_id = ?').get(e.id, s.id);
    }
    case 'expenses':
      return null; // expenses are appended; dedupe handled by exact match below
    default:
      return null;
  }
}

/**
 * Commit validated rows to master tables in a single transaction.
 * Rows with status 'invalid' or 'duplicate' are skipped and remain auditable.
 */
export function commitImport({ orgId, importId, userId }) {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(importId, orgId);
  if (!imp) throw Object.assign(new Error('Import not found.'), { status: 404 });
  if (imp.status !== 'validated') {
    throw Object.assign(new Error('Only validated imports can be committed. Validate the file first.'), { status: 400 });
  }

  const rows = db.prepare(`SELECT * FROM import_rows WHERE import_id = ? AND status IN ('valid','warning')
                           ORDER BY row_number`).all(importId);
  if (!rows.length) throw Object.assign(new Error('There are no valid rows to commit. Correct the errors and re-upload.'), { status: 400 });

  const created = [];
  const summary = { created: 0, updated: 0, skipped: 0, details: [] };

  const run = tx(() => {
    const ctx = { orgId, userId, importId: imp.id, created, summary };
    let committed = 0;
    for (const row of rows) {
      const n = JSON.parse(row.normalized);
      let outcome;
      try {
        outcome = commitRow(imp.entity_type, n, ctx);
      } catch (err) {
        summary.details.push({ row: row.row_number, skipped: true, reason: err.message });
        summary.skipped += 1;
        db.prepare(`UPDATE import_rows SET status = 'skipped', issues = ? WHERE id = ?`)
          .run(JSON.stringify([{ code: 'COMMIT_SKIPPED', severity: 'error', message: err.message }]), row.id);
        continue;
      }
      if (outcome === 'updated') summary.updated += 1;
      else { summary.created += 1; }
      committed += 1;
      db.prepare(`UPDATE import_rows SET status = 'committed' WHERE id = ?`).run(row.id);
    }

    db.prepare(`UPDATE imports SET status = 'committed', rows_committed = ?, committed_at = ?, updated_at = ?,
                notes = ? WHERE id = ?`)
      .run(committed, now(), now(), JSON.stringify({ created, summary: { created: summary.created, updated: summary.updated, skipped: summary.skipped } }), importId);
  });
  run();

  return { committed: summary.created + summary.updated, ...summary, created_detail: created };
}

function recordVersion(ctx, entityType, entityId, snapshot, changeType = 'update') {
  const db = getDb();
  const last = db.prepare('SELECT MAX(version) v FROM record_versions WHERE org_id = ? AND entity_type = ? AND entity_id = ?')
    .get(ctx.orgId, entityType, entityId);
  db.prepare(`INSERT INTO record_versions (org_id, entity_type, entity_id, version, snapshot, changed_by, change_type, changed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ctx.orgId, entityType, entityId, (last?.v || 0) + 1, JSON.stringify(snapshot), ctx.userId, changeType, now());
}

function commitRow(entityType, n, ctx) {
  const db = getDb();
  const ts = now();

  switch (entityType) {
    case 'employees': {
      const buId = n.business_unit ? ensureBusinessUnit(ctx.orgId, n.business_unit, ctx.created) : null;
      const deptId = n.department ? ensureDepartment(ctx.orgId, n.department, buId, ctx.created) : null;
      const locId = n.location ? ensureLocation(ctx.orgId, n.location, ctx.created) : null;
      const existing = db.prepare('SELECT * FROM employees WHERE org_id = ? AND employee_code = ?').get(ctx.orgId, n.employee_code);
      const values = [
        n.full_name, n.email ?? null, deptId, buId, locId, n.designation ?? null, n.grade ?? null,
        n.employment_type ?? 'full_time', n.status ?? 'active', n.join_date ?? null, n.exit_date ?? null,
        n.fte ?? 1, n.weekly_hours ?? null, n.annual_cost ?? null, n.cost_currency ?? 'INR',
        n.bill_rate_hour ?? null, n.annual_bill_rate ?? null, `import:${ctx.importId}`, ts,
      ];
      let empId;
      if (existing) {
        recordVersion(ctx, 'employee', existing.id, existing);
        db.prepare(`UPDATE employees SET full_name=?, email=?, department_id=?, business_unit_id=?, location_id=?,
                    designation=?, grade=?, employment_type=?, status=?, join_date=?, exit_date=?, fte=?, weekly_hours=?,
                    annual_cost=?, cost_currency=?, bill_rate_hour=?, annual_bill_rate=?, data_source=?, updated_at=?
                    WHERE id = ?`).run(...values, existing.id);
        empId = existing.id;
        ctx.summary.details.push({ row: n.employee_code, action: 'updated' });
      } else {
        const info = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id,
                    business_unit_id, location_id, designation, grade, employment_type, status, join_date, exit_date, fte,
                    weekly_hours, annual_cost, cost_currency, bill_rate_hour, annual_bill_rate, data_source, updated_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(ctx.orgId, n.employee_code, ...values, ts);
        empId = info.lastInsertRowid;
        ctx.summary.details.push({ row: n.employee_code, action: 'created' });
      }
      // Manager linkage (second pass happens naturally on later rows / re-upload).
      if (n.manager_code) {
        const mgr = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(ctx.orgId, n.manager_code);
        if (mgr) db.prepare('UPDATE employees SET manager_id = ? WHERE id = ?').run(mgr.id, empId);
      } else if (n.manager_code === undefined) {
        // leave existing manager untouched
      }
      // Inline skills ("Java; SQL")
      if (n.skills) {
        for (const s of String(n.skills).split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
          const skillId = ensureSkill(ctx.orgId, s, null, ctx.created);
          db.prepare(`INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency, verified)
                      VALUES (?, ?, ?, 3, 0)
                      ON CONFLICT(employee_id, skill_id) DO UPDATE SET proficiency = excluded.proficiency`)
            .run(ctx.orgId, empId, skillId);
        }
      }
      return existing ? 'updated' : 'created';
    }

    case 'skills': {
      const emp = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(ctx.orgId, n.employee_code);
      if (!emp) throw new Error(`Employee ${n.employee_code} does not exist. Import employees first.`);
      const skillId = ensureSkill(ctx.orgId, n.skill, n.category, ctx.created);
      const existing = db.prepare('SELECT id FROM employee_skills WHERE employee_id = ? AND skill_id = ?').get(emp.id, skillId);
      db.prepare(`INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency, years, verified)
                  VALUES (?, ?, ?, ?, ?, 0)
                  ON CONFLICT(employee_id, skill_id) DO UPDATE SET proficiency = excluded.proficiency, years = excluded.years`)
        .run(ctx.orgId, emp.id, skillId, n.proficiency ?? 3, n.years ?? null);
      return existing ? 'updated' : 'created';
    }

    case 'projects': {
      const buId = n.business_unit ? ensureBusinessUnit(ctx.orgId, n.business_unit, ctx.created) : null;
      const deptId = n.department ? ensureDepartment(ctx.orgId, n.department, buId, ctx.created) : null;
      const existing = db.prepare('SELECT * FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.code);
      if (existing) {
        recordVersion(ctx, 'project', existing.id, existing);
        db.prepare(`UPDATE projects SET name=?, client_name=?, business_unit_id=?, department_id=?, start_date=?, end_date=?,
                    status=?, contract_type=?, budget_amount=?, currency=?, billing_rate_hour=?, priority=?, health=?, updated_at=?
                    WHERE id=?`)
          .run(n.name, n.client_name ?? null, buId, deptId, n.start_date ?? null, n.end_date ?? null,
            n.status ?? 'active', n.contract_type ?? 'time_material', n.budget_amount ?? null, n.currency ?? 'INR',
            n.billing_rate_hour ?? null, n.priority ?? 'medium', n.health ?? 'green', ts, existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO projects (org_id, code, name, client_name, business_unit_id, department_id, start_date, end_date,
                  status, contract_type, budget_amount, currency, billing_rate_hour, priority, health, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, n.code, n.name, n.client_name ?? null, buId, deptId, n.start_date ?? null, n.end_date ?? null,
          n.status ?? 'active', n.contract_type ?? 'time_material', n.budget_amount ?? null, n.currency ?? 'INR',
          n.billing_rate_hour ?? null, n.priority ?? 'medium', n.health ?? 'green', ts, ts);
      return 'created';
    }

    case 'demand': {
      const proj = db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.project_code);
      if (!proj) throw new Error(`Project ${n.project_code} does not exist. Import projects first.`);
      const skillId = n.required_skill ? ensureSkill(ctx.orgId, n.required_skill, null, ctx.created) : null;
      const existing = db.prepare('SELECT * FROM project_demand WHERE org_id = ? AND project_id = ? AND role_title = ? AND start_date = ?')
        .get(ctx.orgId, proj.id, n.role_title, n.start_date);
      if (existing) {
        db.prepare(`UPDATE project_demand SET required_skill_id=?, headcount=?, hours_per_week=?, end_date=?, priority=?, status=?, notes=?
                    WHERE id=?`)
          .run(skillId, n.headcount, n.hours_per_week ?? 40, n.end_date, n.priority ?? 'medium', n.status ?? 'open', n.notes ?? null, existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO project_demand (org_id, project_id, role_title, required_skill_id, headcount, hours_per_week,
                  start_date, end_date, priority, status, notes, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, proj.id, n.role_title, skillId, n.headcount, n.hours_per_week ?? 40, n.start_date, n.end_date,
          n.priority ?? 'medium', n.status ?? 'open', n.notes ?? null, ts);
      return 'created';
    }

    case 'allocations': {
      const emp = db.prepare('SELECT id, bill_rate_hour, annual_cost FROM employees WHERE org_id = ? AND employee_code = ?')
        .get(ctx.orgId, n.employee_code);
      if (!emp) throw new Error(`Employee ${n.employee_code} does not exist. Import employees first.`);
      const proj = db.prepare('SELECT id, billing_rate_hour FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.project_code);
      if (!proj) throw new Error(`Project ${n.project_code} does not exist. Import projects first.`);
      const existing = db.prepare(`SELECT * FROM allocations WHERE org_id = ? AND employee_id = ? AND project_id = ? AND start_date = ?`)
        .get(ctx.orgId, emp.id, proj.id, n.start_date);
      const billable = n.billable === 'no' ? 0 : 1;
      const rate = n.bill_rate_hour ?? proj.billing_rate_hour ?? emp.bill_rate_hour ?? null;
      if (existing) {
        recordVersion(ctx, 'allocation', existing.id, existing);
        db.prepare(`UPDATE allocations SET end_date=?, hours_per_week=?, allocation_pct=?, billable=?, bill_rate_hour=?,
                    status=?, note=?, updated_at=? WHERE id=?`)
          .run(n.end_date, n.hours_per_week, n.allocation_pct ?? null, billable, rate,
            n.status ?? 'confirmed', n.note ?? null, ts, existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, start_date, end_date, hours_per_week,
                  allocation_pct, billable, bill_rate_hour, status, note, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, emp.id, proj.id, n.start_date, n.end_date, n.hours_per_week, n.allocation_pct ?? null,
          billable, rate, n.status ?? 'confirmed', n.note ?? null, ctx.userId, ts, ts);
      return 'created';
    }

    case 'timesheets': {
      const emp = db.prepare('SELECT id FROM employees WHERE org_id = ? AND employee_code = ?').get(ctx.orgId, n.employee_code);
      if (!emp) throw new Error(`Employee ${n.employee_code} does not exist.`);
      let projId = null;
      if (n.project_code) {
        const proj = db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.project_code);
        if (!proj) throw new Error(`Project ${n.project_code} does not exist.`);
        projId = proj.id;
      }
      const billable = n.billable === 'no' ? 0 : 1;
      const existing = db.prepare(`SELECT * FROM timesheets WHERE org_id = ? AND employee_id = ? AND IFNULL(project_id,0) = IFNULL(?,0)
                                   AND work_date = ? AND billable = ?`)
        .get(ctx.orgId, emp.id, projId, n.work_date, billable);
      if (existing) {
        db.prepare('UPDATE timesheets SET hours = ?, source = ?, import_id = ? WHERE id = ?')
          .run(n.hours, `import:${ctx.importId}`, ctx.importId, existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO timesheets (org_id, employee_id, project_id, work_date, hours, billable, source, import_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, emp.id, projId, n.work_date, n.hours, billable, `import:${ctx.importId}`, ctx.importId);
      return 'created';
    }

    case 'invoices': {
      let projId = null;
      if (n.project_code) {
        const proj = db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.project_code);
        if (!proj) throw new Error(`Project ${n.project_code} does not exist.`);
        projId = proj.id;
      }
      const existing = db.prepare('SELECT * FROM invoices WHERE org_id = ? AND invoice_number = ?').get(ctx.orgId, n.invoice_number);
      if (existing) {
        recordVersion(ctx, 'invoice', existing.id, existing);
        db.prepare(`UPDATE invoices SET project_id=?, period_month=?, amount=?, currency=?, status=?, issued_date=?, due_date=?, paid_date=?
                    WHERE id=?`)
          .run(projId, n.period_month, n.amount, n.currency ?? 'INR', n.status ?? 'issued', n.issued_date ?? null, n.due_date ?? null,
            n.paid_date ?? null, existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO invoices (org_id, project_id, invoice_number, period_month, amount, currency, status,
                  issued_date, due_date, paid_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, projId, n.invoice_number, n.period_month, n.amount, n.currency ?? 'INR', n.status ?? 'issued',
          n.issued_date ?? null, n.due_date ?? null, n.paid_date ?? null, ts);
      return 'created';
    }

    case 'expenses': {
      const proj = n.project_code
        ? db.prepare('SELECT id FROM projects WHERE org_id = ? AND code = ?').get(ctx.orgId, n.project_code) : null;
      if (n.project_code && !proj) throw new Error(`Project ${n.project_code} does not exist.`);
      const deptId = n.department
        ? ensureDepartment(ctx.orgId, n.department, null, ctx.created) : null;
      const dup = db.prepare(`SELECT id FROM expenses WHERE org_id = ? AND period_month = ? AND category = ? AND amount = ?
                              AND IFNULL(project_id,0) = IFNULL(?,0) AND IFNULL(department_id,0) = IFNULL(?,0)`)
        .get(ctx.orgId, n.period_month, n.category, n.amount, proj?.id ?? null, deptId);
      if (dup) return 'updated';
      db.prepare(`INSERT INTO expenses (org_id, project_id, department_id, category, period_month, amount, currency, description, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ctx.orgId, proj?.id ?? null, deptId, n.category, n.period_month, n.amount, n.currency ?? 'INR', n.description ?? null, ts);
      return 'created';
    }

    default:
      throw new Error(`Committing "${entityType}" is not supported.`);
  }
}

export function importSummary(orgId, importId) {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(importId, orgId);
  if (!imp) return null;
  const issues = db.prepare(`SELECT issues FROM import_rows WHERE import_id = ?`).all(importId);
  const errorRows = db.prepare(`SELECT COUNT(*) c FROM import_rows WHERE import_id = ? AND status = 'invalid'`).get(importId).c;
  return { ...imp, errorRows, notesParsed: imp.notes ? JSON.parse(imp.notes) : null };
}
