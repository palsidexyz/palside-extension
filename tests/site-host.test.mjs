import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { siteDefinitions, websiteUrl } from '../packages/shared/src/navigation.ts';
import { normalizeSiteHost } from '../apps/extension/src/domain/assets/site-host.ts';
import { defaultSiteInteraction, readFavorites, readSiteInteractions, siteAllows, siteDraws } from '../apps/extension/src/domain/annotations/interaction.ts';
import { startedTeams } from '../apps/extension/src/runtime/teams/onboarding.ts';

const source = ts.createSourceFile('state.ts', readFileSync('apps/extension/src/runtime/composition/state.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source).replace(/^export /, '')).join('\n');
const context = { defaultSiteInteraction, readFavorites, readSiteInteractions, startedTeams };
vm.runInNewContext(ts.transpileModule(`${declarations}\nglobalThis.readPreferences = readPreferences; globalThis.readPreferencePatch = readPreferencePatch;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { readPreferences, readPreferencePatch } = context;
const plain = value => JSON.parse(JSON.stringify(value));

test('site hosts normalize case, IDN and root dots without broadening subdomains', () => {
  assert.equal(normalizeSiteHost(' GMGN.AI. '), 'gmgn.ai');
  assert.equal(normalizeSiteHost('例子.公司.cn'), 'xn--fsqu00a.xn--55qx5d.cn');
  assert.equal(normalizeSiteHost('WWW.Example.COM'), 'www.example.com');
  for (const input of [undefined, null, 1, {}, '', 'https://gmgn.ai', '//gmgn.ai', 'gmgn.ai:443', 'user@gmgn.ai', 'gmgn.ai/path', 'gmgn.ai?key=value', 'gmgn.ai#hash', '*.gmgn.ai', 'gmgn.ai\\path', 'gmgn%2eai', 'gmg n.ai', 'gmgn..ai', '-bad.com', 'bad_.com', `${'a'.repeat(64)}.com`, 'a.'.repeat(128) + 'com', 'localhost', 'localhost.', 'sub.localhost', 'router.local', 'printer.internal', 'machine.lan', 'router.home.arpa', '10.0.0.1', '127.1', '0x7f000001', '192.168.0.1', '172.16.0.1', '[::1]', '8.8.8.8']) {
    assert.equal(normalizeSiteHost(input), undefined, String(input));
  }
});

test('site settings share URL host exclusions while requiring a DNS host', () => {
  for (const host of ['localhost', 'sub.localhost', 'box.local', 'printer.internal', 'office.intranet', 'router.lan', 'router.home', 'home.arpa', 'router.home.arpa']) {
    for (const spelling of [host, `${host.toUpperCase()}.`]) {
      assert.equal(normalizeSiteHost(spelling), undefined, spelling);
      assert.equal(websiteUrl(`https://${spelling}/page`), null, spelling);
    }
  }
  assert.equal(websiteUrl('https://8.8.8.8/page').hostname, '8.8.8.8');
  assert.equal(normalizeSiteHost('8.8.8.8'), undefined);
  assert.equal(websiteUrl('https://GMGN.AI./page').hostname, normalizeSiteHost('GMGN.AI.'));
  assert.equal(normalizeSiteHost('https://gmgn.ai/page'), undefined);
});

test('per-site 网页互动 defaults on and accepts only normalized hosts and boolean feature switches', () => {
  assert.deepEqual(defaultSiteInteraction, { on: true, danmaku: true, signal: true, chart: true });
  assert.equal(siteDefinitions.some(site => 'defaults' in site || 'quickStart' in site), false, 'the registry presets no site');
  assert.deepEqual(readSiteInteractions({ 'GMGN.AI.': { on: false, signal: false }, 'birdeye.so': { danmaku: false } }), {
    'gmgn.ai': { ...defaultSiteInteraction, on: false, signal: false }, 'birdeye.so': { ...defaultSiteInteraction, danmaku: false },
  });
  for (const value of [undefined, null, [], true, { 'localhost': { on: false } }, { 'gmgn.ai': { on: 1 } }, { 'gmgn.ai': { danmaku: 'no' } }, { 'gmgn.ai': { share: true } }, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`s${i}.com`, {}]))]) {
    assert.equal(readSiteInteractions(value), undefined, 'invalid site settings rejected');
  }
  assert.equal(siteAllows(undefined, 'gmgn.ai'), true, 'sites without an entry default on');
  assert.equal(siteAllows({ 'gmgn.ai': { ...defaultSiteInteraction, on: false } }, 'gmgn.ai'), false);
  assert.equal(siteAllows({ 'gmgn.ai': { ...defaultSiteInteraction, signal: false } }, 'gmgn.ai', 'signal'), false);
  assert.equal(siteDraws({ 'gmgn.ai': { ...defaultSiteInteraction, signal: false } }, 'gmgn.ai'), true);
  assert.equal(siteDraws({ 'gmgn.ai': { ...defaultSiteInteraction, on: false } }, 'gmgn.ai'), false);
});

test('restore preserves valid optional preferences and ignores unknown fields', () => {
  const saved = { current: 'team', notifications: 'mentions', share: true, siteInteraction: { 'gmgn.ai': { ...defaultSiteInteraction, on: false } }, notificationPreview: false, forgottenTeams: ['old-team'], startedTeams: ['team'] };
  assert.deepEqual(plain(readPreferences(saved)), saved);
  assert.deepEqual(plain(readPreferences({})), { current: '', notifications: 'off', startedTeams: [] });
  assert.equal(readPreferences({ siteInteraction: { 'gmgn.ai': { on: 'false' } } }).siteInteraction, undefined, 'a malformed value is ignored');
  const restored = readPreferences({ unknownRules: { 'x.com': { share: true, interact: true } }, unknownChoice: true, unknownSites: [{ name: 'Example', domain: 'example.com' }], unknownHosts: ['example.com'], unknownList: ['gmgn.ai'], unknownFlag: false, notificationPreview: 'yes', forgottenTeams: [1], unknownTeams: ['team'], unknownField: false, unknownOption: false, tokenOff: ['gmgn.ai'], current: 5, notifications: 'invalid' });
  assert.deepEqual(Object.keys(restored).sort(), ['current', 'notifications', 'startedTeams']);
  assert.equal(restored.notifications, 'off'); assert.equal(restored.current, '');
});

test('generic preference patches accept optional fields and reject unknown or malformed values', () => {
  assert.deepEqual(plain(readPreferencePatch({ notificationPreview: false, forgottenTeams: ['one', 'one'], notifications: 'all', current: 'one' })), { notificationPreview: false, forgottenTeams: ['one'], notifications: 'all', current: 'one' });
  assert.deepEqual(plain(readPreferencePatch({ share: true, siteInteraction: { 'GMGN.ai': { on: false } } })), { share: true, siteInteraction: { 'gmgn.ai': { ...defaultSiteInteraction, on: false } } });
  for (const patch of [{ unknownRules: {} }, { unknownChoice: true }, { unknownSites: [] }, { unknownHosts: [] }, { unknownList: [] }, { unknownFlag: false }, { current: false }, { notifications: true }, { notificationPreview: 'true' }, { forgottenTeams: [1] }, { unknownTeams: ['one'] }, { unknownTeams: {} }, { web: { share: true } }, { interaction: {} }, { tokenOff: ['gmgn.ai'] }, { siteInteraction: { 'gmgn.ai': { on: 1 } } }]) assert.equal(readPreferencePatch(patch), undefined, JSON.stringify(patch));
  assert.deepEqual(plain(readPreferencePatch({ startedTeams: ['invented'] })), {});
});

test('unknown preference fields are rejected by patches and omitted on restore', () => {
  for (const patch of [{ unknownField: false }, { unknownField: true }, { unknownOption: false }, { unknownOption: true }, { unknownState: true }]) assert.equal(readPreferencePatch(patch), undefined, JSON.stringify(patch));
  const restored = readPreferences({ unknownField: false, unknownOption: false, unknownState: true });
  assert.equal(Object.hasOwn(restored, 'unknownField'), false);
  assert.equal(Object.hasOwn(restored, 'unknownOption'), false);
  assert.equal(Object.hasOwn(restored, 'unknownState'), false);
});
