import { config } from './config.js';
import { myobClient, fieldValue } from './myobClient.js';
import { mockCustomers } from './mockData.js';
import { Customer } from './models/Customer.js';
import { isDbConnected } from './db.js';

/**
 * Pick the phone number to show for a customer, sourced only from the customer's
 * Main Contact in MYOB. The Default endpoint exposes the contact's Phone 1 /
 * Phone 2 slots (each with a *Type tag). We prefer a slot tagged "Cell"/"Mobile"
 * if there is one, otherwise fall back to the first phone on file.
 */
function pickContactPhone(contact) {
  if (!contact) return '';
  const slots = [
    { number: fieldValue(contact.Phone1), type: fieldValue(contact.Phone1Type) },
    { number: fieldValue(contact.Phone2), type: fieldValue(contact.Phone2Type) },
  ].filter((s) => typeof s.number === 'string' && s.number.trim());

  const cell = slots.find((s) => /cell|mobile/i.test(String(s.type ?? '')));
  return (cell?.number ?? slots[0]?.number ?? '').trim();
}

/**
 * Pull customer profiles from MYOB Acumatica. Tries with $expand=MainContact
 * (to pick up the contact's phone numbers, which live under MainContact);
 * falls back to a plain $select if the endpoint version rejects the expand.
 */
async function fetchLiveCustomers() {
  // NOTE: when $select is used alongside $expand, Acumatica only returns the
  // expanded entity if its fields are ALSO named in $select — otherwise
  // MainContact comes back empty and every phone is blank. So we must list the
  // MainContact phone subfields explicitly here.
  const phoneSelect =
    'MainContact/Phone1,MainContact/Phone1Type,MainContact/Phone2,MainContact/Phone2Type';
  let data;
  try {
    data = await myobClient.getEntity('Customer', {
      $select: `CustomerID,CustomerName,Email,CreditLimit,${phoneSelect}`,
      $expand: 'MainContact',
      $top: 5000,
    });
  } catch (err) {
    console.warn('MYOB Customer $expand=MainContact failed; retrying without:', err.message);
    data = await myobClient.getEntity('Customer', {
      $select: 'CustomerID,CustomerName,Email,CreditLimit',
      $top: 5000,
    });
  }

  const rows = Array.isArray(data) ? data : data?.value ?? [];
  return rows.map((r) => {
    const customerId = String(fieldValue(r.CustomerID) ?? '');
    const email = fieldValue(r.Email);
    const phone = pickContactPhone(r.MainContact);
    return {
      customerId,
      customerName: fieldValue(r.CustomerName) || customerId,
      creditLimit: Number(fieldValue(r.CreditLimit)) || 0,
      email: typeof email === 'string' ? email : '',
      phone,
    };
  });
}

function isValidEmail(value) {
  return typeof value === 'string' && value.includes('@') && value.trim().length > 0;
}

/** Apply Mongo overrides + the configured default email; sort by name. */
function decorate(raw, defaultEmail) {
  return raw
    .filter((c) => c.customerId)
    .map((c) => {
      const overrideEmail = isValidEmail(c.emailOverride) ? c.emailOverride.trim() : '';
      const myobEmail = isValidEmail(c.email) ? c.email.trim() : '';
      const finalEmail = overrideEmail || myobEmail;
      return {
        customerId: c.customerId,
        customerName: c.customerName || c.customerId,
        creditLimit: Number(c.creditLimit) || 0,
        phone: c.phoneOverride || c.phone || '',
        email: finalEmail || defaultEmail,
        usingDefaultEmail: !finalEmail,
        hasOverride: Boolean(overrideEmail || c.phoneOverride),
        lastSyncedAt: c.lastSyncedAt || null,
      };
    })
    .sort((a, b) => a.customerName.localeCompare(b.customerName));
}

/** Bulk upsert MYOB rows into Mongo without touching emailOverride/phoneOverride. */
async function upsertMyobIntoCache(raw) {
  if (!isDbConnected() || !raw.length) return;
  const now = new Date();
  const ops = raw
    .filter((c) => c.customerId)
    .map((c) => ({
      updateOne: {
        filter: { customerId: c.customerId },
        update: {
          $set: {
            customerId: c.customerId,
            customerName: c.customerName || c.customerId,
            email: typeof c.email === 'string' ? c.email : '',
            phone: typeof c.phone === 'string' ? c.phone : '',
            creditLimit: Number(c.creditLimit) || 0,
            lastSyncedAt: now,
          },
        },
        upsert: true,
      },
    }));
  await Customer.bulkWrite(ops, { ordered: false });
}

/**
 * Pull fresh data from MYOB and upsert into Mongo. Triggered by the user
 * clicking "Sync from MYOB" (or as a first-run fallback when the cache is empty).
 */
export async function syncCustomersFromMyob() {
  const raw = config.useMockData ? mockCustomers() : await fetchLiveCustomers();
  await upsertMyobIntoCache(raw);
  return { synced: raw.length, syncedAt: new Date().toISOString() };
}

/**
 * Read customers from the Mongo cache (fast). If the cache is empty, do a
 * one-time sync from MYOB so the first page load isn't broken.
 */
export async function getCustomers() {
  const defaultEmail = config.customers.defaultEmail;

  let docs = [];
  let source = 'cache';

  if (isDbConnected()) {
    docs = await Customer.find({}).sort({ customerName: 1 }).lean();
  }

  if (!docs.length) {
    // No cache yet (first run, or DB down) — fall back to live MYOB and warm the cache.
    const raw = config.useMockData ? mockCustomers() : await fetchLiveCustomers();
    docs = raw.map((c) => ({ ...c, emailOverride: '', phoneOverride: '' }));
    source = config.useMockData ? 'mock' : 'live';
    upsertMyobIntoCache(raw).catch((e) =>
      console.warn('Initial Customer cache warm failed:', e.message)
    );
  }

  const customers = decorate(docs, defaultEmail);
  return {
    source,
    defaultEmail,
    count: customers.length,
    customers,
  };
}
