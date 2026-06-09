import { config } from './config.js';

const transport = (config.mail.transport || 'graph').toLowerCase();
const isSmtp = transport === 'smtp';

const mod = isSmtp
  ? await import('./smtpMailClient.js')
  : await import('./graphMailClient.js');

export const sendMail = mod.sendMail;
export const assertMailConfigured = isSmtp ? mod.assertSmtpConfigured : mod.assertGraphConfigured;
export const checkMailAuth = isSmtp ? mod.checkSmtpAuth : mod.checkGraphAuth;
export const mailTransport = transport;
