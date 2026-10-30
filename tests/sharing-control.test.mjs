import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === './config' && context.parentURL?.endsWith('/composition/core.ts')) return { url: 'data:text/javascript,export const API_URL = "http://127.0.0.1:0";', shortCircuit: true };
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { PalsideService } = await import('../apps/extension/src/runtime/composition/core.ts');
hooks.deregister();

function fixture() {
  const value = new PalsideService();
  const view = { id: 'current', url: 'https://gmgn.ai/token/current' };
  Object.assign(value.state, { authenticated: true, account: {}, connection: { networkOnline: true, service: 'ready', messaging: 'ready' }, preferences: { current: 'team', web: { share: true, interact: true } }, toggles: { share: true, interact: false }, remoteTeams: [{ id: 'team', joined: true, preferences: { readIds: [] } }] });
  value.sharing.selectedDevice = true; value.sharing.page = view;
  value.sharing.ownViewing = { view, teamId: 'team', expiresAt: Date.now() + 30000 };
  return value;
}
test('sharing control selects only this device’s acknowledged lease, never eligibility alone', () => {
  const value = fixture(); value.emit(); assert.equal(value.state.publishedViewing.viewId, 'current');
  value.sharing.ownViewing = undefined; value.emit(); assert.equal(value.state.publishedViewing, undefined);
});
test('sharing control drops old pages, teams, expired leases and superseded devices', () => {
  for (const change of [v => { v.sharing.page = undefined; }, v => { v.sharing.page = { id: 'next' }; }, v => { v.state.preferences.current = 'other'; }, v => { v.sharing.ownViewing.expiresAt = Date.now() - 1; }, v => { v.sharing.selectedDevice = false; }]) {
    const value = fixture(); value.emit(); change(value); value.emit(); assert.equal(value.state.publishedViewing, undefined);
  }
});
test('sharing control clears selection on disconnect, 共享在看 switched off or 禁用, leaving and logout', () => {
  for (const change of [v => { v.state.connection.networkOnline = false; }, v => { v.state.toggles.share = false; }, v => { v.state.preferences.web = { share: false, interact: true }; }, v => { v.state.remoteTeams[0].joined = false; }, v => { v.state.authenticated = false; }]) {
    const value = fixture(); value.emit(); change(value); value.emit(); assert.equal(value.state.publishedViewing, undefined);
  }
});
