import { config } from './config.js';
import { getArAgingSummary } from './arAgingService.js';
import { getCustomers } from './customerService.js';
import { sendMail } from './mailClient.js';
import { getReminderTiers, getReminderEmail } from './settingsStore.js';
import { EmailLog } from './models/EmailLog.js';
import { isDbConnected } from './db.js';
import { getSignatureAttachment, SIGNATURE_CID } from './signatureStore.js';

const money = (n) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build the list of customers who are 31+ days overdue, joined with their
 * email on file (falling back to the default email when missing).
 * "31+ days" = the 31-60, 61-90 and 90+ aging buckets.
 */
export async function buildOverdueReminders() {
  const summary = await getArAgingSummary();
  const { customers: profiles } = await getCustomers();
  const profileById = new Map(profiles.map((p) => [p.customerId, p]));

  // Only chase customers whose tier the admin has enabled in Settings.
  const { tiers: enabledTiers } = await getReminderTiers();
  const tierEnabled = new Set(enabledTiers);

  const reminders = summary.customers
    .map((c) => {
      const b31_60 = c.b31_60 || 0;
      const b61_90 = c.b61_90 || 0;
      const b90plus = c.b90plus || 0;
      return {
        customerId: c.customerId,
        customerName: c.customerName,
        tier: c.tier,
        b31_60: round2(b31_60),
        b61_90: round2(b61_90),
        b90plus: round2(b90plus),
        overdue: round2(b31_60 + b61_90 + b90plus),
        total: round2(c.total || 0),
        oldestDays: c.oldestDays || 0,
      };
    })
    .filter((c) => c.overdue > 0)
    .filter((c) => tierEnabled.has(c.tier))
    .map((c) => {
      // AR-aging codes can arrive padded to a fixed width (e.g. "C0016     ")
      // from the summary GI / stored snapshot, while the customer cache keys are
      // trimmed — so normalise before the lookup or every email/phone misses.
      const customerId = String(c.customerId).trim();
      const profile = profileById.get(customerId);
      return {
        ...c,
        customerId,
        // The customer's real email on file; leave blank when none is known
        // (don't substitute the default placeholder address).
        customerEmail: profile?.email || '',
        customerPhone: profile?.phone || '',
        usingDefaultEmail: profile ? profile.usingDefaultEmail : true,
      };
    })
    .sort((a, b) => b.overdue - a.overdue);

  return { asOfDate: summary.asOfDate, source: summary.source, reminders };
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/** Replace {{placeholders}} (with optional surrounding spaces) from `vars`. */
function renderTemplate(str, vars) {
  return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
  );
}

/**
 * Compose the reminder email (subject + HTML body) for one customer.
 * If the admin has saved a custom template in Settings, use it (with
 * {{placeholder}} substitution); otherwise fall back to the built-in default.
 */
export function composeEmail(r, asOfDate, template) {
  const { companyName } = config.mail;

  const signatureHtmlFor = () =>
    getSignatureAttachment()
      ? `<p><img src="cid:${SIGNATURE_CID}" alt="Signature" style="max-width:320px;height:auto"/></p>`
      : '';

  // ---- Custom template path ----
  if (template && (template.subject?.trim() || template.body?.trim())) {
    const vars = {
      customerName: r.customerName,
      customerId: r.customerId,
      overdue: money(r.overdue),
      total: money(r.total),
      asOfDate,
      companyName,
    };
    const subject = renderTemplate(
      template.subject?.trim() || `${companyName}: account reminder`,
      vars
    );
    const bodyHtml = renderTemplate(template.body || '', vars)
      .split('\n')
      .map((line) => (line.trim() === '' ? '<br/>' : `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`))
      .join('');
    const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2933;font-size:14px;line-height:1.5">
    ${bodyHtml}
    ${signatureHtmlFor()}
  </div>`;
    return { subject, html };
  }

  // ---- Built-in default ----
  const subject = `${companyName}: account reminder — ${money(r.overdue)} is past due`;

  const bucketRow = (label, amount) =>
    amount > 0
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7785">${label}</td>` +
        `<td style="padding:4px 0;text-align:right;font-variant-numeric:tabular-nums">${money(
          amount
        )}</td></tr>`
      : '';

  const signatureHtml = getSignatureAttachment()
    ? `<p><img src="cid:${SIGNATURE_CID}" alt="Signature" style="max-width:320px;height:auto"/></p>`
    : '';

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2933;font-size:14px;line-height:1.5">
    <p>Dear ${r.customerName},</p>
    <p>I hope you are doing well.</p>
    <p>
      We would like to inform you that your account currently has an overdue balance of
      <strong>${money(r.overdue)}</strong> pending payment.
    </p>
    <p>
      Kindly review the attached document for details of the outstanding amount and overdue invoices.
    </p>
    <p>
      Please let us know the expected date by which the balance payment will be cleared.
    </p>
    <p>
      If you have already made the payment, please share the payment details for verification.
    </p>
    <p>Thank you for your attention to this matter. We look forward to your response.</p>
    <p>Best regards,<br/>${companyName} — Accounts Receivable</p>
    ${signatureHtml}
    <p style="margin-top:18px;color:#1f2933">
      Our records as of <strong>${asOfDate}</strong> show an overdue balance of
      <strong>${money(r.overdue)}</strong> on your account (<strong>${r.customerId}</strong>).
    </p>
    <table style="border-collapse:collapse;margin:12px 0">
      ${bucketRow('31–60 days', r.b31_60)}
      ${bucketRow('61–90 days', r.b61_90)}
      ${bucketRow('90+ days', r.b90plus)}
      <tr>
        <td style="padding:8px 12px 4px 0;border-top:1px solid #e3e6ea;font-weight:700">Total overdue</td>
        <td style="padding:8px 0 4px;border-top:1px solid #e3e6ea;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${money(
          r.overdue
        )}</td>
      </tr>
    </table>
  </div>`;

  return { subject, html };
}

/**
 * Send overdue reminders.
 * - testMode (default from config): every email goes to config.mail.testRecipient
 *   instead of the customer, so you can safely test.
 * - dryRun: compose everything and return the plan WITHOUT sending.
 */
export async function sendOverdueReminders({
  testMode,
  dryRun = false,
  customerId,
  customerName,
  customerIds,
  sentBy,
} = {}) {
  const tm = testMode ?? config.mail.testMode;
  const testRecipient = config.mail.testRecipient;
  let { asOfDate, source, reminders } = await buildOverdueReminders();
  const template = await getReminderEmail(); // admin-configured format (or empty = default)

  // Optional filter: a list of customer IDs (from per-row checkbox selection)
  // or a single customerId / customerName (legacy single-target form).
  if (Array.isArray(customerIds) && customerIds.length) {
    const wanted = new Set(customerIds);
    reminders = reminders.filter((r) => wanted.has(r.customerId));
  } else if (customerId) {
    reminders = reminders.filter((r) => r.customerId === customerId);
  } else if (customerName) {
    const needle = String(customerName).toLowerCase();
    reminders = reminders.filter((r) => r.customerName.toLowerCase().includes(needle));
  }

  const results = [];
  for (const r of reminders) {
    const recipient = tm ? testRecipient : r.customerEmail;
    const { subject } = composeEmail(r, asOfDate, template);
    const base = {
      customerId: r.customerId,
      customerName: r.customerName,
      overdue: r.overdue,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      usingDefaultEmail: r.usingDefaultEmail,
      recipient,
      subject,
    };

    if (dryRun) {
      results.push({ ...base, status: 'preview' });
      continue;
    }

    let logEntry;
    try {
      const { html } = composeEmail(r, asOfDate, template);
      const signatureAttachment = getSignatureAttachment();
      await sendMail({
        to: recipient,
        subject,
        html,
        replyTo: config.mail.replyTo || undefined,
        bcc: config.mail.bcc || undefined,
        attachments: signatureAttachment ? [signatureAttachment] : undefined,
      });
      logEntry = { ...base, status: 'sent' };
    } catch (err) {
      logEntry = {
        ...base,
        status: 'failed',
        error: err.response?.data?.error?.message ?? err.message,
      };
    }
    results.push(logEntry);

    if (isDbConnected()) {
      EmailLog.create({
        customerId: r.customerId,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        recipient,
        subject,
        sentBy: sentBy?.name || sentBy?.email || '',
        sentById: sentBy?.id || '',
        status: logEntry.status,
        error: logEntry.error,
        transport: config.mail.transport,
        testMode: tm,
        overdueAmount: r.overdue,
        asOfDate,
      }).catch((e) => console.warn('EmailLog insert failed:', e.message));
    }
  }

  const totalOverdue = round2(reminders.reduce((s, r) => s + r.overdue, 0));
  return {
    asOfDate,
    source,
    testMode: tm,
    testRecipient,
    dryRun,
    count: reminders.length,
    totalOverdue,
    sentCount: results.filter((r) => r.status === 'sent').length,
    failedCount: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
