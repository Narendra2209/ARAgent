// Standalone SMTP diagnostic — shows the full SMTP conversation with the server.
// Run from server/: node smtp-test.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
console.log(`Testing SMTP for: ${user}`);
console.log(`Password length: ${pass ? pass.length : 0} chars`);
console.log(`Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}\n`);

const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  logger: true,   // verbose log
  debug: true,    // dump SMTP wire conversation
});

try {
  await t.verify();
  console.log('\n✅ SMTP AUTH SUCCESSFUL');
} catch (err) {
  console.log('\n❌ SMTP AUTH FAILED');
  console.log('Code:', err.code);
  console.log('Response:', err.response);
  console.log('Message:', err.message);
}
