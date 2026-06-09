// Tiers are collection-priority deciles computed from the data:
// T1 = highest priority (biggest + most overdue) … T10 = lowest. Colour runs
// urgent (red) → calm (stone) so the queue reads at a glance.
const TIER_STYLES = {
  T1: 'bg-red-100 text-red-800 border border-red-200',
  T2: 'bg-red-50 text-red-700 border border-red-200',
  T3: 'bg-orange-100 text-orange-800 border border-orange-200',
  T4: 'bg-amber-100 text-amber-800 border border-amber-200',
  T5: 'bg-amber-50 text-amber-700 border border-amber-200',
  T6: 'bg-sky-100 text-sky-800 border border-sky-200',
  T7: 'bg-sky-50 text-sky-700 border border-sky-200',
  T8: 'bg-stone-100 text-stone-700 border border-stone-200',
  T9: 'bg-stone-100 text-stone-600 border border-stone-200',
  T10: 'bg-stone-50 text-stone-500 border border-stone-200',
};

const TIER_LABEL = {
  T1: 'Top priority',
  T2: 'Very high',
  T3: 'High',
  T4: 'Elevated',
  T5: 'Moderate',
  T6: 'Standard',
  T7: 'Low',
  T8: 'Lower',
  T9: 'Minimal',
  T10: 'Lowest',
};

export function tierLabel(tier) {
  return TIER_LABEL[tier] || '';
}

export default function TierBadge({ tier, withLabel = false }) {
  if (!tier) return <span className="text-stone-300">—</span>;
  return (
    <span
      className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${
        TIER_STYLES[tier] || 'bg-stone-100 text-stone-600 border border-stone-200'
      }`}
      title={TIER_LABEL[tier] ? `${tier} · ${TIER_LABEL[tier]}` : tier}
    >
      {tier}
      {withLabel && TIER_LABEL[tier] ? ` · ${TIER_LABEL[tier]}` : ''}
    </span>
  );
}
