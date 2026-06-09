import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendReminders,
  checkEmailHealth,
  getSignature,
  uploadSignature,
  removeSignature,
  signatureImageUrl,
} from '../api.js';
import { fmtMoney } from '../format.js';

const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024; // 5 MB

const STATUS_LABEL = {
  preview: 'Will send',
  sent: 'Sent',
  failed: 'Failed',
};

export default function RemindersCard() {
  const [testMode, setTestMode] = useState(true);
  const [data, setData] = useState(null); // last response
  const [busy, setBusy] = useState(null); // 'preview' | 'send' | 'health' | null
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const lastResultsKey = useRef(null);

  // ---- Email signature ----
  const [sig, setSig] = useState(null); // { configured, filename, ... }
  const [sigBusy, setSigBusy] = useState(false);
  const [sigError, setSigError] = useState(null);
  const [sigVer, setSigVer] = useState(0); // cache-buster for the preview image
  const fileRef = useRef(null);

  useEffect(() => {
    getSignature()
      .then(setSig)
      .catch(() => setSig({ configured: false }));
  }, []);

  const onSignatureFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setSigError(null);
    if (!/\.(png|jpe?g)$/i.test(file.name)) {
      setSigError('Please choose a PNG or JPG image.');
      return;
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      setSigError('Image is too large (max 5 MB).');
      return;
    }
    setSigBusy(true);
    try {
      setSig(await uploadSignature(file));
      setSigVer((v) => v + 1);
    } catch (err) {
      setSigError(err.message);
    } finally {
      setSigBusy(false);
    }
  };

  const onRemoveSignature = async () => {
    if (!window.confirm('Remove the email signature image?')) return;
    setSigBusy(true);
    setSigError(null);
    try {
      setSig(await removeSignature());
      setSigVer((v) => v + 1);
    } catch (err) {
      setSigError(err.message);
    } finally {
      setSigBusy(false);
    }
  };

  // When a new dataset arrives, default to "all selected".
  useEffect(() => {
    const ids = data?.results?.map((r) => r.customerId) ?? [];
    const key = ids.join('|');
    if (key !== lastResultsKey.current) {
      lastResultsKey.current = key;
      setSelected(new Set(ids));
    }
  }, [data]);

  const testConnection = async () => {
    setBusy('health');
    setHealth(null);
    try {
      setHealth(await checkEmailHealth());
    } catch (e) {
      setHealth({ configured: true, tokenOk: false, error: e.message });
    } finally {
      setBusy(null);
    }
  };

  const run = async (dryRun) => {
    setBusy(dryRun ? 'preview' : 'send');
    setError(null);
    try {
      const customerIds = dryRun ? undefined : [...selected];
      setData(await sendReminders({ testMode, dryRun, customerIds }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const onSend = () => {
    const where = testMode
      ? 'the TEST address (all reminders go to one inbox)'
      : "each customer's own email address";
    const n = selected.size;
    if (n === 0) {
      alert('Select at least one customer to send.');
      return;
    }
    if (window.confirm(`Send ${n} overdue reminder email(s) to ${where}?`)) {
      run(false);
    }
  };

  const sendOne = async (r) => {
    // Reflect the CURRENT toggle, not the recipient frozen at preview time.
    const recipient = testMode ? data?.testRecipient ?? r.recipient : r.customerEmail;
    if (!window.confirm(`Send reminder for ${r.customerName} to ${recipient}?`)) return;
    setSendingId(r.customerId);
    setError(null);
    try {
      const res = await sendReminders({ testMode, customerId: r.customerId });
      const updated = res.results?.[0];
      setData((d) => {
        if (!d) return d;
        const results = d.results.map((row) =>
          row.customerId === r.customerId && updated ? { ...row, ...updated } : row
        );
        return {
          ...d,
          results,
          sentCount: results.filter((x) => x.status === 'sent').length,
          failedCount: results.filter((x) => x.status === 'failed').length,
          dryRun: false,
        };
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSendingId(null);
    }
  };

  const [query, setQuery] = useState('');
  const allResults = data?.results ?? [];
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allResults;
    return allResults.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        r.customerId.toLowerCase().includes(q) ||
        (r.customerEmail || '').toLowerCase().includes(q)
    );
  }, [allResults, query]);

  const toggleOne = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = useMemo(() => results.map((r) => r.customerId), [results]);
  const visibleSelectedCount = useMemo(
    () => visibleIds.filter((id) => selected.has(id)).length,
    [visibleIds, selected]
  );
  const allSelected = results.length > 0 && visibleSelectedCount === results.length;
  const someSelected = visibleSelectedCount > 0 && visibleSelectedCount < results.length;

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Untick all currently-visible rows.
        visibleIds.forEach((id) => next.delete(id));
      } else {
        // Tick all currently-visible rows.
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const summaryLine = useMemo(() => {
    if (!data) return null;
    const totalSelected = results
      .filter((r) => selected.has(r.customerId))
      .reduce((s, r) => s + (r.overdue || 0), 0);
    return { totalSelected: Math.round(totalSelected * 100) / 100 };
  }, [data, results, selected]);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Send Overdue Reminders</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          Test mode (send all to one test address)
        </label>
      </div>

      <p className="subtitle" style={{ marginTop: 0 }}>
        Emails customers <strong>31+ days overdue</strong> a reminder of their balance, sent
        from Outlook via Microsoft 365.
        {data?.testRecipient && (
          <>
            {' '}
            {testMode ? (
              <>
                Test mode is <strong>on</strong> — every email goes to{' '}
                <strong>{data.testRecipient}</strong>.
              </>
            ) : (
              <>
                Test mode is <strong>off</strong> — emails go to each customer’s own address.
              </>
            )}
          </>
        )}
      </p>

      <div className="signature-row">
        <div className="signature-preview">
          {sig?.configured ? (
            <img
              src={signatureImageUrl(sigVer)}
              alt="Email signature"
              style={{ maxWidth: 220, maxHeight: 80, height: 'auto' }}
            />
          ) : (
            <span className="cust-id">No signature image</span>
          )}
        </div>
        <div className="signature-controls">
          <div className="cust-id">
            Signature image embedded at the foot of every reminder.
            {sig?.configured && sig.filename && (
              <>
                {' '}Current: <strong>{sig.filename}</strong>.
              </>
            )}
          </div>
          <div className="actions" style={{ marginTop: 6 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={onSignatureFile}
              style={{ display: 'none' }}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={sigBusy}
            >
              {sigBusy ? 'Uploading…' : sig?.configured ? 'Change image' : 'Upload image'}
            </button>
            {sig?.configured && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={onRemoveSignature}
                disabled={sigBusy}
              >
                Remove
              </button>
            )}
          </div>
          {sigError && <div className="cust-id text-danger">{sigError}</div>}
        </div>
      </div>

      {health && (
        <div className={`alert ${health.tokenOk ? 'alert-ok' : ''}`}>
          {!health.configured ? (
            <>
              <strong>Not configured.</strong> Add to <code>server/.env</code>:{' '}
              {health.missing.join(', ')}.
            </>
          ) : health.tokenOk ? (
            <>
              <strong>✅ Connected to Microsoft 365.</strong> Sending from{' '}
              <strong>{health.sender}</strong>.
            </>
          ) : (
            <>
              <strong>❌ Couldn’t authenticate.</strong> {health.error}
              <div className="alert-hint">
                {health.transport === 'smtp' ? (
                  <>
                    Re-check <code>SMTP_HOST</code>, <code>SMTP_USER</code> and{' '}
                    <code>SMTP_PASS</code> in <code>server/.env</code>, then restart the backend.
                  </>
                ) : (
                  <>
                    Re-check <code>GRAPH_TENANT_ID</code>, <code>GRAPH_CLIENT_ID</code> and{' '}
                    <code>GRAPH_CLIENT_SECRET</code> in <code>server/.env</code>, then restart
                    the backend.
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={testConnection} disabled={busy !== null}>
          {busy === 'health' ? 'Checking…' : 'Test connection'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => run(true)}
          disabled={busy !== null}
        >
          {busy === 'preview' ? 'Loading…' : 'Preview'}
        </button>
        <button
          className="btn btn-primary"
          onClick={onSend}
          disabled={busy !== null || !data || selected.size === 0}
        >
          {busy === 'send'
            ? 'Sending…'
            : `Send ${selected.size} email${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>

      {error && (
        <div className="alert">
          <strong>Couldn’t send reminders.</strong> {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ marginBottom: 10 }}>
            <input
              className="search"
              placeholder="Filter by customer name, ID or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 360, maxWidth: '100%' }}
            />
          </div>

          <div className="reminder-summary">
            <span>
              <strong>{data.count}</strong> customer{data.count === 1 ? '' : 's'} 31+ days overdue
              {query && <> · showing <strong>{results.length}</strong></>}
            </span>
            <span>
              <strong>{selected.size}</strong> selected
              {summaryLine && (
                <>
                  {' '}· total selected:{' '}
                  <strong>{fmtMoney(summaryLine.totalSelected)}</strong>
                </>
              )}
            </span>
            <span>
              Total overdue: <strong>{fmtMoney(data.totalOverdue)}</strong>
            </span>
            {!data.dryRun && (
              <span>
                Sent: <strong>{data.sentCount}</strong>
                {data.failedCount > 0 && (
                  <>
                    {' '}· Failed: <strong className="text-danger">{data.failedCount}</strong>
                  </>
                )}
              </span>
            )}
            <span className="cust-id">as of {data.asOfDate}</span>
          </div>

          <div className="table-wrap">
            <table className="aging-table">
              <thead>
                <tr>
                  <th className="left" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="left">Customer</th>
                  <th className="right">Overdue (31+)</th>
                  {!testMode && <th className="left">Customer email</th>}
                  <th className="left">Recipient</th>
                  <th className="left">Status</th>
                  <th className="left">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.customerId}>
                    <td className="left">
                      <input
                        type="checkbox"
                        checked={selected.has(r.customerId)}
                        onChange={() => toggleOne(r.customerId)}
                        aria-label={`Select ${r.customerName}`}
                      />
                    </td>
                    <td className="left">
                      <div className="cust-name">{r.customerName}</div>
                      <div className="cust-id">{r.customerId}</div>
                    </td>
                    <td className="right">{fmtMoney(r.overdue)}</td>
                    {!testMode && (
                      <td className="left">
                        {r.customerEmail}
                        {r.usingDefaultEmail && <span className="badge">default</span>}
                      </td>
                    )}
                    <td className="left">{r.recipient}</td>
                    <td className="left">
                      <span className={`pill pill-${r.status}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      {r.error && <div className="cust-id text-danger">{r.error}</div>}
                    </td>
                    <td className="left">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => sendOne(r)}
                        disabled={busy !== null || sendingId !== null}
                      >
                        {sendingId === r.customerId ? 'Sending…' : 'Send'}
                      </button>
                    </td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr>
                    <td className="left empty" colSpan={testMode ? 6 : 7}>
                      {query
                        ? `No customers match “${query}”.`
                        : 'No customers are 31+ days overdue. 🎉'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !error && (
        <p className="footnote" style={{ textAlign: 'left' }}>
          Click <strong>Preview</strong> first to see who would be emailed and how much they owe.
        </p>
      )}
    </div>
  );
}
