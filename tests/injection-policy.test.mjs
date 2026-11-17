import test from 'node:test';
import assert from 'node:assert/strict';
import { pageRegistration, pageScript } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
const pageMatches = (...input) => pageRegistration(...input)?.matches ?? [];
import { manualPageLayerPolicy, validatePageLayerRegistration } from '../scripts/lib/extension-artifact.mjs';
test('Chrome grants alone determine automatic registrations while 网页互动 runs', () => {
  const state = { authenticated: true, preferences: { current: 't' }, remoteTeams: [{ id: 't', joined: true }] };
  const script = pageScript(pageRegistration(state, ['https://custom.example.com/*', '*://both.example.com/*', 'https://api.example.org/*']));
  assert.deepEqual(validatePageLayerRegistration(script), []);
  assert.deepEqual(script.matches, ['http://both.example.com/*', 'https://api.example.org/*', 'https://both.example.com/*', 'https://custom.example.com/*']);
  const broad = pageScript(pageRegistration(state, ['<all_urls>', 'https://custom.example.com/*']));
  assert.deepEqual(broad.matches, ['http://*/*', 'https://*/*'], 'a grant from Chrome menu covers every site');
  assert.deepEqual(validatePageLayerRegistration(broad), []);
  const paused = { ...state, preferences: { current: 't', siteInteraction: { '*': { on: false, danmaku: true, signal: true, chart: true } } } };
  assert.deepEqual(pageMatches(paused, ['<all_urls>', 'https://custom.example.com/*'], true), [], 'the master switch off registers no site, not even for 弹幕');
  assert.equal(script.persistAcrossSessions, false);
  assert.ok(validatePageLayerRegistration({ ...script, matches: ['<all_urls>'] }).length);
  assert.ok(validatePageLayerRegistration({ ...script, allFrames: true }).length);
  assert.deepEqual(manualPageLayerPolicy.protocols, ['http:', 'https:']);
});

test('a site switched off never receives the page layer, under a broad grant too', () => {
  const state = { authenticated: true, preferences: { current: 't' }, remoteTeams: [{ id: 't', joined: true }] };
  const off = { on: false, danmaku: true, signal: true, chart: true }, quiet = { on: true, danmaku: false, signal: true, chart: true };
  const sites = { 'bank.example.com': off, 'mail.example.com': off, 'gmgn.ai': quiet, 'dexscreener.com': { ...quiet, danmaku: true } };
  const withSites = { ...state, preferences: { current: 't', siteInteraction: sites } };
  const broad = pageScript(pageRegistration(withSites, ['<all_urls>']));
  assert.deepEqual(broad.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(broad.excludeMatches, ['*://bank.example.com/*', '*://mail.example.com/*'], 'a squad page layer skips only sites switched off');
  assert.deepEqual(validatePageLayerRegistration(broad), []);
  assert.equal('excludeMatches' in pageScript(pageRegistration(state, ['<all_urls>'])), false, 'no site setting, no exclusion list');
  // Without a squad only 弹幕 runs: a site with 弹幕 off is excluded as well.
  const room = pageRegistration({ ...withSites, remoteTeams: [] }, ['<all_urls>'], true);
  assert.deepEqual(room.excludeMatches, ['*://bank.example.com/*', '*://gmgn.ai/*', '*://mail.example.com/*']);
  // 弹幕 off everywhere and no squad: nothing runs, so nothing registers.
  assert.equal(pageRegistration({ ...withSites, remoteTeams: [], preferences: { current: 't', siteInteraction: { ...sites, '*': { ...quiet } } } }, ['<all_urls>'], true), undefined);
  // Exact grants already leave switched-off sites out.
  assert.deepEqual(pageMatches(withSites, ['https://bank.example.com/*', 'https://gmgn.ai/*']), ['https://gmgn.ai/*']);
  const base = { js: ['page-layer.js'], allFrames: false, persistAcrossSessions: false };
  assert.ok(validatePageLayerRegistration({ ...base, matches: ['https://gmgn.ai/*'], excludeMatches: ['*://bank.example.com/*'] }).length, 'exclusions only narrow the every-site registration');
  for (const excludeMatches of [[], ['<all_urls>'], ['*://*.example.com/*'], ['https://example.com/path/*'], ['*://localhost/*']])
    assert.ok(validatePageLayerRegistration({ ...base, matches: ['http://*/*', 'https://*/*'], excludeMatches }).length, JSON.stringify(excludeMatches));
});

test('registration validation rejects broad or malformed patterns and allows exact HTTP/HTTPS hosts', () => {
  const base = { js: ['page-layer.js'], allFrames: false, persistAcrossSessions: false };
  for (const pattern of ['http://custom.example.com/*', 'https://custom.example.com/*', '*://custom.example.com/*']) assert.deepEqual(validatePageLayerRegistration({ ...base, matches: [pattern] }), []);
  assert.deepEqual(validatePageLayerRegistration({ ...base, matches: ['http://*/*', 'https://*/*'] }), [], 'the broad pair is the only wildcard allowed');
  for (const matches of [['https://*/*'], ['http://*/*'], ['https://*/*', 'http://*/*'], ['http://*/*', 'https://*/*', 'https://example.com/*']]) assert.ok(validatePageLayerRegistration({ ...base, matches }).length, String(matches));
  for (const pattern of ['<all_urls>', '*://*/*', 'https://*.example.com/*', 'https://example.com.evil*/*', 'file://example.com/*', 'https://user@example.com/*', 'https://example.com:8443/*', 'https://example.com/path/*', 'https://localhost/*', 'https://EXAMPLE.com/*', undefined]) assert.ok(validatePageLayerRegistration({ ...base, matches: [pattern] }).length, String(pattern));
  for (const patch of [{ matches: [] }, { matches: ['https://example.com/*'], allFrames: true }, { matches: ['https://example.com/*'], persistAcrossSessions: true }, { matches: ['https://example.com/*'], matchOriginAsFallback: true }, { matches: ['https://example.com/*'], js: ['remote.js'] }]) assert.ok(validatePageLayerRegistration({ ...base, ...patch }).length);
});
test('registration requires 网页互动 on for a joined current team and never trusts malformed grants', () => {
  const state = { authenticated: true, preferences: { current: 't' }, remoteTeams: [{ id: 't', joined: true }] };
  assert.deepEqual(pageMatches(state, ['https://*.example.com/*', 'https://example.com/path/*', 'notifications']), []);
  const origins = ['https://example.com/*'];
  assert.deepEqual(pageMatches(state, origins), ['https://example.com/*']);
  for (const patch of [{ authenticated: false }, { remoteTeams: [] }, { remoteTeams: [{ id: 't', joined: false }] }, { preferences: { ...state.preferences, current: 'other' } },
    { preferences: { ...state.preferences, siteInteraction: { 'example.com': { on: false, danmaku: true, signal: true } } } }]) assert.deepEqual(pageMatches({ ...state, ...patch }, origins), [], JSON.stringify(patch));
  // 引用 has no switch of its own, so the layer stays registered with 信号 off.
  assert.deepEqual(pageMatches({ ...state, preferences: { ...state.preferences, siteInteraction: { 'example.com': { on: true, danmaku: true, signal: false } } } }, origins), ['https://example.com/*']);
});

test('page layer registrations allow only the isolated execution world', () => {
  const base = { matches: ['https://example.com/*'], js: ['page-layer.js'], persistAcrossSessions: false };
  for (const world of [undefined, 'ISOLATED']) assert.deepEqual(validatePageLayerRegistration({ ...base, world }), []);
  for (const world of ['MAIN', 'isolated', '', null]) assert.ok(validatePageLayerRegistration({ ...base, world }).length, String(world));
});
