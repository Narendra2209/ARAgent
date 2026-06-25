import axios from 'axios';
import { config } from './config.js';
import { withRetry } from './mailRetry.js';

/**
 * Minimal Microsoft Graph mail client using the OAuth2 client-credentials
 * (app-only) flow. Sends mail "from Outlook" via:
 *   POST https://graph.microsoft.com/v1.0/users/{sender}/sendMail
 *
 * Azure setup required (one time):
 *   1. Register an app in Entra ID (Azure AD) → note Tenant ID, Client ID.
 *   2. Add a client secret → GRAPH_CLIENT_SECRET.
 *   3. API permissions → Microsoft Graph → Application → Mail.Send →
 *      "Grant admin consent".
 *   4. GRAPH_SENDER = a licensed mailbox the app may send as.
 */
let token = null;
let tokenExpiresAt = 0;
// Shared promise for an in-progress token fetch. Concurrent callers (e.g. the
// boot pre-warm and the first page-load health check) piggyback on one request
// instead of each firing its own slow outbound call on a cold instance.
let inFlightToken = null;

/** Which GRAPH_* values are still blank (empty array = fully configured). */
export function missingGraphConfig() {
  const missing = [];
  if (!config.graph.tenantId) missing.push('GRAPH_TENANT_ID');
  if (!config.graph.clientId) missing.push('GRAPH_CLIENT_ID');
  if (!config.graph.clientSecret) missing.push('GRAPH_CLIENT_SECRET');
  if (!config.graph.sender) missing.push('GRAPH_SENDER');
  return missing;
}

export function assertGraphConfigured() {
  const missing = missingGraphConfig();
  if (missing.length) {
    throw new Error(
      `Microsoft Graph is not configured. Missing: ${missing.join(', ')}. ` +
        `Add them to server/.env (see .env.example), or use Preview to inspect the ` +
        `reminders without sending.`
    );
  }
}

/**
 * Verify the credentials by acquiring an app-only token. Proves the tenant ID,
 * client ID and secret are valid; it can't confirm Mail.Send consent (only an
 * actual send does that), so we say so.
 */
export async function checkGraphAuth() {
  const missing = missingGraphConfig();
  if (missing.length) return { configured: false, missing, sender: config.graph.sender || null };
  try {
    await getToken();
    return { configured: true, tokenOk: true, sender: config.graph.sender };
  } catch (err) {
    return {
      configured: true,
      tokenOk: false,
      sender: config.graph.sender,
      error: err.response?.data?.error_description ?? err.message,
    };
  }
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 30_000) return token;
  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const body = new URLSearchParams({
      client_id: config.graph.clientId,
      client_secret: config.graph.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await axios.post(
      `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`,
      body,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // A token fetch normally completes in ~1s. Keep this under the health
        // check's race window (server/src/index.js) so a genuine failure — bad
        // credentials, blocked egress — surfaces as its real error instead of
        // being masked by the outer "timed out" guard.
        timeout: 12_000,
      }
    );

    token = res.data.access_token;
    tokenExpiresAt = Date.now() + (Number(res.data.expires_in) || 3600) * 1000;
    return token;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = null; // clear so a failed fetch can be retried next call
  }
}

/** Split a "a@x.com; b@y.com" string into individual recipient addresses. */
function toRecipients(to) {
  const list = String(to)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (!list.length) throw new Error(`No valid recipient email in "${to}"`);
  return list.map((address) => ({ emailAddress: { address } }));
}

// Microsoft Graph throttles with HTTP 429 (and may 503/504 under load); network
// hiccups surface as axios codes. These are transient — retry them. A 4xx other
// than 429 (e.g. 403 missing Mail.Send consent, 404 bad sender) is permanent.
const GRAPH_TRANSIENT_NET_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'ECONNREFUSED',
  'EAI_AGAIN',
]);

function isTransientGraph(err) {
  const status = err?.response?.status;
  if (status === 429 || status === 503 || status === 504 || status === 500 || status === 502) {
    return true;
  }
  if (err?.code && GRAPH_TRANSIENT_NET_CODES.has(err.code)) return true;
  return false;
}

// Honour Graph's Retry-After header (seconds) when present; otherwise back off
// exponentially. Capped so a hostile header can't stall the batch for minutes.
function graphRetryDelay(attempt, err) {
  const header = err?.response?.headers?.['retry-after'];
  const retryAfterSec = Number(header);
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, 60_000);
  }
  return 3000 * attempt; // 3s, 6s
}

const MAX_SEND_ATTEMPTS = 3;

/** Send a single HTML email as the configured sender. `to` may list several addresses. */
export async function sendMail({ to, subject, html, replyTo, bcc, attachments }) {
  assertGraphConfigured();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    config.graph.sender
  )}/sendMail`;

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: toRecipients(to),
  };
  if (replyTo) {
    message.replyTo = [{ emailAddress: { address: replyTo } }];
  }
  if (bcc) {
    message.bccRecipients = toRecipients(bcc);
  }
  if (attachments?.length) {
    message.attachments = attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content).toString('base64'),
      ...(a.cid ? { contentId: a.cid, isInline: true } : {}),
    }));
  }

  // Retry transient throttling (429 + Retry-After) and network blips so a single
  // customer isn't permanently dropped from the batch. The token is fetched
  // inside the attempt so a just-expired token is refreshed on retry.
  await withRetry(
    async () => {
      const accessToken = await getToken();
      await axios.post(
        url,
        { message, saveToSentItems: true },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        }
      );
    },
    {
      attempts: MAX_SEND_ATTEMPTS,
      isTransient: isTransientGraph,
      delayForAttempt: graphRetryDelay,
      label: `to ${to}`,
    }
  );
}
