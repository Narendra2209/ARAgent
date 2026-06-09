import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { fmtMoney } from '../format.js';

const COLORS = ['#2e7d32', '#9e9d24', '#ef6c00', '#d84315', '#b71c1c'];

export default function AgingChart({ buckets, totals }) {
  const data = buckets.map((b) => ({ name: b.label, amount: totals[b.key] || 0 }));

  return (
    <div className="card">
      <h2 className="card-title">Outstanding by Aging Bucket</h2>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={(v) => fmtMoney(v).replace(/\.00$/, '')} width={90} />
          <Tooltip formatter={(v) => fmtMoney(v)} />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
