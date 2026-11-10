import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok } from '../lib/http.js';
import { REPORTS, generateReport, listReportHistory } from '../services/reports.js';
import { resolvePeriod } from '../lib/capacity.js';
import { config } from '../config.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

router.get('/', requirePermission('report.view'), ah(async (req, res) => {
  const catalogue = Object.entries(REPORTS).map(([code, r]) => ({
    code, name: r.name, description: r.description,
    available: req.user.permissions.has(r.permission) || req.user.isPlatformAdmin,
    required_permission: r.permission,
    columns: r.columns,
  }));
  return ok(res, catalogue);
}));

router.post('/generate', requirePermission('report.view'), ah(async (req, res) => {
  const { code, format = 'csv' } = req.body || {};
  if (!['csv', 'xlsx'].includes(format)) throw new ApiError(400, 'VALIDATION_FAILED', 'format must be csv or xlsx.');
  const period = resolvePeriod(req.body?.period || { month: new Date().toISOString().slice(0, 7) });
  const result = generateReport(req.user, { code, period, format, filters: req.body?.filters || {} });
  audit(req, { action: 'report.generated', entityType: 'report', entityId: code, summary: `Generated ${code} report (${result.rowCount} rows, ${format})`, meta: { period, format } });
  return ok(res, {
    filename: result.filename, rowCount: result.rowCount, format, meta: result.meta,
    downloadUrl: `/api/reports/download/${encodeURIComponent(result.filename)}`,
    preview: result.rows.slice(0, 50), headers: result.headers,
  });
}));

router.get('/download/:filename', requirePermission('report.view'), ah(async (req, res) => {
  const filename = path.basename(String(req.params.filename));
  if (!/^[\w.-]+$/.test(filename)) throw new ApiError(400, 'INVALID_FILENAME', 'Invalid file name.');
  const db = getDb();
  const run = db.prepare('SELECT * FROM report_runs WHERE org_id = ? AND file_path LIKE ?').get(req.orgId, `%${filename}`);
  if (!run) throw new ApiError(404, 'NOT_FOUND', 'Report file not found for your organization.');
  const full = path.join(config.exportsDir, filename);
  if (!fs.existsSync(full)) throw new ApiError(410, 'FILE_EXPIRED', 'This report file is no longer available. Generate it again.');
  audit(req, { action: 'report.downloaded', entityType: 'report', entityId: run.report_code, summary: `Downloaded report ${filename}` });
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', filename.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv; charset=utf-8');
  return res.sendFile(path.resolve(full));
}));

router.get('/history', requirePermission('report.view'), ah(async (req, res) => ok(res, listReportHistory(req.orgId))));

export default router;
