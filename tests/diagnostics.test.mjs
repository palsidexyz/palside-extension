import test from 'node:test'; import assert from 'node:assert/strict'; import { DiagnosticErrors, diagnostics } from '../apps/extension/src/runtime/diagnostics/diagnostics.ts';
test('diagnostics ring buffer is capped and excludes values',()=>{const e=new DiagnosticErrors();for(let i=0;i<12;i++)e.record({code:`E_${i}`},i);const out=diagnostics({version:'1',ua:'ua',locale:'en',connection:{networkOnline:true,service:'ready',messaging:'ready',retrying:false},sync:'SYNCING',sseOpen:true,access:{tabs:true,site:false},pageLayer:{enabled:false,registered:false},teams:2,errors:e.snapshot()}).text;assert.match(out,/E_11/);assert.doesNotMatch(out,/E_0/);assert.doesNotMatch(out,/secret|url|token/i)});

const { registerHooks } = await import('node:module');
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'wxt/browser') return { url: 'data:text/javascript,export const browser = { runtime: {} }', shortCircuit: true };
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { RuntimeCommands } = await import('../apps/extension/src/runtime/composition/dispatch.ts');
const { commands } = await import('../apps/extension/src/background/commands.ts');
hooks.deregister();

function runtimeFixture() {
  const errors = new DiagnosticErrors(); errors.record({ code: 'SYNC_FAILED', message: 'SYNTHETIC_SECRET' }, 1000);
  return {
    initialise: async () => {},
    state: { connection: { networkOnline: true, service: 'ready', messaging: 'unavailable', retrying: true }, remoteTeams: [{ joined: true }, { joined: false }], secret: 'SYNTHETIC_SECRET' },
    auth: { client: { getSyncState: () => 'RECONNECTING' }, sseOpen: false }, diagnosticErrors: errors,
  };
}
test('offscreen diagnostics uses only runtime host APIs and returns serializable metrics', async () => {
  const result = await new RuntimeCommands(runtimeFixture()).execute({ name: 'diagnostics' });
  assert.deepEqual(result, {
    connection: { networkOnline: true, service: 'ready', messaging: 'unavailable', retrying: true }, sync: 'RECONNECTING', sseOpen: false, teams: 1, errors: [{ code: 'SYNC_FAILED', at: 1000 }],
  });
  assert.deepEqual(structuredClone(result), result);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET/);
});
test('background assembles diagnostics with worker grants, registrations and version', async () => {
  const runtime = runtimeFixture(), dispatch = new RuntimeCommands(runtime), calls = [];
  const bg = {
    browser: {
      runtime: { getManifest: () => ({ version: '1.2.3' }) },
      permissions: { async contains(query) { calls.push(query); return Boolean(query.permissions); } },
      scripting: { async getRegisteredContentScripts() { return [{ id: 'page-layer' }]; } },
    },
    run: async command => ({ ok: true, value: structuredClone(await dispatch.execute(command)) }),
  };
  const result = await commands(bg).panelCommand({ name: 'diagnostics', payload: { locale: 'zh-CN' } }, 'chrome-extension://test/sidepanel.html');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value), ['text']);
  assert.deepEqual(result.value.text.split('\n'), [
    'Extension: 1.2.3', `Browser UA: ${navigator.userAgent}`, 'Locale: zh-CN', 'Network online: true', 'Service: ready', 'Messaging: unavailable', 'Retrying: true', 'Sync: RECONNECTING', 'SSE open: false', 'Access tabs: true', 'Access site: false', 'Page layer enabled: false', 'Page layer registered: true', 'Teams: 1', 'Errors:', '1970-01-01T00:00:01.000Z SYNC_FAILED',
  ]);
  assert.deepEqual(calls, [{ permissions: ['tabs'] }, { origins: ['<all_urls>'] }]);
  assert.doesNotMatch(result.value.text, /SYNTHETIC_SECRET/);
});
test('background diagnostics preserves offscreen error replies', async () => {
  const failure = { ok: false, code: 'RUNTIME_UNAVAILABLE', message: 'Unavailable' };
  const bg = { run: async () => failure };
  assert.equal(await commands(bg).panelCommand({ name: 'diagnostics' }, ''), failure);
});
