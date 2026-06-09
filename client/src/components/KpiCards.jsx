import { fmtMoney, fmtNum } from '../format.js';

export default function KpiCards({ kpis }) {
  const cards = [
    { label: 'Total Receivables', value: fmtMoney(kpis.totalReceivables), tone: 'primary' },
    {
      label: 'Total Overdue',
      value: fmtMoney(kpis.totalOverdue),
      sub: `${kpis.overduePct}% of balance`,
      tone: 'danger',
    },
    { label: 'Customers', value: fmtNum(kpis.customerCount), tone: 'neutral' },
    {
      label: 'Oldest Balance',
      value: `${fmtNum(kpis.oldestBalanceDays)} days`,
      sub: 'past due',
      tone: 'warn',
    },
  ];

  return (
    <div className="kpi-grid">
      {cards.map((c) => (
        <div key={c.label} className={`kpi-card kpi-${c.tone}`}>
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value">{c.value}</div>
          {c.sub && <div className="kpi-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
