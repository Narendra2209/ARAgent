import { config, assertMyobConfigured } from './config.js';
import { myobClient, fieldValue } from './myobClient.js';
import { mockOpenDocuments } from './mockData.js';
import { ArAgingSnapshot } from './models/ArAgingSnapshot.js';
import { EmailLog } from './models/EmailLog.js';
import { isDbConnected } from './db.js';
import { getCustomers } from './customerService.js';

/** Aging buckets, in display order. `max` is inclusive days-overdue upper bound (null = no cap). */
export const BUCKETS = [
  { key: 'current', label: 'Current', max: 0 },
  { key: 'b1_30', label: '1-30', max: 30 },
  { key: 'b31_60', label: '31-60', max: 60 },
  { key: 'b61_90', label: '61-90', max: 90 },
  { key: 'b90plus', label: '90+', max: null },
];

/** Format a Date as a local-time YYYY-MM-DD string (avoids UTC off-by-one). */
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveAsOf() {
  const raw = config.arAging.asOfDate;
  const d = raw ? new Date(`${raw}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(asOf, dueDate) {
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.floor((asOf - due) / 86_400_000);
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
function assignTiers(customers) {
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

// One-time diagnostic: print the full field list of a single Invoice so we can
// find what "branch" is actually called on this MYOB tenant (if anything).
let _loggedInvoiceFields = false;
async function probeInvoiceFieldsOnce() {
  if (_loggedInvoiceFields) return;
  _loggedInvoiceFields = true;
  try {
    const probe = await myobClient.getEntity('Invoice', { $top: 1 });
    const rows = Array.isArray(probe) ? probe : probe?.value ?? [];
    if (!rows[0]) return console.log('[branch-probe] no invoices returned');
    const keys = Object.keys(rows[0]);
    const branchy = keys.filter((k) => /branch|company|site|location|warehouse|division/i.test(k));
    console.log('[branch-probe] Invoice fields:', keys.join(', '));
    console.log('[branch-probe] branch-like fields:', branchy.join(', ') || '(none found)');
  } catch (e) {
    console.warn('[branch-probe] failed:', e.message);
  }
}

async function fetchComputedDocuments() {
  assertMyobConfigured();
  probeInvoiceFieldsOnce(); // fire-and-forget diagnostic (runs once per server start)

  // MYOB Acumatica throttles concurrent API calls, so fetch sequentially.
  // The Invoice entity has no CustomerName field, so names come from Customer.
  // Branch isn't exposed on every tenant's Invoice contract — request it, but
  // fall back to a Branch-less $select if MYOB rejects the field, so the report
  // still loads (branch filtering just stays empty until the field is known).
  const selectWithBranch = 'Type,ReferenceNbr,Customer,Branch,Date,DueDate,Balance,Status';
  const selectNoBranch = 'Type,ReferenceNbr,Customer,Date,DueDate,Balance,Status';
  let data;
  try {
    data = await myobClient.getEntity('Invoice', {
      $filter: "Status eq 'Open'",
      $select: selectWithBranch,
      $top: 5000,
    });
  } catch (err) {
    console.warn('MYOB Invoice $select with Branch failed; retrying without Branch:', err.message);
    data = await myobClient.getEntity('Invoice', {
      $filter: "Status eq 'Open'",
      $select: selectNoBranch,
      $top: 5000,
    });
  }
  const nameMap = await fetchCustomerNameMap();

  const rows = Array.isArray(data) ? data : data?.value ?? [];
  return rows
    .map((r) => {
      const customerId = String(fieldValue(r.Customer) ?? '(unknown)');
      const type = fieldValue(r.Type) || 'Invoice';
      const rawBalance = Number(fieldValue(r.Balance)) || 0;
      // Credit memos reduce the receivable balance.
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
      return {
        customerId: String(customerId),
        customerName: String(pick(r, 'CustomerName', 'AcctName', 'Customer') ?? customerId),
        docType: String(pick(r, 'DocType', 'Type') ?? 'Invoice'),
        refNbr: String(pick(r, 'RefNbr', 'ReferenceNbr') ?? ''),
        branch: String(pick(r, 'Branch', 'BranchID', 'BranchCD') ?? ''),
        date: pick(r, 'DocDate', 'Date') ?? null,
        dueDate: pick(r, 'DueDate', 'Due') ?? null,
        balance: Number(pick(r, 'Balance', 'OpenBalance', 'CuryBalance')) || 0,
      };
    })
    .filter((r) => r.balance !== 0 && r.dueDate);
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

function getOpenDocumentsCached(asOf) {
  const key = ymd(asOf);
  const fresh = _docCache.promise && _docCache.key === key && Date.now() - _docCache.at < DOC_CACHE_TTL_MS;
  if (fresh) return _docCache.promise;
  const promise = fetchOpenDocuments(asOf).catch((err) => {
    // Don't cache a failed fetch — clear it so the next call retries.
    if (_docCache.promise === promise) _docCache = { key: null, at: 0, promise: null };
    throw err;
  });
  _docCache = { key, at: Date.now(), promise };
  return promise;
}

/** Build the AR Aging Summary report from open documents. */
export async function getArAgingSummary({ branch } = {}) {
  const asOf = resolveAsOf();
  const allDocs = await getOpenDocumentsCached(asOf);

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

  // Persist a snapshot only for the unfiltered (all-branches) view — a
  // branch-scoped view would otherwise overwrite the day's full snapshot.
  if (isDbConnected() && !selectedBranch) {
    ArAgingSnapshot.findOneAndUpdate(
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
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
