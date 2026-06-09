import { useEffect, useMemo, useState } from 'react';
import { fetchInvoices } from '../api.js';
import { fmtMoney } from '../format.js';

const ageColor = (age) =>
  age >= 90 ? 'text-red-700' : age >= 60 ? 'text-orange-700' : age >= 30 ? 'text-amber-700' : 'text-emerald-700';

const bucketOf = (age) =>
  age >= 90 ? '90+' : age >= 60 ? '61–90' : age >= 30 ? '31–60' : age >= 1 ? '1–30' : 'Current';

/** Open invoices across all customers (real MYOB/aging data), searchable + filterable. */
export default function InvoicesView({ onOpenCustomer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [aging, setAging] = useState('');
  const [branch, setBranch] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchInvoices()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const all = data?.invoices || [];
    const q = search.toLowerCase();
    return all.filter((i) => {
      if (q && !(`${i.refNbr}`.toLowerCase().includes(q) || `${i.customerName}`.toLowerCase().includes(q)))
        return false;
      if (aging && bucketOf(i.age) !== aging) return false;
      if (branch && i.branch !== branch) return false;
      return true;
    });
  }, [data, search, aging, branch]);

  const shownTotal = useMemo(() => rows.reduce((s, i) => s + (i.balance || 0), 0), [rows]);

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Open invoices</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {data ? `${rows.length} of ${data.count} invoices · ${fmtMoney(shownTotal)} shown` : 'Loading…'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          type="text"
          placeholder="Search by invoice number or customer…"
          className="flex-1 min-w-[16rem] max-w-md px-3 py-1.5 text-sm border border-stone-300 rounded"
        />
        <select value={aging} onChange={(e) => setAging(e.target.value)} className="text-sm border border-stone-300 rounded px-2 py-1.5 bg-white">
          <option value="">Any age</option>
          <option>Current</option><option>1–30</option><option>31–60</option><option>61–90</option><option>90+</option>
        </select>
        {data?.branches?.length > 0 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="text-sm border border-stone-300 rounded px-2 py-1.5 bg-white">
            <option value="">All branches</option>
            {data.branches.map((b) => <option key={b}>{b}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left font-medium px-3 py-2">Invoice</th>
                <th className="text-left font-medium px-2 py-2">Type</th>
                <th className="text-left font-medium px-2 py-2">Customer</th>
                {data?.branches?.length > 0 && <th className="text-left font-medium px-2 py-2">Branch</th>}
                <th className="text-left font-medium px-2 py-2">Issue date</th>
                <th className="text-left font-medium px-2 py-2">Due date</th>
                <th className="text-right font-medium px-2 py-2">Amount</th>
                <th className="text-right font-medium px-3 py-2">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((i, idx) => (
                <tr key={i.refNbr || idx} className="hover:bg-stone-50">
                  <td className="px-3 py-2.5 mono font-medium">{i.refNbr || '—'}</td>
                  <td className="px-2 text-stone-600">{i.docType}</td>
                  <td className="px-2">
                    {onOpenCustomer && i.customerId ? (
                      <button
                        className="text-stone-900 hover:text-orange-700 hover:underline text-left"
                        onClick={() => onOpenCustomer(i.customerId)}
                      >
                        {i.customerName}
                      </button>
                    ) : (
                      i.customerName
                    )}
                  </td>
                  {data?.branches?.length > 0 && <td className="px-2 text-stone-600">{i.branch || '—'}</td>}
                  <td className="px-2 text-stone-600">{i.date || '—'}</td>
                  <td className="px-2 text-stone-600">{i.dueDate || '—'}</td>
                  <td className="px-2 text-right num font-medium">{fmtMoney(i.balance)}</td>
                  <td className={`px-3 text-right num ${ageColor(i.age)}`}>{i.age > 0 ? `${i.age}d` : 'current'}</td>
                </tr>
              ))}
              {data && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-400">No invoices match these filters.</td></tr>
              )}
              {!data && !error && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-stone-400">Loading invoices…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
