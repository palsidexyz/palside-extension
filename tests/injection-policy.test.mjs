import test from 'node:test';
import assert from 'node:assert/strict';
import { pageMatches, pageScript } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
import { manualPageLayerPolicy, validatePageLayerRegistration } from '../scripts/lib/extension-artifact.mjs';
test('Chrome grants alone determine automatic registrations while 网页互动 runs', () => {
  const state = { authenticated: true, preferences: { current: 't', web: { share: true, interact: true } }, toggles: { share: false, interact: true }, remoteTeams: [{ id: 't', joined: true }] };
  const script = pageScript(pageMatches(state, ['https://custom.example.com/*', '*://both.example.com/*', 'https://api.example.org/*']));
  assert.deepEqual(validatePageLayerRegistration(script), []);
  assert.deepEqual(script.matches, ['http://both.example.com/*', 'https://api.example.org/*', 'https://both.example.com/*', 'https://custom.example.com/*']);
  const broad = pageScript(pageMatches(state, ['<all_urls>', 'https://custom.example.com/*']));
  assert.deepEqual(broad.matches, ['http://*/*', 'https://*/*'], 'a grant from Chrome menu covers every site');
  assert.deepEqual(validatePageLayerRegistration(broad), []);
  assert.equal(script.persistAcrossSessions, false);
  assert.ok(validatePageLayerRegistration({ ...script, matches: ['<all_urls>'] }).length);
  assert.ok(validatePageLayerRegistration({ ...script, allFrames: true }).length);
  assert.deepEqual(manualPageLayerPolicy.protocols, ['http:', 'https:']);
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
  const state = { authenticated: true, preferences: { current: 't', web: { share: true, interact: true } }, toggles: { share: false, interact: true }, remoteTeams: [{ id: 't', joined: true }] };
  assert.deepEqual(pageMatches(state, ['https://*.example.com/*', 'https://example.com/path/*', 'notifications']), []);
  const origins = ['https://example.com/*'];
  assert.deepEqual(pageMatches(state, origins), ['https://example.com/*']);
  for (const patch of [{ authenticated: false }, { remoteTeams: [] }, { remoteTeams: [{ id: 't', joined: false }] }, { preferences: { ...state.preferences, current: 'other' } },
    { toggles: { share: true, interact: false } }, { preferences: { ...state.preferences, web: { share: true, interact: false } } },
    { preferences: { ...state.preferences, interaction: { danmaku: false, signal: false, sticky: false } } }]) assert.deepEqual(pageMatches({ ...state, ...patch }, origins), [], JSON.stringify(patch));
});

test('page layer registrations allow only the isolated execution world', () => {
  const base = { matches: ['https://example.com/*'], js: ['page-layer.js'], persistAcrossSessions: false };
  for (const world of [undefined, 'ISOLATED']) assert.deepEqual(validatePageLayerRegistration({ ...base, world }), []);
  for (const world of ['MAIN', 'isolated', '', null]) assert.ok(validatePageLayerRegistration({ ...base, world }).length, String(world));
});
