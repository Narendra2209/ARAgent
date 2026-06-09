import { useEffect, useState } from 'react';
import { fetchEmailLog } from '../api.js';
import { fmtMoney, fmtRelative } from '../format.js';

const DOT = {
  sent: 'bg-emerald-500',
  failed: 'bg-red-500',
  preview: 'bg-stone-400',
};

export default function ActivityFeed({ onViewAll }) {
  const [rows, setRows] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | empty | dbdown | error

  useEffect(() => {
    let alive = true;
    fetchEmailLog(12)
      .then((res) => {
        if (!alive) return;
        if (res.dbDown) return setState('dbdown');
        setRows(res.rows || []);
        setState((res.rows || []).length ? 'ok' : 'empty');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="bg-white border border-stone-200 rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <span className="w-2 h-2 bg-orange-500 rounded-full" />
            Recent activity
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">Reminder emails sent</p>
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-xs text-stone-500 hover:text-stone-900">
            Send more →
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin divide-y divide-stone-100 max-h-[28rem]">
        {state === 'loading' && (
          <div className="px-4 py-8 text-center text-sm text-stone-400">Loading…</div>
        )}
        {state === 'dbdown' && (
          <div className="px-4 py-8 text-center text-sm text-stone-400">
            Database offline — activity log unavailable.
          </div>
        )}
        {state === 'error' && (
          <div className="px-4 py-8 text-center text-sm text-stone-400">
            Couldn’t load activity.
          </div>
        )}
        {state === 'empty' && (
          <div className="px-4 py-8 text-center text-sm text-stone-400">
            No reminders sent yet. Head to Overdue Reminders to send the first batch.
          </div>
        )}
        {state === 'ok' &&
          rows.map((r, i) => (
            <div key={r._id || i} className="px-4 py-3 hover:bg-stone-50">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    DOT[r.status] || 'bg-stone-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-stone-500">{fmtRelative(r.sentAt)}</div>
                  <div className="text-sm truncate">
                    {r.status === 'failed' ? 'Failed reminder to ' : 'Reminder sent to '}
                    <span className="font-medium">{r.customerName || r.customerId}</span>
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5 truncate">
                    {r.recipient}
                    {r.overdueAmount ? ` · ${fmtMoney(r.overdueAmount)}` : ''}
                  </div>
                  {r.status === 'failed' && r.error && (
                    <div className="text-xs text-red-600 mt-0.5 truncate">{r.error}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
