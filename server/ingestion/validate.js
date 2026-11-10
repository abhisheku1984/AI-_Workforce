/**
 * Row-level validation and normalisation.
 *
 * Principles:
 *  - Safe formatting fixes are applied automatically and RECORDED as a warning
 *    (whitespace, number formatting with commas, date format normalisation,
 *    currency symbols, case of enum values, Y/N flags).
 *  - Questionable values are NEVER invented: they are flagged as errors for the
 *    user to correct or explicitly approve.
 *  - Every row keeps its raw source values for lineage.
 */
import { getSchema, FIELD_TYPES } from './schemas.js';

const TRUE_WORDS = new Set(['y', 'yes', 'true', '1', 't', 'billable']);
const FALSE_WORDS = new Set(['n', 'no', 'false', '0', 'f', 'non-billable', 'non billable']);

export function parseNumber(v) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { value: null, issue: 'not_a_number' };
  let s = String(v).trim();
  if (!s) return { value: null };
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/[₹$€£,]/g, '').replace(/\s/g, '');
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  if (!/^-?\d*\.?\d+$/.test(s)) return { value: null, issue: 'not_a_number' };
  let n = Number(s);
  if (negative) n = -n;
  return { value: n, issue: undefined, fixed: pct };
}

const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, map: (m) => [m[1], m[2], m[3]] },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, map: (m) => [m[1], pad(m[2]), pad(m[3])] },
  { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, map: (m) => [m[3], pad(m[2]), pad(m[1])] }, // dd/mm/yyyy
  { re: /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/, map: (m) => [m[3], MONTHS[m[2].toLowerCase()], pad(m[1])] },
  { re: /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/, map: (m) => [m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], pad(m[1])] },
  { re: /^(\d{4})(\d{2})(\d{2})$/, map: (m) => [m[1], m[2], m[3]] },
];
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const pad = (s) => String(s).padStart(2, '0');

export function parseDate(v) {
  if (v === null || v === undefined || v === '') return { value: null };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { value: v.toISOString().slice(0, 10), fixed: 'excel_datetime' };
  }
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return { value: d.toISOString().slice(0, 10), fixed: 'excel_serial' };
  }
  const s = String(v).trim();
  if (!s) return { value: null };
  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const [y, mo, d] = p.map(m);
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== Number(mo) - 1) {
      return { value: null, issue: 'invalid_date' };
    }
    const out = `${y}-${mo}-${d}`;
    return { value: out, fixed: out === s ? undefined : 'date_format' };
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return { value: parsed.toISOString().slice(0, 10), fixed: 'date_format' };
  return { value: null, issue: 'invalid_date' };
}

export function parseMonth(v) {
  const s = String(v ?? '').trim();
  if (!s) return { value: null };
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return { value: `${m[1]}-${pad(m[2])}` };
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return { value: `${m[2]}-${pad(m[1])}` };
  m = /^([A-Za-z]{3,9})[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { value: `${m[2]}-${mo}`, fixed: 'month_format' };
  }
  const d = parseDate(s);
  if (d.value) return { value: d.value.slice(0, 7), fixed: 'month_format' };
  return { value: null, issue: 'invalid_month' };
}

function coerce(field, raw) {
  const issues = [];
  const fixes = [];
  const empty = raw === null || raw === undefined || String(raw).trim() === '';

  if (empty) {
    if (field.defaultValue !== undefined) {
      fixes.push({ code: 'DEFAULT_APPLIED', field: field.key, message: `No value supplied; default "${field.defaultValue}" applied (${field.label}).` });
      return { value: field.defaultValue, issues, fixes };
    }
    return { value: null, issues, fixes, empty: true };
  }

  switch (field.type) {
    case 'number':
    case 'currency': {
      const n = parseNumber(raw);
      if (n.issue) { issues.push({ code: 'NOT_A_NUMBER', field: field.key, message: `"${raw}" is not a valid number.`, severity: 'error' }); return { value: null, issues, fixes }; }
      if (typeof raw === 'string' && /[₹$€£,]/.test(raw)) fixes.push({ code: 'NUMBER_FORMAT', field: field.key, message: `Formatted number "${raw}" stored as ${n.value}.` });
      if (n.value < 0) issues.push({ code: 'NEGATIVE_VALUE', field: field.key, message: `${field.label} is negative (${n.value}). Please confirm.`, severity: 'warning' });
      return { value: n.value, issues, fixes };
    }
    case 'integer': {
      const n = parseNumber(raw);
      if (n.issue) { issues.push({ code: 'NOT_A_NUMBER', field: field.key, message: `"${raw}" is not a whole number.`, severity: 'error' }); return { value: null, issues, fixes }; }
      const v = Math.round(n.value);
      if (v !== n.value) fixes.push({ code: 'ROUNDED', field: field.key, message: `"${raw}" rounded to ${v} for ${field.label}.` });
      return { value: v, issues, fixes };
    }
    case 'percent': {
      const n = parseNumber(raw);
      if (n.issue) { issues.push({ code: 'NOT_A_NUMBER', field: field.key, message: `"${raw}" is not a valid percentage.`, severity: 'error' }); return { value: null, issues, fixes }; }
      let v = n.value;
      if (String(raw).includes('%')) v = v;
      else if (v > 0 && v <= 1) { v = v * 100; fixes.push({ code: 'PERCENT_SCALED', field: field.key, message: `Decimal "${raw}" interpreted as ${v}%.` }); }
      return { value: v, issues, fixes };
    }
    case 'date': {
      const d = parseDate(raw);
      if (d.issue) { issues.push({ code: 'INVALID_DATE', field: field.key, message: `"${raw}" is not a recognisable date for ${field.label}.`, severity: 'error' }); return { value: null, issues, fixes }; }
      if (d.fixed) fixes.push({ code: 'DATE_FORMAT', field: field.key, message: `Date "${raw}" normalised to ${d.value}.` });
      return { value: d.value, issues, fixes };
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) {
        issues.push({ code: 'INVALID_EMAIL', field: field.key, message: `"${raw}" is not a valid email address.`, severity: 'warning' });
        return { value: null, issues, fixes };
      }
      if (s !== String(raw)) fixes.push({ code: 'EMAIL_NORMALISED', field: field.key, message: `Email "${raw}" normalised to ${s}.` });
      return { value: s, issues, fixes };
    }
    case 'enum': {
      const s = String(raw).trim();
      const lower = s.toLowerCase();
      const aliasHit = field.enumAliases?.[lower];
      const direct = field.enumValues.includes(lower);
      const value = aliasHit || (direct ? lower : null);
      if (!value) {
        issues.push({
          code: 'INVALID_ENUM', field: field.key, severity: 'error',
          message: `"${raw}" is not a recognised ${field.label.toLowerCase()}. Allowed: ${field.enumValues.join(', ')}.`,
        });
        return { value: null, issues, fixes };
      }
      if (value !== s) fixes.push({ code: 'ENUM_NORMALISED', field: field.key, message: `${field.label} "${raw}" normalised to "${value}".` });
      return { value, issues, fixes };
    }
    default: {
      const s = String(raw).trim().replace(/\s+/g, ' ');
      if (s !== String(raw)) fixes.push({ code: 'WHITESPACE', field: field.key, message: `Whitespace trimmed for ${field.label}.` });
      if (s.length > 500) issues.push({ code: 'TOO_LONG', field: field.key, message: `${field.label} exceeds 500 characters and was truncated.`, severity: 'warning' });
      return { value: s.slice(0, 500), issues, fixes };
    }
  }
}

/**
 * Validate a single row against an entity schema.
 * Returns {status, normalized, issues[]} where issues carry severity
 * error | warning. Status is 'invalid' if any error, 'warning' if any warning.
 */
export function validateRow(entityType, rawValues, mapping) {
  const schema = getSchema(entityType);
  const normalized = {};
  const issues = [];
  const fixes = [];

  for (const field of schema.fields) {
    const sourceCol = Object.keys(mapping).find((col) => mapping[col] === field.key);
    const raw = sourceCol ? rawValues[sourceCol] : undefined;
    const res = coerce(field, raw);
    issues.push(...res.issues);
    fixes.push(...res.fixes);
    if (res.value !== null && res.value !== undefined && res.value !== '') normalized[field.key] = res.value;
  }

  for (const field of schema.fields) {
    if (field.required && (normalized[field.key] === undefined || normalized[field.key] === null)) {
      if (!issues.some((i) => i.field === field.key && i.severity === 'error')) {
        issues.push({ code: 'REQUIRED_MISSING', field: field.key, message: `${field.label} is required but is missing.`, severity: 'error' });
      }
    }
  }

  // Business-rule checks per entity.
  issues.push(...businessRules(entityType, normalized));

  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  const status = hasError ? 'invalid' : hasWarning ? 'warning' : 'valid';
  return { status, normalized, issues, fixes };
}

function businessRules(entityType, n) {
  const issues = [];
  if (entityType === 'allocations') {
    if (n.start_date && n.end_date && n.start_date > n.end_date) {
      issues.push({ code: 'DATE_ORDER', field: 'end_date', message: `Allocation end date (${n.end_date}) is before start date (${n.start_date}).`, severity: 'error' });
    }
    if (n.hours_per_week != null && (n.hours_per_week < 0 || n.hours_per_week > 80)) {
      issues.push({ code: 'HOURS_RANGE', field: 'hours_per_week', message: `Weekly hours ${n.hours_per_week} is outside the expected 0–80 range.`, severity: 'warning' });
    }
    if (n.hours_per_week != null && n.hours_per_week > 60) {
      issues.push({ code: 'OVER_ALLOCATION_RISK', field: 'hours_per_week', message: `${n.hours_per_week} hours/week is above a standard working week and will show as over-allocated.`, severity: 'warning' });
    }
  }
  if (entityType === 'demand') {
    if (n.start_date && n.end_date && n.start_date > n.end_date) {
      issues.push({ code: 'DATE_ORDER', field: 'end_date', message: 'Demand end date is before the start date.', severity: 'error' });
    }
    if (n.headcount != null && n.headcount <= 0) {
      issues.push({ code: 'HEADCOUNT_RANGE', field: 'headcount', message: 'Headcount must be greater than zero.', severity: 'error' });
    }
  }
  if (entityType === 'projects') {
    if (n.start_date && n.end_date && n.start_date > n.end_date) {
      issues.push({ code: 'DATE_ORDER', field: 'end_date', message: 'Project end date is before the start date.', severity: 'error' });
    }
    if (n.budget_amount != null && n.budget_amount < 0) {
      issues.push({ code: 'NEGATIVE_BUDGET', field: 'budget_amount', message: 'Project budget cannot be negative.', severity: 'error' });
    }
  }
  if (entityType === 'employees') {
    if (n.join_date && n.exit_date && n.join_date > n.exit_date) {
      issues.push({ code: 'DATE_ORDER', field: 'exit_date', message: 'Exit date is before the join date.', severity: 'error' });
    }
    if (n.status === 'exited' && !n.exit_date) {
      issues.push({ code: 'EXIT_DATE_MISSING', field: 'exit_date', message: 'Employee status is "exited" but no exit date is supplied. Capacity calculations need an exit date.', severity: 'warning' });
    }
    if (n.fte != null && (n.fte <= 0 || n.fte > 2)) {
      issues.push({ code: 'FTE_RANGE', field: 'fte', message: `FTE ${n.fte} is outside the expected 0–2 range.`, severity: 'warning' });
    }
    if (n.annual_cost != null && n.annual_cost > 100000000) {
      issues.push({ code: 'COST_IMPLAUSIBLE', field: 'annual_cost', message: `Annual cost ${n.annual_cost} looks unusually high. Please confirm the currency and value.`, severity: 'warning' });
    }
  }
  if (entityType === 'timesheets') {
    if (n.hours != null && n.hours > 24) {
      issues.push({ code: 'HOURS_RANGE', field: 'hours', message: `A single day cannot exceed 24 hours (got ${n.hours}).`, severity: 'error' });
    }
    if (n.hours != null && n.hours > 12) {
      issues.push({ code: 'HOURS_IMPLAUSIBLE', field: 'hours', message: `${n.hours} hours in one day is unusually high. Please confirm.`, severity: 'warning' });
    }
  }
  if (entityType === 'invoices') {
    if (n.period_month == null) {
      issues.push({ code: 'REQUIRED_MISSING', field: 'period_month', message: 'Invoice period (month) is required.', severity: 'error' });
    }
    if (n.amount != null && n.amount <= 0) {
      issues.push({ code: 'AMOUNT_RANGE', field: 'amount', message: 'Invoice amount should be greater than zero.', severity: 'warning' });
    }
  }
  return issues;
}

export function naturalKeyOf(entityType, normalized) {
  const schema = getSchema(entityType);
  return schema.naturalKey.map((k) => String(normalized[k] ?? '').trim().toLowerCase()).join('|');
}

export { FIELD_TYPES };
