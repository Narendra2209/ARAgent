import serverless from 'serverless-http';
import { buildApp, captureDailySnapshot } from './app.js';
import { connectDb, isDbConnected } from './db.js';

// ---------------------------------------------------------------------------
// AWS Lambda entrypoint. Two handlers share one warm container:
//   - handler:     the HTTP API, behind a Lambda Function URL (payload v2.0).
//   - cronHandler: the daily AR snapshot, invoked directly by EventBridge.
//
// Everything module-scoped here is reused across warm invocations, so the
// Express app is built once and the Mongo connection is kept open between
// requests (Mongoose pools it) instead of reconnecting every call.
// ---------------------------------------------------------------------------

const app = buildApp();

// serverless-http adapts Express (req/res) to the Lambda event/response. Mark
// image + binary bodies so responses (e.g. the signature preview) round-trip as
// base64 through the Function URL; JSON and CSV stay as UTF-8 text.
const serverlessHandler = serverless(app, {
  binary: ['image/*', 'application/octet-stream'],
});

/**
 * Ensure Mongo is connected before handling work. connectDb() is idempotent and
 * dedupes concurrent callers, so a warm container reuses the existing pool and a
 * cold one connects once. We never block the whole request on it failing —
 * routes already degrade to 503 when the DB is down.
 */
async function ensureDb() {
  if (isDbConnected()) return;
  try {
    await connectDb();
  } catch (err) {
    console.warn('Lambda DB connect failed (continuing):', err.message);
  }
}

export async function handler(event, context) {
  // Don't wait for the (intentionally long-lived) Mongo socket to go idle before
  // returning the response — otherwise every request would hang to the timeout.
  context.callbackWaitsForEmptyEventLoop = false;
  await ensureDb();
  return serverlessHandler(event, context);
}

/**
 * EventBridge schedule target: capture the daily AR aging snapshot without any
 * HTTP request or login. Mirrors POST /api/cron/snapshot. Throwing on failure
 * lets EventBridge record the error and apply its retry policy.
 */
export async function cronHandler(_event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  await ensureDb();
  if (!isDbConnected()) {
    throw new Error('Database not connected — cannot capture snapshot');
  }
  const result = await captureDailySnapshot();
  return { ok: true, ...result, capturedAt: new Date().toISOString() };
}
