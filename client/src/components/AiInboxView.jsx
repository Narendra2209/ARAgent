import PreviewBanner from './PreviewBanner.jsx';

const ITEMS = [
  { icon: '!', tone: 'bg-red-100 text-red-700', title: 'Approve escalation: Lysaght Building Solutions', tier: 'T1', when: '2h ago',
    body: '3 reminders sent, no reply. Recommend personal call from branch manager. $284,610 at risk.', actions: ['Approve', 'Reassign', 'Snooze'] },
  { icon: '?', tone: 'bg-amber-100 text-amber-700', title: 'Dispute detected: Stratco Wholesale', tier: 'T1', when: '5h ago',
    body: 'Customer reply mentions "wrong quantities on INV-28201". Needs investigation before further follow-up.', actions: ['Open dispute', 'View email'] },
  { icon: '✓', tone: 'bg-emerald-100 text-emerald-700', title: 'Confirm payment plan: JMP Roofing', tier: 'T2', when: '8h ago',
    body: 'Customer proposed 4 weekly payments of $21,855. Auto-recommended to accept based on payment history.', actions: ['Accept', 'Counter-propose'] },
  { icon: '☎', tone: 'bg-purple-100 text-purple-700', title: 'Voice call transcript ready: Northern Plumbing', tier: '', when: 'Today 8:12 AM',
    body: '3 min call. Payment promised $28,140 by 13 Jun. Sentiment: cooperative.', actions: ['Mark reviewed', 'View transcript'] },
  { icon: '⛔', tone: 'bg-red-100 text-red-700', title: 'Recommend stop-credit: Apex Steel Trading', tier: 'T9', when: 'Yesterday',
    body: '112 days overdue. No response to 5 attempts. Recommend placing on stop-credit in MYOB.', actions: ['Apply stop-credit', 'Override'] },
];

const tierCls = (t) =>
  ({ T1: 'bg-amber-100 text-amber-800 border-amber-200', T2: 'bg-blue-100 text-blue-800 border-blue-200', T9: 'bg-red-100 text-red-800 border-red-200' }[t] ||
    'bg-stone-100 text-stone-700 border-stone-200');

/** Preview of the AI triage inbox (no backend yet). */
export default function AiInboxView() {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">AI Inbox</h1>
        <p className="text-sm text-stone-500 mt-0.5">Items the AI flagged for your review · 5 pending</p>
      </div>
      <PreviewBanner>
        This is a preview of the AI triage inbox. Escalations, disputes, payment-plan confirmations and call
        transcripts will appear here once the AI agent is connected — the items below are samples.
      </PreviewBanner>

      <div className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-200">
        {ITEMS.map((it, i) => (
          <div key={i} className="p-4 hover:bg-stone-50">
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" disabled />
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs ${it.tone}`}>{it.icon}</div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="font-medium text-sm">{it.title}</span>
                    {it.tier && <span className={`text-xs px-1.5 py-0.5 rounded border ml-2 ${tierCls(it.tier)}`}>{it.tier}</span>}
                  </div>
                  <span className="text-xs text-stone-500">{it.when}</span>
                </div>
                <div className="text-sm text-stone-600 mt-1">{it.body}</div>
                <div className="flex gap-2 mt-2">
                  {it.actions.map((a, j) => (
                    <button
                      key={j}
                      className={`text-xs px-2 py-1 rounded ${j === 0 ? 'bg-stone-900 text-white' : 'border border-stone-300'} opacity-60 cursor-not-allowed`}
                      disabled
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
