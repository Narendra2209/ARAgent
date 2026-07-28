import { getArAgingSummary } from './arAgingService.js';
import { getCustomers } from './customerService.js';
import { BRANCH_ORDER, branchForCustomer, MAPPED_CUSTOMER_COUNT } from './branchMap.js';
import { buildXlsx, STYLE } from './xlsxWriter.js';

/**
 * The Branch page: the operations team's branch-split workbook, rebuilt from
 * LIVE data on every request.
 *
 * The split itself is the one thing that can't be live. MYOB's AR feed returns
 * no Branch value on any document for this tenant (`/api/ar-aging` reports
 * `branches: []`), so which customer sits under Sunbury / Melton / Pakenham /
 * Cash Sale is read from branchMap.js — transcribed from the workbook. Every
 * figure below is recomputed from the current aging run and customer master.
 *
 * Column layout, priority bands, and row order all mirror the workbook exactly
 * (verified row-for-row against all 180 rows of the 27 Jul 2026 export).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Unmapped customers land here rather than being dropped off the report. */
export const UNASSIGNED = 'Unassigned';

/**
 * Priority band = the oldest bucket the customer still owes money in. The two
 * middle ranks deliberately share the "URGENT" label (as the workbook does)
 * while still sorting apart, which is why this returns a rank, not just a name.
 */
function rankOf(c) {
  if (c.b90plus > 0) return 0;
  if (c.b61_90 > 0) return 1;
  if (c.b31_60 > 0) return 2;
  if (c.b1_30 > 0) return 3;
  return 4;
}
const PRIORITY_LABEL = ['CRITICAL', 'URGENT', 'URGENT', 'Follow Up', 'Current'];

/** Bands in display order, for the UI's group headers and filter chips. */
export const PRIORITIES = ['CRITICAL', 'URGENT', 'Follow Up', 'Current'];

function buildRow(c, creditLimit) {
  const pastDue = round2(c.b1_30 + c.b31_60 + c.b61_90 + c.b90plus);
  const total = round2(c.total);
  const rank = rankOf(c);
  return {
    priority: PRIORITY_LABEL[rank],
    rank,
    customerId: String(c.customerId).trim(),
    customerName: c.customerName,
    creditLimit: round2(creditLimit),
    current: round2(c.current),
    b1_30: round2(c.b1_30),
    b31_60: round2(c.b31_60),
    b61_90: round2(c.b61_90),
    b90plus: round2(c.b90plus),
    pastDue,
    total,
    // A zero limit means "no limit recorded", not "limit of nothing" — those
    // customers are never flagged, matching the workbook.
    overLimit: creditLimit > 0 && total > creditLimit,
  };
}

/** Workbook row order: worst band first, then biggest past due, then biggest balance. */
function sortRows(rows) {
  return rows.sort(
    (a, b) => a.rank - b.rank || b.pastDue - a.pastDue || b.total - a.total
  );
}

function totalsFor(rows) {
  const sum = (k) => round2(rows.reduce((t, r) => t + r[k], 0));
  return {
    creditLimit: sum('creditLimit'),
    current: sum('current'),
    b1_30: sum('b1_30'),
    b31_60: sum('b31_60'),
    b61_90: sum('b61_90'),
    b90plus: sum('b90plus'),
    pastDue: sum('pastDue'),
    total: sum('total'),
    customerCount: rows.length,
  };
}

/**
 * Pure transform: aged customers + credit limits -> the branch-split report.
 * Kept separate from the fetching so it can be exercised against a captured
 * aging run without touching MYOB.
 *
 * @param customers aged rows from getArAgingSummary()
 * @param limits    Map of trimmed customer code -> credit limit
 */
export function buildSplit({ customers, limits, asOfDate, source }) {
  const groups = new Map(BRANCH_ORDER.map((b) => [b, []]));
  for (const c of customers) {
    const id = String(c.customerId).trim();
    const branch = branchForCustomer(id) ?? UNASSIGNED;
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch).push(buildRow(c, limits.get(id) ?? 0));
  }

  // Keep the workbook's tab order; anything unmapped is appended last so a
  // newly-created customer is visible instead of silently missing.
  const branches = [...groups.entries()]
    .filter(([name, rows]) => rows.length > 0 || name !== UNASSIGNED)
    .map(([name, rows]) => ({
      name,
      customers: sortRows(rows),
      totals: totalsFor(rows),
    }));

  const all = branches.flatMap((b) => b.customers);
  return {
    asOfDate,
    source,
    // Surfaced so the UI can warn when the workbook mapping has drifted from
    // the live customer list rather than quietly under-reporting a branch.
    mappedCustomerCount: MAPPED_CUSTOMER_COUNT,
    unmappedCount: groups.get(UNASSIGNED)?.length ?? 0,
    branches,
    grandTotals: totalsFor(all),
  };
}

/**
 * Live branch split. `refresh` forces a fresh MYOB pull rather than reusing the
 * cached open-document set.
 */
export async function getBranchSplit({ refresh = false } = {}) {
  const summary = await getArAgingSummary({ refresh });

  // Credit limits live on the customer master, not the aging run. Best effort:
  // if the master is unreachable the report still renders with 0 limits (and
  // therefore no over-limit flags) rather than failing outright.
  const limits = new Map();
  try {
    const { customers: profiles } = await getCustomers();
    for (const p of profiles) {
      limits.set(String(p.customerId).trim(), Number(p.creditLimit) || 0);
    }
  } catch {
    /* limits are optional */
  }

  return buildSplit({
    customers: summary.customers,
    limits,
    asOfDate: summary.asOfDate,
    source: summary.source,
  });
}

// ---------------------------------------------------------------------------
// Excel export — same workbook shape as the source file: one sheet per branch,
// a title and summary line, the header row, the customer rows, then a TOTAL row.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-07-28' -> '28 Jul 2026' (the header format the workbook uses). */
function prettyDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Whole dollars with thousand separators, as the summary line shows them. */
const money0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-AU')}`;

const HEADERS = [
  'Priority', 'Code', 'Customer Name', 'Credit Limit', 'Current', '1-30',
  '31-60', '61-90', 'Over 90', 'Past Due ($)', 'Total Balance ($)', 'Over Limit?',
];

const COL_WIDTHS = [11, 10, 46, 13, 13, 12, 12, 12, 12, 14, 16, 11].map((width) => ({ width }));

function sheetForBranch(branch, asOfDate) {
  const { name, customers, totals } = branch;
  const money = (v) => ({ v, s: STYLE.MONEY });
  const totalMoney = (v) => ({ v, s: STYLE.TOTAL_MONEY });

  const rows = [
    [{ v: `${name} — AR Summary (${prettyDate(asOfDate)})`, s: STYLE.TITLE }],
    [
      {
        v:
          `${totals.customerCount} customer${totals.customerCount === 1 ? '' : 's'} · ` +
          `Current ${money0(totals.current)} · Past Due ${money0(totals.pastDue)} · ` +
          `Total ${money0(totals.total)}`,
        s: STYLE.SUBTITLE,
      },
    ],
    HEADERS.map((h) => ({ v: h, s: STYLE.HEADER })),
  ];

  for (const c of customers) {
    rows.push([
      { v: c.priority },
      { v: c.customerId },
      { v: c.customerName },
      money(c.creditLimit),
      money(c.current),
      money(c.b1_30),
      money(c.b31_60),
      money(c.b61_90),
      money(c.b90plus),
      money(c.pastDue),
      money(c.total),
      c.overLimit ? { v: 'OVER', s: STYLE.FLAG } : null,
    ]);
  }

  rows.push([
    null,
    null,
    { v: 'TOTAL', s: STYLE.TOTAL_LABEL },
    totalMoney(totals.creditLimit),
    totalMoney(totals.current),
    totalMoney(totals.b1_30),
    totalMoney(totals.b31_60),
    totalMoney(totals.b61_90),
    totalMoney(totals.b90plus),
    totalMoney(totals.pastDue),
    totalMoney(totals.total),
    { v: '', s: STYLE.TOTAL_LABEL },
  ]);

  return { name, cols: COL_WIDTHS, rows };
}

/** Render the split as an .xlsx Buffer. */
export function buildBranchWorkbook(split) {
  return buildXlsx(split.branches.map((b) => sheetForBranch(b, split.asOfDate)));
}

/** Suggested download name, e.g. Metfold_AR_BranchSplit_2026-07-28.xlsx. */
export function branchWorkbookFilename(split) {
  return `Metfold_AR_BranchSplit_${split.asOfDate}.xlsx`;
}
