/**
 * Forecasting — deliberately conservative.
 *
 * We use ordinary least squares on monthly history plus a seasonal-free trend,
 * and we REFUSE to produce a forecast without enough history. Results always carry
 * the method, the number of months, R², and explicit limitations. Predictions are
 * stored separately from actuals and always labelled as forecasts.
 */
import { getDb, now } from '../db/index.js';
import { recentMonths, utilizationTrend, financialAnalysis } from './analytics.js';
import { resolvePeriod, round } from '../lib/capacity.js';
import { maySeeCost } from './scope.js';

const MIN_MONTHS = 4;

export function linearRegression(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const preds = xs.map((x) => slope * x + intercept);
  const ssRes = ys.reduce((s, y, i) => s + (y - preds[i]) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residStd = Math.sqrt(ssRes / Math.max(n - 2, 1));
  return { slope, intercept, r2: round(r2, 3), residStd, predict: (x) => slope * x + intercept };
}

export function nextMonths(count, afterMonth) {
  const [y, m] = afterMonth.split('-').map(Number);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function generateForecast(principal, { kind = 'utilization', horizonMonths = 3, filters = {} }) {
  const db = getDb();
  const orgId = principal.orgId;
  const horizon = Math.min(Math.max(Number(horizonMonths) || 3, 1), 12);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const months = recentMonths(12, currentMonth);
  const trend = utilizationTrend(principal, { months, filters });
  const actuals = trend.filter((t) => t.headcount > 0);

  const limitations = [];
  const series = [];
  let method = 'ordinary_least_squares_trend';
  let quality = { months_of_history: actuals.length };

  if (kind === 'utilization' || kind === 'demand' || kind === 'capacity') {
    const usable = actuals.filter((a) => a.utilization_pct != null);
    if (usable.length < MIN_MONTHS) {
      return refuse({
        kind, reason: `Only ${usable.length} month(s) of complete utilization history are available. At least ${MIN_MONTHS} are required before a forecast is meaningful.`,
        required: `${MIN_MONTHS} months of timesheet and allocation data`,
        have: `${usable.length} months`,
        actuals: trend,
      });
    }
    const reg = linearRegression(usable.map((u) => u.utilization_pct));
    quality = { ...quality, r2: reg.r2, method_note: 'Linear trend on monthly utilization; no seasonality modelling.' };
    const lastMonth = usable.at(-1).month;
    const values = usable.map((u) => u.utilization_pct);
    const histMax = Math.max(...values);
    const histMin = Math.min(...values);
    // Guardrail: a short history must not extrapolate beyond a plausible band.
    const ceiling = Math.min(100, histMax + 5);
    const floor = Math.max(0, histMin - 5);
    let clamped = false;
    for (const m of nextMonths(horizon, lastMonth)) {
      const x = usable.length - 1 + (nextMonths(horizon, lastMonth).indexOf(m) + 1);
      const raw = reg.predict(x);
      const point = Math.min(Math.max(raw, floor), ceiling);
      if (Math.abs(raw - point) > 0.5) clamped = true;
      const band = Math.max(reg.residStd * 1.96, 3);
      series.push({
        month: m, forecast_utilization_pct: round(point),
        lower_pct: round(Math.max(point - band, 0)),
        upper_pct: round(Math.min(point + band, 100)),
        is_forecast: true,
      });
    }
    if (clamped) {
      limitations.push(`The fitted trend ran outside the observed range (${histMin}%–${histMax}%) and was capped at ${floor}%–${ceiling}% to avoid an implausible forecast.`);
    }
    limitations.push('Forecast assumes the recent trend continues; utilisation is capped between 0% and 100%.');
    limitations.push('Confidence band is ±1.96 × residual standard deviation of the fitted trend, not a model of project demand.');
    if (usable.some((u) => u.timesheet_coverage_pct < 90)) {
      limitations.push('Some historical months had incomplete timesheet coverage, which adds uncertainty.');
    }
    if (reg.r2 < 0.3) limitations.push(`The trend explains only ${(reg.r2 * 100).toFixed(0)}% of historical variation (R²=${reg.r2}); treat the direction, not the exact number, as the signal.`);
  } else if (kind === 'cost') {
    if (!maySeeCost(principal)) return refuse({ kind, reason: 'You do not have permission to view cost data.', required: 'View workforce cost permission', have: 'no access' });
    const costSeries = [];
    for (const m of months) {
      const fin = financialAnalysis(principal, { period: resolvePeriod({ month: m }), filters });
      if (fin.availability.employee_cost && fin.totals.workforce_cost > 0) {
        costSeries.push({ month: m, workforce_cost: fin.totals.workforce_cost });
      }
    }
    if (costSeries.length < MIN_MONTHS) {
      return refuse({ kind, reason: `Only ${costSeries.length} month(s) of cost data are available; ${MIN_MONTHS} are required.`, required: `${MIN_MONTHS} months of cost data`, have: `${costSeries.length} months` });
    }
    const reg = linearRegression(costSeries.map((c) => c.workforce_cost));
    quality = { ...quality, r2: reg.r2, months_of_cost_history: costSeries.length, method_note: 'Linear trend on monthly workforce cost.' };
    const lastMonth = costSeries.at(-1).month;
    const future = nextMonths(horizon, lastMonth);
    future.forEach((m, idx) => {
      const point = reg.predict(costSeries.length - 1 + idx + 1);
      const band = Math.max(reg.residStd * 1.96, point * 0.05);
      series.push({ month: m, forecast_cost: round(point), lower: round(point - band), upper: round(point + band), is_forecast: true });
    });
    limitations.push('Cost forecast uses the trend in recorded workforce cost only; it does not model headcount plans, increments or currency movements.');
  } else {
    return refuse({ kind, reason: `Forecast type "${kind}" is not available.`, required: 'utilization, demand, capacity or cost', have: kind });
  }

  const info = db.prepare(`INSERT INTO forecasts (org_id, kind, method, horizon_months, params, results, limitations, quality, generated_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(orgId, kind, method, horizon, JSON.stringify({ filters }), JSON.stringify({ series }),
      JSON.stringify(limitations), JSON.stringify(quality), principal.user.id, now());

  return {
    id: info.lastInsertRowid, kind, method, horizon_months: horizon,
    series, quality, limitations,
    actuals: trend.map((t) => ({ month: t.month, utilization_pct: t.utilization_pct, allocation_pct: t.allocation_pct, headcount: t.headcount, is_forecast: false })),
    generated_at: now(),
    is_forecast: true,
    note: 'Forecasts are estimates, not commitments. They are shown separately from actual results.',
  };
}

function refuse({ kind, reason, required, have, actuals = [] }) {
  return { refused: true, kind, reason, missing: { required, have }, actuals, series: [], limitations: [reason] };
}

export function listForecasts(principal) {
  return getDb().prepare('SELECT * FROM forecasts WHERE org_id = ? ORDER BY created_at DESC LIMIT 20').all(principal.orgId)
    .map((f) => ({ ...f, results: JSON.parse(f.results), limitations: JSON.parse(f.limitations), quality: JSON.parse(f.quality), params: JSON.parse(f.params) }));
}
