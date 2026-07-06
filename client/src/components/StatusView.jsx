import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchArAgingHistory } from '../api.js';
import { fmtMoney, fmtMoney0 } from '../format.js';
import Loader from './Loader.jsx';

// The six trends to plot, in the same order as the dashboard KPI cards.
// `pick` reads the value out of one snapshot; each gets its own colour.
const METRICS = [
  { key: 'total', label: 'Total Receivables', color: '#0f766e', pick: (s) => s.totalReceivables },
  { key: 'current', label: 'Current', color: '#2e7d32', pick: (s) => s.totals?.current },
  { key: 'b1_30', label: '1–30 Days', color: '#9e9d24', pick: (s) => s.totals?.b1_30 },
  { key: 'b31_60', label: '31–60 Days', color: '#ef6c00', pick: (s) => s.totals?.b31_60 },
  { key: 'b61_90', label: '61–90 Days', color: '#d84315', pick: (s) => s.totals?.b61_90 },
  { key: 'b90plus', label: '90+ Days', color: '#b71c1c', pick: (s) => s.totals?.b90plus },
];

// "2026-07-07" -> "7 Jul" for a compact axis label.
const shortDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return iso;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${mon[(m || 1) - 1]}`;
};

export default function StatusView() {
  const [snapshots, setSnapshots] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchArAgingHistory()
      .then((res) => {
        if (!alive) return;
        // API returns newest-first; a time series reads oldest → newest.
        setSnapshots([...(res.snapshots || [])].reverse());
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // One row per date holding every metric, so each chart shares the same x-axis.
  const rows = useMemo(
    () =>
      (snapshots || []).map((s) => {
        const row = { date: s.asOfDate, label: shortDate(s.asOfDate) };
        for (const m of METRICS) row[m.key] = Number(m.pick(s)) || 0;
        return row;
      }),
    [snapshots]
  );

  if (loading) return <Loader message="Loading receivables history…" />;

  if (error) {
    return (
      <div className="mb-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
        <strong>Couldn’t load the history.</strong> {error}
        <div className="mt-1 text-xs text-red-700">
          The trend charts read stored daily snapshots, which need the database connected.
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-3xl mb-2">📈</div>
        <h2 className="card-title justify-center">No history yet</h2>
        <p className="text-sm text-stone-500 mt-1 max-w-md mx-auto">
          A snapshot of these six figures is saved automatically each time the dashboard
          loads or syncs from MYOB. Come back after a day or two of use and the trends will
          build up here — one line per bucket, dropping as customers pay.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Receivables trend</h1>
          <p className="text-sm text-stone-500">
            Each figure saved by date. A line falling means money was collected; rising means
            new or ageing balances.
          </p>
        </div>
        <span className="text-xs text-stone-400 mono">
          {rows.length} day{rows.length === 1 ? '' : 's'} · {rows[0].date} → {rows[rows.length - 1].date}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {METRICS.map((m) => (
          <TrendCard key={m.key} metric={m} rows={rows} />
        ))}
      </div>
    </div>
  );
}

function TrendCard({ metric, rows }) {
  const latest = rows[rows.length - 1][metric.key];
  const prev = rows.length > 1 ? rows[rows.length - 2][metric.key] : null;
  const delta = prev == null ? null : latest - prev;

  // For receivables, a DROP is good (collections) → green; a rise → red.
  let deltaEl = null;
  if (delta != null && Math.abs(delta) >= 0.005) {
    const good = delta < 0;
    deltaEl = (
      <span
        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
          good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}
        title="Change since the previous snapshot"
      >
        {good ? '▼' : '▲'} {fmtMoney0(Math.abs(delta))}
      </span>
    );
  } else if (delta != null) {
    deltaEl = <span className="text-xs text-stone-400 px-1.5 py-0.5">no change</span>;
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: metric.color }} />
          <h2 className="card-title mb-0">{metric.label}</h2>
        </div>
        {deltaEl}
      </div>
      <div className="text-2xl font-semibold text-stone-900 mb-3">{fmtMoney0(latest)}</div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={rows} margin={{ top: 5, right: 12, left: 6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
          <YAxis
            width={64}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => fmtMoney0(v).replace(/A?\$/, '$')}
          />
          <Tooltip
            formatter={(v) => fmtMoney(v)}
            labelFormatter={(l, p) => p?.[0]?.payload?.date || l}
          />
          <Line
            type="monotone"
            dataKey={metric.key}
            stroke={metric.color}
            strokeWidth={2}
            dot={rows.length <= 30 ? { r: 2.5 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
