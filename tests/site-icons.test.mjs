import test from 'node:test';
import assert from 'node:assert/strict';
import { iconCandidates, iconFace, iconPlate, readSiteIcon } from '../apps/extension/src/domain/assets/site-icon.ts';
import { createContext } from '../apps/extension/src/background/context.ts';
import { siteIcons } from '../apps/extension/src/background/site-icons.ts';

const png = 'data:image/png;base64,iVBORw0KGgo=';

test('icon candidates prefer a raster of at least 64px, then SVG, then smaller ones, ending with /favicon.ico', () => {
  const html = `<head>
    <link rel="icon" href="/16.png" sizes="16x16">
    <link rel='shortcut icon' href='https://cdn.example.net/plain.ico'>
    <LINK REL="icon" TYPE="image/svg+xml" HREF="/mark.svg">
    <link rel="apple-touch-icon" href="/touch.png">
    <link href="/96.png?v=1&amp;x=2" rel="icon" sizes="96x96">
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" href="http://insecure.example.com/a.png" sizes="64x64">
    <link rel="icon" href="javascript:alert(1)">
  </head>`;
  assert.deepEqual(iconCandidates(html, 'https://example.com/home'), [
    'https://example.com/96.png?v=1&x=2', 'https://example.com/touch.png', 'https://example.com/mark.svg',
    'https://example.com/16.png', 'https://cdn.example.net/plain.ico', 'https://example.com/favicon.ico',
  ]);
  assert.deepEqual(iconCandidates('', 'https://example.com/'), ['https://example.com/favicon.ico']);
});

test('icon plate follows the visible pixels: near-black takes a light plate, near-white a dark one', () => {
  const pixels = (rgba, count = 10) => Array.from({ length: count }, () => rgba).flat();
  assert.equal(iconPlate(pixels([10, 10, 10, 255])), 'light');
  assert.equal(iconPlate(pixels([250, 250, 250, 255])), 'dark');
  assert.equal(iconPlate([...pixels([250, 250, 250, 255], 5), ...pixels([200, 30, 30, 255], 5)]), undefined);
  // Transparent pixels do not count.
  assert.equal(iconPlate([...pixels([255, 255, 255, 0], 50), ...pixels([0, 0, 0, 255], 5)]), 'light');
  assert.equal(iconPlate(pixels([0, 0, 0, 0])), undefined);
});

test('stored icons are only small image data URLs with a known plate', () => {
  assert.deepEqual(readSiteIcon({ src: png, plate: 'dark', at: 1 }), { src: png, plate: 'dark' });
  assert.deepEqual(readSiteIcon({ src: png, plate: 'purple' }), { src: png });
  assert.equal(readSiteIcon({ src: 'https://example.com/a.png' }), undefined);
  assert.equal(readSiteIcon({ src: 'data:text/html;base64,PHNjcmlwdD4=' }), undefined);
  assert.equal(readSiteIcon({ src: `data:image/png;base64,${'A'.repeat(20_000)}` }), undefined);
});

function fixture({ origins = [], pages = {} } = {}) {
  const local = {}, posts = [], requests = [];
  const granted = { origins: [...origins] };
  const browser = {
    action: { setTitle: async () => {} },
    runtime: { id: 'qa', getURL: path => `chrome-extension://qa${path}` },
    permissions: { getAll: async () => ({ origins: [...granted.origins], permissions: [] }) },
    storage: { local: {
      get: async keys => Object.fromEntries(keys.filter(key => key in local).map(key => [key, structuredClone(local[key])])),
      set: async value => { Object.assign(local, structuredClone(value)); },
      remove: async key => { delete local[key]; },
    } },
  };
  const fetch = async (url, init) => {
    requests.push({ url, credentials: init?.credentials });
    const page = pages[url];
    if (!page) return new Response('missing', { status: 404 });
    return new Response(page.body, { headers: { 'content-type': page.type } });
  };
  const bg = createContext({ browser, websiteUrl: 'https://palside.example', fetch });
  const port = { postMessage: message => posts.push(message) };
  bg.panels.set(port, 1);
  // The image step is Chrome's canvas; here every image file becomes an icon named after its bytes.
  const image = async blob => { const text = await blob.text(); return text.startsWith('img:') ? { src: `data:image/png;base64,${btoa(text)}`, ...(text.includes('black') ? { plate: 'light' } : {}) } : undefined; };
  const icons = siteIcons(bg, image);
  return { bg, icons, local, posts, requests, granted, port };
}

test('a newly allowed non-catalog site keeps the icon its homepage declares, fetched without cookies', async () => {
  const f = fixture({
    origins: ['https://tools.example.com/*', 'https://gmgn.ai/*'],
    pages: {
      'https://tools.example.com/': { type: 'text/html', body: '<link rel="icon" href="/big.png" sizes="128x128"><link rel="icon" href="/small.png" sizes="16x16">' },
      'https://tools.example.com/big.png': { type: 'image/png', body: 'img:black' },
    },
  });
  f.icons.added(['https://tools.example.com/*', 'https://gmgn.ai/*', '<all_urls>']);
  await f.icons.fetchIcon('tools.example.com');
  await f.icons.ready;
  assert.deepEqual(f.requests.map(request => request.url), ['https://tools.example.com/', 'https://tools.example.com/big.png'], 'catalog sites and broad grants are skipped');
  assert.ok(f.requests.every(request => request.credentials === 'omit'));
  const stored = f.local['palside:site-icons']['tools.example.com'];
  assert.equal(stored.plate, 'light');
  assert.match(stored.src, /^data:image\/png;base64,/);
  assert.deepEqual(f.posts.at(-1), { type: 'site-icons', icons: { 'tools.example.com': { src: stored.src, plate: 'light' } } });
});

test('a shared page never waits for a download from the site: Chrome\'s cached icon goes out, the site\'s lands later', async () => {
  const f = fixture({ origins: ['https://slow.example.com/*'] });
  let answer;
  const homepage = new Promise(resolve => { answer = resolve; });
  // The site's homepage hangs; Chrome's favicon cache answers at once.
  f.bg.fetch = async url => {
    if (String(url).startsWith('chrome-extension://qa/_favicon/')) return new Response(String(url).includes('palside.invalid') ? 'img:globe' : 'img:cached');
    f.requests.push({ url });
    if (url === 'https://slow.example.com/') { await homepage; return new Response('<link rel="icon" href="/site.png">', { headers: { 'content-type': 'text/html' } }); }
    if (url === 'https://slow.example.com/site.png') return new Response('img:site', { headers: { 'content-type': 'image/png' } });
    return new Response('missing', { status: 404 });
  };
  f.bg.browser.permissions.contains = async () => true;
  const downloads = f.icons.added(['https://slow.example.com/*']);
  const shared = await f.icons.shareable('https://slow.example.com/page');
  assert.equal(shared, `data:image/png;base64,${btoa('img:cached')}`);
  answer();
  await downloads;
  assert.equal(await f.icons.shareable('https://slow.example.com/page'), `data:image/png;base64,${btoa('img:site')}`);
});

test('a failed homepage falls back to /favicon.ico, and a site that is not allowed is never stored', async () => {
  const f = fixture({ origins: ['https://plain.example.org/*'], pages: { 'https://plain.example.org/favicon.ico': { type: 'image/x-icon', body: 'img:ico' } } });
  await f.icons.fetchIcon('plain.example.org');
  assert.ok(f.local['palside:site-icons']['plain.example.org']);
  const g = fixture({ origins: [], pages: { 'https://gone.example.org/favicon.ico': { type: 'image/x-icon', body: 'img:ico' } } });
  await g.icons.fetchIcon('gone.example.org');
  assert.equal(g.requests.length, 0);
  assert.equal(g.local['palside:site-icons'], undefined);
});

test('revoking a site prunes its icon; 清除本地数据 drops every icon until the site is open again', async () => {
  const f = fixture({
    origins: ['https://a.example.com/*', 'https://b.example.com/*'],
    pages: { 'https://a.example.com/favicon.ico': { type: 'image/x-icon', body: 'img:a' }, 'https://b.example.com/favicon.ico': { type: 'image/x-icon', body: 'img:b' }, 'https://b.example.com/tab.png': { type: 'image/png', body: 'img:tab' } },
  });
  await f.icons.fetchIcon('a.example.com'); await f.icons.fetchIcon('b.example.com');
  f.granted.origins = ['https://b.example.com/*'];
  await f.icons.prune();
  assert.deepEqual(Object.keys(f.local['palside:site-icons']), ['b.example.com']);
  await f.icons.clear();
  assert.equal(f.local['palside:site-icons'], undefined);
  assert.deepEqual(f.posts.at(-1), { type: 'site-icons', icons: {} });
  await f.icons.tab({ url: 'https://b.example.com/page', favIconUrl: 'https://b.example.com/tab.png' });
  assert.equal(f.local['palside:site-icons']['b.example.com'].from, 'https://b.example.com/tab.png');
  // The same tab icon within a day is not read again.
  const count = f.requests.length;
  await f.icons.tab({ url: 'https://b.example.com/other', favIconUrl: 'https://b.example.com/tab.png' });
  assert.equal(f.requests.length, count);
  // A catalog site's tab never stores anything.
  await f.icons.tab({ url: 'https://gmgn.ai/sol/token/x', favIconUrl: 'https://gmgn.ai/favicon.ico' });
  assert.equal(f.requests.length, count);
});

test('a site icon with transparent corners is a bare glyph; a nearly all white or black glyph takes a plate', () => {
  const square = (size, at) => { const out = []; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push(...at(x, y)); return out; };
  const inner = (x, y) => x > 1 && y > 1 && x < 6 && y < 6;
  assert.deepEqual(iconFace(square(8, () => [40, 200, 90, 255]), 8), { glyph: false });
  assert.deepEqual(iconFace(square(8, (x, y) => inner(x, y) ? [40, 200, 90, 255] : [0, 0, 0, 0]), 8), { glyph: true });
  assert.deepEqual(iconFace(square(8, (x, y) => inner(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0]), 8), { glyph: true, plate: 'dark' });
  assert.deepEqual(iconFace(square(8, (x, y) => inner(x, y) ? [8, 8, 8, 255] : [0, 0, 0, 0]), 8), { glyph: true, plate: 'light' });
  // Google's G: a coloured mark on a white disc (60% white) reads bare, without a dark plate.
  const disc = (x, y) => !inner(x, y) ? [0, 0, 0, 0] : (x === 3 || x === 4) && y > 2 ? [66, 133, 244, 255] : [255, 255, 255, 255];
  assert.deepEqual(iconFace(square(8, disc), 8), { glyph: true });
});
