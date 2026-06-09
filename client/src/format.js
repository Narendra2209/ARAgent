const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currency0 = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export const fmtMoney = (n) => currency.format(Number(n) || 0);
/** Whole-dollar money for big KPI numbers (no cents). */
export const fmtMoney0 = (n) => currency0.format(Number(n) || 0);
export const fmtNum = (n) => new Intl.NumberFormat('en-AU').format(Number(n) || 0);

/** "3h ago", "2 days ago", "just now" — for the activity feed. */
export function fmtRelative(dateLike) {
  if (!dateLike) return '';
  const then = new Date(dateLike).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Short clock time, e.g. "9:42 AM". */
export function fmtTime(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}
