import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchComments, createComment, deleteComment } from '../api.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TYPES = [
  { key: 'note', label: 'Note', dot: 'bg-blue-500', cell: 'bg-blue-50 border-blue-500 text-blue-900' },
  { key: 'call', label: 'Call', dot: 'bg-stone-500', cell: 'bg-stone-100 border-stone-500 text-stone-900' },
  { key: 'followup', label: 'Follow-up', dot: 'bg-amber-500', cell: 'bg-amber-50 border-amber-500 text-amber-900' },
  { key: 'promise', label: 'Promise', dot: 'bg-emerald-500', cell: 'bg-emerald-50 border-emerald-500 text-emerald-900' },
];
const typeStyle = (t) => TYPES.find((x) => x.key === t) || TYPES[0];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based

/** Calendar with user comments pinned to days. Click a day to add one. */
export default function CalendarView() {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [comments, setComments] = useState([]);
  const [dbDown, setDbDown] = useState(false);
  const [error, setError] = useState(null);
  const [addDate, setAddDate] = useState(null); // YYYY-MM-DD when the add modal is open

  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  // First/last day of the visible month, as YYYY-MM-DD, for the range query.
  const from = ymd(cursor.y, cursor.m, 1);
  const lastDay = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const to = ymd(cursor.y, cursor.m, lastDay);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchComments({ from, to });
      setComments(res.comments || []);
      setDbDown(Boolean(res.dbDown));
    } catch (e) {
      setError(e.message);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Group comments by their day for quick cell lookup.
  const byDate = useMemo(() => {
    const map = {};
    for (const c of comments) (map[c.date] ||= []).push(c);
    return map;
  }, [comments]);

  // Build the Mon-first grid: leading blanks + each day of the month.
  const cells = useMemo(() => {
    const firstDow = new Date(cursor.y, cursor.m, 1).getDay(); // 0=Sun..6=Sat
    const lead = (firstDow + 6) % 7;
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= lastDay; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor, lastDay]);

  const goMonth = (delta) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  const goToday = () => setCursor({ y: today.getFullYear(), m: today.getMonth() });

  const onDelete = async (id) => {
    try {
      await deleteComment(id);
      setComments((cs) => cs.filter((c) => c._id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Your notes and follow-up comments, pinned to the day
          </p>
        </div>
        <button
          onClick={() => setAddDate(todayStr)}
          className="text-sm px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded"
        >
          + Add comment
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}
      {dbDown && (
        <div className="mb-4 px-4 py-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-800">
          The database is offline, so comments can’t be loaded or saved right now.
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-3">
            <button onClick={() => goMonth(-1)} className="text-stone-500 hover:text-stone-900 px-1">‹</button>
            <span className="font-semibold">{MONTHS[cursor.m]} {cursor.y}</span>
            <button onClick={() => goMonth(1)} className="text-stone-500 hover:text-stone-900 px-1">›</button>
            <button onClick={goToday} className="text-xs text-stone-500 hover:text-stone-900 ml-2">Today</button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {TYPES.map((t) => (
              <span key={t.key} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                {t.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 font-medium">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-stone-200">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="min-h-[96px] p-2 bg-stone-50" />;
            const dateStr = ymd(cursor.y, cursor.m, d);
            const items = byDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            return (
              <div
                key={i}
                className={`min-h-[96px] p-2 group cursor-pointer hover:bg-stone-50 ${isToday ? 'bg-orange-50' : ''}`}
                onClick={() => setAddDate(dateStr)}
                title="Click to add a comment"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${isToday ? 'font-semibold' : 'text-stone-600'}`}>
                    {d}{isToday ? ' · Today' : ''}
                  </span>
                  <span className="text-xs text-stone-300 group-hover:text-stone-500">+</span>
                </div>
                <div className="mt-1 space-y-1">
                  {items.map((c) => {
                    const st = typeStyle(c.type);
                    return (
                      <div
                        key={c._id}
                        className={`text-xs px-1.5 py-0.5 rounded-sm border-l-2 ${st.cell} relative`}
                        title={`${c.body}${c.customerName ? ` — ${c.customerName}` : ''}${c.createdBy ? ` (by ${c.createdBy})` : ''}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="truncate pr-4">{c.body}</div>
                        {c.customerName && (
                          <div className="truncate text-[10px] opacity-70">{c.customerName}</div>
                        )}
                        <button
                          onClick={() => onDelete(c._id)}
                          className="absolute top-0.5 right-0.5 text-stone-400 hover:text-red-600 leading-none"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {addDate && (
        <AddCommentModal
          date={addDate}
          onClose={() => setAddDate(null)}
          onSaved={(c) => {
            setAddDate(null);
            // Only add to the visible list if it's in the current month.
            if (c.date >= from && c.date <= to) setComments((cs) => [...cs, c]);
          }}
        />
      )}
    </>
  );
}

function AddCommentModal({ date, onClose, onSaved }) {
  const [body, setBody] = useState('');
  const [type, setType] = useState('note');
  const [customerName, setCustomerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    if (!body.trim()) {
      setErr('Please enter a comment.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const { comment } = await createComment({ date, body, type, customerName });
      onSaved(comment);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <div>
            <h2 className="font-semibold">Add comment</h2>
            <p className="text-xs text-stone-500 mt-0.5">{date} · appears on the calendar</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-900 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {err && (
            <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>
          )}
          <div>
            <label className="text-xs text-stone-500 uppercase tracking-wide">Comment</label>
            <textarea
              autoFocus
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full mt-1 border border-stone-300 rounded px-2 py-1.5 text-sm"
              placeholder="What happened / what to do?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone-500 uppercase tracking-wide">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full mt-1 border border-stone-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                {TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-stone-500 uppercase tracking-wide">Customer (optional)</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full mt-1 border border-stone-300 rounded px-2 py-1.5 text-sm"
                placeholder="e.g. Kelkane Constructions"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-200 bg-stone-50">
          <button onClick={onClose} className="text-sm px-3 py-1.5 hover:bg-stone-100 rounded">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
