import { fmtMoney } from '../format.js';

const SEGMENTS = [
  { key: 'current', label: 'Current', color: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'b1_30', label: '1–30', color: 'bg-amber-400', dot: 'bg-amber-400' },
  { key: 'b31_60', label: '31–60', color: 'bg-amber-500', dot: 'bg-amber-500' },
  { key: 'b61_90', label: '61–90', color: 'bg-orange-500', dot: 'bg-orange-500' },
  { key: 'b90plus', label: '90+', color: 'bg-red-600', dot: 'bg-red-600' },
];

/** Lightweight customer drawer built entirely from the AR-aging row we already have. */
export default function CustomerDetailModal({ customer, onClose, onSendReminder }) {
  if (!customer) return null;

  // Widths use absolute values so a negative (credit) bucket still renders sensibly.
  const denom =
    SEGMENTS.reduce((s, seg) => s + Math.abs(customer[seg.key] || 0), 0) || 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/40 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto scroll-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-stone-200 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{customer.customerName}</h2>
            <div className="text-xs text-stone-500 mono mt-0.5">{customer.customerId}</div>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-900 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="flex justify-between text-xs text-stone-500 mb-1.5">
            <span>
              Outstanding:{' '}
              <span className="text-stone-900 font-semibold mono">
                {fmtMoney(customer.total)}
              </span>
            </span>
            <span>
              Oldest: <span className="mono">{customer.oldestDays || 0}d</span>
            </span>
          </div>

          <div className="flex h-2 rounded overflow-hidden bg-stone-100">
            {SEGMENTS.map((seg) => {
              const w = (Math.abs(customer[seg.key] || 0) / denom) * 100;
              if (w <= 0) return null;
              return <div key={seg.key} className={seg.color} style={{ width: `${w}%` }} />;
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            {SEGMENTS.map((seg) => (
              <div key={seg.key} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-sm ${seg.dot}`} />
                {seg.label}
                <span className="ml-auto mono font-medium">
                  {fmtMoney(customer[seg.key] || 0)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => onSendReminder?.(customer)}
              className="text-sm px-3 py-1.5 bg-stone-900 text-white rounded hover:bg-stone-800"
            >
              Send reminder
            </button>
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 border border-stone-300 rounded hover:bg-stone-50"
            >
              Close
            </button>
          </div>

          <p className="mt-6 text-xs text-stone-400 leading-relaxed">
            Invoice-level detail and the communication timeline live in MYOB. This panel
            summarises the aging buckets computed for the current report date.
          </p>
        </div>
      </div>
    </div>
  );
}
