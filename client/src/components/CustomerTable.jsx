import { useMemo, useState } from 'react';
import { fmtMoney } from '../format.js';

export default function CustomerTable({ buckets, customers, totals }) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.customerId.toLowerCase().includes(q)
    );
  }, [customers, query]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">AR Aging Summary by Customer</h2>
        <input
          className="search"
          placeholder="Filter customers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table className="aging-table">
          <thead>
            <tr>
              <th className="left">Customer</th>
              {buckets.map((b) => (
                <th key={b.key} className="right">
                  {b.label}
                </th>
              ))}
              <th className="right total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.customerId}>
                <td className="left">
                  <div className="cust-name">{c.customerName}</div>
                  <div className="cust-id">{c.customerId}</div>
                </td>
                {buckets.map((b) => (
                  <td key={b.key} className="right">
                    {c[b.key] ? fmtMoney(c[b.key]) : '—'}
                  </td>
                ))}
                <td className="right total-col">{fmtMoney(c.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="left empty" colSpan={buckets.length + 2}>
                  No customers match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="left">TOTAL</td>
              {buckets.map((b) => (
                <td key={b.key} className="right">
                  {fmtMoney(totals[b.key])}
                </td>
              ))}
              <td className="right total-col">{fmtMoney(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
