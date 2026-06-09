/**
 * Shared retry/backoff helper for the mail transports.
 *
 * Both the SMTP and Graph clients send in tight batches against providers that
 * throttle (Office 365 SMTP: ~30 msg/min; Microsoft Graph: HTTP 429 with a
 * Retry-After header). A throttled message is a *transient* failure — retrying
 * after a short pause usually succeeds — so we centralise that policy here
 * instead of duplicating it per transport. Each transport supplies its own
 * `isTransient` rule (SMTP reply codes vs. Graph HTTP statuses) and, optionally,
 * a `delayForAttempt` (so Graph can honour Retry-After).
 */

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` (which receives the 1-based attempt number), retrying while the error
 * is classified transient. Permanent failures (bad mailbox, auth, 5xx) are
 * re-thrown immediately so we never waste time retrying the hopeless.
 *
 * @param {(attempt:number)=>Promise<any>} fn
 * @param {object}   opts
 * @param {number}   [opts.attempts=3]              total tries (incl. the first)
 * @param {(err:any)=>boolean} opts.isTransient     should this error be retried?
 * @param {(attempt:number, err:any)=>number} [opts.delayForAttempt]  ms to wait before the next try
 * @param {string}   [opts.label]                   context for log lines (e.g. the recipient)
 */
export async function withRetry(
  fn,
  { attempts = 3, isTransient, delayForAttempt, label = '' } = {}
) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts && isTransient?.(err)) {
        const ms = delayForAttempt ? delayForAttempt(attempt, err) : 3000 * attempt;
        console.warn(
          `[mail] transient error${label ? ` ${label}` : ''} ` +
            `(attempt ${attempt}/${attempts}): ${err.message}. Retrying in ${ms}ms`
        );
        await delay(ms);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
