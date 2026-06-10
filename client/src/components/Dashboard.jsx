import { useMemo } from 'react';
import { fmtMoney, fmtMoney0, fmtNum } from '../format.js';
import ActivityFeed from './ActivityFeed.jsx';
import TierBadge from './TierBadge.jsx';

/** KPI strip: total receivable + each aging bucket, % of book underneath. */
function KpiStrip({ kpis, totals }) {
  const book = kpis.totalReceivables || 0;
  const pct = (v) => (book ? Math.round((v / book) * 100) : 0);

  const cards = [
    { label: 'Total Receivables', value: fmtMoney(kpis.totalReceivables), sub: '100% of book', accent: 'text-stone-900' },
    { label: 'Current', value: fmtMoney(totals.current), sub: `${pct(totals.current)}% of book`, accent: 'text-emerald-700' },
    { label: '1–30 Days', value: fmtMoney(totals.b1_30), sub: `${pct(totals.b1_30)}% of book`, accent: 'text-amber-700' },
    { label: '31–60 Days', value: fmtMoney(totals.b31_60), sub: `${pct(totals.b31_60)}% of book`, accent: 'text-amber-700' },
    { label: '61–90 Days', value: fmtMoney(totals.b61_90), sub: `${pct(totals.b61_90)}% of book`, accent: 'text-orange-700' },
    { label: '90+ Days', value: fmtMoney(totals.b90plus), sub: `${pct(totals.b90plus)}% of book`, accent: 'text-red-700' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-stone-200 rounded-lg p-4">
          <div className="text-xs text-stone-500 uppercase tracking-wide">{c.label}</div>
          <div className={`text-2xl font-semibold mt-1 num ${c.accent}`}>{c.value}</div>
          <div className="text-xs text-stone-500 mt-1 num">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Map oldest-days to a coloured risk badge. */
function riskBadge(days) {
  if (days >= 90) return { text: `${days}d`, cls: 'text-red-700', dot: 'bg-red-500', tag: '90+ days' };
  if (days >= 60) return { text: `${days}d`, cls: 'text-orange-700', dot: 'bg-orange-500', tag: '61–90 days' };
  if (days >= 30) return { text: `${days}d`, cls: 'text-amber-700', dot: 'bg-amber-500', tag: '31–60 days' };
  if (days >= 1) return { text: `${days}d`, cls: 'text-emerald-700', dot: 'bg-emerald-500', tag: '1–30 days' };
  return { text: 'Current', cls: 'text-stone-500', dot: 'bg-stone-400', tag: 'Current' };
}

export default function Dashboard({ data, onGoToReminders, onOpenCustomer }) {
  const { kpis, totals, customers } = data;

  // Priority queue: highest-balance customers that carry overdue, top 10.
  const queue = useMemo(() => {
    return customers
      .map((c) => ({ ...c, overdue: (c.total || 0) - (c.current || 0) }))
      .filter((c) => c.overdue > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [customers]);

  return (
    <>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Receivables overview</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {fmtNum(kpis.customerCount)} customers · {fmtMoney(kpis.totalOverdue)} overdue ·
            oldest balance {fmtNum(kpis.oldestBalanceDays)} days
          </p>
        </div>
        <div className="text-xs text-stone-500">As of {data.asOfDate}</div>
      </div>

      <KpiStrip kpis={kpis} totals={totals} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Priority queue */}
        <div className="xl:col-span-2 bg-white border border-stone-200 rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
            <div>
              <h2 className="font-semibold text-sm">Priority queue</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Largest balances carrying overdue amounts
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Customer</th>
                  <th className="text-left font-medium px-2 py-2">Tier</th>
                  <th className="text-right font-medium px-2 py-2">Outstanding</th>
                  <th className="text-right font-medium px-2 py-2">Overdue</th>
                  <th className="text-right font-medium px-2 py-2">Oldest</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {queue.map((c) => {
                  const risk = riskBadge(c.oldestDays || 0);
                  return (
                    <tr
                      key={c.customerId}
                      className="hover:bg-stone-50 cursor-pointer"
                      onClick={() => onOpenCustomer?.(c.customerId)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.customerName}</div>
                        <div className="text-xs text-stone-500 mono">{c.customerId}</div>
                      </td>
                      <td className="px-2"><TierBadge tier={c.tier} /></td>
                      <td className="px-2 text-right num font-medium">{fmtMoney(c.total)}</td>
                      <td className="px-2 text-right num">{fmtMoney(c.overdue)}</td>
                      <td className={`px-2 text-right num ${risk.cls}`}>{risk.text}</td>
                      <td className="px-4">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                          <span className="text-xs">{risk.tag}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                      No customers are currently overdue. 🎉
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity feed (real email log) */}
        <ActivityFeed onViewAll={onGoToReminders} />
      </div>
    </>
  );
}
