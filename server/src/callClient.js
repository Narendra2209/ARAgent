import { config } from './config.js';

/**
 * Normalise a phone number to E.164 (e.g. +61412345678) so the provider can dial
 * it. Handles the common Australian forms: leading 0 (04.. / 02..), a bare +61,
 * or an already-normalised +.. number. Returns '' when nothing usable is present.
 */
export function toE164(phone, country = config.calls.defaultCountry) {
  if (!phone) return '';
  let s = String(phone).trim().replace(/[\s()\-.]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return /^\+\d{6,15}$/.test(s) ? s : '';
  if (s.startsWith('00')) s = '+' + s.slice(2); // international 00 prefix
  else if (country === 'AU') {
    if (s.startsWith('0')) s = '+61' + s.slice(1); // 04.. → +614..
    else if (s.startsWith('61')) s = '+' + s;
    else s = '+61' + s; // bare local digits
  } else {
    s = '+' + s.replace(/^\+/, '');
  }
  return /^\+\d{6,15}$/.test(s) ? s : '';
}

/**
 * Place one outbound AI call via Vapi. `variables` are injected into the
 * assistant's {{placeholders}} (customerName, overdue, etc.). Returns the
 * provider call id — the join key the end-of-call webhook uses to resolve
 * the CallLog. Throws on any non-2xx so callService can log a 'failed' row.
 */
export async function placeCall({ toPhone, variables }) {
  const c = config.calls;
  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.vapiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistantId: c.vapiAssistantId,
      phoneNumberId: c.vapiPhoneNumberId,
      customer: { number: toPhone },
      assistantOverrides: { variableValues: variables },
    }),
  });
  if (!res.ok) {
    throw new Error(`Vapi call failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { callId: data.id };
}

/** Fail fast at call time if the provider isn't fully configured. */
export { assertCallsConfigured } from './config.js';
export const callProvider = config.calls.provider;
