import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Where uploaded signatures live. One file at a time: signature.<ext>.
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
let cached;

function findSavedFile() {
  for (const ext of Object.keys(ALLOWED)) {
    const p = path.join(ASSETS_DIR, `signature${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadFromPath(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ALLOWED[ext] || 'image/png';
  const content = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    attachment: {
      filename: `signature${ext || '.png'}`,
      content,
      contentType,
      cid: SIGNATURE_CID,
      // Force the image to render in the body, not appear as a download.
      contentDisposition: 'inline',
    },
    meta: {
      filename: path.basename(filePath),
      size: content.length,
      contentType,
      source, // 'upload' (from the app) or 'env' (MAIL_SIGNATURE_IMAGE_PATH)
      updatedAt: stat.mtime.toISOString(),
    },
  };
}

function load() {
  if (cached !== undefined) return cached;
  // 1. An image uploaded from the app wins.
  const saved = findSavedFile();
  if (saved) {
    try {
      cached = loadFromPath(saved, 'upload');
      return cached;
    } catch (err) {
      console.warn(`Signature load failed (${saved}): ${err.message}`);
    }
  }
  // 2. Otherwise fall back to the .env-configured path, if any.
  if (config.mail.signatureImagePath) {
    try {
      cached = loadFromPath(config.mail.signatureImagePath, 'env');
      return cached;
    } catch (err) {
      console.warn(
        `Signature image not loaded (${config.mail.signatureImagePath}): ${err.message}`
      );
    }
  }
  cached = null;
  return cached;
}

/** The attachment object to hand to nodemailer, or null when no signature is set. */
export function getSignatureAttachment() {
  const s = load();
  return s ? s.attachment : null;
}

/** Lightweight description of the current signature for the client. */
export function getSignatureMeta() {
  const s = load();
  return s ? { configured: true, ...s.meta } : { configured: false };
}

/** The raw bytes + content type, for serving a preview. Null when none is set. */
export function getSignatureImage() {
  const s = load();
  return s ? { content: s.attachment.content, contentType: s.attachment.contentType } : null;
}

function removeSavedFiles() {
  for (const ext of Object.keys(ALLOWED)) {
    const p = path.join(ASSETS_DIR, `signature${ext}`);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

/** Persist an uploaded image, replacing any existing signature. Returns the new meta. */
export function saveSignature({ buffer, ext }) {
  const e = String(ext || '').toLowerCase();
  if (!ALLOWED[e]) {
    throw new Error('Unsupported image type — use a PNG or JPG.');
  }
  if (!buffer || !buffer.length) {
    throw new Error('Empty image.');
  }
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  removeSavedFiles(); // keep exactly one signature file
  fs.writeFileSync(path.join(ASSETS_DIR, `signature${e}`), buffer);
  cached = undefined; // force a reload on next use
  return getSignatureMeta();
}

/** Delete the uploaded signature (reverts to the .env path if one is configured). */
export function clearSignature() {
  removeSavedFiles();
  cached = undefined; // reload so any .env fallback is re-applied
  return getSignatureMeta();
}
