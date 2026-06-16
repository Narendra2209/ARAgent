import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { config } from './config.js';
import {
  getArAgingSummary,
  toCsv,
  getCustomerDetail,
  getOpenInvoices,
  importArAgingFromBuffer,
} from './arAgingService.js';
import { getCustomers, syncCustomersFromMyob } from './customerService.js';
import { sendOverdueReminders } from './reminderService.js';
import {
  getSignatureMeta,
  getSignatureImage,
  saveSignature,
  clearSignature,
} from './signatureStore.js';
import { assertMailConfigured, checkMailAuth, mailTransport } from './mailClient.js';
import { myobClient } from './myobClient.js';
import { connectDb, disconnectDb, isDbConnected } from './db.js';
import {
  needsSetup,
  registerFirstAdmin,
  login as authLogin,
  createUser,
  listUsers,
  deleteUser,
  requireAuth,
  requireAdmin,
} from './authService.js';
import {
  getReminderTiers,
  setReminderTiers,
  getReminderEmail,
  setReminderEmail,
  ALL_TIERS,
} from './settingsStore.js';
import { EmailLog } from './models/EmailLog.js';
import { ArAgingSnapshot } from './models/ArAgingSnapshot.js';
import { Customer } from './models/Customer.js';
import { Comment } from './models/Comment.js';

// Fire and forget — app still works if Mongo is unreachable.
connectDb();

const app = express();
app.use(cors());
// Limit raised so a base64-encoded signature image fits in the JSON body.
app.use(express.json({ limit: '6mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: config.useMockData ? 'mock' : 'live',
    strategy: config.arAging.strategy,
    myobConfigured: Boolean(config.myob.baseUrl && config.myob.username),
    dbConnected: isDbConnected(),
  });
});

// ============================================================
//  Authentication (public routes) — everything below the guard
//  further down requires a valid login token.
// ============================================================

// Helper to turn thrown {status,message} into a clean JSON response.
const sendAuthError = (res, err) =>
  res.status(err.status || 500).json({ error: err.message || 'Request failed' });

// Is this a brand-new install with no users yet? (drives first-run signup)
app.get('/api/auth/setup-status', async (_req, res) => {
  try {
    res.json({ needsSetup: await needsSetup(), dbConnected: isDbConnected() });
  } catch (err) {
    res.status(500).json({ error: 'Setup check failed', detail: err.message });
  }
});

// First-run only: create the initial admin when no users exist.
app.post('/api/auth/register-admin', async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};
    const user = await registerFirstAdmin({ name, email, password });
    const { token } = await authLogin({ email, password });
    res.status(201).json({ token, user });
  } catch (err) {
    sendAuthError(res, err);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    res.json(await authLogin({ email, password }));
  } catch (err) {
    sendAuthError(res, err);
  }
});

// Who am I? (validates the token)
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- User management (available to any signed-in user) ----
app.get('/api/auth/users', requireAuth, async (_req, res) => {
  try {
    res.json({ users: await listUsers() });
  } catch (err) {
    sendAuthError(res, err);
  }
});

app.post('/api/auth/users', requireAuth, async (req, res) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    res.status(201).json({ user: await createUser({ name, email, password, role }) });
  } catch (err) {
    sendAuthError(res, err);
  }
});

app.delete('/api/auth/users/:id', requireAuth, async (req, res) => {
  try {
    res.json(await deleteUser(req.params.id, req.user.id));
  } catch (err) {
    sendAuthError(res, err);
  }
});

// ============================================================
//  Everything below this line requires authentication.
// ============================================================
app.use('/api', requireAuth);

app.get('/api/email-log', async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const filter = {};
    if (req.query.customerId) filter.customerId = req.query.customerId;
    if (req.query.status) filter.status = req.query.status;
    const rows = await EmailLog.find(filter).sort({ sentAt: -1 }).limit(limit).lean();
    res.json({ count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read email log', detail: err.message });
  }
});

// ---- Calendar comments (user notes pinned to a day) ----
app.get('/api/comments', async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const filter = {};
    if (req.query.customerId) filter.customerId = req.query.customerId;
    // Optional date-range filter (inclusive), e.g. ?from=2026-06-01&to=2026-06-30
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = String(req.query.from);
      if (req.query.to) filter.date.$lte = String(req.query.to);
    }
    const rows = await Comment.find(filter).sort({ date: 1, createdAt: 1 }).limit(1000).lean();
    res.json({ count: rows.length, comments: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read comments', detail: err.message });
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { date, body, type, customerId, customerName } = req.body ?? {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
    }
    if (!body || !String(body).trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    const doc = await Comment.create({
      date: String(date),
      body: String(body).trim(),
      type: type || 'note',
      customerId: customerId || '',
      customerName: customerName || '',
      createdBy: req.user?.name || req.user?.email || '',
      createdById: req.user?.id || '',
    });
    res.status(201).json({ ok: true, comment: doc.toObject() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save comment', detail: err.message });
  }
});

app.delete('/api/comments/:id', async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    await Comment.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment', detail: err.message });
  }
});

app.get('/api/ar-aging/history', async (_req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const rows = await ArAgingSnapshot.find({}, {
      asOfDate: 1, totalReceivables: 1, totalOverdue: 1, overduePct: 1,
      customerCount: 1, oldestBalanceDays: 1, lastCapturedAt: 1,
    })
      .sort({ asOfDate: -1 })
      .limit(180)
      .lean();
    res.json({ count: rows.length, snapshots: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read aging history', detail: err.message });
  }
});

app.get('/api/customers/cached', async (_req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const rows = await Customer.find({}).sort({ customerName: 1 }).lean();
    res.json({ count: rows.length, customers: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read cached customers', detail: err.message });
  }
});

app.patch('/api/customers/:customerId', async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const { customerId } = req.params;
    const { emailOverride, phoneOverride } = req.body ?? {};
    const update = {};
    // null / empty string => clear the override; undefined => leave untouched.
    if (emailOverride !== undefined) update.emailOverride = emailOverride || '';
    if (phoneOverride !== undefined) update.phoneOverride = phoneOverride || '';
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const doc = await Customer.findOneAndUpdate(
      { customerId },
      { $set: { customerId, ...update } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ ok: true, customer: doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update customer', detail: err.message });
  }
});

app.get('/api/ar-aging', async (req, res) => {
  try {
    const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh).toLowerCase());
    const summary = await getArAgingSummary({ branch: req.query.branch, refresh });
    res.json(summary);
  } catch (err) {
    console.error('AR aging fetch failed:', err.response?.data ?? err.message);
    res.status(502).json({
      error: 'Failed to load AR Aging report',
      detail: err.response?.data?.message ?? err.message,
    });
  }
});

// Upload a MYOB "AR Aging (Detailed)" .xlsx; parse it and store it as the
// source of truth for the dashboard. Admin only. The file is sent as raw bytes
// (octet-stream) so we don't need a multipart parser.
app.post(
  '/api/ar-aging/import',
  requireAdmin,
  express.raw({ type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: '50mb' }),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'No file received. Attach the .xlsx export.' });
      }
      const summary = await importArAgingFromBuffer(req.body);
      res.json({
        ok: true,
        asOfDate: summary.asOfDate,
        customerCount: summary.kpis.customerCount,
        totalReceivables: summary.kpis.totalReceivables,
      });
    } catch (err) {
      console.error('AR aging import failed:', err.message);
      res.status(400).json({ error: 'Failed to import AR Aging file', detail: err.message });
    }
  }
);

app.get('/api/invoices', async (req, res) => {
  try {
    res.json(await getOpenInvoices({ branch: req.query.branch }));
  } catch (err) {
    console.error('Invoices fetch failed:', err.response?.data ?? err.message);
    res.status(502).json({
      error: 'Failed to load invoices',
      detail: err.response?.data?.message ?? err.message,
    });
  }
});

app.get('/api/customers', async (_req, res) => {
  try {
    const result = await getCustomers();
    res.json(result);
  } catch (err) {
    console.error('Customer fetch failed:', err.response?.data ?? err.message);
    res.status(502).json({
      error: 'Failed to load customers',
      detail: err.response?.data?.message ?? err.message,
    });
  }
});

app.get('/api/customers/:customerId/detail', async (req, res) => {
  try {
    const detail = await getCustomerDetail(req.params.customerId);
    res.json(detail);
  } catch (err) {
    console.error('Customer detail failed:', err.response?.data ?? err.message);
    res.status(502).json({
      error: 'Failed to load customer detail',
      detail: err.response?.data?.message ?? err.message,
    });
  }
});

app.post('/api/customers/sync', async (_req, res) => {
  try {
    const sync = await syncCustomersFromMyob();
    const result = await getCustomers();
    res.json({ ...result, sync });
  } catch (err) {
    console.error('Customer sync failed:', err.response?.data ?? err.message);
    res.status(502).json({
      error: 'Failed to sync customers from MYOB',
      detail: err.response?.data?.message ?? err.message,
    });
  }
});

// ---- Reminder tier settings (which tiers get reminder emails) ----
app.get('/api/settings/reminder-tiers', async (_req, res) => {
  try {
    const cfg = await getReminderTiers();
    res.json({ ...cfg, allTiers: ALL_TIERS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read tier settings', detail: err.message });
  }
});

app.put('/api/settings/reminder-tiers', async (req, res) => {
  try {
    const cfg = await setReminderTiers(req.body?.tiers);
    res.json({ ...cfg, allTiers: ALL_TIERS });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to save tier settings' });
  }
});

// ---- Reminder email template ----
app.get('/api/settings/reminder-email', async (_req, res) => {
  try {
    res.json(await getReminderEmail());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read email template', detail: err.message });
  }
});

app.put('/api/settings/reminder-email', async (req, res) => {
  try {
    const { subject, body } = req.body ?? {};
    res.json(await setReminderEmail({ subject, body }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to save email template' });
  }
});

app.get('/api/reminders/health', async (_req, res) => {
  try {
    res.json({ transport: mailTransport, ...(await checkMailAuth()) });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed', detail: err.message });
  }
});

// ---- Email signature (uploaded from the app, embedded at the foot of every reminder) ----
app.get('/api/reminders/signature', (_req, res) => {
  res.json(getSignatureMeta());
});

// Raw image bytes, for previewing the current signature in the UI.
app.get('/api/reminders/signature/image', (_req, res) => {
  const img = getSignatureImage();
  if (!img) return res.status(404).json({ error: 'No signature set' });
  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(img.content);
});

app.post('/api/reminders/signature', (req, res) => {
  try {
    const { filename, dataBase64 } = req.body ?? {};
    if (!dataBase64) return res.status(400).json({ error: 'No image data provided' });
    // Accept either a data URL ("data:image/png;base64,…") or raw base64.
    const comma = dataBase64.indexOf(',');
    const raw =
      dataBase64.startsWith('data:') && comma >= 0 ? dataBase64.slice(comma + 1) : dataBase64;
    const buffer = Buffer.from(raw, 'base64');
    const ext = path.extname(filename || '').toLowerCase() || '.png';
    const meta = saveSignature({ buffer, ext });
    res.json(meta);
  } catch (err) {
    res.status(400).json({ error: 'Failed to save signature', detail: err.message });
  }
});

app.delete('/api/reminders/signature', (_req, res) => {
  res.json(clearSignature());
});

app.post('/api/reminders/send', async (req, res) => {
  const { testMode, dryRun = false, customerId, customerName, customerIds } = req.body ?? {};
  try {
    // A real send needs the mail transport configured; a dry run never sends, so allow it.
    if (!dryRun) assertMailConfigured();
    const result = await sendOverdueReminders({
      testMode,
      dryRun,
      customerId,
      customerName,
      customerIds,
      sentBy: req.user,
    });
    res.json(result);
  } catch (err) {
    const notConfigured = /not configured/i.test(err.message ?? '');
    console.error('Send reminders failed:', err.response?.data ?? err.message);
    res.status(notConfigured ? 400 : 502).json({
      error: notConfigured ? 'Email not configured' : 'Failed to send reminders',
      detail: err.response?.data?.error?.message ?? err.message,
    });
  }
});

app.get('/api/ar-aging/export.csv', async (req, res) => {
  try {
    const summary = await getArAgingSummary({ branch: req.query.branch });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ar-aging-summary-${summary.asOfDate}.csv"`
    );
    res.send(toCsv(summary));
  } catch (err) {
    console.error('CSV export failed:', err.response?.data ?? err.message);
    res.status(502).json({ error: 'Failed to export CSV', detail: err.message });
  }
});

const server = app.listen(config.port, () => {
  console.log(`AR Aging API on http://localhost:${config.port}`);
  console.log(`Mode: ${config.useMockData ? 'MOCK (sample data)' : 'LIVE (MYOB Acumatica)'}`);
});

// Release any open MYOB API session on shutdown so we don't leak login seats.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await myobClient.logout();
  } catch {
    /* best effort */
  }
  try {
    await disconnectDb();
  } catch {
    /* best effort */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
