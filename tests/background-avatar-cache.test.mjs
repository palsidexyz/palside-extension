import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../apps/extension/src/background/context.ts';
import { images } from '../apps/extension/src/background/images.ts';

function fixture() {
  const calls = [];
  const response = { load: async () => new Response('avatar') };
  const browser = { action: { setTitle: async () => {} }, runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}`, onConnect: { addListener() {} } } };
  const bg = createContext({ browser, fetch: async url => { calls.push(url); return response.load(url); } });
  bg.state = { authenticated: true, account: { id: 'alice' }, data: { people: [{ id: 'peer', name: 'Peer', avatar: 'blob:one' }] } };
  const imageHost = images(bg);
  return { bg, calls, response, imageHost };
}

test('background avatar projection is bounded to 32 entries with recent-use eviction', async () => {
  const f = fixture(); const person = f.bg.state.data.people[0];
  f.bg.state.data.people = Array.from({ length: 33 }, (_, i) => ({ id: `p${i}`, name: 'Peer', avatar: `blob:${i}` }));
  f.bg.state.data.people.push(person);
  for (let i = 0; i < 32; i++) await f.bg.pagePerson(`p${i}`);
  await f.bg.pagePerson('p0'); await f.bg.pagePerson('p32'); await f.bg.pagePerson('p0');
  assert.equal(f.calls.length, 33);
  await f.bg.pagePerson('p1'); assert.equal(f.calls.length, 34);
});

test('background avatar revoke clears account copies and discards late loads across the epoch', async () => {
  const f = fixture(); const loaded = await f.bg.pagePerson('peer'); assert.ok(loaded.avatar);
  f.imageHost.clearImageSessions(); await f.bg.pagePerson('peer'); assert.equal(f.calls.length, 2);
  f.bg.state.account = { id: 'bob' }; await f.bg.pagePerson('peer'); assert.equal(f.calls.length, 3);
  f.imageHost.clearImageSessions();
  let finish; f.response.load = () => new Promise(resolve => { finish = resolve; });
  const loading = f.bg.pagePerson('peer');
  f.imageHost.clearImageSessions(); finish(new Response('private')); assert.equal((await loading).avatar, undefined);
  f.response.load = async () => new Response('current'); await f.bg.pagePerson('peer'); assert.equal(f.calls.length, 5);
  f.bg.state.authenticated = false; f.imageHost.clearImageSessions(); assert.equal((await f.bg.pagePerson('peer')).avatar, undefined);
});

test('background avatar failures are retried and parallel projections share one request', async () => {
  const f = fixture(); f.response.load = async () => new Response('retry', { status: 503 });
  assert.equal((await f.bg.pagePerson('peer')).avatar, undefined);
  let finish; f.response.load = () => new Promise(resolve => { finish = resolve; });
  const first = f.bg.pagePerson('peer'), second = f.bg.pagePerson('peer');
  assert.equal(f.calls.length, 2); finish(new Response('ok'));
  assert.ok((await first).avatar); assert.deepEqual(await first, await second);
});
