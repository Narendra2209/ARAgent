import { getToken, clearAuth } from './authStore.js';

/**
 * Single fetch wrapper: attaches the bearer token, parses errors consistently,
 * and on a 401 clears the session so the app falls back to the login page.
 */
async function request(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    clearAuth(); // token missing/expired → bounce to login
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `Request failed (${res.status})`);
  }
  return res;
}

const json = (url, opts) => request(url, opts).then((r) => r.json());

const postJson = (url, payload) =>
  json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// Append ?token= for browser-native loads (img/href) that can't set a header.
function withToken(url) {
  const t = getToken();
  if (!t) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}

// ---------------- Auth ----------------

export const getSetupStatus = () => json('/api/auth/setup-status');
export const registerAdmin = (payload) => postJson('/api/auth/register-admin', payload);
export const login = (payload) => postJson('/api/auth/login', payload);
export const getMe = () => json('/api/auth/me');
export const listUsers = () => json('/api/auth/users');
export const createUserApi = (payload) => postJson('/api/auth/users', payload);
export const deleteUserApi = (id) =>
  json(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------------- AR aging ----------------

export const fetchArAging = (branch, { refresh = false } = {}) => {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (refresh) params.set('refresh', '1');
  const qs = params.toString();
  return json(`/api/ar-aging${qs ? `?${qs}` : ''}`);
};
export const exportCsvUrl = (branch) =>
  withToken(`/api/ar-aging/export.csv${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);
export const fetchHealth = () => json('/api/health');

// Daily AR aging snapshots (one per date) — powers the Status page trend charts.
export const fetchArAgingHistory = () => json('/api/ar-aging/history');

// Upload a MYOB "AR Aging (Detailed)" .xlsx export; the server parses and stores
// it as the dashboard's source of truth. Sent as raw bytes (no multipart).
export const importArAging = (file) =>
  json('/api/ar-aging/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });

export async function fetchEmailLog(limit = 12) {
  const res = await request(`/api/email-log?limit=${limit}`).catch((e) => {
    // 503 (DB down) is surfaced as a soft state, not an error.
    if (/503/.test(e.message)) return null;
    throw e;
  });
  if (!res) return { count: 0, rows: [], dbDown: true };
  return res.json();
}

// ---------------- Invoices ----------------

export const fetchInvoices = (branch) =>
  json(`/api/invoices${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);

// ---------------- Customers ----------------

export const fetchCustomers = () => json('/api/customers');
export const fetchCustomerDetail = (id) =>
  json(`/api/customers/${encodeURIComponent(id)}/detail`);
export const syncCustomers = () => json('/api/customers/sync', { method: 'POST' });
export const updateCustomer = (customerId, { emailOverride, phoneOverride } = {}) =>
  json(`/api/customers/${encodeURIComponent(customerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOverride, phoneOverride }),
  });

// ---------------- Calendar comments ----------------

export async function fetchComments({ from, to, customerId } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (customerId) params.set('customerId', customerId);
  const qs = params.toString();
  const res = await request(`/api/comments${qs ? `?${qs}` : ''}`).catch((e) => {
    if (/503/.test(e.message)) return null; // DB down → soft empty state
    throw e;
  });
  if (!res) return { count: 0, comments: [], dbDown: true };
  return res.json();
}

export const createComment = (payload) => postJson('/api/comments', payload);
export const deleteComment = (id) =>
  json(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------------- Settings ----------------

export const getReminderTiers = () => json('/api/settings/reminder-tiers');
export const saveReminderTiers = (tiers) =>
  json('/api/settings/reminder-tiers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tiers }),
  });

export const getReminderEmail = () => json('/api/settings/reminder-email');
export const saveReminderEmail = ({ subject, body }) =>
  json('/api/settings/reminder-email', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, body }),
  });

// ---------------- Reminders ----------------

export const checkEmailHealth = () => json('/api/reminders/health');

export const sendReminders = ({ testMode, dryRun, customerId, customerName, customerIds } = {}) =>
  postJson('/api/reminders/send', { testMode, dryRun, customerId, customerName, customerIds });

// ---- Email signature image ----

export const signatureImageUrl = (v) =>
  withToken(`/api/reminders/signature/image${v ? `?v=${v}` : ''}`);

export const getSignature = () => json('/api/reminders/signature');
export const removeSignature = () => json('/api/reminders/signature', { method: 'DELETE' });

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadSignature(file) {
  const dataBase64 = await readFileAsDataUrl(file);
  return postJson('/api/reminders/signature', { filename: file.name, dataBase64 });
}
