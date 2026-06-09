import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCustomers, updateCustomer, syncCustomers, fetchArAging } from '../api.js';
import { fmtMoney } from '../format.js';
import TierBadge from './TierBadge.jsx';

export default function CustomersView({ onOpenCustomer }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState({}); // { [id]: { email, phone } }
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [aging, setAging] = useState({}); // customerId -> { tier, total }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCustomers());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tier + outstanding come from the AR-aging report, joined here by customer ID.
  useEffect(() => {
    fetchArAging()
      .then((summary) => {
        const map = {};
        for (const c of summary.customers || []) {
          map[c.customerId] = { tier: c.tier, total: c.total };
        }
        setAging(map);
      })
      .catch(() => setAging({}));
  }, []);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      setData(await syncCustomers());
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = data?.customers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.customerId.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
    );
  }, [data, query]);

  const setEdit = (id, field, value) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: value } }));
  const clearEdit = (id) =>
    setEdits((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  const currentValue = (c, field) =>
    edits[c.customerId]?.[field] !== undefined ? edits[c.customerId][field] : c[field] ?? '';
  const hasUnsaved = (c) => {
    const e = edits[c.customerId];
    if (!e) return false;
    const emailChanged = e.email !== undefined && e.email !== (c.email ?? '');
    const phoneChanged = e.phone !== undefined && e.phone !== (c.phone ?? '');
    return emailChanged || phoneChanged;
  };

  const save = async (c) => {
    const e = edits[c.customerId];
    if (!e) return;
    setSavingId(c.customerId);
    try {
      const patch = {};
      if (e.email !== undefined) patch.emailOverride = e.email;
      if (e.phone !== undefined) patch.phoneOverride = e.phone;
      await updateCustomer(c.customerId, patch);
      setData((d) => {
        if (!d) return d;
        const customers = d.customers.map((x) =>
          x.customerId === c.customerId
            ? {
                ...x,
                email: e.email !== undefined && e.email ? e.email : x.email,
                phone: e.phone !== undefined ? e.phone : x.phone,
                usingDefaultEmail: e.email ? false : x.usingDefaultEmail,
              }
            : x
        );
        return { ...d, customers };
      });
      clearEdit(c.customerId);
      setSavedId(c.customerId);
      setTimeout(() => setSavedId((id) => (id === c.customerId ? null : id)), 1800);
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const inputCls =
    'w-full min-w-[150px] px-2 py-1 border border-stone-300 rounded text-sm focus:outline-none focus:border-orange-500';

  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Customers</h2>
          {data && (
            <p className="text-xs text-stone-500 mt-0.5">
              {data.count} customers
              {data.source === 'cache' && ' · cached'}
              {data.source === 'live' && ' · live from MYOB'}
              {data.source === 'mock' && ' · sample data'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="border border-stone-300 rounded px-3 py-1.5 text-sm w-64 max-w-full focus:outline-none focus:border-orange-500"
            placeholder="Filter by name, ID, email or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50"
            onClick={onSync}
            disabled={syncing || loading}
          >
            {syncing ? 'Syncing…' : 'Sync from MYOB'}
          </button>
        </div>
      </div>

      {error && (
        <div className="m-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
          <strong>Couldn’t load customers.</strong> {error}
        </div>
      )}

      {loading && !data && (
        <div className="px-4 py-12 text-center text-stone-400">Loading customers…</div>
      )}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left font-medium px-4 py-2">Customer ID</th>
                <th className="text-left font-medium px-2 py-2">Name</th>
                <th className="text-left font-medium px-2 py-2">Tier</th>
                <th className="text-right font-medium px-2 py-2">Outstanding</th>
                <th className="text-right font-medium px-2 py-2">Credit limit</th>
                <th className="text-left font-medium px-2 py-2">Email</th>
                <th className="text-left font-medium px-2 py-2">Phone</th>
                <th className="text-left font-medium px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((c) => (
                <tr key={c.customerId} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 mono text-xs text-stone-600">{c.customerId}</td>
                  <td className="px-2 py-2.5">
                    <button
                      className="font-medium text-stone-900 hover:text-orange-700 hover:underline text-left"
                      onClick={() => onOpenCustomer?.(c.customerId)}
                      title="View invoices & details"
                    >
                      {c.customerName}
                    </button>
                  </td>
                  <td className="px-2 py-2.5">
                    <TierBadge tier={aging[c.customerId]?.tier} />
                  </td>
                  <td className="px-2 py-2.5 text-right num">
                    {aging[c.customerId]?.total != null
                      ? fmtMoney(aging[c.customerId].total)
                      : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-right num">
                    {c.creditLimit ? fmtMoney(c.creditLimit) : '—'}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        type="email"
                        value={currentValue(c, 'email')}
                        onChange={(ev) => setEdit(c.customerId, 'email', ev.target.value)}
                        placeholder="email@…"
                      />
                      {c.usingDefaultEmail && !edits[c.customerId]?.email && (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                          default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      className={inputCls}
                      type="tel"
                      value={currentValue(c, 'phone')}
                      onChange={(ev) => setEdit(c.customerId, 'phone', ev.target.value)}
                      placeholder="phone"
                    />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <button
                      className="text-xs px-2.5 py-1 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-40"
                      onClick={() => save(c)}
                      disabled={!hasUnsaved(c) || savingId !== null}
                    >
                      {savingId === c.customerId ? 'Saving…' : 'Save'}
                    </button>
                    {savedId === c.customerId && (
                      <span className="ml-2 text-xs text-emerald-700">✓ Saved</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-stone-400">
                    {query ? `No customers match “${query}”.` : 'No customers found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.defaultEmail && (
        <p className="px-4 py-3 text-xs text-stone-400 border-t border-stone-200">
          Customers without an email on file use the default: {data.defaultEmail}
        </p>
      )}
    </div>
  );
}
