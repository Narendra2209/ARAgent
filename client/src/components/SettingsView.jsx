import { useEffect, useState } from 'react';
import {
  getReminderTiers,
  saveReminderTiers,
  getReminderEmail,
  saveReminderEmail,
} from '../api.js';

const ALL_TIERS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

// Shown in the editor when no custom template has been saved yet.
const DEFAULT_SUBJECT = '{{companyName}}: account reminder — {{overdue}} is past due';
const DEFAULT_BODY = `Dear {{customerName}},

I hope you are doing well.

Your account currently has an overdue balance of {{overdue}}. We would appreciate payment at your earliest convenience, or please let us know the expected payment date.

If you have already made the payment, kindly share the details for our records.

Best regards,
{{companyName}} — Accounts Receivable`;

const VARS = ['customerName', 'customerId', 'overdue', 'total', 'asOfDate', 'companyName'];

/** Settings: choose which customer tiers receive reminder emails. */
export default function SettingsView() {
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    getReminderTiers()
      .then((cfg) => {
        if (!alive) return;
        setSelected(new Set(cfg.tiers || []));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (tier) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(tier) ? next.delete(tier) : next.add(tier);
      return next;
    });
    setDirty(true);
    setSaved(false);
  };

  const setAll = (on) => {
    setSelected(on ? new Set(ALL_TIERS) : new Set());
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const tiers = ALL_TIERS.filter((t) => selected.has(t));
      const cfg = await saveReminderTiers(tiers);
      setSelected(new Set(cfg.tiers || []));
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const count = selected.size;

  return (
    <>
      <TierSettings
        loading={loading}
        error={error}
        selected={selected}
        toggle={toggle}
        setAll={setAll}
        save={save}
        saving={saving}
        saved={saved}
        dirty={dirty}
        count={count}
      />
      <EmailFormatSettings />
    </>
  );
}

function TierSettings({ loading, error, selected, toggle, setAll, save, saving, saved, dirty, count }) {
  return (
    <>
      <h1 className="text-xl font-semibold mb-1">Settings</h1>
      <p className="text-sm text-stone-500 mb-5">Control how the AR system sends reminders</p>

      <div className="bg-white border border-stone-200 rounded-lg max-w-2xl">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Reminder tiers</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Reminder emails are sent <strong>only</strong> to customers in the ticked tiers.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <button onClick={() => setAll(true)} className="px-2 py-1 border border-stone-300 rounded hover:bg-stone-50">Select all</button>
            <button onClick={() => setAll(false)} className="px-2 py-1 border border-stone-300 rounded hover:bg-stone-50">Clear</button>
          </div>
        </div>

        {error && (
          <div className="m-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
        )}

        {loading ? (
          <div className="px-4 py-10 text-center text-stone-400">Loading…</div>
        ) : (
          <>
            <div className="divide-y divide-stone-100">
              {ALL_TIERS.map((tier) => {
                const on = selected.has(tier);
                return (
                  <label key={tier} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50">
                    <input type="checkbox" checked={on} onChange={() => toggle(tier)} className="w-4 h-4" />
                    <span className="text-sm font-medium flex-1">{tier}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-500'}`}>
                      {on ? 'Reminders on' : 'Off'}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
              <span className="text-xs text-stone-500">
                {count === 0
                  ? 'No tiers selected — no reminders will be sent.'
                  : `Reminders will go to customers in ${count} tier${count === 1 ? '' : 's'}.`}
              </span>
              <div className="flex items-center gap-2">
                {saved && <span className="text-xs text-emerald-700">✓ Saved</span>}
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-stone-400 mt-3 max-w-2xl">
        Tiers are assigned automatically (T1 = highest collection priority … T10 = lowest), recomputed each time
        the aging report runs. This setting only changes <em>who gets emailed</em> — it doesn’t change the tiers themselves.
      </p>
    </>
  );
}

/** Edit the reminder email subject + body (with {{placeholders}}). */
function EmailFormatSettings() {
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    getReminderEmail()
      .then((cfg) => {
        if (!alive) return;
        if (cfg.configured) {
          setSubject(cfg.subject || DEFAULT_SUBJECT);
          setBody(cfg.body || DEFAULT_BODY);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSubject = (v) => { setSubject(v); setDirty(true); setSaved(false); };
  const onBody = (v) => { setBody(v); setDirty(true); setSaved(false); };
  const resetDefault = () => { setSubject(DEFAULT_SUBJECT); setBody(DEFAULT_BODY); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveReminderEmail({ subject, body });
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:border-orange-500';

  return (
    <div className="bg-white border border-stone-200 rounded-lg max-w-2xl mt-6">
      <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Reminder email format</h2>
          <p className="text-xs text-stone-500 mt-0.5">The subject and message used for every reminder email.</p>
        </div>
        <button onClick={resetDefault} className="text-xs px-2 py-1 border border-stone-300 rounded hover:bg-stone-50">
          Reset to default
        </button>
      </div>

      {error && (
        <div className="m-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="px-4 py-10 text-center text-stone-400">Loading…</div>
      ) : (
        <>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs text-stone-500 uppercase tracking-wide">Subject</label>
              <input className={`${inputCls} mt-1`} value={subject} onChange={(e) => onSubject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase tracking-wide">Body</label>
              <textarea
                rows={12}
                className={`${inputCls} mt-1 font-mono`}
                value={body}
                onChange={(e) => onBody(e.target.value)}
              />
            </div>
            <div className="text-xs text-stone-500">
              Variables you can use:{' '}
              {VARS.map((v) => (
                <code key={v} className="mono px-1.5 py-0.5 bg-stone-100 rounded mr-1">{`{{${v}}}`}</code>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stone-200 bg-stone-50">
            {saved && <span className="text-xs text-emerald-700">✓ Saved</span>}
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save email format'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
