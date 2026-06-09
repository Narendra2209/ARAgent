import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { isDbConnected } from './db.js';
import { User } from './models/User.js';

const SALT_ROUNDS = 10;

/** Are there zero users yet? (Drives the first-run "create admin" flow.) */
export async function needsSetup() {
  if (!isDbConnected()) return false; // can't set up without a DB
  return (await User.countDocuments()) === 0;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw httpError(400, 'Password must be at least 6 characters.');
  }
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Create a user. `role` defaults to 'user'. Throws on duplicate / bad input. */
export async function createUser({ name, email, password, role = 'user' }) {
  if (!isDbConnected()) throw httpError(503, 'Database not connected.');
  if (!name || !String(name).trim()) throw httpError(400, 'Name is required.');
  if (!isValidEmail(email)) throw httpError(400, 'A valid email is required.');
  assertPassword(password);
  if (!['admin', 'user'].includes(role)) throw httpError(400, 'Invalid role.');

  const normalizedEmail = email.trim().toLowerCase();
  const exists = await User.findOne({ email: normalizedEmail });
  if (exists) throw httpError(409, 'A user with that email already exists.');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
    role,
  });
  return user.toPublic();
}

/** First-run only: create the initial admin when no users exist. */
export async function registerFirstAdmin({ name, email, password }) {
  if (!isDbConnected()) throw httpError(503, 'Database not connected.');
  if (!(await needsSetup())) {
    throw httpError(409, 'Setup already completed — an account already exists.');
  }
  return createUser({ name, email, password, role: 'admin' });
}

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, name: user.name, email: user.email },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenTtl }
  );
}

/** Verify credentials and return { token, user }. */
export async function login({ email, password }) {
  if (!isDbConnected()) throw httpError(503, 'Database not connected.');
  if (!isValidEmail(email) || !password) throw httpError(400, 'Email and password are required.');

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  // Same generic message whether the email is unknown or the password is wrong.
  if (!user || !user.active) throw httpError(401, 'Invalid email or password.');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw httpError(401, 'Invalid email or password.');

  user.lastLoginAt = new Date();
  await user.save();
  return { token: signToken(user), user: user.toPublic() };
}

export async function listUsers() {
  if (!isDbConnected()) throw httpError(503, 'Database not connected.');
  const users = await User.find({}).sort({ createdAt: -1 });
  return users.map((u) => u.toPublic());
}

export async function deleteUser(id, requesterId) {
  if (!isDbConnected()) throw httpError(503, 'Database not connected.');
  if (id === requesterId) throw httpError(400, 'You cannot delete your own account.');
  const user = await User.findById(id).catch(() => null);
  if (!user) throw httpError(404, 'User not found.');
  // Don't allow removing the last admin.
  if (user.role === 'admin') {
    const admins = await User.countDocuments({ role: 'admin' });
    if (admins <= 1) throw httpError(400, 'Cannot delete the last admin.');
  }
  await user.deleteOne();
  return { ok: true };
}

// ---- Express middleware ----

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  // Fallback for browser-native loads that can't set a header — the CSV export
  // <a href> and the signature <img src>. Token passed as ?token=…
  if (typeof req.query?.token === 'string' && req.query.token) return req.query.token;
  return null;
}

/** Require a valid login. Attaches req.user = { id, role, name, email }. */
export function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    req.user = { id: payload.sub, role: payload.role, name: payload.name, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

/** Require an admin (must be used after requireAuth). */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}
