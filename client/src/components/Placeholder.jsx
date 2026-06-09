const CONTENT = {
  ai_inbox: {
    title: 'AI Inbox',
    blurb: 'Items an AI agent flags for your review — escalations, detected disputes, payment-promise confirmations, and call transcripts.',
    items: [
      'Approve escalations for accounts that ignored repeated reminders',
      'Review disputes detected from customer email replies',
      'Confirm payment plans the agent negotiated',
      'Read voice-call transcripts and recommended next actions',
    ],
  },
  reports: {
    title: 'Reports',
    blurb: 'Collections analytics built on top of the AR aging snapshots already stored in MongoDB.',
    items: [
      'Aging by branch (Sunbury, Melton, Pakenham, Moama)',
      'Collections performance · DSO trend',
      'AI vs manual outcomes',
      'Dispute log and payment-promise tracker',
    ],
  },
};

export default function Placeholder({ view }) {
  const c = CONTENT[view] ?? CONTENT.ai_inbox;
  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-stone-200 rounded-lg p-8">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide bg-stone-100 text-stone-600 px-2 py-0.5 rounded mb-3">
          Coming soon
        </div>
        <h1 className="text-xl font-semibold">{c.title}</h1>
        <p className="text-sm text-stone-500 mt-1">{c.blurb}</p>
        <ul className="mt-5 space-y-2">
          {c.items.map((it) => (
            <li key={it} className="flex items-start gap-2 text-sm text-stone-700">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
              {it}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-stone-400">
          This screen is a placeholder — these features need new backend endpoints that don’t exist
          yet. The Dashboard, Customers and Overdue Reminders tabs are fully wired to live data.
        </p>
      </div>
    </div>
  );
}
