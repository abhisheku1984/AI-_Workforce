import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, now } from '../db/index.js';
import { config } from '../config.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok } from '../lib/http.js';
import { ENTITY_SCHEMAS, getSchema, suggestMapping } from '../ingestion/schemas.js';
import { validateFile, parseTabular, fileChecksum, toCsv } from '../ingestion/parse.js';
import { stageImport, mapImport, validateImport, commitImport } from '../ingestion/pipeline.js';
import { generateInsights } from '../ai/insights.js';
import { resolvePeriod } from '../lib/capacity.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

const upload = multer({
  dest: path.join(config.uploadsDir, 'tmp'),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!config.allowedUploadTypes.includes(ext)) {
      return cb(Object.assign(new Error(`Unsupported file type. Allowed: ${config.allowedUploadTypes.join(', ')}`), { status: 400 }));
    }
    return cb(null, true);
  },
});

router.get('/schemas', requirePermission('import.manage'), ah(async (_req, res) => ok(res, {
  entities: Object.entries(ENTITY_SCHEMAS).map(([key, s]) => ({
    key, label: s.label, description: s.description, naturalKey: s.naturalKey,
    fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: Boolean(f.required), aliases: f.aliases || [], example: f.example, enumValues: f.enumValues, sensitive: Boolean(f.sensitive), multi: f.multi || null })),
  })),
  limits: { max_mb: config.maxUploadBytes / 1024 / 1024, types: config.allowedUploadTypes },
})));

router.get('/template/:entity', requirePermission('import.manage'), ah(async (req, res) => {
  const schema = getSchema(req.params.entity);
  const headers = schema.fields.map((f) => f.label);
  const sample = {};
  schema.fields.forEach((f) => { sample[f.label] = f.example ?? ''; });
  const csv = `# WorkforceIQ import template — ${schema.label}\n# Delete these comment lines and the example row before uploading your own data.\n` + toCsv(headers, [sample]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="workforceiq_${req.params.entity}_template.csv"`);
  return res.send(csv);
}));

router.post('/upload', requirePermission('import.manage'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'NO_FILE', 'Choose a CSV or Excel file to upload.');
  const entityType = String(req.body.entity_type || '');
  const schema = getSchema(entityType);

  const validation = validateFile({ originalname: req.file.originalname, size: req.file.size, path: req.file.path });
  if (!validation.ok) {
    fs.unlinkSync(req.file.path);
    throw new ApiError(400, validation.code, validation.message);
  }

  const { headers, rows } = parseTabularSafe(req.file.path, validation.ext);
  if (!rows.length) {
    fs.unlinkSync(req.file.path);
    throw new ApiError(400, 'NO_ROWS', 'The file contains a header row but no data rows.');
  }
  if (rows.length > 20000) {
    fs.unlinkSync(req.file.path);
    throw new ApiError(400, 'TOO_MANY_ROWS', 'Files above 20,000 rows must be split. This keeps validation fast and errors manageable.');
  }

  const checksum = fileChecksum(req.file.path);
  // Catch re-uploads of an identical file at any stage except one that was discarded.
  const dupImport = getDb().prepare(`SELECT id, filename, created_at, status FROM imports
      WHERE org_id = ? AND checksum = ? AND status <> 'discarded' ORDER BY id DESC`)
    .get(req.orgId, checksum);
  if (dupImport && !req.body.force) {
    fs.unlinkSync(req.file.path);
    throw new ApiError(409, 'DUPLICATE_FILE',
      `This exact file was already uploaded on ${dupImport.created_at.slice(0, 10)} (import #${dupImport.id}, status ${dupImport.status}). Uploading it again would not add new information. Tick "upload anyway" if you intend to refresh it.`,
      { existingImportId: dupImport.id });
  }

  const safeName = `${crypto.randomUUID()}${validation.ext}`;
  const storedPath = path.join(config.uploadsDir, `${req.orgId}_${safeName}`);
  fs.renameSync(req.file.path, storedPath);

  const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : suggestMapping(entityType, headers);
  const { importId } = stageImport({
    orgId: req.orgId, userId: req.user.user.id, entityType, filename: path.basename(req.file.originalname),
    storedPath, format: validation.ext.replace('.', ''), size: req.file.size, checksum, headers, rows, mapping,
  });

  audit(req, {
    action: 'import.uploaded', entityType: 'import', entityId: importId,
    summary: `Uploaded ${req.file.originalname} (${rows.length} rows) for ${schema.label}`, meta: { entityType, rows: rows.length, checksum },
  });

  return ok(res, {
    importId, entityType, label: schema.label, headers, rowsTotal: rows.length,
    suggestedMapping: mapping, preview: rows.slice(0, 10),
    autoMappedCount: Object.keys(mapping).length,
    requiredFields: schema.fields.filter((f) => f.required).map((f) => ({ key: f.key, label: f.label })),
  });
}));

function parseTabularSafe(filePath, ext) {
  try {
    return parseTabular(filePath, ext);
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new ApiError(400, err.code || 'PARSE_FAILED', err.message || 'The file could not be read.');
  }
}

router.get('/', requirePermission('import.manage'), ah(async (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT i.*, u.full_name AS uploaded_by_name FROM imports i
      LEFT JOIN users u ON u.id = i.uploaded_by WHERE i.org_id = ? ORDER BY i.created_at DESC LIMIT 200`).all(req.orgId);
  return ok(res, rows.map((r) => ({ ...r, notes: r.notes ? JSON.parse(r.notes) : null })));
}));

router.get('/:id', requirePermission('import.manage'), ah(async (req, res) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!imp) throw new ApiError(404, 'NOT_FOUND', 'Import not found.');
  const schema = getSchema(imp.entity_type);
  const statusFilter = req.query.status;
  const rows = db.prepare(`SELECT * FROM import_rows WHERE import_id = ? ${statusFilter ? 'AND status = ?' : ''}
      ORDER BY row_number LIMIT 500`).all(...(statusFilter ? [imp.id, statusFilter] : [imp.id]));
  const counts = db.prepare(`SELECT status, COUNT(*) c FROM import_rows WHERE import_id = ? GROUP BY status`).all(imp.id);
  return ok(res, {
    import: { ...imp, mapping: imp.mapping ? JSON.parse(imp.mapping) : null, headers: JSON.parse(imp.headers || '[]'), notes: imp.notes ? JSON.parse(imp.notes) : null },
    schema: { key: imp.entity_type, label: schema.label, fields: schema.fields.map((f) => ({ key: f.key, label: f.label, required: Boolean(f.required), type: f.type })) },
    rows: rows.map((r) => ({ ...r, raw: JSON.parse(r.raw), normalized: r.normalized ? JSON.parse(r.normalized) : null, issues: JSON.parse(r.issues) })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.c])),
  });
}));

router.post('/:id/map', requirePermission('import.manage'), ah(async (req, res) => {
  const { mapping } = req.body || {};
  if (!mapping || typeof mapping !== 'object') throw new ApiError(400, 'VALIDATION_FAILED', 'mapping object is required.');
  const result = mapImport({ orgId: req.orgId, importId: Number(req.params.id), mapping });
  audit(req, { action: 'import.mapped', entityType: 'import', entityId: req.params.id, summary: 'Column mapping saved', meta: mapping });
  return ok(res, result);
}));

router.post('/:id/validate', requirePermission('import.manage'), ah(async (req, res) => {
  const result = validateImport({ orgId: req.orgId, importId: Number(req.params.id) });
  audit(req, { action: 'import.validated', entityType: 'import', entityId: req.params.id, summary: `Validation complete: ${result.rowsValid} valid, ${result.rowsInvalid} invalid, ${result.rowsDuplicate} duplicates`, meta: result });
  return ok(res, result);
}));

router.post('/:id/commit', requirePermission('import.manage'), ah(async (req, res) => {
  const result = commitImport({ orgId: req.orgId, importId: Number(req.params.id), userId: req.user.user.id });
  audit(req, { action: 'import.committed', entityType: 'import', entityId: req.params.id, summary: `Import committed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`, meta: { created: result.created, updated: result.updated, skipped: result.skipped } });

  // Refresh insights after a successful commit (read-only recalculation).
  let insights = null;
  try {
    const period = resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
    const r = generateInsights(req.user, { period });
    insights = { generated: r.generated };
  } catch { insights = null; }

  return ok(res, { ...result, insights });
}));

router.delete('/:id', requirePermission('import.manage'), ah(async (req, res) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!imp) throw new ApiError(404, 'NOT_FOUND', 'Import not found.');
  if (imp.status === 'committed') {
    throw new ApiError(400, 'COMMITTED_IMPORT',
      'This import has already loaded data into the platform. Deleting the file would break data lineage. Use Data → Deletion requests to remove the loaded records with an audit trail.');
  }
  try { fs.unlinkSync(imp.stored_path); } catch { /* already gone */ }
  db.prepare(`UPDATE imports SET status = 'discarded', updated_at = ? WHERE id = ?`).run(now(), imp.id);
  audit(req, { action: 'import.discarded', entityType: 'import', entityId: imp.id, summary: `Discarded staged import ${imp.filename}` });
  return ok(res, { discarded: true });
}));

/** Error report download for a staged import. */
router.get('/:id/error-report', requirePermission('import.manage'), ah(async (req, res) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!imp) throw new ApiError(404, 'NOT_FOUND', 'Import not found.');
  const rows = db.prepare(`SELECT * FROM import_rows WHERE import_id = ? AND status IN ('invalid','warning','duplicate','skipped')
      ORDER BY row_number`).all(imp.id);
  const mapping = imp.mapping ? JSON.parse(imp.mapping) : {};
  const flat = [];
  for (const r of rows) {
    for (const issue of JSON.parse(r.issues)) {
      flat.push({
        row_number: r.row_number,
        severity: issue.severity,
        code: issue.code,
        field: issue.field ?? '',
        message: issue.message,
        raw_values: JSON.stringify(JSON.parse(r.raw)),
      });
    }
  }
  const csv = toCsv(['row_number', 'severity', 'code', 'field', 'message', 'raw_values'], flat);
  audit(req, { action: 'import.error_report.downloaded', entityType: 'import', entityId: imp.id, summary: `Downloaded error report for import #${imp.id}` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import_${imp.id}_errors.csv"`);
  return res.send(csv);
}));

/** Source file download (originals are retained for lineage). */
router.get('/:id/file', requirePermission('import.manage'), ah(async (req, res) => {
  const db = getDb();
  const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!imp) throw new ApiError(404, 'NOT_FOUND', 'Import not found.');
  if (!fs.existsSync(imp.stored_path)) throw new ApiError(410, 'FILE_EXPIRED', 'The original file is no longer retained (retention policy). The imported records remain in the platform.');
  audit(req, { action: 'import.file.downloaded', entityType: 'import', entityId: imp.id, summary: `Downloaded original file for import #${imp.id}` });
  res.setHeader('Content-Disposition', `attachment; filename="${imp.filename.replace(/[^\w.\-]/g, '_')}"`);
  return res.sendFile(path.resolve(imp.stored_path));
}));

export default router;
