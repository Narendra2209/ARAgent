import PreviewBanner from './PreviewBanner.jsx';

const REPORTS = [
  { title: 'Aging by branch', desc: 'Outstanding split across each branch' },
  { title: 'Collections performance', desc: 'DSO trend · monthly' },
  { title: 'AI vs manual outcomes', desc: 'Response rates by handling mode' },
  { title: 'Tier migration', desc: 'Customers moving between T1–T10' },
  { title: 'Dispute log', desc: 'Open and resolved disputes' },
  { title: 'Payment promise tracker', desc: 'Promised vs delivered' },
];

/** Preview of the reports catalogue (no backend yet). */
export default function ReportsView() {
  return (
    <>
      <h1 className="text-xl font-semibold mb-4">Reports</h1>
      <PreviewBanner>
        These reports are planned. The aging numbers behind several of them already exist in the app — say
        the word and I can wire up the ones you want first (e.g. Aging by branch, Collections performance).
      </PreviewBanner>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <div key={r.title} className="bg-white border border-stone-200 rounded-lg p-5 opacity-80">
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-stone-500 mt-1">{r.desc}</div>
            <div className="text-[10px] uppercase tracking-wide text-stone-400 mt-3">Preview</div>
          </div>
        ))}
      </div>
    </>
  );
}
