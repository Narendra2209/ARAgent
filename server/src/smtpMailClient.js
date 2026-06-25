import nodemailer from 'nodemailer';
import { config } from './config.js';
import { withRetry } from './mailRetry.js';

/**
 * SMTP mail client for Microsoft 365 / Outlook submission
 * (smtp.office365.com:587 STARTTLS) using a mailbox login.
 *
 * Tenant prerequisite: SMTP AUTH must be enabled for the mailbox:
 *   Set-CASMailbox -Identity <user> -SmtpClientAuthenticationDisabled $false
 */

let transporter = null;

export function missingSmtpConfig() {
  const missing = [];
  if (!config.smtp.host) missing.push('SMTP_HOST');
  if (!config.smtp.port) missing.push('SMTP_PORT');
  if (!config.smtp.user) missing.push('SMTP_USER');
  if (!config.smtp.pass) missing.push('SMTP_PASS');
  return missing;
}

export function assertSmtpConfigured() {
  const missing = missingSmtpConfig();
  if (missing.length) {
    throw new Error(
      `SMTP is not configured. Missing: ${missing.join(', ')}. ` +
        `Add them to server/.env, or use Preview to inspect the reminders without sending.`
    );
  }
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: true,
    auth: { user: config.smtp.user, pass: config.smtp.pass },

    // ---- Office 365 batch-send safety ----
    // Without these, every reminder opened a fresh TLS+AUTH connection and the
    // loop fired as fast as Node could go. Office 365 client submission caps at
    // ~30 messages/minute and throttles rapid parallel connections, so the tail
    // of a batch was being throttled (4.3.2 / 4.4.x) and silently dropped.
    pool: true, // reuse ONE authenticated connection for the whole batch
    maxConnections: 1, // O365 dislikes many parallel client-submission sockets
    maxMessages: 50, // recycle the connection before O365 force-closes it
    rateLimit: 20, // <= the ~30 msg/min cap; nodemailer paces sends for us
    rateDelta: 60_000, // window (ms) the rateLimit applies over
    // connection/greeting timeouts are kept under the health check's race window
    // (server/src/index.js) so a blocked outbound SMTP port — the classic
    // free-tier-host failure — surfaces as a real "connection timeout" error
    // instead of being masked by the outer "timed out" guard. socketTimeout
    // stays generous for the actual (slow) batch sends.
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 60_000,
  });
  return transporter;
}

// Transient SMTP failures worth retrying: 4xx replies, dropped sockets, and the
// various ways Office 365 phrases "you're going too fast". Permanent 5xx
// rejections (bad mailbox, blocked sender) are NOT retried — that's hopeless.
const TRANSIENT_NET_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ESOCKET',
  'ECONNECTION',
  'EDNS',
  'ECONNREFUSED',
]);

function isTransient(err) {
  if (!err) return false;
  if (typeof err.responseCode === 'number' && err.responseCode >= 400 && err.responseCode < 500) {
    return true;
  }
  if (err.code && TRANSIENT_NET_CODES.has(err.code)) return true;
  return /throttl|too many|try again|temporar|server busy|service (not |un)available|4\.\d\.\d/i.test(
    err.message || ''
  );
}

export async function checkSmtpAuth() {
  const missing = missingSmtpConfig();
  if (missing.length) return { configured: false, missing, sender: config.smtp.from || null };
  try {
    await getTransporter().verify();
    return { configured: true, tokenOk: true, sender: config.smtp.from || config.smtp.user };
  } catch (err) {
    return {
      configured: true,
      tokenOk: false,
      sender: config.smtp.from || config.smtp.user,
      error: err.message,
    };
  }
}

function toRecipientList(to) {
  const list = String(to)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (!list.length) throw new Error(`No valid recipient email in "${to}"`);
  return list;
}

const MAX_SEND_ATTEMPTS = 3;

export async function sendMail({ to, subject, html, replyTo, bcc, attachments }) {
  assertSmtpConfigured();
  const from = config.smtp.from || config.smtp.user;
  const fromHeader = config.mail.fromName ? `${config.mail.fromName} <${from}>` : from;
  const toList = toRecipientList(to);

  const message = {
    from: fromHeader,
    to: toList,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
    ...(bcc ? { bcc: toRecipientList(bcc) } : {}),
    ...(attachments?.length ? { attachments } : {}),
  };

  // Retry transient throttling/connection failures so a single customer that
  // Office 365 deferred (rather than permanently rejected) still gets the email.
  await withRetry(
    async () => {
      const info = await getTransporter().sendMail(message);

      // nodemailer does NOT throw when SOME recipients are accepted and others
      // rejected (e.g. the internal BCC is accepted but the external customer is
      // refused). Detect that here so the customer ("to") never silently fails.
      const accepted = (info.accepted || []).map((a) => String(a).toLowerCase());
      const rejected = (info.rejected || []).map((a) => String(a).toLowerCase());
      const toRejected = toList.filter((addr) => !accepted.includes(addr.toLowerCase()));

      console.log(
        `[smtp] to=${toList.join(',')} accepted=[${accepted.join(',')}] ` +
          `rejected=[${rejected.join(',')}] response=${info.response}`
      );

      if (toRejected.length) {
        throw new Error(
          `Customer recipient(s) rejected by the mail server: ${toRejected.join(', ')}. ` +
            `Server response: ${info.response || '(none)'}`
        );
      }
    },
    { attempts: MAX_SEND_ATTEMPTS, isTransient, label: `to ${toList.join(',')}` }
  );
}
