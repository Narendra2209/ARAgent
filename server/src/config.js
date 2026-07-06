import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the backend's own .env (server/.env)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

// Single source of truth for the fallback / test email address.
const DEFAULT_EMAIL = process.env.CUSTOMER_DEFAULT_EMAIL || 'narendrareddy2209@gmail.com';

export const config = {
  port: Number(process.env.PORT) || 4000,
  useMockData: bool(process.env.USE_MOCK_DATA, true),

  myob: {
    baseUrl: (process.env.MYOB_BASE_URL || '').replace(/\/+$/, ''),
    endpointName: process.env.MYOB_ENDPOINT_NAME || 'Default',
    endpointVersion: process.env.MYOB_ENDPOINT_VERSION || '23.200.001',
    username: process.env.MYOB_USERNAME || '',
    password: process.env.MYOB_PASSWORD || '',
    // Tenant/company login name, appended to the OAuth client id as
    // "<clientId>@<company>" for the MYOB Advanced password grant. Accept the
    // MYOB_BRANCH_COMPANY alias too (both name the login company).
    company: process.env.MYOB_COMPANY || process.env.MYOB_BRANCH_COMPANY || '',
    branch: process.env.MYOB_BRANCH || '',
    // 'oauth2' (client id/secret) or 'cookie' (/entity/auth/login).
    // Defaults to oauth2 when a client id is present.
    authMethod: (
      process.env.MYOB_AUTH_METHOD || (process.env.MYOB_CLIENT_ID ? 'oauth2' : 'cookie')
    ).toLowerCase(),
    clientId: process.env.MYOB_CLIENT_ID || '',
    clientSecret: process.env.MYOB_CLIENT_SECRET || '',
  },

  arAging: {
    strategy: (process.env.AR_AGING_STRATEGY || 'computed').toLowerCase(),
    // Where the dashboard's aged figures come from:
    //   'computed'  = recompute buckets from open invoices (default)
    //   'imported'  = serve MYOB's OWN figures from an imported AR Aging
    //                 (Detailed) .xlsx export, stored in MongoDB — exact match.
    source: (process.env.AR_AGING_SOURCE || 'computed').toLowerCase(),
    giName: process.env.MYOB_GI_NAME || '',
    // Pre-aged AR Aging Summary Generic Inquiry (exposed via OData). When set,
    // the dashboard reads MYOB's OWN per-customer Current / 1-30 / 31-60 / 61-90
    // / 90+ / Balance figures straight through, so the cards match MYOB's AR
    // Aging report exactly instead of recomputing buckets from open invoices.
    agingGi: process.env.MYOB_AGING_GI || '',
    asOfDate: process.env.AR_AS_OF_DATE || '', // YYYY-MM-DD or blank = today
    // Business timezone the aging "today" is computed in, so the as-of date
    // matches MYOB (AEST) no matter where the server runs. IANA name.
    timezone: process.env.AR_TIMEZONE || 'Australia/Sydney',
  },

  customers: {
    // Fallback shown when a customer has no email on file in MYOB.
    defaultEmail: DEFAULT_EMAIL,
  },

  // ---- MongoDB (email log, AR aging snapshots, customer master) ----
  mongo: {
    uri: process.env.MONGODB_URI || '',
    dbName: process.env.MONGODB_DB_NAME || 'ar_agent',
  },

  // ---- Scheduled daily snapshot (external cron pings /api/cron/snapshot) ----
  cron: {
    // Shared secret the scheduler must echo back (header x-cron-secret or
    // ?secret=). Blank = endpoint is open (fine for a private/unknown URL, but
    // set it in production). See .github/workflows/daily-snapshot.yml.
    secret: process.env.CRON_SECRET || '',
  },

  // ---- Authentication (JWT login, admin/user roles) ----
  auth: {
    // Secret used to sign login tokens. CHANGE THIS in production via .env.
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me',
    // How long a login stays valid.
    tokenTtl: process.env.JWT_TTL || '12h',
  },

  // ---- Microsoft Graph (send mail "from Outlook" / Microsoft 365) ----
  graph: {
    tenantId: process.env.GRAPH_TENANT_ID || '',
    clientId: process.env.GRAPH_CLIENT_ID || '',
    clientSecret: process.env.GRAPH_CLIENT_SECRET || '',
    // The mailbox the reminders are sent FROM (a real Microsoft 365 user/shared mailbox).
    sender: process.env.GRAPH_SENDER || '',
  },

  // ---- SMTP (Office 365 / Outlook submission) ----
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  // ---- Overdue reminder emails ----
  mail: {
    // Which transport sends mail: 'graph' (Microsoft Graph) or 'smtp' (SMTP AUTH).
    transport: (process.env.MAIL_TRANSPORT || 'graph').toLowerCase(),
    // testMode=true: send EVERY reminder to testRecipient instead of the customer.
    // Defaults ON so you can't accidentally email real customers while testing.
    testMode: bool(process.env.MAIL_TEST_MODE, true),
    testRecipient: process.env.MAIL_TEST_RECIPIENT || DEFAULT_EMAIL,
    fromName: process.env.MAIL_FROM_NAME || 'Accounts Receivable',
    // Company/sign-off name shown in the email body.
    companyName: process.env.MAIL_COMPANY_NAME || 'Metfold',
    // Replies to the reminder emails are delivered here (Reply-To header).
    replyTo: process.env.MAIL_REPLY_TO || '',
    // Blind-copy every reminder to this address (e.g. an accounts mailbox) so a
    // copy is always retained. Accepts a ';'/',' separated list. Blank = no BCC.
    bcc: process.env.MAIL_BCC || '',
    // Absolute path to a PNG/JPG image embedded at the bottom of every email.
    signatureImagePath: process.env.MAIL_SIGNATURE_IMAGE_PATH || '',
  },

  // ---- Overdue reminder calls (AI voice agent: Vapi + Twilio) ----
  calls: {
    // Master switch. Leave OFF until Vapi + Twilio are wired and tested.
    enabled: bool(process.env.CALLS_ENABLED, false),
    // Which voice-AI provider places the call. Only 'vapi' is implemented today;
    // swap this + callClient.js to move to Bland/Retell without touching callService.
    provider: (process.env.CALLS_PROVIDER || 'vapi').toLowerCase(),
    vapiApiKey: process.env.VAPI_API_KEY || '',
    vapiAssistantId: process.env.VAPI_ASSISTANT_ID || '',
    // The imported Twilio number in Vapi (Phone Numbers → the number's id).
    vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '',
    // testMode=true: call testPhone instead of the real customer. Defaults ON so
    // you can't accidentally cold-call real customers while wiring this up.
    testMode: bool(process.env.CALLS_TEST_MODE, true),
    testPhone: process.env.CALLS_TEST_PHONE || '', // your own mobile, E.164 (+61...)
    // Default country for normalising local numbers to E.164 (AU = +61).
    defaultCountry: (process.env.CALLS_DEFAULT_COUNTRY || 'AU').toUpperCase(),
    // Shared secret Vapi must echo back on the webhook so we can trust the caller.
    webhookSecret: process.env.CALLS_WEBHOOK_SECRET || '',

    // ---- Enterprise guardrails (the Airtel-style dialer rules) ----
    // Calling window in the customer's business timezone (config.arAging.timezone).
    // Real customer calls outside this window are BLOCKED. Bypassed in testMode so
    // you can still test-call your own phone anytime.
    callWindowStart: Number(process.env.CALLS_WINDOW_START) || 9, // 9am
    callWindowEnd: Number(process.env.CALLS_WINDOW_END) || 18, // 6pm (exclusive)
    callWeekdaysOnly: bool(process.env.CALLS_WEEKDAYS_ONLY, true),
    // Anti-harassment: don't call the same customer again within this many days.
    recallCooldownDays: Number(process.env.CALLS_RECALL_COOLDOWN_DAYS) || 3,
  },
};

export function assertCallsConfigured() {
  const missing = [];
  if (!config.calls.vapiApiKey) missing.push('VAPI_API_KEY');
  if (!config.calls.vapiAssistantId) missing.push('VAPI_ASSISTANT_ID');
  if (!config.calls.vapiPhoneNumberId) missing.push('VAPI_PHONE_NUMBER_ID');
  if (config.calls.testMode && !config.calls.testPhone) missing.push('CALLS_TEST_PHONE');
  if (missing.length) {
    throw new Error(
      `Calling agent is not configured. Missing: ${missing.join(', ')}. Set them in server/.env.`
    );
  }
}

export function assertMyobConfigured() {
  const missing = [];
  if (!config.myob.baseUrl) missing.push('MYOB_BASE_URL');
  if (!config.myob.username) missing.push('MYOB_USERNAME');
  if (!config.myob.password) missing.push('MYOB_PASSWORD');
  if (config.myob.authMethod === 'oauth2') {
    if (!config.myob.clientId) missing.push('MYOB_CLIENT_ID');
    if (!config.myob.clientSecret) missing.push('MYOB_CLIENT_SECRET');
  }
  if (missing.length) {
    throw new Error(
      `MYOB is not configured. Missing: ${missing.join(', ')}. ` +
        `Set them in .env, or set USE_MOCK_DATA=true to preview with sample data.`
    );
  }
}
