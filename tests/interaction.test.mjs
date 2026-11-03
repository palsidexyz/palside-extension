import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSiteInteraction, siteAllows, siteDraws, siteInteraction, readFavorites, readSiteInteractions } from '../apps/extension/src/domain/annotations/interaction.ts';

test('per-site interaction preferences fill defaults, normalize hosts, and reject invalid settings', () => {
  assert.deepEqual(readSiteInteractions({}), {});
  assert.deepEqual(readSiteInteractions({ 'GMGN.ai': { signal: false } }), { 'gmgn.ai': { ...defaultSiteInteraction, signal: false } });
  for (const input of [null, [], { 'localhost': { on: true } }, { 'example.com': { unknown: true } }, { 'example.com': { danmaku: 'yes' } }]) assert.equal(readSiteInteractions(input), undefined);
});

test('site interaction controls each page feature and draws only squad annotations', () => {
  const sites = { 'example.com': { ...defaultSiteInteraction, on: false }, 'gmgn.ai': { ...defaultSiteInteraction, signal: false, sticky: false } };
  assert.deepEqual(siteInteraction(sites, 'missing.example'), defaultSiteInteraction);
  assert.equal(siteAllows(undefined, 'example.com'), true);
  assert.equal(siteAllows(sites, 'example.com'), false);
  assert.equal(siteDraws(sites, 'example.com'), false);
  assert.equal(siteDraws(sites, 'gmgn.ai'), false);
  assert.equal(siteAllows(sites, 'gmgn.ai', 'danmaku'), true);
  assert.equal(siteDraws(undefined, 'missing.example'), true);
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
