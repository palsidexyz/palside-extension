/** Headless Chrome over the DevTools protocol for unattended browser checks. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromePath } from './chrome-discovery.mjs';
export { chromePath } from './chrome-discovery.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
export async function until(fn, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await bounded(Promise.resolve().then(fn), label, Math.max(0, deadline - Date.now()));
    if (value) return value;
    await pause(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw Error(`Timed out waiting for ${label} (${timeout} ms)`);
}
export async function bounded(promise, label, timeout = 15_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out waiting for ${label} (${timeout} ms)`)), timeout); })]); }
  finally { clearTimeout(timer); }
}

/**
 * Starts a throwaway headless browser and connects to its browser target.
 * `send(method, params, sessionId)` calls CDP; `listen(fn)` receives every event with its `sessionId`.
 */
export async function launchChrome(executable) {
  // An explicit path wins over CHROME_PATH and never falls back to discovery.
  const browser = await chromePath({ chrome: executable });
  const profile = await mkdtemp(resolve(tmpdir(), 'palside-chrome-'));
  // Headless Chrome on Linux runners reports no hover-capable pointer; checks target a desktop mouse unless a page emulates touch.
  const pointer = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
  const chrome = spawn(browser, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', pointer, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', failure;
  chrome.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-16_000); });
  const exited = new Promise(done => chrome.once('exit', (code, signal) => { failure ??= Error(`Browser exited (code ${code}, signal ${signal})\n${stderr}`); done(); }));
  chrome.once('error', error => { failure = error; });
  const calls = new Map(), listeners = new Set();
  let ws, seq = 0;
  let closing;
  const close = () => closing ??= (async () => {
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => ws?.close()),
      Promise.resolve().then(async () => {
        if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) {
          chrome.kill('SIGTERM');
          await bounded(exited, 'browser termination', 5_000).catch(() => { chrome.kill('SIGKILL'); return bounded(exited, 'browser kill', 5_000); });
        }
      }),
    ]);
    // Helpers may inherit this pipe after the browser exits. It must not keep
    // the checker alive once its owned browser has been reaped.
    outcomes.push(...await Promise.allSettled([Promise.resolve().then(() => chrome.stderr.destroy())]));
    // Browser helper processes can finish profile writes just after the main process exits.
    outcomes.push(...await Promise.allSettled([rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })]));
    const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Chrome cleanup failed');
  })();
  try {
    const port = await until(async () => {
      if (failure) throw failure;
      try {
        const value = Number((await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        return Number.isInteger(value) && value > 0 && value <= 65535 ? value : false;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }, 'browser startup', 30_000);
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(15_000) })).json();
    ws = new WebSocket(webSocketDebuggerUrl);
    await bounded(new Promise((done, reject) => {
      ws.addEventListener('open', done, { once: true });
      ws.addEventListener('error', () => reject(Error('CDP WebSocket connection failed')), { once: true });
      ws.addEventListener('close', () => reject(Error('CDP WebSocket closed before connecting')), { once: true });
    }), 'CDP WebSocket connection');
    ws.addEventListener('close', () => { for (const call of calls.values()) call.reject(failure ?? Error('CDP WebSocket closed')); calls.clear(); });
    ws.addEventListener('error', () => { for (const call of calls.values()) call.reject(Error('CDP WebSocket failed')); calls.clear(); });
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) { for (const listener of listeners) listener(message); return; }
      const call = calls.get(message.id); if (!call) return;
      calls.delete(message.id);
      if (message.error) call.reject(Error(`CDP ${call.method}: ${JSON.stringify(message.error)}`)); else call.resolve(message.result);
    });
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Chrome startup and cleanup failed'); }
    throw error;
  }
  const send = async (method, params = {}, sessionId) => {
    const id = ++seq;
    try {
      return await bounded(new Promise((done, reject) => {
        calls.set(id, { method, resolve: done, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }), `CDP ${method}`, 30_000);
    } finally { calls.delete(id); }
  };
  return { send, listen: listener => { listeners.add(listener); return () => listeners.delete(listener); }, close, get stderr() { return stderr; } };
}
