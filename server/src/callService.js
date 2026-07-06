import { config } from './config.js';
import { buildOverdueReminders } from './reminderService.js';
import { placeCall, toE164 } from './callClient.js';
import { CallLog } from './models/CallLog.js';
import { isDbConnected } from './db.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Guardrail #1 — the calling window. Returns { ok, reason } for "is it an
 * acceptable time to ring customers right now?", evaluated in the customer's
 * business timezone (reuses the AR aging timezone, e.g. Australia/Sydney) so it
 * matches when the customer is actually at work — not where the server runs.
 */
export function callingWindowStatus(now = new Date()) {
  const c = config.calls;
  const tz = config.arAging.timezone || 'Australia/Sydney';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value; // 'Mon'..'Sun'
  let hour = Number(parts.find((p) => p.type === 'hour')?.value);
  if (hour === 24) hour = 0; // some ICU builds emit '24' at midnight

  if (c.callWeekdaysOnly && (weekday === 'Sat' || weekday === 'Sun')) {
    return { ok: false, reason: `outside calling days (${weekday}, ${tz})` };
  }
  if (hour < c.callWindowStart || hour >= c.callWindowEnd) {
    return {
      ok: false,
      reason: `outside calling hours (${hour}:00 ${tz}; allowed ${c.callWindowStart}:00–${c.callWindowEnd}:00)`,
    };
  }
  return { ok: true };
}

/**
 * Place AI reminder calls to overdue customers.
 * Deliberately reuses buildOverdueReminders() so calling targets the SAME set
 * (and same tier rules) as the email path — a customer is "call-worthy" exactly
 * when they're "email-worthy".
 *
 * - testMode (default from config): every call goes to config.calls.testPhone
 *   instead of the customer, so you can safely test.
 * - dryRun: resolve the target list and dialled numbers WITHOUT calling.
 * - customerIds / customerId: optional narrowing to a selection.
 * - minOverdueDays: escalation gate — only call customers whose oldest overdue
 *   invoice is at least this many days old (e.g. 90 for the 90+ bucket).
 */
export async function callOverdueReminders({
  testMode,
  dryRun = false,
  customerId,
  customerIds,
  minOverdueDays = 0,
  force = false, // bypass the calling-window + cooldown guardrails (use sparingly)
  calledBy,
} = {}) {
  const tm = testMode ?? config.calls.testMode;
  const { asOfDate, source, reminders } = await buildOverdueReminders();

  let targets = reminders;
  if (Array.isArray(customerIds) && customerIds.length) {
    const wanted = new Set(customerIds);
    targets = targets.filter((r) => wanted.has(r.customerId));
  } else if (customerId) {
    targets = targets.filter((r) => r.customerId === customerId);
  }
  if (minOverdueDays > 0) {
    targets = targets.filter((r) => (r.oldestDays || 0) >= minOverdueDays);
  }

  // Guardrail #1 — calling window. Only gates REAL customer calls; test calls go
  // to your own phone so you can test any time. A dry run just previews targets.
  if (!tm && !dryRun && !force) {
    const win = callingWindowStatus();
    if (!win.ok) {
      return {
        asOfDate,
        source,
        testMode: tm,
        blocked: true,
        reason: win.reason,
        count: targets.length,
        results: [],
      };
    }
  }

  // Guardrail #2 — don't re-call anyone we already rang within the cooldown
  // window. One batched query instead of one-per-customer. Skipped in testMode.
  let recentlyCalled = new Set();
  if (!tm && !force && isDbConnected() && config.calls.recallCooldownDays > 0 && targets.length) {
    const since = new Date(Date.now() - config.calls.recallCooldownDays * DAY_MS);
    const recent = await CallLog.find({
      customerId: { $in: targets.map((t) => t.customerId) },
      testMode: false,
      startedAt: { $gte: since },
      status: { $in: ['initiated', 'completed', 'no-answer'] },
    })
      .select('customerId')
      .lean();
    recentlyCalled = new Set(recent.map((r) => r.customerId));
  }

  const results = [];
  for (const r of targets) {
    const realPhone = toE164(r.customerPhone);
    const recipient = tm ? toE164(config.calls.testPhone) : realPhone;

    const base = {
      customerId: r.customerId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      overdue: r.overdue,
      recipient,
    };

    // No usable number → skip (don't dial a blank/garbage number).
    if (!recipient) {
      results.push({ ...base, status: 'skipped', reason: 'no valid phone number' });
      continue;
    }
    // Guardrail #2 — already rung within the cooldown window → skip.
    if (recentlyCalled.has(r.customerId)) {
      results.push({
        ...base,
        status: 'skipped',
        reason: `already called within ${config.calls.recallCooldownDays}d`,
      });
      continue;
    }
    if (dryRun) {
      results.push({ ...base, status: 'preview' });
      continue;
    }

    let logEntry;
    try {
      const { callId } = await placeCall({
        toPhone: recipient,
        variables: {
          customerName: r.customerName,
          customerId: r.customerId,
          overdue: r.overdue,
          asOfDate,
          companyName: config.mail.companyName,
        },
      });
      logEntry = { ...base, status: 'initiated', callId };
    } catch (err) {
      logEntry = { ...base, status: 'failed', error: err.message };
    }
    results.push(logEntry);

    if (isDbConnected()) {
      CallLog.create({
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        recipient,
        callId: logEntry.callId,
        calledBy: calledBy?.name || calledBy?.email || '',
        calledById: calledBy?.id || '',
        status: logEntry.status,
        error: logEntry.error,
        provider: config.calls.provider,
        testMode: tm,
        overdueAmount: r.overdue,
        asOfDate,
      }).catch((e) => console.warn('CallLog insert failed:', e.message));
    }
  }

  const totalOverdue = round2(targets.reduce((s, r) => s + r.overdue, 0));
  return {
    asOfDate,
    source,
    testMode: tm,
    testPhone: config.calls.testPhone,
    dryRun,
    count: targets.length,
    totalOverdue,
    initiatedCount: results.filter((r) => r.status === 'initiated').length,
    failedCount: results.filter((r) => r.status === 'failed').length,
    skippedCount: results.filter((r) => r.status === 'skipped').length,
    results,
  };
}

/**
 * Resolve a CallLog from the provider's end-of-call webhook payload.
 * Idempotent-ish: matches on callId and folds in the assistant's structured
 * analysis (promise-to-pay, already-paid, dispute) plus transcript/recording.
 */
export async function recordCallWebhook(payload) {
  if (!isDbConnected()) return { ok: false, reason: 'db not connected' };

  // Vapi wraps the event under `message`; be liberal about shape.
  const msg = payload?.message ?? payload ?? {};
  const call = msg.call ?? payload?.call ?? {};
  const callId = call.id ?? msg.callId ?? payload?.callId;
  if (!callId) return { ok: false, reason: 'no callId in payload' };

  const analysis = msg.analysis ?? {};
  const structured = analysis.structuredData ?? {};
  const endedReason = msg.endedReason ?? call.endedReason;

  const status =
    endedReason && /no-?answer|voicemail|busy|failed|customer-did-not-answer/i.test(endedReason)
      ? 'no-answer'
      : 'completed';

  const update = {
    status,
    endedReason,
    outcome: analysis.summary ?? structured.outcome,
    promiseToPayDate: structured.promiseToPayDate,
    claimsAlreadyPaid: structured.claimsAlreadyPaid,
    disputeReason: structured.disputeReason,
    durationSec: msg.durationSeconds ?? call.durationSeconds,
    transcript: msg.transcript,
    recordingUrl: msg.recordingUrl ?? call.recordingUrl,
  };
  // Drop undefined keys so we never overwrite good data with blanks.
  Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

  const doc = await CallLog.findOneAndUpdate({ callId }, { $set: update }, { new: true });
  return { ok: true, matched: Boolean(doc), callId, status };
}
