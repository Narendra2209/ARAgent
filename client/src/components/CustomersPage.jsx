import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCustomers, updateCustomer, syncCustomers } from '../api.js';
import { fmtMoney } from '../format.js';

export default function CustomersPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState({});       // { [customerId]: { email, phone } }
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null); // shows "✓ Saved" briefly

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

  const lastSyncedAt = useMemo(() => {
    const list = data?.customers ?? [];
    const ts = list
      .map((c) => (c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0))
      .filter(Boolean);
    return ts.length ? new Date(Math.max(...ts)) : null;
  }, [data]);

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

  const setEdit = (id, field, value) => {
    setEdits((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: value } }));
  };
  const clearEdit = (id) => {
    setEdits((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const currentValue = (c, field) =>
    edits[c.customerId]?.[field] !== undefined
      ? edits[c.customerId][field]
      : c[field] ?? '';

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
      // Update the local copy so the UI reflects what was saved.
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

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Customers</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="search"
            placeholder="Filter by name, ID, email or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            onClick={onSync}
            disabled={syncing || loading}
            title="Re-fetch the full customer list from MYOB"
          >
            {syncing ? 'Syncing…' : 'Sync from MYOB'}
          </button>
        </div>
      </div>

      {data && (
        <p className="subtitle" style={{ marginTop: 0 }}>
          <strong>{data.count}</strong> customers
          {data.source === 'cache' && lastSyncedAt && (
            <> · cached · last synced {lastSyncedAt.toLocaleString()}</>
          )}
          {data.source === 'live' && <> · live from MYOB (cache warming)</>}
          {data.source === 'mock' && <> · sample data</>}
        </p>
      )}

      {error && (
        <div className="alert">
          <strong>Couldn’t load customers.</strong> {error}
        </div>
      )}

      {loading && !data && <div className="loading">Loading customers…</div>}

      {data && (
        <div className="table-wrap">
          <table className="aging-table">
            <thead>
              <tr>
                <th className="left">Customer ID</th>
                <th className="left">Customer Name</th>
                <th className="right">Credit Limit</th>
                <th className="left">Email</th>
                <th className="left">Phone</th>
                <th className="left">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.customerId}>
                  <td className="left cust-id">{c.customerId}</td>
                  <td className="left cust-name">{c.customerName}</td>
                  <td className="right">
                    {c.creditLimit ? fmtMoney(c.creditLimit) : '—'}
                  </td>
                  <td className="left">
                    <input
                      className="cell-input"
                      type="email"
                      value={currentValue(c, 'email')}
                      onChange={(ev) => setEdit(c.customerId, 'email', ev.target.value)}
                      placeholder="email@…"
                    />
                    {c.usingDefaultEmail && !edits[c.customerId]?.email && (
                      <span className="badge">default</span>
                    )}
                  </td>
                  <td className="left">
                    <input
                      className="cell-input"
                      type="tel"
                      value={currentValue(c, 'phone')}
                      onChange={(ev) => setEdit(c.customerId, 'phone', ev.target.value)}
                      placeholder="phone"
                    />
                  </td>
                  <td className="left">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => save(c)}
                      disabled={!hasUnsaved(c) || savingId !== null}
                    >
                      {savingId === c.customerId ? 'Saving…' : 'Save'}
                    </button>
                    {savedId === c.customerId && (
                      <span style={{ marginLeft: 8, color: '#188a45', fontSize: 12 }}>
                        ✓ Saved
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="left empty" colSpan={6}>
                    {query ? `No customers match “${query}”.` : 'No customers found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.defaultEmail && (
        <p className="footnote">
          Customers without an email on file use the default: {data.defaultEmail}
        </p>
      )}
    </div>
  );
}
