import { unzipSync } from 'fflate';
import { BUCKETS } from './arAgingService.js';

/**
 * Parse a MYOB "AR Aging (Detailed)" Excel export into the same per-customer
 * aged-bucket shape the dashboard uses, so the UI can show MYOB's OWN figures
 * verbatim instead of recomputing them from open invoices.
 *
 * Why a hand-rolled parser: MYOB's .xlsx omits cell-reference (`r`) attributes
 * and ships a non-standard stylesheet, which makes SheetJS and openpyxl throw.
 * We only need sharedStrings + the sheet, read positionally, so we unzip with
 * fflate and walk the row/cell XML ourselves.
 *
 * Export layout (one block per customer):
 *   [CustomerID, CustomerName]                         <- starts a customer
 *   Doc.Type | Ref | CustRef | Branch | DocDate | DueDate | Current | 1-30 | 31-60 | 61-90 | Over90 | Balance
 *   ...one such row per open document...
 * The five bucket columns already hold MYOB's aged amounts (credit memos come
 * through negative), so we just sum them per customer.
 */

// Document types MYOB prints in the "Doc. Type" column of a detail row.
const DOC_TYPES = new Set([
  'Invoice', 'Credit Memo', 'Debit Memo', 'Payment', 'Prepayment',
  'Overpayment', 'Customer Refund', 'Small Credit Write-Off', 'Small Balance Write-Off',
]);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Excel serial date (1900 system) -> YYYY-MM-DD. */
function excelSerialToYmd(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n <= 0) return null;
  // Excel's epoch is 1899-12-30 (accounts for the fictional 1900 leap year).
  const ms = (n - 25569) * 86_400_000; // 25569 = days from 1899-12-30 to 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}

const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Read sharedStrings.xml into an ordered array of plain strings. */
function parseSharedStrings(xml) {
  const out = [];
  // Each <si> is one string; concatenate any nested <t> runs inside it.
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let s = '';
    let t;
    while ((t = tRe.exec(m[1]))) s += decodeXml(t[1]);
    tRe.lastIndex = 0;
    out.push(s);
  }
  return out;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Walk sheet rows positionally, yielding each row as an array of cell values. */
function parseSheetRows(xml, strings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  // Non-greedy attrs so a self-closing styled empty cell (`<c s="3"/>`) matches
  // the `/>` branch instead of greedily swallowing following cells.
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const cells = [];
    let c;
    while ((c = cellRe.exec(r[1]))) {
      const attrs = c[1] || '';
      const inner = c[2] || '';
      const isString = /\bt="s"/.test(attrs);
      const isInline = /\bt="(?:inlineStr|str)"/.test(attrs);
      let val = null;
      const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      if (isInline) {
        const im = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        val = im ? decodeXml(im[1]) : vm ? decodeXml(vm[1]) : null;
      } else if (vm) {
        val = isString ? strings[Number(vm[1])] ?? '' : vm[1];
      }
      cells.push(val);
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Parse the export buffer into a dashboard snapshot:
 * { asOfDate, customers[], totals, kpis, invoiceCount }.
 */
export function parseArAgingDetailXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const dec = new TextDecoder();
  const sheetEntry =
    Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k)) ||
    Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetEntry) throw new Error('Not a valid .xlsx: no worksheet found.');
  const strings = files['xl/sharedStrings.xml']
    ? parseSharedStrings(dec.decode(files['xl/sharedStrings.xml']))
    : [];
  const rows = parseSheetRows(dec.decode(files[sheetEntry]), strings);

  // "Aged On:" serial near the top gives MYOB's report date.
  let asOfDate = null;
  for (const row of rows.slice(0, 12)) {
    const cells = row.map((c) => (c == null ? '' : String(c)));
    const idx = cells.findIndex((c) => /aged on/i.test(c));
    if (idx >= 0) {
      const serial = cells.slice(idx + 1).find((c) => c && Number.isFinite(Number(c)));
      if (serial) asOfDate = excelSerialToYmd(serial);
      break;
    }
  }

  const byCustomer = new Map();
  let current = null;
  let invoiceCount = 0;
  const idRe = /^C\d{3,}$/;

  for (const row of rows) {
    const nonEmpty = row.filter((v) => v != null && v !== '');
    // Customer header: exactly [CustomerID, CustomerName].
    if (
      nonEmpty.length === 2 &&
      typeof nonEmpty[0] === 'string' &&
      idRe.test(String(nonEmpty[0]).trim())
    ) {
      const id = String(nonEmpty[0]).trim();
      if (!byCustomer.has(id)) {
        byCustomer.set(id, {
          customerId: id,
          customerName: String(nonEmpty[1] ?? id),
          current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0,
          total: 0, oldestDays: 0,
        });
      }
      current = byCustomer.get(id);
      continue;
    }
    // Detail row: first cell is a known doc type and the bucket columns exist.
    if (current && row.length >= 12 && typeof row[0] === 'string' && DOC_TYPES.has(row[0].trim())) {
      current.current += num(row[6]);
      current.b1_30 += num(row[7]);
      current.b31_60 += num(row[8]);
      current.b61_90 += num(row[9]);
      current.b90plus += num(row[10]);
      current.total += num(row[11]);
      invoiceCount += 1;
    }
  }

  const customers = [...byCustomer.values()]
    .map((c) => {
      const r = { ...c };
      for (const b of BUCKETS) r[b.key] = round2(r[b.key]);
      r.total = round2(r.total);
      // Estimate oldest-days from the oldest non-empty overdue bucket (drives
      // tier/severity only — the export has no per-customer day count).
      r.oldestDays = r.b90plus ? 120 : r.b61_90 ? 90 : r.b31_60 ? 60 : r.b1_30 ? 30 : 0;
      return r;
    })
    // Drop zero-balance customers MYOB may still list.
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total);

  const totals = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };
  let grandTotal = 0;
  for (const c of customers) {
    for (const b of BUCKETS) totals[b.key] += c[b.key];
    grandTotal += c.total;
  }
  for (const b of BUCKETS) totals[b.key] = round2(totals[b.key]);
  grandTotal = round2(grandTotal);
  const overdue = round2(grandTotal - totals.current);

  return {
    asOfDate,
    customers,
    totals: { ...totals, total: grandTotal },
    kpis: {
      totalReceivables: grandTotal,
      totalOverdue: overdue,
      overduePct: grandTotal ? round2((overdue / grandTotal) * 100) : 0,
      customerCount: customers.length,
      oldestBalanceDays: customers.reduce((m, c) => Math.max(m, c.oldestDays || 0), 0),
    },
    invoiceCount,
  };
}
