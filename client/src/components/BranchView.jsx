import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBranchSplit, branchExportUrl } from '../api.js';
import { fmtMoney, fmtMoney0, fmtNum } from '../format.js';

/**
 * Branch page — the operations team's branch-split workbook, rebuilt live.
 *
 * MYOB's AR feed carries no branch on any document, so which customer sits under
 * which branch comes from the workbook mapping held server-side
 * (server/src/branchMap.js). Every figure on this page is live: same columns,
 * same priority bands, same row order as the spreadsheet.
 */

const PRIORITY_STYLES = {
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
  URGENT: 'bg-orange-100 text-orange-800 border-orange-200',
  'Follow Up': 'bg-amber-100 text-amber-800 border-amber-200',
  Current: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const PRIORITY_ORDER = ['CRITICAL', 'URGENT', 'Follow Up', 'Current'];

function PriorityBadge({ priority }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${
        PRIORITY_STYLES[priority] ?? 'bg-stone-100 text-stone-700 border-stone-200'
      }`}
    >
      {priority}
    </span>
  );
}

/** Zero shows as a dash so the eye lands on the buckets that actually hold money. */
const money = (n) => (n ? fmtMoney(n) : <span className="text-stone-300">—</span>);

function SummaryCard({ label, value, hint, tone = 'default' }) {
  const toneCls =
    tone === 'danger' ? 'text-red-700' : tone === 'muted' ? 'text-stone-500' : 'text-stone-900';
  return (
    <div className="border border-stone-200 rounded-lg px-3 py-2.5 bg-white">
      <div className="text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`text-lg font-semibold num mt-0.5 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-stone-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function BranchView({ onOpenCustomer }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // selected branch name
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const load = useCallback(async ({ refresh = false } = {}) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const split = await fetchBranchSplit({ refresh });
      setData(split);
      // Keep the open tab across refreshes; fall back to the first branch.
      setActive((cur) =>
        cur && split.branches.some((b) => b.name === cur) ? cur : split.branches[0]?.name ?? null
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const branch = useMemo(
    () => data?.branches.find((b) => b.name === active) ?? null,
    [data, active]
  );

  const rows = useMemo(() => {
    if (!branch) return [];
    const q = query.trim().toLowerCase();
    return branch.customers.filter((c) => {
      if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        c.customerName.toLowerCase().includes(q) || c.customerId.toLowerCase().includes(q)
      );
    });
  }, [branch, query, priorityFilter]);

  // Totals for what's actually on screen, so a filtered view still adds up.
  const shown = useMemo(() => {
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    return {
      current: sum('current'),
      b1_30: sum('b1_30'),
      b31_60: sum('b31_60'),
      b61_90: sum('b61_90'),
      b90plus: sum('b90plus'),
      pastDue: sum('pastDue'),
      total: sum('total'),
      creditLimit: sum('creditLimit'),
    };
  }, [rows]);

  const filtered = rows.length !== (branch?.customers.length ?? 0);

  const counts = useMemo(() => {
    const out = {};
    for (const p of PRIORITY_ORDER) {
      out[p] = branch?.customers.filter((c) => c.priority === p).length ?? 0;
    }
    return out;
  }, [branch]);

  if (loading && !data) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg px-4 py-12 text-center text-stone-400">
        Loading branch split…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg px-4 py-8">
        <p className="text-sm text-red-700">{error}</p>
        <button
          className="mt-3 text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50"
          onClick={() => load()}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-stone-200 rounded-lg">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-stone-200 flex-wrap">
          <div>
            <h2 className="font-semibold text-sm">Branch split</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Live AR as at {data?.asOfDate} · {fmtNum(data?.grandTotals.customerCount ?? 0)}{' '}
              customers across {data?.branches.length ?? 0} branches
              {data?.source === 'mock' && ' · sample data'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50"
              onClick={() => load({ refresh: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh from MYOB'}
            </button>
            <a
              className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800"
              href={branchExportUrl()}
            >
              Download Excel
            </a>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
            {error}
          </div>
        )}

        {data?.unmappedCount > 0 && (
          <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
            {data.unmappedCount} customer{data.unmappedCount === 1 ? ' is' : 's are'} not in the
            branch workbook and {data.unmappedCount === 1 ? 'is' : 'are'} grouped under
            “Unassigned”. Add {data.unmappedCount === 1 ? 'it' : 'them'} to
            server/src/branchMap.js to file {data.unmappedCount === 1 ? 'it' : 'them'} correctly.
          </div>
        )}

        {/* Branch tabs, in workbook sheet order */}
        <div className="flex gap-1 px-3 pt-3 flex-wrap">
          {data?.branches.map((b) => {
            const isActive = b.name === active;
            return (
              <button
                key={b.name}
                onClick={() => setActive(b.name)}
                className={`px-3 py-2 text-sm rounded-t border-b-2 -mb-px ${
                  isActive
                    ? 'border-orange-500 text-stone-900 font-medium bg-stone-50'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                {b.name}
                <span className="ml-1.5 text-xs text-stone-400">{b.totals.customerCount}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-stone-200" />

        {branch && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3">
            <SummaryCard
              label="Total balance"
              value={fmtMoney0(branch.totals.total)}
              hint={`${branch.totals.customerCount} customers`}
            />
            <SummaryCard label="Current" value={fmtMoney0(branch.totals.current)} />
            <SummaryCard
              label="Past due"
              value={fmtMoney0(branch.totals.pastDue)}
              tone="danger"
              hint={
                branch.totals.total
                  ? `${Math.round((branch.totals.pastDue / branch.totals.total) * 100)}% of balance`
                  : undefined
              }
            />
            <SummaryCard
              label="Over 90 days"
              value={fmtMoney0(branch.totals.b90plus)}
              tone={branch.totals.b90plus ? 'danger' : 'muted'}
            />
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setPriorityFilter('all')}
              className={`text-xs px-2 py-1 rounded border ${
                priorityFilter === 'all'
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-50'
              }`}
            >
              All {branch?.customers.length ?? 0}
            </button>
            {PRIORITY_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter((cur) => (cur === p ? 'all' : p))}
                disabled={!counts[p]}
                className={`text-xs px-2 py-1 rounded border disabled:opacity-40 ${
                  priorityFilter === p
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                }`}
              >
                {p} {counts[p]}
              </button>
            ))}
          </div>
          <input
            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-56 max-w-full focus:outline-none focus:border-orange-500"
            placeholder="Filter by name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left font-medium px-4 py-2">Priority</th>
                <th className="text-left font-medium px-2 py-2">Code</th>
                <th className="text-left font-medium px-2 py-2">Customer Name</th>
                <th className="text-right font-medium px-2 py-2">Credit Limit</th>
                <th className="text-right font-medium px-2 py-2">Current</th>
                <th className="text-right font-medium px-2 py-2">1-30</th>
                <th className="text-right font-medium px-2 py-2">31-60</th>
                <th className="text-right font-medium px-2 py-2">61-90</th>
                <th className="text-right font-medium px-2 py-2">Over 90</th>
                <th className="text-right font-medium px-2 py-2">Past Due</th>
                <th className="text-right font-medium px-2 py-2">Total Balance</th>
                <th className="text-left font-medium px-4 py-2">Over Limit?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((c) => (
                <tr key={c.customerId} className="hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <PriorityBadge priority={c.priority} />
                  </td>
                  <td className="px-2 py-2 mono text-xs text-stone-600">{c.customerId}</td>
                  <td className="px-2 py-2">
                    <button
                      className="font-medium text-stone-900 hover:text-orange-700 hover:underline text-left"
                      onClick={() => onOpenCustomer?.(c.customerId)}
                      title="View invoices & details"
                    >
                      {c.customerName}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right num text-stone-500">
                    {c.creditLimit ? fmtMoney(c.creditLimit) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right num">{money(c.current)}</td>
                  <td className="px-2 py-2 text-right num">{money(c.b1_30)}</td>
                  <td className="px-2 py-2 text-right num">{money(c.b31_60)}</td>
                  <td className="px-2 py-2 text-right num">{money(c.b61_90)}</td>
                  <td className="px-2 py-2 text-right num text-red-700">{money(c.b90plus)}</td>
                  <td className="px-2 py-2 text-right num font-medium">{money(c.pastDue)}</td>
                  <td className="px-2 py-2 text-right num font-medium">{fmtMoney(c.total)}</td>
                  <td className="px-4 py-2">
                    {c.overLimit && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                        Over
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-stone-400">
                    No customers match this filter.
                  </td>
                </tr>
              )}
            </tbody>
            {branch && rows.length > 0 && (
              <tfoot className="bg-stone-50 border-t-2 border-stone-300 font-medium">
                <tr>
                  <td className="px-4 py-2.5" />
                  <td className="px-2 py-2.5" />
                  <td className="px-2 py-2.5">
                    {filtered ? `TOTAL (${rows.length} shown)` : 'TOTAL'}
                  </td>
                  <td className="px-2 py-2.5 text-right num text-stone-500">
                    {fmtMoney(shown.creditLimit)}
                  </td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.current)}</td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.b1_30)}</td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.b31_60)}</td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.b61_90)}</td>
                  <td className="px-2 py-2.5 text-right num text-red-700">
                    {fmtMoney(shown.b90plus)}
                  </td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.pastDue)}</td>
                  <td className="px-2 py-2.5 text-right num">{fmtMoney(shown.total)}</td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
