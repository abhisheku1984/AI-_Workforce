import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { config } from '../config.js';

export function fileChecksum(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Safe file validation performed BEFORE any parsing.
 * Extension, size and (for XLSX) magic-byte signature are checked.
 */
export function validateFile({ originalname, size, path: p }) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!config.allowedUploadTypes.includes(ext)) {
    return { ok: false, code: 'UNSUPPORTED_FILE_TYPE', message: `Only ${config.allowedUploadTypes.join(', ')} files are supported.` };
  }
  if (!size || size === 0) return { ok: false, code: 'EMPTY_FILE', message: 'The file is empty.' };
  if (size > config.maxUploadBytes) {
    return {
      ok: false, code: 'FILE_TOO_LARGE',
      message: `File is ${(size / 1024 / 1024).toFixed(1)} MB. The maximum allowed is ${(config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB.`,
    };
  }
  const fd = fs.openSync(p, 'r');
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  if (ext === '.xlsx' && !(head[0] === 0x50 && head[1] === 0x4b)) {
    return { ok: false, code: 'INVALID_FILE_CONTENT', message: 'This file is not a valid .xlsx workbook.' };
  }
  if (!/^[\w .,()\-&]+\.(csv|xlsx|xls)$/i.test(path.basename(originalname))) {
    return { ok: false, code: 'INVALID_FILENAME', message: 'The file name contains unsupported characters.' };
  }
  return { ok: true, ext };
}

/** Parse CSV/XLSX into {headers, rows}. Cell values are kept as raw strings/numbers. */
export function parseTabular(filePath, ext) {
  if (ext === '.csv') {
    const buf = fs.readFileSync(filePath);
    if (buf.includes(0)) {
      const err = new Error('The CSV file contains binary data and cannot be read as text.');
      err.status = 400; err.code = 'INVALID_CSV';
      throw err;
    }
    const wb = XLSX.read(buf.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    return matrixToTable(matrix);
  }
  const wb = XLSX.readFile(filePath, { cellDates: false });
  if (!wb.SheetNames.length) {
    const err = new Error('The workbook contains no sheets.');
    err.status = 400; err.code = 'EMPTY_WORKBOOK';
    throw err;
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  return matrixToTable(matrix);
}

function matrixToTable(matrix) {
  const nonEmpty = matrix.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!nonEmpty.length) {
    const err = new Error('No data rows found in the file.');
    err.status = 400; err.code = 'NO_ROWS';
    throw err;
  }
  const headerRow = nonEmpty[0].map((h, i) => {
    const name = String(h ?? '').trim();
    return name || `Column ${i + 1}`;
  });
  // De-duplicate header names deterministically.
  const seen = new Map();
  const headers = headerRow.map((h) => {
    const count = seen.get(h) || 0;
    seen.set(h, count + 1);
    return count ? `${h} (${count + 1})` : h;
  });
  const rows = nonEmpty.slice(1).map((r, i) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return { rowNumber: i + 2, values: obj }; // 1-based incl. header row
  });
  return { headers, rows };
}

/** Protect against CSV formula injection on export. */
export function safeCell(v) {
  const s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

export function toXlsxBuffer(headers, rows, sheetName = 'Report') {
  return toXlsxMultiSheet([{ name: sheetName, headers, rows }]);
}

/** Build a multi-sheet workbook buffer. sheets: [{name, headers, rows}] */
export function toXlsxMultiSheet(sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const data = [s.headers, ...s.rows.map((r) => s.headers.map((h) => r[h] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, String(s.name).slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
