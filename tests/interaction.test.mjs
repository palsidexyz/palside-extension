import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SITES, allSites, defaultSiteInteraction, siteAllows, siteDraws, siteInteraction, readFavorites, readSiteInteractions, withSiteInteraction } from '../apps/extension/src/domain/annotations/interaction.ts';

test('per-site interaction preferences fill defaults, normalize hosts, and reject invalid settings', () => {
  assert.deepEqual(readSiteInteractions({}), {});
  assert.deepEqual(readSiteInteractions({ 'GMGN.ai': { signal: false } }), { 'gmgn.ai': { ...defaultSiteInteraction, signal: false } });
  for (const input of [null, [], { 'localhost': { on: true } }, { 'example.com': { unknown: true } }, { 'example.com': { danmaku: 'yes' } }]) assert.equal(readSiteInteractions(input), undefined);
});

test('site interaction controls each page feature; the page layer runs while 网页互动 is on', () => {
  const sites = { 'example.com': { ...defaultSiteInteraction, on: false }, 'gmgn.ai': { ...defaultSiteInteraction, signal: false } };
  assert.deepEqual(siteInteraction(sites, 'missing.example'), defaultSiteInteraction);
  assert.equal(siteAllows(undefined, 'example.com'), true);
  assert.equal(siteAllows(sites, 'example.com'), false);
  assert.equal(siteDraws(sites, 'example.com'), false);
  assert.equal(siteDraws(sites, 'gmgn.ai'), true, '引用 keeps the layer with 信号 off');
  assert.equal(siteAllows(sites, 'gmgn.ai', 'danmaku'), true);
  assert.equal(siteDraws(undefined, 'missing.example'), true);
});

test('the master switch in 设置 › 网页互动 stops every site and each feature everywhere, keeping each site\'s own choice', () => {
  assert.deepEqual(readSiteInteractions({ [ALL_SITES]: { on: false } }), { [ALL_SITES]: { ...defaultSiteInteraction, on: false } });
  const off = { [ALL_SITES]: { ...defaultSiteInteraction, on: false }, 'gmgn.ai': { ...defaultSiteInteraction, signal: false } };
  assert.equal(allSites(off).on, false);
  assert.equal(siteAllows(off, 'example.com'), false);
  assert.equal(siteDraws(off, 'gmgn.ai'), false);
  assert.equal(siteInteraction(off, 'gmgn.ai').signal, false, 'the site keeps its own choice');
  const noChart = { [ALL_SITES]: { ...defaultSiteInteraction, chart: false } };
  assert.equal(siteAllows(noChart, 'example.com'), true);
  assert.equal(siteAllows(noChart, 'example.com', 'chart'), false);
  assert.equal(siteAllows(noChart, 'example.com', 'signal'), true);
  assert.equal(siteAllows(noChart, ALL_SITES), false, 'the master entry is not a site');
  assert.deepEqual(withSiteInteraction(off, ALL_SITES, defaultSiteInteraction), { 'gmgn.ai': off['gmgn.ai'] }, 'back at the default it keeps no entry');
});

test('favorites keep exact hosts and page scopes, deduplicated and bounded', () => {
  const value = readFavorites({ sites: ['GMGN.ai', 'gmgn.ai'], pages: [{ url: 'https://gmgn.ai/sol/token/abc?utm_source=x', title: ' PONS ' }, { url: 'https://gmgn.ai/sol/token/abc', title: 'dup' }] });
  assert.deepEqual(value?.sites, ['gmgn.ai']);
  assert.equal(value?.pages.length, 1);
  assert.equal(value?.pages[0].title, 'PONS');
  assert.equal(readFavorites({ sites: ['localhost'], pages: [] }), undefined);
  assert.equal(readFavorites({ sites: [], pages: [{ url: 'chrome://settings', title: 'x' }] }), undefined);
  assert.equal(readFavorites({ sites: Array.from({ length: 201 }, (_, i) => `s${i}.example.com`), pages: [] }), undefined);
  assert.equal(readFavorites({ sites: [], pages: [], extra: 1 }), undefined);
});


test('favorite titles count graphemes including composed emoji and combining marks', () => {
  for (const grapheme of ['👨‍👩‍👧‍👦', 'e\u0301', '🇹🇼']) {
    const title = grapheme.repeat(200);
    assert.equal(readFavorites({ sites: [], pages: [{ url: 'https://example.com/', title }] }).pages[0].title, title);
    assert.equal(readFavorites({ sites: [], pages: [{ url: 'https://example.com/', title: title + grapheme }] }), undefined);
  }
});

test('a site set back to the default keeps no entry, so an account that changed many sites can still change one more', () => {
  const off = { ...defaultSiteInteraction, on: false };
  let sites = {};
  for (let n = 0; n < 600; n++) sites = withSiteInteraction(sites, `site${n}.example`, n % 2 ? off : defaultSiteInteraction);
  assert.equal(Object.keys(sites).length, 300);
  assert.ok(readSiteInteractions(withSiteInteraction(sites, 'new.example', off)), 'the next site still saves');
  assert.deepEqual(withSiteInteraction({ 'a.example': off }, 'a.example', defaultSiteInteraction), {});
});
