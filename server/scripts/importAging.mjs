// One-off importer for a MYOB "AR Aging (Detailed)" .xlsx export.
//   node scripts/importAging.mjs "C:\\path\\to\\AR Aging (2026-06-16).xlsx"
// Parses the file and stores it in MongoDB as the dashboard's source of truth.
import fs from 'node:fs';
import { connectDb, disconnectDb } from '../src/db.js';
import { importArAgingFromBuffer } from '../src/arAgingService.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/importAging.mjs <path-to-AR-Aging.xlsx>');
  process.exit(1);
}

const conn = await connectDb();
if (!conn) {
  console.error('MongoDB not connected (set MONGODB_URI in server/.env).');
  process.exit(1);
}

try {
  const buffer = fs.readFileSync(file);
  const summary = await importArAgingFromBuffer(buffer);
  console.log('Imported AR Aging (Detailed):');
  console.log('  as-of date     :', summary.asOfDate);
  console.log('  customers      :', summary.kpis.customerCount);
  console.log('  total receivab.:', summary.kpis.totalReceivables.toLocaleString());
  console.log('  buckets        :', JSON.stringify(summary.totals));
  console.log('Stored. Set AR_AGING_SOURCE=imported in server/.env to serve it.');
} catch (err) {
  console.error('Import failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
