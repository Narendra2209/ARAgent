// Diagnostic for a MYOB "AR Aging (Detailed)" .xlsx that won't import.
//   node scripts/diagnoseAging.mjs "C:\\path\\to\\AR Aging.xlsx"
// Dumps the first rows the parser sees so we can spot why no customer rows match.
import fs from 'node:fs';
import { unzipSync } from 'fflate';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/diagnoseAging.mjs <path-to-AR-Aging.xlsx>');
  process.exit(1);
}

// --- minimal copy of the parser's XML walking (kept standalone on purpose) ---
function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}
function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    let s = '', t;
    while ((t = tRe.exec(m[1]))) s += decodeXml(t[1]);
    tRe.lastIndex = 0;
    out.push(s);
  }
  return out;
}
function parseSheetRows(xml, strings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const cells = [];
    let c;
    while ((c = cellRe.exec(r[1]))) {
      const attrs = c[1] || '', inner = c[2] || '';
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

const buffer = fs.readFileSync(file);
const files = unzipSync(new Uint8Array(buffer));
const dec = new TextDecoder();
console.log('Zip entries:', Object.keys(files).filter((k) => k.endsWith('.xml')).join(', '));

const sheetEntry =
  Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k)) ||
  Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
console.log('Sheet entry:', sheetEntry);
const strings = files['xl/sharedStrings.xml']
  ? parseSharedStrings(dec.decode(files['xl/sharedStrings.xml']))
  : [];
const rows = parseSheetRows(dec.decode(files[sheetEntry]), strings);
console.log('Total rows parsed:', rows.length, '\n');

const idRe = /^C\d{3,}$/;
console.log('First 40 rows (index | nNonEmpty | cells):');
rows.slice(0, 40).forEach((row, i) => {
  const nonEmpty = row.filter((v) => v != null && v !== '');
  const headerMatch =
    nonEmpty.length === 2 && typeof nonEmpty[0] === 'string' && idRe.test(String(nonEmpty[0]).trim());
  const tag = headerMatch ? ' <== matches customer-header rule' : '';
  console.log(
    String(i).padStart(3),
    '|', String(nonEmpty.length).padStart(2),
    '|', JSON.stringify(row.map((c) => (c == null ? '' : String(c)))).slice(0, 220) + tag
  );
});

// Show every distinct value that appears as the FIRST cell of any 2-cell row,
// so we can see what the real customer-ID format looks like.
const firstOfTwo = new Set();
for (const row of rows) {
  const ne = row.filter((v) => v != null && v !== '');
  if (ne.length === 2 && typeof ne[0] === 'string') firstOfTwo.add(ne[0].trim());
}
console.log('\nDistinct first-cell values of 2-cell rows (candidate customer IDs):');
console.log([...firstOfTwo].slice(0, 40));
