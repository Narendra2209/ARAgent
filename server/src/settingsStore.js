import { Setting } from './models/Setting.js';
import { isDbConnected } from './db.js';

const KEY = 'reminderTiers';
const EMAIL_KEY = 'reminderEmail';

/** Every tier the aging engine can assign (decile ranking → T1..T10). */
export const ALL_TIERS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

/**
 * Which tiers reminder emails are sent to. When nothing has been configured
 * (or the DB is down) we default to ALL tiers — i.e. existing behaviour.
 */
export async function getReminderTiers() {
  if (!isDbConnected()) return { tiers: ALL_TIERS, configured: false };
  const doc = await Setting.findOne({ key: KEY }).lean();
  if (!doc || !Array.isArray(doc.value)) return { tiers: ALL_TIERS, configured: false };
  // Keep canonical order and drop anything unexpected.
  const tiers = ALL_TIERS.filter((t) => doc.value.includes(t));
  return { tiers, configured: true };
}

/** Persist the set of tiers that should receive reminders. */
export async function setReminderTiers(tiers) {
  if (!isDbConnected()) {
    const err = new Error('Database not connected — cannot save settings.');
    err.status = 503;
    throw err;
  }
  const clean = ALL_TIERS.filter((t) => Array.isArray(tiers) && tiers.includes(t));
  await Setting.findOneAndUpdate(
    { key: KEY },
    { $set: { key: KEY, value: clean } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  return { tiers: clean, configured: true };
}

/**
 * The reminder email template (subject + body) the admin set in Settings.
 * Empty strings mean "use the built-in default". Body supports {{placeholders}}.
 */
export async function getReminderEmail() {
  if (!isDbConnected()) return { subject: '', body: '', configured: false };
  const doc = await Setting.findOne({ key: EMAIL_KEY }).lean();
  if (!doc || !doc.value) return { subject: '', body: '', configured: false };
  return {
    subject: doc.value.subject || '',
    body: doc.value.body || '',
    configured: true,
  };
}

export async function setReminderEmail({ subject, body } = {}) {
  if (!isDbConnected()) {
    const err = new Error('Database not connected — cannot save settings.');
    err.status = 503;
    throw err;
  }
  const value = { subject: String(subject || ''), body: String(body || '') };
  await Setting.findOneAndUpdate(
    { key: EMAIL_KEY },
    { $set: { key: EMAIL_KEY, value } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  return { ...value, configured: true };
}
