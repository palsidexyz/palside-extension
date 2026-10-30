import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { siteDefinitions, websiteUrl } from '../packages/shared/src/navigation.ts';
import { normalizeSiteHost } from '../apps/extension/src/domain/assets/site-host.ts';
import { defaultWebFeatures, readFavorites, readHosts, readInteraction, readWebFeatures } from '../apps/extension/src/domain/annotations/interaction.ts';
import { startedTeams } from '../apps/extension/src/runtime/teams/onboarding.ts';

const source = ts.createSourceFile('state.ts', readFileSync('apps/extension/src/runtime/composition/state.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source).replace(/^export /, '')).join('\n');
const context = { defaultWebFeatures, readFavorites, readHosts, readInteraction, readWebFeatures, startedTeams };
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

test('设置 › 网页 starts with 共享在看 and 网页互动 启用, and only exact booleans are accepted', () => {
  assert.deepEqual(defaultWebFeatures, { share: true, interact: true });
  assert.equal(siteDefinitions.some(site => 'defaults' in site || 'quickStart' in site), false, 'the registry presets no site');
  assert.deepEqual(readWebFeatures({ share: false, interact: true }), { share: false, interact: true });
  assert.deepEqual(readWebFeatures({ interact: false, share: true }), { share: true, interact: false });
  for (const value of [undefined, null, [], true, {}, { share: true }, { interact: false }, { share: 1, interact: false }, { share: true, interact: 'no' }, { share: true, interact: false, tabs: true }]) {
    assert.equal(readWebFeatures(value), undefined, JSON.stringify(value));
  }
  const input = { share: true, interact: true };
  const value = readWebFeatures(input);
  value.share = false;
  assert.equal(input.share, true, 'the returned value is a copy');
});

test('host lists are exact public hosts, deduplicated in order and bounded', () => {
  assert.deepEqual(readHosts(['GMGN.AI.', 'gmgn.ai', 'birdeye.so']), ['gmgn.ai', 'birdeye.so']);
  assert.deepEqual(readHosts([]), []);
  for (const value of [undefined, null, {}, 'gmgn.ai', ['https://gmgn.ai'], ['localhost'], ['*.gmgn.ai'], [1], Array.from({ length: 501 }, (_, i) => `s${i}.com`)]) {
    assert.equal(readHosts(value), undefined, JSON.stringify(value)?.slice(0, 60));
  }
});

test('restore preserves valid optional preferences and ignores unknown fields', () => {
  const saved = { current: 'team', notifications: 'mentions', web: { share: false, interact: true }, notificationPreview: false, hiddenStickies: ['sticky'], tokenOff: ['gmgn.ai'], restoreSites: ['birdeye.so'], startedTeams: ['team'] };
  assert.deepEqual(plain(readPreferences(saved)), saved);
  assert.deepEqual(plain(readPreferences({}).web), { share: true, interact: true });
  assert.deepEqual(plain(readPreferences({ web: { share: false } }).web), { share: true, interact: true }, 'a malformed value falls back to the default');
  const restored = readPreferences({ unknownRules: { 'x.com': { share: true, interact: true } }, unknownChoice: true, unknownSites: [{ name: 'Example', domain: 'example.com' }], unknownHosts: ['example.com'], unknownList: ['gmgn.ai'], unknownFlag: false, notificationPreview: 'yes', hiddenStickies: [1], unknownTeams: ['team'], unknownField: false, unknownOption: false, tokenOff: ['https://x.com'], current: 5, notifications: 'invalid' });
  assert.deepEqual(Object.keys(restored).sort(), ['current', 'notifications', 'startedTeams', 'web']);
  assert.equal(restored.notifications, 'off'); assert.equal(restored.current, '');
});

test('generic preference patches accept optional fields and reject unknown or malformed values', () => {
  assert.deepEqual(plain(readPreferencePatch({ notificationPreview: false, hiddenStickies: ['one', 'one'], notifications: 'all', current: 'one' })), { notificationPreview: false, hiddenStickies: ['one'], notifications: 'all', current: 'one' });
  assert.deepEqual(plain(readPreferencePatch({ web: { share: false, interact: true }, tokenOff: ['GMGN.ai', 'gmgn.ai'], restoreSites: [] })), { web: { share: false, interact: true }, tokenOff: ['gmgn.ai'], restoreSites: [] });
  for (const patch of [{ unknownRules: {} }, { unknownChoice: true }, { unknownSites: [] }, { unknownHosts: [] }, { unknownList: [] }, { unknownFlag: false }, { current: false }, { notifications: true }, { notificationPreview: 'true' }, { hiddenStickies: [1] }, { unknownTeams: ['one'] }, { unknownTeams: {} }, { web: { share: true } }, { tokenOff: ['localhost'] }, { restoreSites: 'gmgn.ai' }]) assert.equal(readPreferencePatch(patch), undefined, JSON.stringify(patch));
  assert.deepEqual(plain(readPreferencePatch({ startedTeams: ['invented'] })), {});
});

test('unknown preference fields are rejected by patches and omitted on restore', () => {
  for (const patch of [{ unknownField: false }, { unknownField: true }, { unknownOption: false }, { unknownOption: true }, { unknownState: true }]) assert.equal(readPreferencePatch(patch), undefined, JSON.stringify(patch));
  const restored = readPreferences({ unknownField: false, unknownOption: false, unknownState: true });
  assert.equal(Object.hasOwn(restored, 'unknownField'), false);
  assert.equal(Object.hasOwn(restored, 'unknownOption'), false);
  assert.equal(Object.hasOwn(restored, 'unknownState'), false);
});
