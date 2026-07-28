import { buildApp } from './app.js';
import { config } from './config.js';
import { checkMailAuth } from './mailClient.js';
import { myobClient } from './myobClient.js';
import { connectDb, disconnectDb } from './db.js';

// ---------------------------------------------------------------------------
// Local / long-running Node server entry (npm start / npm run dev).
// The AWS Lambda deployment uses src/lambda.js instead, which mounts the same
// buildApp() without opening a listening socket. Keep the two in sync by only
// ever adding routes in app.js.
// ---------------------------------------------------------------------------

// Fire and forget — app still works if Mongo is unreachable.
connectDb();

// Pre-warm the mail auth token at boot so the first page-load health check finds
// it cached instead of paying a cold outbound auth round-trip. Safe no-op if
// mail isn't configured. The page-load check shares this in-flight fetch.
checkMailAuth().catch(() => {});

// Every route already has its own try/catch, so a rejection escaping to the
// process is always background work — a timer, a stream, a fire-and-forget
// call. Node would nonetheless kill the process for it, which the browser sees
// as ECONNRESET on whatever was in flight and ECONNREFUSED on everything after
// (the dev proxy then reports both as "backend unavailable"). Log loudly and
// stay up. Trade-off: after an uncaughtException the process may hold damaged
// state, so treat these lines in the log as a bug to fix, not as handled.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-guard] Unhandled promise rejection — server kept alive:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal-guard] Uncaught exception — server kept alive:', err);
});

const app = buildApp();

const server = app.listen(config.port, () => {
  console.log(`AR Aging API on http://localhost:${config.port}`);
  console.log(`Mode: ${config.useMockData ? 'MOCK (sample data)' : 'LIVE (MYOB Acumatica)'}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Starting a second instance over a running one. Say so in one line instead
    // of an EADDRINUSE stack trace, which reads like a crash in the old server.
    console.error(
      `Port ${config.port} is already in use — an API instance is still running. ` +
        `Stop it first, or set PORT to a free port in server/.env.`
    );
    process.exit(1);
  }
  throw err;
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
