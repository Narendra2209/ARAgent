// Delivery test across multiple customer addresses (gmail, hotmail, company, etc.).
// Sends the REAL reminder (HTML + signature) separately to each address and
// reports what Microsoft 365 accepts/rejects, so you can then check each inbox.
//
// Run from server/:
//   DIAG_TO="a@gmail.com,b@hotmail.com,c@company.com.au" node smtp-diag.js
import { composeEmail } from './src/reminderService.js';
import { getSignatureAttachment } from './src/signatureStore.js';
import { sendMail } from './src/mailClient.js';
import { config } from './src/config.js';

const addresses = (process.env.DIAG_TO || config.mail.testRecipient)
  .split(/[;,]/)
  .map((s) => s.trim())
  .filter(Boolean);

const fakeReminder = {
  customerId: 'C0342',
  customerName: 'Test Customer',
  b31_60: 196.35,
  b61_90: 0,
  b90plus: 0,
  overdue: 196.35,
};
const { subject, html } = composeEmail(fakeReminder, '2026-06-05');
const sig = getSignatureAttachment();

console.log(`Transport: ${config.mail.transport}`);
console.log(`From:      ${config.smtp.from || config.smtp.user}`);
console.log(`Signature: ${sig ? sig.filename : '(none)'}`);
console.log(`Testing ${addresses.length} address(es):\n`);

for (const to of addresses) {
  try {
    await sendMail({ to, subject, html, attachments: sig ? [sig] : undefined });
    console.log(`  ✅ ${to}  -> accepted by Microsoft (check inbox AND spam)`);
  } catch (err) {
    console.log(`  ❌ ${to}  -> ${err.message}`);
  }
}
console.log('\nDone. Now open each mailbox above and check Inbox + Junk/Spam.');
process.exit(0);
