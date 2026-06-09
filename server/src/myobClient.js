import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { config } from './config.js';

/**
 * Client for the MYOB Acumatica / Advanced contract-based REST API.
 * Supports two auth methods (config.myob.authMethod):
 *   - 'oauth2': OAuth2 Resource-Owner-Password grant against /identity/connect/token
 *               (uses client id/secret + username/password). Sends Bearer tokens.
 *   - 'cookie': session login via POST /entity/auth/login.
 */
class MyobClient {
  constructor() {
    this.jar = new CookieJar();
    this.http = wrapper(
      axios.create({
        baseURL: config.myob.baseUrl,
        jar: this.jar,
        withCredentials: true,
        timeout: 60_000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      })
    );
    this.token = null;
    this.tokenExpiresAt = 0;
    this.loggedIn = false;
  }

  // ---- OAuth2 (Resource Owner Password Credentials) ----
  async getOAuthToken() {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 30_000) return this.token;
    // Dedupe concurrent callers so we only request a single token.
    if (this._tokenPromise) return this._tokenPromise;
    this._tokenPromise = this._requestToken(now).finally(() => {
      this._tokenPromise = null;
    });
    return this._tokenPromise;
  }

  async _requestToken(now) {
    // MYOB Advanced multi-tenant instances require the company appended to the
    // client id for the password grant, i.e. "<clientId>@<Company>".
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientIdForTenant(),
      client_secret: config.myob.clientSecret,
      username: config.myob.username,
      password: config.myob.password,
      scope: 'api offline_access',
    });

    const res = await axios.post(`${config.myob.baseUrl}/identity/connect/token`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      timeout: 60_000,
    });

    this.token = res.data.access_token;
    this.refreshToken = res.data.refresh_token || null;
    this.tokenExpiresAt = now + (Number(res.data.expires_in) || 3600) * 1000;
    return this.token;
  }

  clientIdForTenant() {
    return config.myob.company
      ? `${config.myob.clientId}@${config.myob.company}`
      : config.myob.clientId;
  }

  /**
   * Revoke the current OAuth token to release the MYOB API session/seat.
   * MYOB Advanced limits concurrent API logins, so we revoke after each use.
   */
  async revokeToken() {
    if (config.myob.authMethod !== 'oauth2' || !this.token) return;
    const revoke = async (token, hint) => {
      const body = new URLSearchParams({
        token,
        token_type_hint: hint,
        client_id: this.clientIdForTenant(),
        client_secret: config.myob.clientSecret,
      });
      await axios.post(`${config.myob.baseUrl}/identity/connect/revocation`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30_000,
      });
    };
    try {
      await revoke(this.token, 'access_token');
      if (this.refreshToken) await revoke(this.refreshToken, 'refresh_token');
    } catch {
      /* best effort */
    } finally {
      this.token = null;
      this.refreshToken = null;
      this.tokenExpiresAt = 0;
    }
  }

  // ---- Cookie session login ----
  async cookieLogin() {
    if (this.loggedIn) return;
    const body = { name: config.myob.username, password: config.myob.password };
    if (config.myob.company) body.company = config.myob.company;
    if (config.myob.branch) body.branch = config.myob.branch;
    await this.http.post('/entity/auth/login', body);
    this.loggedIn = true;
  }

  /** Return per-request auth headers, performing whatever login the method needs. */
  async authHeaders() {
    if (config.myob.authMethod === 'oauth2') {
      const token = await this.getOAuthToken();
      return { Authorization: `Bearer ${token}` };
    }
    await this.cookieLogin();
    return {};
  }

  /** Release the MYOB API session (revoke token / log out cookie). */
  async logout() {
    if (config.myob.authMethod === 'oauth2') {
      await this.revokeToken();
      return;
    }
    if (this.loggedIn) {
      try {
        await this.http.post('/entity/auth/logout');
      } catch {
        /* best effort */
      }
      this.loggedIn = false;
    }
  }

  entityUrl(resource) {
    const { endpointName, endpointVersion } = config.myob;
    return `/entity/${endpointName}/${endpointVersion}/${resource}`;
  }

  /**
   * GET with detection of MYOB's "concurrent API logins exceeded" condition,
   * which manifests as a 302 redirect to an HTML error page rather than JSON.
   * On that condition we drop the token and retry once after a short delay.
   */
  async getJson(url, params) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = await this.authHeaders();
      const res = await this.http.get(url, { params, headers });
      const looksLikeHtml =
        typeof res.data === 'string' && /<html|Object moved|Error\.aspx/i.test(res.data);
      if (!looksLikeHtml) return res.data;

      // Session/seat problem: force a fresh token and wait for the seat to free.
      this.token = null;
      this.refreshToken = null;
      this.tokenExpiresAt = 0;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error(
      'MYOB returned a session error (likely the concurrent API login limit). ' +
        'Try again in a moment, or reduce other API usage.'
    );
  }

  /** GET a contract-based REST entity, e.g. getEntity('Invoice', { $filter, $select }). */
  async getEntity(resource, params = {}) {
    return this.getJson(this.entityUrl(resource), params);
  }

  /** GET a Generic Inquiry exposed via OData (returns res.value array). */
  async getOData(giName, params = {}) {
    const company = config.myob.company || 'Company';
    const url = `/OData/${encodeURIComponent(company)}/${encodeURIComponent(giName)}`;
    return this.getJson(url, { $format: 'json', ...params });
  }
}

/** One shared client; tokens/sessions are reused across requests. */
export const myobClient = new MyobClient();

/** Unwrap Acumatica's { value: x } field wrappers (and pass through plain values). */
export function fieldValue(field) {
  if (field === null || field === undefined) return undefined;
  if (typeof field === 'object' && 'value' in field) return field.value;
  return field;
}
