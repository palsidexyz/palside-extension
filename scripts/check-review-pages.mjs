/**
 * Opens every review page in `apps/extension/integration` (except the live-services `index.html`) in headless Chrome.
 * A page fails on an uncaught exception, a console or network error, a request leaving the review server,
 * `data-review="failed"`, a self-check that never passes, or a critical/serious axe violation.
 * Usage: node scripts/check-review-pages.mjs [filter]
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { bounded, launchChrome, until } from './lib/headless-chrome.mjs';
import { chromePath } from './lib/chrome-discovery.mjs';
import { reviewRoot, startReviewServer } from './lib/review-server.mjs';
import { websiteCleanup } from './lib/website-cleanup.mjs';

const phone = { width: 400, height: 760 }, desktop = { width: 1280, height: 800 };
const scenes = (...names) => names.map(name => `scene=${name}`);
// `check`: the page runs a self-check and must report `passed`; `run` adds `?run` to start it on load.
// `allow`: expected browser errors (by text or URL), e.g. a revoked Blob URL that the page proves no longer resolves.
const pages = {
  'asset-runtime': { check: true, run: true },
  // Both avatar pages load a missing image on purpose to show the fallback face.
  'avatar-review': { allow: [/\/avatars\/nonexistent\.webp$/] },
  // Written against the wide top-area layout, where every viewing group is a card.
  'baseline-review': { check: true, run: true, viewport: { width: 600, height: 1000 } },
  'chat-reading': { check: true, run: true },
  'connection-review': { check: true, variants: scenes('service', 'sync', 'connecting', 'crypto', 'readonly', 'empty', 'login') },
  'design-review': { variants: scenes('chat', 'add-site', 'blocked', 'cache-clear-error', 'cache-read-error', 'detail', 'draft', 'follow-off', 'grant', 'hot', 'invites', 'lobby', 'pokes', 'read', 'ref', 'room-empty', 'room-slow', 'security', 'start', 'stickies', 'shared-tokens') },
  'edge-review': { allow: [/\/intentionally-missing-token\.webp$/], variants: scenes('normal', 'assets', 'empty', 'failure', 'invite', 'invite-nickname', 'missing', 'no-team', 'pacing', 'password', 'readonly', 'suspended') },
  'i18n-review': { variants: ['', ...scenes('login')] },
  'notification-runtime': { check: true, run: true },
  'offline-runtime': { check: true, variants: scenes('empty', 'cached', 'settings') },
  'page-layer-review': { viewport: desktop, variants: [...scenes('danmaku', 'capture', 'pick', 'stickies', 'hidden'), 'scene=danmaku&real=1'] },
  'profile-runtime': { check: true, run: true, allow: [/^blob:/] },
  'retention-review': { check: true, run: true, allow: [/^blob:/] },
  storage: { check: true, run: true },
  'team-avatar-review': { allow: [/\/team-avatars\/missing-image\.webp$/] },
  'token-logo-display': { allow: [/metadata\.mobula\.io\/assets\/logos\/0{64}\.png/] },
  'ui-review': { variants: ['', ...scenes('empty', 'history', 'menus', 'offline')] },
};
// External images a page renders on purpose, answered locally so the check never leaves this machine.
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const externalFixtures = new Set(['https://metadata.mobula.io/assets/logos/f03b6095dc83bde168cab16013205334941f599c7405682cced179242df940f8.png']);

const filter = process.argv[2] ?? '';
const files = (await readdir(reviewRoot)).filter(file => file.endsWith('.html') && file !== 'index.html').map(file => file.slice(0, -5)).sort();
const unlisted = Object.keys(pages).filter(name => !files.includes(name));
if (unlisted.length) throw Error(`Listed review pages do not exist: ${unlisted.join(', ')}`);
const runs = files.flatMap(name => {
  const page = pages[name] ?? {};
  return (page.variants ?? ['']).map(variant => {
    const query = [page.run ? 'run' : '', variant].filter(Boolean).join('&');
    return { name, page, path: `${name}.html${query ? `?${query}` : ''}`, key: `${name}.html${variant ? `?${variant}` : ''}` };
  });
}).filter(run => run.path.includes(filter));
const axe = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

process.env.CHROME_PATH = await chromePath();

// Review pages load the generated logo, avatar and brand folders from the extension's public directory.
execFileSync(process.execPath, [new URL('sync-site-assets.mjs', import.meta.url).pathname], { stdio: 'ignore' });
let server, origin, chrome;
const cleanup = websiteCleanup(() => ({ chrome, website: server && { close: () => bounded(server.close(), 'review server shutdown') } }));
const failures = [];
async function visit({ page, path, key }) {
  const problems = [];
  const allowed = text => (page.allow ?? []).some(pattern => pattern.test(text));
  // Each page gets its own storage and a foreground window, so parallel pages neither share data nor pause animation frames.
  let browserContextId, stop;
  try {
    ({ browserContextId } = await chrome.send('Target.createBrowserContext', { disposeOnDetach: true }));
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true });
    const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => chrome.send(method, params, sessionId);
    let loaded = false;
    stop = chrome.listen(({ method, params, sessionId: from }) => {
      if (from !== sessionId) return;
      if (method === 'Page.loadEventFired') loaded = true;
      else if (method === 'Runtime.exceptionThrown') problems.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
        const text = params.args.map(arg => arg.description ?? (typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value))).join(' ');
        if (!allowed(text)) problems.push(`console.error: ${text}`);
      } else if (method === 'Log.entryAdded' && params.entry.level === 'error' && !allowed(params.entry.url ?? '') && !allowed(params.entry.text)) {
        problems.push(`browser: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
      } else if (method === 'Fetch.requestPaused') {
        const { requestId, request } = params;
        if (request.url.startsWith(`${origin}/`)) return void send('Fetch.continueRequest', { requestId }).catch(() => {});
        if (externalFixtures.has(request.url)) return void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: pixel }).catch(() => {});
        if (!allowed(request.url)) problems.push(`request left the review server: ${request.method} ${request.url}`);
        void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    });
    const viewport = page.viewport ?? phone;
    await Promise.all([send('Runtime.enable'), send('Log.enable'), send('Page.enable'), send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }),
      send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false }), send('Emulation.setFocusEmulationEnabled', { enabled: true })]);
    await send('Page.navigate', { url: `${origin}/${path}` });
    await until(() => loaded, `${path} load`, 30_000);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const status = () => evaluate('document.documentElement.dataset.review ?? ""');
    if (page.check) {
      const outcome = await until(async () => ['passed', 'failed'].includes(await status()) && await status(), `${path} self-check`, 60_000).catch(error => error.message);
      if (outcome !== 'passed') {
        // Self-check pages print `{ checks, error }`; show the error and the last check that held.
        const text = await evaluate(`document.querySelector('#result, pre, [role=alert]')?.textContent ?? ''`);
        let detail = text.replace(/\s+/g, ' ').slice(0, 400);
        try { const { error, checks = [] } = JSON.parse(text); if (error) detail = `${error}${checks.length ? ` (after: ${checks.at(-1)})` : ''}`; } catch {}
        problems.push(`self-check ${outcome}: ${detail}`);
      }
    } else {
      await new Promise(done => setTimeout(done, 1500));
      if (await status() === 'failed') problems.push('page reported data-review="failed"');
    }
    // Contrast is judged on settled frames: a slow runner can still be fading content in after the fixed wait.
    await evaluate(`Promise.race([Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))), new Promise(done => setTimeout(done, 5000))])`);
    await evaluate(axe);
    const violations = await evaluate(`axe.run(document, { resultTypes: ['violations'] }).then(result => result.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => v.impact + ' ' + v.id + ' ×' + v.nodes.length + ' ' + v.nodes[0].target.join(' ')))`);
    problems.push(...violations.map(violation => `axe ${violation}`));
  } catch (error) { problems.push(error.message); }
  finally {
    // Disposing the context closes every target it owns, including unattached targets.
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => stop?.()),
      Promise.resolve().then(() => browserContextId && chrome.send('Target.disposeBrowserContext', { browserContextId })),
    ]);
    const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) {
      const error = new AggregateError(errors, 'Review page cleanup failed');
      problems.push(`${error.message}: ${error.errors.map(error => error.message).join('; ')}`);
    }
  }
  if (problems.length) { failures.push(key); console.log(`FAIL  ${key}\n${[...new Set(problems)].map(problem => `      ${problem}`).join('\n')}`); }
  else console.log(`ok    ${key}`);
}
let failure;
try {
  ({ server, origin } = await startReviewServer({ logLevel: 'error' }));
  chrome = await launchChrome();
  const queue = [...runs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await visit(queue.shift()); }));
  // Timing checks can miss under four-way contention on a small runner; a page fails only if it also fails alone.
  const contended = runs.filter(run => failures.includes(run.key));
  failures.length = 0;
  for (const run of contended) { console.log(`retry ${run.key} alone`); await visit(run); }
} catch (error) { failure = error; }
finally {
  try { await cleanup(); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Review checks and cleanup failed') : error; }
}
if (failure) throw failure;
console.log(`${runs.length - failures.length}/${runs.length} review pages passed`);
if (!runs.length) { console.error(`No review page matches "${filter}"`); process.exitCode = 1; }
if (failures.length) process.exitCode = 1;
