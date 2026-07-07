import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendReminders,
  checkEmailHealth,
  fetchHealth,
  getSignature,
  uploadSignature,
  removeSignature,
  signatureImageUrl,
} from '../api.js';
import { fmtMoney } from '../format.js';

const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024; // 5 MB

const STATUS_LABEL = { preview: 'Will send', sent: 'Sent', failed: 'Failed' };
const STATUS_PILL = {
  preview: 'bg-stone-100 text-stone-600',
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

export default function RemindersView() {
  const [testMode, setTestMode] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'send' | 'health'
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const lastResultsKey = useRef(null);

  const [sig, setSig] = useState(null);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigError, setSigError] = useState(null);
  const [sigVer, setSigVer] = useState(0);
  const fileRef = useRef(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    getSignature()
      .then(setSig)
      .catch(() => setSig({ configured: false }));
  }, []);

  useEffect(() => {
    const ids = data?.results?.map((r) => r.customerId) ?? [];
    const key = ids.join('|');
    if (key !== lastResultsKey.current) {
      lastResultsKey.current = key;
      setSelected(new Set(ids));
    }
  }, [data]);

  const onSignatureFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSigError(null);
    if (!/\.(png|jpe?g)$/i.test(file.name)) return setSigError('Please choose a PNG or JPG image.');
    if (file.size > MAX_SIGNATURE_BYTES) return setSigError('Image is too large (max 5 MB).');
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

  const testConnection = async () => {
    setBusy('health');
    setHealth(null);
    // The backend runs on a free-tier host that sleeps after ~15 min idle. A
    // cold start can take up to a minute, during which the mail check (and the
    // proxy in front of it) times out and reports "warming". So first WAKE the
    // server with the cheap /api/health ping, then retry the mail check long
    // enough to outlast the cold start (10 × 5s ≈ 50s) before giving up. The
    // token is cached server-side once fetched, so a later attempt lands on a
    // warm "Connected". Only surface a hard error once we've stopped warming.
    const MAX_ATTEMPTS = 10;
    const RETRY_MS = 5000;
    setHealth({ configured: true, tokenOk: false, warming: true });
    try {
      // Wake the instance first; ignore the result, it just gets a request in.
      await fetchHealth().catch(() => {});
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let result;
        try {
          result = await checkEmailHealth();
        } catch (e) {
          result = { configured: true, tokenOk: false, warming: true, error: e.message };
        }
        const stillWarming = !result.tokenOk && result.warming;
        if (!stillWarming || attempt === MAX_ATTEMPTS) {
          setHealth(result);
          break;
        }
        // Show a soft "warming up" banner and wait before retrying.
        setHealth({ ...result, warming: true });
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
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
    if (n === 0) return alert('Select at least one customer to send.');
    if (window.confirm(`Send ${n} overdue reminder email(s) to ${where}?`)) run(false);
  };

  const sendOne = async (r) => {
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

  const toggleOne = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = useMemo(() => results.map((r) => r.customerId), [results]);
  const visibleSelectedCount = useMemo(
    () => visibleIds.filter((id) => selected.has(id)).length,
    [visibleIds, selected]
  );
  const allSelected = results.length > 0 && visibleSelectedCount === results.length;
  const someSelected = visibleSelectedCount > 0 && visibleSelectedCount < results.length;

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const totalSelected = useMemo(() => {
    if (!data) return 0;
    const t = results.filter((r) => selected.has(r.customerId)).reduce((s, r) => s + (r.overdue || 0), 0);
    return Math.round(t * 100) / 100;
  }, [data, results, selected]);

  const btnGhost =
    'text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50';

  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-200 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm">Send overdue reminders</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Emails customers <strong>31+ days overdue</strong>, sent from Outlook via Microsoft 365.
            {data?.testRecipient && testMode && (
              <> Test mode <strong>on</strong> — all go to {data.testRecipient}.</>
            )}
            {data?.testRecipient && !testMode && (
              <> Test mode <strong>off</strong> — emails go to each customer.</>
            )}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 accent-orange-600"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          Test mode
        </label>
      </div>

      <div className="p-4 space-y-4">
        {/* Signature */}
        <div className="flex gap-4 items-center flex-wrap p-3 border border-stone-200 rounded-lg bg-stone-50">
          <div className="flex items-center justify-center min-w-[120px] min-h-[56px] p-2 border border-dashed border-stone-300 rounded bg-white">
            {sig?.configured ? (
              <img
                src={signatureImageUrl(sigVer)}
                alt="Email signature"
                className="max-w-[220px] max-h-20 h-auto"
              />
            ) : (
              <span className="text-xs text-stone-400">No signature image</span>
            )}
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs text-stone-500">
              Signature image embedded at the foot of every reminder.
              {sig?.configured && sig.filename && (
                <> Current: <strong>{sig.filename}</strong>.</>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                onChange={onSignatureFile}
                className="hidden"
              />
              <button className={btnGhost} onClick={() => fileRef.current?.click()} disabled={sigBusy}>
                {sigBusy ? 'Uploading…' : sig?.configured ? 'Change image' : 'Upload image'}
              </button>
              {sig?.configured && (
                <button className={btnGhost} onClick={onRemoveSignature} disabled={sigBusy}>
                  Remove
                </button>
              )}
            </div>
            {sigError && <div className="text-xs text-red-600 mt-1">{sigError}</div>}
          </div>
        </div>

        {/* Health banner */}
        {health && (
          <div
            className={`px-4 py-3 rounded border text-sm ${health.tokenOk
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : !health.tokenOk && health.warming
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-800'
              }`}
          >
            {!health.configured ? (
              <><strong>Not configured.</strong> Add to server/.env: {health.missing?.join(', ')}.</>
            ) : health.tokenOk ? (
              <><strong>✅ Connected to Microsoft 365.</strong> Sending from <strong>{health.sender}</strong>.</>
            ) : health.warming ? (
              <><strong>⏳ Waking the mail service…</strong> The server was idle and is warming up. Retrying automatically.</>
            ) : (
              <><strong>❌ Couldn’t authenticate.</strong> {health.error}</>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button className={btnGhost} onClick={testConnection} disabled={busy !== null}>
            {busy === 'health' ? 'Checking…' : 'Test connection'}
          </button>
          <button className={btnGhost} onClick={() => run(true)} disabled={busy !== null}>
            {busy === 'preview' ? 'Loading…' : 'Preview'}
          </button>
          {/* Bulk "Send N emails" button — hidden for now; uncomment the <button> below to show it again. */}
          {/* <button
            className="text-sm px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            onClick={onSend}
            disabled={busy !== null || !data || selected.size === 0}
          >
            {busy === 'send' ? 'Sending…' : `Send ${selected.size} email${selected.size === 1 ? '' : 's'}`}
          </button> */}
        </div>

        {error && (
          <div className="px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
            <strong>Couldn’t send reminders.</strong> {error}
          </div>
        )}

        {data && (
          <>
            <input
              className="border border-stone-300 rounded px-3 py-1.5 text-sm w-80 max-w-full focus:outline-none focus:border-orange-500"
              placeholder="Filter by customer name, ID or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-600">
              <span>
                <strong>{data.count}</strong> customer{data.count === 1 ? '' : 's'} 31+ days overdue
                {query && <> · showing <strong>{results.length}</strong></>}
              </span>
              <span>
                <strong>{selected.size}</strong> selected · {fmtMoney(totalSelected)}
              </span>
              <span>Total overdue: <strong>{fmtMoney(data.totalOverdue)}</strong></span>
              {!data.dryRun && (
                <span>
                  Sent: <strong>{data.sentCount}</strong>
                  {data.failedCount > 0 && (
                    <> · Failed: <strong className="text-red-600">{data.failedCount}</strong></>
                  )}
                </span>
              )}
              <span className="text-stone-400">as of {data.asOfDate}</span>
            </div>

            <div className="overflow-x-auto border border-stone-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="text-xs text-stone-500 bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="px-3 py-2 w-9">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-orange-600"
                        checked={allSelected}
                        ref={(el) => el && (el.indeterminate = someSelected)}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="text-left font-medium px-2 py-2">Customer</th>
                    <th className="text-right font-medium px-2 py-2">Overdue (31+)</th>
                    <th className="text-left font-medium px-2 py-2">Customer email</th>
                    <th className="text-left font-medium px-2 py-2">Phone</th>
                    <th className="text-left font-medium px-2 py-2">Recipient</th>
                    <th className="text-left font-medium px-2 py-2">Status</th>
                    {/* Action column: per-row "Send" button to email a single customer's reminder. */}
                    <th className="text-left font-medium px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {results.map((r) => (
                    <tr key={r.customerId} className="hover:bg-stone-50">
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-orange-600"
                          checked={selected.has(r.customerId)}
                          onChange={() => toggleOne(r.customerId)}
                          aria-label={`Select ${r.customerName}`}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-medium">{r.customerName}</div>
                        <div className="text-xs text-stone-500 mono">{r.customerId}</div>
                      </td>
                      <td className="px-2 py-2.5 text-right num">{fmtMoney(r.overdue)}</td>
                      {/* Customer's MYOB email and phone; blank when none is on file. */}
                      <td className="px-2 py-2.5">{r.customerEmail}</td>
                      <td className="px-2 py-2.5">{r.customerPhone}</td>
                      {/* Recipient reflects the Test-mode toggle live: in test mode every
                          email goes to your test inbox; otherwise it goes to the customer's
                          own MYOB email (blank when none is on file in MYOB). */}
                      <td className="px-2 py-2.5">
                        {testMode ? data?.testRecipient || r.recipient : r.customerEmail}
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_PILL[r.status] || 'bg-stone-100 text-stone-600'
                            }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                        {r.error && <div className="text-xs text-red-600 mt-0.5">{r.error}</div>}
                      </td>
                      {/* Send button: emails this one customer; disabled while any bulk/single send is in flight. */}
                      <td className="px-3 py-2.5">
                        <button
                          className="text-xs px-2.5 py-1 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-40"
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
                      <td colSpan={testMode ? 6 : 7} className="px-4 py-12 text-center text-stone-400">
                        {query ? `No customers match “${query}”.` : 'No customers are 31+ days overdue. 🎉'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!data && !error && (
          <p className="text-sm text-stone-400">
            Click <strong>Preview</strong> first to see who would be emailed and how much they owe.
          </p>
        )}
      </div>
    </div>
  );
}
