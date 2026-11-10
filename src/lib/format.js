export const fmtNumber = (n, dp = 0) =>
  n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: 0 });

export const fmtHours = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `${fmtNumber(n, 1)} h`);

export const fmtPct = (n, dp = 1) => (n == null || Number.isNaN(Number(n)) ? '—' : `${fmtNumber(n, dp)}%`);

export function fmtMoney(n, currency = 'INR', opts = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const abs = Math.abs(n);
  const symbol = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[currency] || `${currency} `;
  if (opts.compact !== false) {
    if (abs >= 1_00_00_000) return `${symbol}${(n / 1_00_00_000).toFixed(2)} Cr`;
    if (abs >= 1_00_000) return `${symbol}${(n / 1_00_000).toFixed(2)} L`;
  }
  return `${symbol}${Math.round(n).toLocaleString('en-IN')}`;
}

export const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const fmtMonth = (m) => {
  if (!m) return '—';
  const [y, mo] = String(m).split('-');
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const titleCase = (s) =>
  String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const relativeTime = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return fmtDate(iso);
};

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function monthOptions(count = 18) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: fmtMonth(value) });
  }
  return out;
}

export function quarterOptions(count = 6) {
  const out = [];
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count; i++) {
    out.push({ value: `${y}-Q${q}`, label: `Q${q} ${y}`, year: y, quarter: q });
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

export const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
