import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Setting } from './models/Setting.js';
import { isDbConnected } from './db.js';

// The email signature is stored in MongoDB (Setting key 'emailSignature') so it
// survives on a stateless/ephemeral host like AWS Lambda, whose filesystem is
// read-only apart from a per-instance /tmp that isn't shared or persisted.
// A bundled asset and MAIL_SIGNATURE_IMAGE_PATH remain read-only fallbacks.
const SIGNATURE_KEY = 'emailSignature';

// Read-only fallback location: an image shipped in the deployment bundle.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../assets');

export const SIGNATURE_CID = 'signature@reminder';

// Only image types we're happy to embed in an email.
const ALLOWED = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

// undefined = not loaded yet, null = none configured, object = loaded signature.
// A synchronous cache so composeEmail() can stay sync; refreshed by the async
// loadSignature() below (call it once per request/flow before composing mail).
let cached;

function toEntry({ buffer, ext, source, updatedAt }) {
  const e = String(ext || '').toLowerCase() || '.png';
  const contentType = ALLOWED[e] || 'image/png';
  return {
    attachment: {
      filename: `signature${e}`,
      content: buffer,
      contentType,
      cid: SIGNATURE_CID,
      // Force the image to render in the body, not appear as a download.
      contentDisposition: 'inline',
    },
    meta: {
      filename: `signature${e}`,
      size: buffer.length,
      contentType,
      source, // 'db' (uploaded via the app), 'env' (MAIL_SIGNATURE_IMAGE_PATH) or 'bundle'
      updatedAt: updatedAt || new Date().toISOString(),
    },
  };
}

function findBundledFile() {
  for (const ext of Object.keys(ALLOWED)) {
    const p = path.join(ASSETS_DIR, `signature${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadFromDisk(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  const entry = toEntry({ buffer, ext, source, updatedAt: stat.mtime.toISOString() });
  entry.meta.filename = path.basename(filePath);
  return entry;
}

/** Read-only fallbacks used when nothing is stored in the DB. */
function loadFallback() {
  // 1. An explicit env-configured path wins over the bundled default.
  if (config.mail.signatureImagePath) {
    try {
      return loadFromDisk(config.mail.signatureImagePath, 'env');
    } catch (err) {
      console.warn(
        `Signature image not loaded (${config.mail.signatureImagePath}): ${err.message}`
      );
    }
  }
  // 2. Otherwise an image shipped in the bundle (server/assets/signature.*).
  const bundled = findBundledFile();
  if (bundled) {
    try {
      return loadFromDisk(bundled, 'bundle');
    } catch (err) {
      console.warn(`Bundled signature load failed (${bundled}): ${err.message}`);
    }
  }
  return null;
}

/**
 * Populate the in-memory cache from MongoDB (falling back to disk/env). Call
 * this and await it before composing mail or serving the signature routes; the
 * synchronous getters below then read the cache. Safe to call repeatedly.
 */
export async function loadSignature() {
  if (isDbConnected()) {
    try {
      const doc = await Setting.findOne({ key: SIGNATURE_KEY }).lean();
      if (doc?.value?.dataBase64) {
        cached = toEntry({
          buffer: Buffer.from(doc.value.dataBase64, 'base64'),
          ext: doc.value.ext,
          source: 'db',
          updatedAt: doc.value.updatedAt,
        });
        return cached;
      }
      // No DB-stored signature: use a read-only fallback if present.
      cached = loadFallback();
      return cached;
    } catch (err) {
      console.warn(`Signature load from DB failed: ${err.message}`);
    }
  }
  // DB unavailable — best effort from disk/env.
  cached = loadFallback();
  return cached;
}

// Ensure the cache is warm even if a caller forgot to loadSignature() first.
function ensureLoaded() {
  if (cached === undefined) cached = loadFallback();
  return cached;
}

/** The attachment object to hand to nodemailer, or null when no signature is set. */
export function getSignatureAttachment() {
  const s = ensureLoaded();
  return s ? s.attachment : null;
}

/** Lightweight description of the current signature for the client. */
export function getSignatureMeta() {
  const s = ensureLoaded();
  return s ? { configured: true, ...s.meta } : { configured: false };
}

/** The raw bytes + content type, for serving a preview. Null when none is set. */
export function getSignatureImage() {
  const s = ensureLoaded();
  return s ? { content: s.attachment.content, contentType: s.attachment.contentType } : null;
}

/** Persist an uploaded image to MongoDB, replacing any existing signature. */
export async function saveSignature({ buffer, ext }) {
  const e = String(ext || '').toLowerCase();
  if (!ALLOWED[e]) {
    throw new Error('Unsupported image type — use a PNG or JPG.');
  }
  if (!buffer || !buffer.length) {
    throw new Error('Empty image.');
  }
  if (!isDbConnected()) {
    throw new Error('Database not connected — cannot save signature.');
  }
  const value = {
    ext: e,
    contentType: ALLOWED[e],
    dataBase64: Buffer.from(buffer).toString('base64'),
    size: buffer.length,
    updatedAt: new Date().toISOString(),
  };
  await Setting.findOneAndUpdate(
    { key: SIGNATURE_KEY },
    { $set: { key: SIGNATURE_KEY, value } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  cached = toEntry({ buffer, ext: e, source: 'db', updatedAt: value.updatedAt });
  return getSignatureMeta();
}

/** Delete the uploaded signature (reverts to the env/bundled fallback if any). */
export async function clearSignature() {
  if (isDbConnected()) {
    try {
      await Setting.deleteOne({ key: SIGNATURE_KEY });
    } catch (err) {
      console.warn(`Signature delete failed: ${err.message}`);
    }
  }
  cached = loadFallback();
  return getSignatureMeta();
}
