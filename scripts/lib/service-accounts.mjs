import assert from 'node:assert/strict';
import { endpoints, endpointsById, pathFor } from '../../packages/shared/src/contracts/endpoints.ts';
import { errorBody, matrixErrorBody } from '../../packages/shared/src/contracts/errors.ts';
import { decodeContract } from '../../packages/shared/src/contracts/validation.ts';
import { generateMnemonic, deriveIdentity, createHttpAuth, authorizationHeader } from '../../packages/shared/src/identity.ts';

export function requestDeadline(timeout = 30_000, signal) {
  const deadline = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export async function mediaResponseStatus(response) {
  if (response.ok) decodeContract(endpointsById['media.read'].response.schema, new Uint8Array(await response.arrayBuffer()));
  else decodeContract(errorBody, await response.json());
  return response.status;
}

export function waitUntil(check, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    let running = false, settled = false, lastError;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve();
    }
    const deadline = setTimeout(() => finish(lastError ?? new Error('Timed out waiting for Matrix synchronization')), timeout);
    const poll = setInterval(async () => {
      if (running || settled) return;
      running = true;
      try {
        if (await check()) finish();
      } catch (error) { lastError = error; }
      finally { running = false; }
    }, 100);
  });
}

export function createServiceApi({ base, viewingControl = new Map(), fetcher = fetch }) {
  function jsonBytes(body) { return body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)); }
  async function api(path, { method = 'GET', body, session, secretKey, difficulty, key, expected = 200, headers = {}, rawBase = base, signal: callerSignal } = {}) {
    const controlKey = session?.matrix?.deviceId;
    const control = controlKey ? viewingControl.get(controlKey) ?? { sequence: 0, order: 0 } : undefined;
    if (path === '/viewing' && method === 'POST' && control) { body = { ...body, sequence: ++control.sequence, order: control.order }; viewingControl.set(controlKey, control); }
    let endpoint;
    if (!path.startsWith('/_matrix/')) {
      const url = new URL(path, rawBase);
      endpoint = endpoints.find(candidate => candidate.method === method && new RegExp(`^${candidate.path.replace(/:[A-Za-z][A-Za-z0-9]*/g, '([^/]+)')}$`).test(url.pathname));
      assert.ok(endpoint, `Unspecified endpoint: ${method} ${url.pathname}`);
      const keys = [...endpoint.path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map(match => match[1]);
      const values = url.pathname.match(new RegExp(`^${endpoint.path.replace(/:[A-Za-z][A-Za-z0-9]*/g, '([^/]+)')}$`)).slice(1);
      path = pathFor(endpoint, Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(values[index])])), Object.fromEntries(url.searchParams));
      method = endpoint.method;
      if (expected < 400) { body = decodeContract(endpoint.body.schema, body); decodeContract(endpoint.headers, key ? { 'idempotency-key': key } : {}); }
    }
    const bytes = jsonBytes(body);
    const signal = requestDeadline(30_000, callerSignal);
    const auth = secretKey ? authorizationHeader(await createHttpAuth({ url: `${rawBase}${path}`, method, body: bytes, secretKey, difficulty, signal })) : session ? `Bearer ${session.token}` : undefined;
    signal.throwIfAborted();
    const response = await fetcher(`${rawBase}${path}`, { method, signal, headers: { ...headers, ...(bytes ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: auth } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(bytes ? { body: bytes } : {}) });
    const result = await response.json().catch(error => { signal.throwIfAborted(); if (error instanceof SyntaxError) return {}; throw error; });
    if (path === '/viewing' && method === 'POST' && control && typeof result.order === 'number') control.order = result.order;
    assert.equal(response.status, expected, `${path}: ${result.error ?? result.errcode ?? 'unexpected response'}`);
    return endpoint ? response.ok ? decodeContract(endpoint.response.schema, result) : decodeContract(errorBody, result) : response.ok ? result : decodeContract(matrixErrorBody, result);
  }
  return api;
}

export function createServiceAccounts({ api, extended = false, log = () => {} }) {
  let serviceConfig;
  async function config() { return serviceConfig ??= await api('/config'); }
  function label(name) { return `service-check · ${name}`; }
  let createdAccounts = 0;
  async function createAccount(name, mnemonic = generateMnemonic()) {
    const identity = deriveIdentity(mnemonic);
    // TEST-NET addresses model proxy input only; the real socket remains loopback.
    const source = `192.0.2.${1 + Math.floor(createdAccounts / 3)}`;
    const headers = extended ? { 'X-Palside-Client-IP': source } : {};
    const result = await api('/accounts', { method: 'POST', body: { label: label(name) }, secretKey: identity.secretKey, difficulty: (await config()).signupDifficulty, headers });
    createdAccounts++;
    if (extended && createdAccounts % 3 === 0) {
      const rejected = deriveIdentity(generateMnemonic());
      const error = await api('/accounts', { method: 'POST', body: { label: label('quota-rejected') }, secretKey: rejected.secretKey, difficulty: (await config()).signupDifficulty, headers, expected: 429 });
      assert.equal(error.error, 'RATE_LIMITED');
      assert.ok(error.retryAfterMs > 0 && error.retryAfterMs <= 3_600_000);
      log(`signup: synthetic proxy source ${source} permits three accounts and rejects its fourth with 429 RATE_LIMITED`);
    }
    assert.equal(result.account.id, identity.publicKey);
    return { ...result, mnemonic, identity };
  }
  async function addDevice(account, name) {
    const result = await api('/devices', { method: 'POST', body: { label: label(name) }, secretKey: account.identity.secretKey });
    return { ...result, mnemonic: account.mnemonic, identity: account.identity };
  }
  return { createAccount, addDevice };
}
