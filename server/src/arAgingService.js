import { config, assertMyobConfigured } from './config.js';
import { myobClient, fieldValue } from './myobClient.js';
import { mockOpenDocuments } from './mockData.js';
import { ArAgingSnapshot } from './models/ArAgingSnapshot.js';
import { EmailLog } from './models/EmailLog.js';
import { isDbConnected } from './db.js';
import { getCustomers } from './customerService.js';
import { parseArAgingDetailXlsx } from './arAgingImport.js';

/** Aging buckets, in display order. `max` is inclusive days-overdue upper bound (null = no cap). */
export const BUCKETS = [
  { key: 'current', label: 'Current', max: 0 },
  { key: 'b1_30', label: '1-30', max: 30 },
  { key: 'b31_60', label: '31-60', max: 60 },
  { key: 'b61_90', label: '61-90', max: 90 },
  { key: 'b90plus', label: '90+', max: null },
];

/**
 * Parse any date-like value to UTC midnight of its CALENDAR date, ignoring the
 * time and timezone. MYOB returns dates like "2026-06-02T00:00:00+00:00"; we
 * only care about the 2026-06-02 part. Doing all aging math on UTC-midnight
 * calendar dates makes day counts identical no matter what timezone the server
 * runs in (local Windows, UTC on Render, etc.).
 */
function utcMidnight(value) {
  const s = String(value).slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** Format a UTC-midnight Date as YYYY-MM-DD. */
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function resolveAsOf() {
  const raw = config.arAging.asOfDate;
  if (raw) return utcMidnight(raw);
  // "Today" in the business timezone (AEST), so the aging date matches MYOB's
  // report regardless of where the server runs. en-CA formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.arAging.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return utcMidnight(today);
}

function daysBetween(asOf, dueDate) {
  return Math.round((asOf - utcMidnight(dueDate)) / 86_400_000);
}

function bucketForDaysOverdue(days) {
  if (days <= 0) return 'current';
  for (const b of BUCKETS) {
    if (b.max !== null && days <= b.max) return b.key;
  }
  return 'b90plus';
}

const emptyBuckets = () =>
  BUCKETS.reduce((acc, b) => ((acc[b.key] = 0), acc), {});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Collection-priority score for a customer (higher = chase first). Blends two
 * real signals: how much they owe (value) and how badly overdue it is
 * (severity = overdue share × how old, capped at ~120 days).
 */
function priorityScore(c, maxOutstanding) {
  const total = c.total || 0;
  const overdue = total - (c.current || 0);
  const overdueRatio = total > 0 ? Math.max(0, overdue) / total : 0;
  const severity = overdueRatio * Math.min((c.oldestDays || 0) / 120, 1);
  const value = maxOutstanding > 0 ? Math.max(0, total) / maxOutstanding : 0;
  return 0.6 * value + 0.4 * severity;
}

/**
 * Assign each customer a tier T1–T10 by ranking them on collection priority and
 * splitting into deciles — T1 = top 10% (chase first), T10 = bottom 10%.
 * Rank-based (not threshold-based) so it always spreads across all ten tiers
 * regardless of how skewed the book is. Mutates each customer with `.tier`.
 */
export function assignTiers(customers) {
  if (!customers.length) return;
  const maxOutstanding = customers.reduce((m, c) => Math.max(m, Math.abs(c.total || 0)), 0);
  const ranked = customers
    .map((c) => ({ c, score: priorityScore(c, maxOutstanding) }))
    .sort((a, b) => b.score - a.score);
  const n = ranked.length;
  ranked.forEach((entry, i) => {
    const tierNum = Math.min(10, Math.floor((i / n) * 10) + 1);
    entry.c.tier = `T${tierNum}`;
  });
}

/**
 * Aggregate raw open documents into per-customer rows (buckets, total, oldest
 * days) and assign tiers. Shared by the summary and the per-customer detail so
 * a customer's tier is identical in both. Returns { customers, totals,
 * grandTotal, oldestDays }.
 */
function aggregateCustomers(docs, asOf) {
  const byCustomer = new Map();
  const totals = emptyBuckets();
  let grandTotal = 0;
  let oldestDays = 0;

  for (const doc of docs) {
    // AR aging is point-in-time: a document that doesn't exist yet as of the
    // aging date (its document date is after asOf) isn't on the report. MYOB's
    // AR Aging report excludes these; we must too, or post-dated invoices
    // inflate Current.
    if (doc.date && utcMidnight(doc.date) > asOf) continue;

    const raw = doc.dueDate ? daysBetween(asOf, doc.dueDate) : 0;
    const days = Number.isFinite(raw) ? raw : 0;
    const bucket = bucketForDaysOverdue(days);

    if (!byCustomer.has(doc.customerId)) {
      byCustomer.set(doc.customerId, {
        customerId: doc.customerId,
        customerName: doc.customerName,
        branch: doc.branch || '',
        ...emptyBuckets(),
        total: 0,
        oldestDays: 0,
      });
    }
    const c = byCustomer.get(doc.customerId);
    if (!c.branch && doc.branch) c.branch = doc.branch;
    c[bucket] += doc.balance;
    c.total += doc.balance;
    c.oldestDays = Math.max(c.oldestDays, days);

    totals[bucket] += doc.balance;
    grandTotal += doc.balance;
    oldestDays = Math.max(oldestDays, days);
  }

  const customers = [...byCustomer.values()]
    .map((c) => {
      const r = { ...c };
      for (const b of BUCKETS) r[b.key] = round2(r[b.key]);
      r.total = round2(r.total);
      return r;
    })
    .sort((a, b) => b.total - a.total);

  assignTiers(customers);
  for (const b of BUCKETS) totals[b.key] = round2(totals[b.key]);

  return { customers, totals, grandTotal: round2(grandTotal), oldestDays };
}

/**
 * Pull open AR documents from MYOB Acumatica via the contract REST "Invoice"
 * resource and normalize them to { customerId, customerName, dueDate, balance }.
 */
/** Build a CustomerID -> CustomerName lookup from the Customer entity. */
async function fetchCustomerNameMap() {
  const data = await myobClient.getEntity('Customer', {
    $select: 'CustomerID,CustomerName',
    $top: 5000,
  });
  const rows = Array.isArray(data) ? data : data?.value ?? [];
  const map = new Map();
  for (const r of rows) {
    const id = fieldValue(r.CustomerID);
    if (id) map.set(String(id), fieldValue(r.CustomerName) || String(id));
  }
  return map;
}

// Whether this tenant's Invoice contract exposes a Branch field. null = unknown
// (probe with it), true = supported, false = not supported (skip the with-Branch
// request to avoid a guaranteed 500 + retry on every load).
let _invoiceHasBranch = null;

async function fetchComputedDocuments() {
  assertMyobConfigured();

  // MYOB Acumatica throttles concurrent API calls, so fetch sequentially.
  // The Invoice entity has no CustomerName field, so names come from Customer.
  // Branch isn't exposed on every tenant's Invoice contract — request it, but
  // fall back to a Branch-less $select if MYOB rejects the field, so the report
  // still loads (branch filtering just stays empty until the field is known).
  const selectWithBranch = 'Type,ReferenceNbr,Customer,Branch,Date,DueDate,Balance,Status';
  const selectNoBranch = 'Type,ReferenceNbr,Customer,Date,DueDate,Balance,Status';
  // Once we've learned Branch isn't on this tenant's Invoice contract, skip the
  // doomed with-Branch request on every later load — it 500s and only doubles
  // the MYOB round-trips (and the seat pressure) for no benefit.
  let data;
  if (_invoiceHasBranch === false) {
    data = await myobClient.getEntity('Invoice', {
      $filter: "Status eq 'Open'",
      $select: selectNoBranch,
      $top: 5000,
    });
  } else {
    try {
      data = await myobClient.getEntity('Invoice', {
        $filter: "Status eq 'Open'",
        $select: selectWithBranch,
        $top: 5000,
      });
      _invoiceHasBranch = true;
    } catch (err) {
      console.warn('MYOB Invoice $select with Branch failed; retrying without Branch:', err.message);
      _invoiceHasBranch = false;
      data = await myobClient.getEntity('Invoice', {
        $filter: "Status eq 'Open'",
        $select: selectNoBranch,
        $top: 5000,
      });
    }
  }
  const nameMap = await fetchCustomerNameMap();

  const rows = Array.isArray(data) ? data : data?.value ?? [];
  const invoiceDocs = rows
    .map((r) => {
      const customerId = String(fieldValue(r.Customer) ?? '(unknown)');
      const type = fieldValue(r.Type) || 'Invoice';
      const rawBalance = Number(fieldValue(r.Balance)) || 0;
      // Credit memos reduce the receivable balance (matches MYOB's AR Aging
      // report, which carries them negative — verified bucket-for-bucket).
      const balance = /credit/i.test(type) ? -Math.abs(rawBalance) : rawBalance;
      return {
        customerId,
        customerName: nameMap.get(customerId) || customerId,
        docType: type,
        refNbr: fieldValue(r.ReferenceNbr) || '',
        branch: fieldValue(r.Branch) || '',
        date: fieldValue(r.Date) || null,
        dueDate: fieldValue(r.DueDate) || fieldValue(r.Date) || null,
        balance,
      };
    })
    .filter((r) => r.balance !== 0);

  return invoiceDocs;
}

/**
 * Read open AR documents from a Generic Inquiry exposed via OData.
 * The GI is expected to expose columns whose names contain Customer / DueDate /
 * Balance; we match them case-insensitively so a range of GI designs work.
 */
async function fetchODataDocuments() {
  assertMyobConfigured();
  if (!config.arAging.giName) {
    throw new Error('AR_AGING_STRATEGY=odata requires MYOB_GI_NAME to be set in .env');
  }
  const data = await myobClient.getOData(config.arAging.giName);
  const rows = data?.value ?? [];

  const pick = (row, ...candidates) => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const k = keys.find((key) => key.toLowerCase() === c.toLowerCase());
      if (k !== undefined) return row[k];
    }
    // loose contains-match fallback
    for (const c of candidates) {
      const k = keys.find((key) => key.toLowerCase().includes(c.toLowerCase()));
      if (k !== undefined) return row[k];
    }
    return undefined;
  };

  return rows
    .map((r) => {
      const customerId = pick(r, 'CustomerID', 'Customer', 'AcctCD') ?? '(unknown)';
      const docType = String(pick(r, 'DocType', 'Type') ?? 'Invoice');
      // The GI's open-balance (CuryDocBal) comes through positive even for credit
      // memos, so flip those negative to reduce the receivable — same rule as the
      // computed path, which matched MYOB's report bucket-for-bucket.
      const rawBalance = Number(pick(r, 'Balance', 'OpenBalance', 'CuryBalance', 'CuryDocBal')) || 0;
      const balance = /credit/i.test(docType) ? -Math.abs(rawBalance) : rawBalance;
      // Credit memos usually have no due date; fall back to the doc date, and if
      // neither exists they age as Current (matches MYOB, which carries open
      // credits in Current). Don't drop these rows.
      const dueDate = pick(r, 'DueDate', 'Due') ?? pick(r, 'DocDate', 'Date') ?? null;
      return {
        customerId: String(customerId),
        customerName: String(pick(r, 'CustomerName', 'AcctName', 'Customer') ?? customerId),
        docType,
        refNbr: String(pick(r, 'RefNbr', 'ReferenceNbr') ?? ''),
        branch: String(pick(r, 'Branch', 'BranchID', 'BranchCD') ?? ''),
        date: pick(r, 'DocDate', 'Date') ?? null,
        dueDate,
        balance,
      };
    })
    .filter((r) => r.balance !== 0);
}

async function fetchOpenDocuments(asOf) {
  if (config.useMockData) return mockOpenDocuments(asOf);
  // NB: we deliberately reuse one cached token across requests (see myobClient)
  // and only release it on shutdown — MYOB Advanced limits concurrent API
  // logins, so acquiring a fresh session per request exhausts the seat.
  if (config.arAging.strategy === 'odata') return fetchODataDocuments();
  return fetchComputedDocuments();
}

// Short-lived in-memory cache of the open-documents fetch. The dashboard,
// customer detail and invoices screen all need the same MYOB pull; without this
// each screen triggers its own (slow, throttled) round-trip and pages can hang
// waiting on MYOB. One in-flight fetch is shared via the stored promise.
const DOC_CACHE_TTL_MS = 60_000;
let _docCache = { key: null, at: 0, promise: null };

function getOpenDocumentsCached(asOf, { force = false } = {}) {
  const key = ymd(asOf);
  const fresh =
    !force &&
    _docCache.promise &&
    _docCache.key === key &&
    Date.now() - _docCache.at < DOC_CACHE_TTL_MS;
  if (fresh) return _docCache.promise;
  const promise = fetchOpenDocuments(asOf).catch((err) => {
    // Don't cache a failed fetch — clear it so the next call retries.
    if (_docCache.promise === promise) _docCache = { key: null, at: 0, promise: null };
    throw err;
  });
  _docCache = { key, at: Date.now(), promise };
  return promise;
}

// ---------------------------------------------------------------------------
// Straight-through path: read MYOB's OWN pre-aged AR Aging figures from a
// Generic Inquiry (exposed via OData) and pass the per-customer buckets through
// verbatim, so the dashboard equals MYOB's AR Aging report exactly (instead of
// recomputing from open invoices, which can't see MYOB's account-level credit
// application / unreleased adjustments).
// ---------------------------------------------------------------------------

const _norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Candidate column names per bucket, normalized (lowercase, alnum-only). The GI
// builder may name columns various ways; we match the first that exists.
const AGING_GI_COLUMNS = {
  current: ['current', 'agecurrent', 'notdue', 'currentbalance', 'curycurrent', 'bucket0', 'age0'],
  b1_30: ['age1to30', 'days1to30', 'days0to30', '1to30', '0to30', '0030', '0130', 'bucket1', 'overdue1to30', 'curyage1to30', 'agedays0', 'days130'],
  b31_60: ['age31to60', 'days31to60', '31to60', '3160', 'bucket2', 'overdue31to60', 'curyage31to60'],
  b61_90: ['age61to90', 'days61to90', '61to90', '6190', 'bucket3', 'overdue61to90', 'curyage61to90'],
  b90plus: ['ageover90', 'over90', 'days91plus', '91plus', '90plus', '9000', 'bucket4', 'daysover90', 'overdueover90', 'curyageover90', 'age91plus'],
  total: ['balance', 'totalbalance', 'agetotal', 'curybalance', 'openbalance', 'curytotal', 'total'],
};
const AGING_GI_ID = ['customerid', 'customercd', 'acctcd', 'baccountid', 'customer'];
const AGING_GI_NAME = ['customername', 'acctname', 'custname', 'baccountname'];
const AGING_GI_BRANCH = ['branch', 'branchid', 'branchcd', 'branchname'];

/** Resolve, once, which GI column maps to each field we need. Throws a clear
 *  error listing the available columns if a required bucket can't be found. */
function resolveAgingColumns(sampleRow) {
  const keys = Object.keys(sampleRow);
  const byNorm = new Map(keys.map((k) => [_norm(k), k]));
  const matchOne = (cands) => {
    for (const c of cands) if (byNorm.has(c)) return byNorm.get(c);
    return null;
  };
  const map = {};
  for (const field of [...Object.keys(AGING_GI_COLUMNS)]) {
    const col = matchOne(AGING_GI_COLUMNS[field]);
    if (!col) {
      throw new Error(
        `MYOB_AGING_GI "${config.arAging.agingGi}" is missing a column for "${field}". ` +
          `Available columns: ${keys.join(', ')}. Rename the GI column or add it to ` +
          `AGING_GI_COLUMNS in arAgingService.js.`
      );
    }
    map[field] = col;
  }
  map.customerId = matchOne(AGING_GI_ID) || keys[0];
  map.customerName = matchOne(AGING_GI_NAME) || map.customerId;
  map.branch = matchOne(AGING_GI_BRANCH); // optional
  return map;
}

const _num = (v) => {
  if (v == null) return 0;
  const n = Number(String(fieldValue(v)).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Pull the pre-aged GI rows and normalize each into a customer aging row. */
async function fetchAgingGiCustomers() {
  assertMyobConfigured();
  if (!config.arAging.agingGi) {
    throw new Error('MYOB_AGING_GI is not set in .env');
  }
  const data = await myobClient.getOData(config.arAging.agingGi);
  const rows = data?.value ?? [];
  if (!rows.length) return [];

  const col = resolveAgingColumns(rows[0]);
  const customers = rows.map((r) => {
    const buckets = {};
    for (const b of BUCKETS) buckets[b.key] = round2(_num(r[col[b.key]]));
    // Trust the GI's own Balance column; fall back to the bucket sum if absent.
    const total = round2(
      col.total != null && r[col.total] != null
        ? _num(r[col.total])
        : BUCKETS.reduce((s, b) => s + buckets[b.key], 0)
    );
    // The summary GI has no document-level due dates, so estimate "oldest days"
    // from the oldest non-empty overdue bucket (drives severity/tier only).
    const oldestDays =
      buckets.b90plus ? 120 : buckets.b61_90 ? 90 : buckets.b31_60 ? 60 : buckets.b1_30 ? 30 : 0;
    return {
      customerId: String(fieldValue(r[col.customerId]) ?? '(unknown)'),
      customerName: String(fieldValue(r[col.customerName]) ?? fieldValue(r[col.customerId]) ?? ''),
      branch: col.branch ? String(fieldValue(r[col.branch]) ?? '') : '',
      ...buckets,
      total,
      oldestDays,
    };
  });
  // A summary GI may emit a grand-total row and zero-balance customers — drop them.
  return customers.filter((c) => c.total !== 0 && c.customerId && !/^total$/i.test(c.customerId));
}

const _agingCache = { key: null, at: 0, promise: null };
function getAgingGiCustomersCached(asOf, { force = false } = {}) {
  const key = ymd(asOf);
  const fresh =
    !force &&
    _agingCache.promise &&
    _agingCache.key === key &&
    Date.now() - _agingCache.at < DOC_CACHE_TTL_MS;
  if (fresh) return _agingCache.promise;
  const promise = fetchAgingGiCustomers().catch((err) => {
    if (_agingCache.promise === promise) {
      _agingCache.key = null;
      _agingCache.at = 0;
      _agingCache.promise = null;
    }
    throw err;
  });
  _agingCache.key = key;
  _agingCache.at = Date.now();
  _agingCache.promise = promise;
  return promise;
}

/** Upsert the day's AR aging snapshot (unfiltered view only — a branch-scoped
 *  view would otherwise overwrite the day's full snapshot). Fire-and-forget. */
function persistSnapshot(summary) {
  if (!isDbConnected() || summary.selectedBranch) return Promise.resolve();
  return ArAgingSnapshot.findOneAndUpdate(
    { asOfDate: summary.asOfDate },
    {
      $set: {
        asOfDate: summary.asOfDate,
        source: summary.source,
        totalReceivables: summary.kpis.totalReceivables,
        totalOverdue: summary.kpis.totalOverdue,
        overduePct: summary.kpis.overduePct,
        customerCount: summary.kpis.customerCount,
        oldestBalanceDays: summary.kpis.oldestBalanceDays,
        totals: summary.totals,
        customers: summary.customers,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((e) => console.warn('ArAgingSnapshot upsert failed:', e.message));
}

/** Build the AR Aging Summary from MYOB's pre-aged GI (straight-through). */
async function getArAgingSummaryFromGi({ branch, refresh = false } = {}) {
  const asOf = resolveAsOf();
  const allCustomers = await getAgingGiCustomersCached(asOf, { force: refresh });

  const branches = [...new Set(allCustomers.map((c) => c.branch).filter(Boolean))].sort();
  const selectedBranch = branch && branches.includes(branch) ? branch : null;
  const scoped = selectedBranch ? allCustomers.filter((c) => c.branch === selectedBranch) : allCustomers;

  const totals = emptyBuckets();
  let grandTotal = 0;
  for (const c of scoped) {
    for (const b of BUCKETS) totals[b.key] += c[b.key];
    grandTotal += c.total;
  }
  for (const b of BUCKETS) totals[b.key] = round2(totals[b.key]);
  grandTotal = round2(grandTotal);

  const customers = scoped.map((c) => ({ ...c })).sort((a, b) => b.total - a.total);
  assignTiers(customers);
  const overdue = round2(grandTotal - totals.current);
  const oldestDays = customers.reduce((m, c) => Math.max(m, c.oldestDays || 0), 0);

  return {
    asOfDate: ymd(asOf),
    reportFormat: 'Summary',
    source: 'aging-gi',
    buckets: BUCKETS.map(({ key, label }) => ({ key, label })),
    branches,
    selectedBranch,
    customers,
    totals: { ...totals, total: grandTotal },
    kpis: {
      totalReceivables: grandTotal,
      totalOverdue: overdue,
      overduePct: grandTotal ? round2((overdue / grandTotal) * 100) : 0,
      customerCount: customers.length,
      oldestBalanceDays: oldestDays,
    },
  };
}

// ---------------------------------------------------------------------------
// Imported path: serve MYOB's OWN aged figures from an AR Aging (Detailed)
// .xlsx export the user uploaded. Stored in MongoDB as an ArAgingSnapshot with
// source 'imported-xlsx', so the dashboard equals MYOB's report exactly.
// ---------------------------------------------------------------------------

/** Shape a parsed import (or stored snapshot) into the dashboard summary, with
 *  tiers assigned. `parsed` provides { asOfDate, customers, totals, kpis }. */
function buildImportedSummary(parsed) {
  const customers = parsed.customers.map((c) => ({ ...c })).sort((a, b) => b.total - a.total);
  assignTiers(customers);
  return {
    asOfDate: parsed.asOfDate,
    reportFormat: 'Detailed',
    source: 'imported-xlsx',
    buckets: BUCKETS.map(({ key, label }) => ({ key, label })),
    branches: [],
    selectedBranch: null,
    customers,
    totals: parsed.totals,
    kpis: parsed.kpis,
  };
}

/** Parse an uploaded AR Aging (Detailed) .xlsx, upsert it as the day's
 *  snapshot, and return the dashboard summary. */
export async function importArAgingFromBuffer(buffer) {
  if (!isDbConnected()) {
    throw new Error('Cannot save the import: MongoDB is not connected (check MONGODB_URI).');
  }
  const parsed = parseArAgingDetailXlsx(buffer);
  if (!parsed.customers.length) {
    throw new Error(
      'No customer rows found in the file. Make sure it is the MYOB "AR Aging ' +
        '(Detailed)" Excel export.'
    );
  }
  if (!parsed.asOfDate) parsed.asOfDate = ymd(resolveAsOf());
  const summary = buildImportedSummary(parsed);
  await persistSnapshot(summary); // upsert by asOfDate (source = 'imported-xlsx')
  return summary;
}

/** Serve the most recently imported AR Aging snapshot from MongoDB. */
async function getArAgingSummaryFromImport() {
  if (!isDbConnected()) {
    throw new Error(
      'AR_AGING_SOURCE=imported needs MongoDB connected to read the stored ' +
        'AR Aging import. Check MONGODB_URI.'
    );
  }
  const snap = await ArAgingSnapshot.findOne({ source: 'imported-xlsx' })
    .sort({ asOfDate: -1, lastCapturedAt: -1 })
    .lean();
  if (!snap) {
    throw new Error(
      'No imported AR Aging found yet. Upload the MYOB "AR Aging (Detailed)" ' +
        'Excel export (Import button), or set AR_AGING_SOURCE=computed.'
    );
  }
  return buildImportedSummary({
    asOfDate: snap.asOfDate,
    customers: snap.customers || [],
    totals: snap.totals,
    kpis: {
      totalReceivables: snap.totalReceivables,
      totalOverdue: snap.totalOverdue,
      overduePct: snap.overduePct,
      customerCount: snap.customerCount,
      oldestBalanceDays: snap.oldestBalanceDays,
    },
  });
}

/** Build the AR Aging Summary report from open documents. */
export async function getArAgingSummary({ branch, refresh = false } = {}) {
  // Serve MYOB's own imported figures (exact match) when configured to.
  if (config.arAging.source === 'imported') {
    return getArAgingSummaryFromImport();
  }

  // When a pre-aged GI is configured (and we're live, not on mock data), read
  // MYOB's own aged figures so the dashboard matches MYOB's AR Aging report.
  if (config.arAging.agingGi && !config.useMockData) {
    const summary = await getArAgingSummaryFromGi({ branch, refresh });
    persistSnapshot(summary);
    return summary;
  }

  const asOf = resolveAsOf();
  const allDocs = await getOpenDocumentsCached(asOf, { force: refresh });

  // The full set of branches is always reported (so the UI selector stays
  // populated) even when the view is filtered down to one branch.
  const branches = [...new Set(allDocs.map((d) => d.branch).filter(Boolean))].sort();

  const selectedBranch = branch && branches.includes(branch) ? branch : null;
  const docs = selectedBranch ? allDocs.filter((d) => d.branch === selectedBranch) : allDocs;

  const { customers, totals, grandTotal, oldestDays } = aggregateCustomers(docs, asOf);
  const overdue = round2(grandTotal - totals.current);

  const summary = {
    asOfDate: ymd(asOf),
    reportFormat: 'Summary',
    source: config.useMockData ? 'mock' : config.arAging.strategy,
    buckets: BUCKETS.map(({ key, label }) => ({ key, label })),
    branches,
    selectedBranch,
    customers,
    totals: { ...totals, total: round2(grandTotal) },
    kpis: {
      totalReceivables: round2(grandTotal),
      totalOverdue: overdue,
      overduePct: grandTotal ? round2((overdue / grandTotal) * 100) : 0,
      customerCount: customers.length,
      oldestBalanceDays: oldestDays,
    },
  };

  persistSnapshot(summary);
  return summary;
}

/**
 * Full detail for one customer: their open invoices (number, dates, amount,
 * days overdue, bucket), aging buckets, computed tier, and contact info on file.
 */
export async function getCustomerDetail(customerId) {
  const asOf = resolveAsOf();
  const docs = await getOpenDocumentsCached(asOf);
  const idStr = String(customerId);

  // Reuse the shared aggregation so this customer's tier matches the dashboard.
  const { customers } = aggregateCustomers(docs, asOf);
  const customer =
    customers.find((c) => String(c.customerId) === idStr) ||
    { customerId: idStr, customerName: idStr, ...emptyBuckets(), total: 0, oldestDays: 0, tier: null };

  // Invoice-level rows for this customer (kept out of the summary).
  const invoices = docs
    .filter((d) => String(d.customerId) === idStr)
    .map((d) => {
      const raw = d.dueDate ? daysBetween(asOf, d.dueDate) : 0;
      const days = Number.isFinite(raw) ? raw : 0;
      return {
        refNbr: d.refNbr,
        docType: d.docType,
        branch: d.branch || '',
        date: d.date,
        dueDate: d.dueDate,
        balance: round2(d.balance),
        age: days,
        bucket: bucketForDaysOverdue(days),
      };
    })
    .sort((a, b) => b.age - a.age);

  // Contact details from the customer master (best-effort).
  let contact = null;
  try {
    const { customers: profiles } = await getCustomers();
    const p = profiles.find((c) => c.customerId === idStr);
    if (p) {
      customer.customerName = p.customerName || customer.customerName;
      contact = {
        name: p.customerName,
        email: p.email,
        phone: p.phone || '',
        usingDefaultEmail: p.usingDefaultEmail,
        creditLimit: p.creditLimit || 0,
      };
    }
  } catch {
    /* contact is optional — invoices still render */
  }

  // Follow-up history from the email log (most recent first). "Last follow-up"
  // = the latest reminder we sent this customer, including who sent it.
  let followUps = [];
  let lastFollowUp = null;
  if (isDbConnected()) {
    try {
      const rows = await EmailLog.find({ customerId: idStr })
        .sort({ sentAt: -1 })
        .limit(10)
        .lean();
      followUps = rows.map((r) => ({
        sentAt: r.sentAt,
        subject: r.subject,
        status: r.status,
        sentBy: r.sentBy || '',
        recipient: r.recipient,
        testMode: r.testMode,
        overdueAmount: r.overdueAmount,
      }));
      lastFollowUp = followUps[0] || null;
    } catch {
      /* email log is optional — detail still renders */
    }
  }

  return {
    asOfDate: ymd(asOf),
    customer,
    contact,
    invoiceCount: invoices.length,
    invoices,
    lastFollowUp,
    followUps,
  };
}

/**
 * Flat list of every open AR document (invoice-level), with age + bucket.
 * Powers the Invoices screen. Optional branch filter.
 */
export async function getOpenInvoices({ branch } = {}) {
  const asOf = resolveAsOf();
  const allDocs = await getOpenDocumentsCached(asOf);
  const branches = [...new Set(allDocs.map((d) => d.branch).filter(Boolean))].sort();
  const selectedBranch = branch && branches.includes(branch) ? branch : null;
  const docs = selectedBranch ? allDocs.filter((d) => d.branch === selectedBranch) : allDocs;

  const invoices = docs
    .map((d) => {
      const raw = d.dueDate ? daysBetween(asOf, d.dueDate) : 0;
      const days = Number.isFinite(raw) ? raw : 0;
      return {
        refNbr: d.refNbr,
        docType: d.docType,
        customerId: d.customerId,
        customerName: d.customerName,
        branch: d.branch || '',
        date: d.date,
        dueDate: d.dueDate,
        balance: round2(d.balance),
        age: days,
        bucket: bucketForDaysOverdue(days),
      };
    })
    .sort((a, b) => b.age - a.age);

  const total = round2(invoices.reduce((s, i) => s + i.balance, 0));
  return { asOfDate: ymd(asOf), count: invoices.length, total, branches, selectedBranch, invoices };
}

/** Render the summary as CSV (one row per customer + a totals row). */
export function toCsv(summary) {
  const head = ['Customer ID', 'Customer Name', ...BUCKETS.map((b) => b.label), 'Total'];
  const esc = (v) => {
    // Collapse any embedded CR/LF in a field (e.g. a customer name imported with
    // a line break) to a space so it can't shift that row's columns in Excel,
    // then quote whenever the value contains a comma or quote.
    const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.map(esc).join(',')];
  for (const c of summary.customers) {
    lines.push(
      [c.customerId, c.customerName, ...BUCKETS.map((b) => c[b.key]), c.total].map(esc).join(',')
    );
  }
  lines.push(
    ['', 'TOTAL', ...BUCKETS.map((b) => summary.totals[b.key]), summary.totals.total]
      .map(esc)
      .join(',')
  );
  return lines.join('\r\n');
}
