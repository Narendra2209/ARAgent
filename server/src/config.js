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
    giName: process.env.MYOB_GI_NAME || '',
    asOfDate: process.env.AR_AS_OF_DATE || '', // YYYY-MM-DD or blank = today
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
};

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
