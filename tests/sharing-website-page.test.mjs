import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { websiteIdentity } from '../packages/shared/src/navigation.ts';
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'wxt/browser') return { url: 'data:text/javascript,export const browser = {}', shortCircuit: true };
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes('/apps/extension/')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { pageCommand } = await import('../apps/extension/src/runtime/viewing/command-handlers.ts');
hooks.deregister();

const icon = 'data:image/png;base64,iVBORw0KGgo=';

/** Just enough runtime for the page command: what it accepts lands on `sharing.page`. */
function runtime() {
  const session = { account: { id: 'me' } };
  const sharing = {
    page: undefined, pagePreview: false, pageObservation: 0, pageRequest: undefined, pageSince: 0, viewingTimer: undefined, published: 0,
    invalidatePage() { this.pageObservation++; this.page = undefined; }, mayObserve: () => true, publishViewing: async () => { sharing.published++; },
  };
  const value = {
    auth: { session }, sharing, emit() {}, cache: { upsertView() {} },
    state: { preferences: { current: 'team' }, data: { people: [] } },
    tokens: { get: () => undefined, answered: () => true }, directory: { ensure: async () => {} },
  };
  return { runtime: value };
}

test('a shared website is its page, title and clean link, and carries the icon Chrome keeps for it so teammates see its logo', async () => {
  const self = runtime(), identity = websiteIdentity('https://www.google.com/search?q=x&utm_source=a', 'page');
  await pageCommand.call(self, { name: 'page', payload: { identity, host: identity.host, stable: true, title: 'x - Google 搜索', favicon: icon } });
  const view = self.runtime.sharing.page;
  assert.equal(view.kind, 'website');
  assert.equal(view.url, 'https://www.google.com/search?q=x', 'tracking is gone, the page stays');
  assert.equal(view.disclosure, 'page');
  assert.equal(view.name, 'x', 'the title without the site name');
  assert.equal(view.logo, icon);
  // The icon arrives on a later observation of the same site: the view is rebuilt with it.
  await pageCommand.call(self, { name: 'page', payload: { identity, host: identity.host, stable: true } });
  assert.equal(self.runtime.sharing.page.logo, undefined);
  await pageCommand.call(self, { name: 'page', payload: { identity, host: identity.host, stable: true, favicon: icon } });
  assert.equal(self.runtime.sharing.page.logo, icon);
  await pageCommand.call(self, { name: 'page', payload: { identity, host: identity.host, stable: true, favicon: 'https://www.google.com/favicon.ico' } });
  assert.equal(self.runtime.sharing.page.logo, undefined, 'only a small data URL is carried');
});

test('a link carrying credentials or a title naming an account shares the site only, with no title', async () => {
  for (const [url, title] of [['https://mail.example.com/inbox?token=abc', 'Inbox'], ['https://mail.example.com/inbox', 'Inbox (3) - someone@example.com']]) {
    const self = runtime(), identity = websiteIdentity(url, 'page');
    await pageCommand.call(self, { name: 'page', payload: { identity, host: identity.host, stable: true, title } });
    const view = self.runtime.sharing.page;
    assert.equal(view.url, 'https://mail.example.com');
    assert.equal(view.disclosure, 'site');
    assert.equal(view.name, 'mail.example.com');
  }
});
