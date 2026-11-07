import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/runtime/signals.ts') && specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { readSignal, SIGNAL_CLOCK_SKEW, signalKinds, signalEmotes, defaultWheel, wheelIcon, normalizeSignalSettings, signalIdentityUrl } = await import('../apps/extension/src/runtime/annotations/signals.ts');
hooks.deregister();
const now = 100_000;
const spot = (...anchors) => ({ kind: 'spot', anchors });
const base = () => ({ id: '0123456789abcdef', teamId: 'team', url: 'https://example.com/page?a=1', sentAt: now, kind: 'attention', target: { kind: 'page' } });

test('signals accept every supported kind and nearest-first anchors', () => {
  for (const kind of signalKinds) assert.equal(readSignal({ ...base(), kind }, now).kind, kind);
  const target = spot({ kind: 'quote', exact: 'Public text', prefix: '', suffix: '', nth: 1, of: 3 }, { kind: 'element', tag: 'button', label: 'Buy', nth: 0, of: 1, x: 0.5, y: 0.5 }, { kind: 'chart', x: 0.2, y: 0.8 });
  assert.deepEqual(readSignal({ ...base(), target, emote: 'popcorn' }, now).target, target);
  // Clocks disagree between members: a send time within the skew window is accepted either way.
  for (const sentAt of [now - SIGNAL_CLOCK_SKEW, now + SIGNAL_CLOCK_SKEW]) assert.ok(readSignal({ ...base(), sentAt }, now));
});

test('signal schema rejects malformed, stale, future and private payloads', () => {
  for (const patch of [
    { id: 'short' }, { id: 'a'.repeat(65) }, { teamId: '' }, { kind: 'unknown' },
    { sentAt: now - SIGNAL_CLOCK_SKEW - 1 }, { sentAt: now + SIGNAL_CLOCK_SKEW + 1 }, { sentAt: Infinity }, { sentAt: '100000' },
    { url: '' }, { url: 'https://EXAMPLE.com/page' }, { url: 'http://localhost/private' }, { url: 'javascript:alert(1)' },
    { target: null }, { target: { kind: 'region', selector: 'canvas', x: .5, y: .5 } },
    { target: spot({ kind: 'quote', exact: '', prefix: '', suffix: '', nth: 0, of: 1 }) }, { target: { kind: 'quote', exact: 'Public text', prefix: '', suffix: '' } },
    { target: spot() }, { target: spot(...Array(5).fill({ kind: 'chart', x: 0, y: 0 })) }, { target: spot({ kind: 'chart', x: 2, y: 0 }) },
    { target: spot({ kind: 'quote', exact: 'Public text', prefix: '', suffix: '' }) }, { target: spot({ kind: 'quote', exact: 'Public text', prefix: '', suffix: '', nth: 1, of: 1 }) },
    { target: spot({ kind: 'quote', exact: 'Public text', prefix: '', suffix: '', nth: 0, of: 33 }) }, { emote: '../image' }, { emote: 'x'.repeat(65) },
  ]) assert.equal(readSignal({ ...base(), ...patch }, now), undefined, JSON.stringify(patch));
  for (const value of [null, false, 'text', []]) assert.equal(readSignal(value, now), undefined);
});

test('element schema validates bounded semantic identity and public URLs', () => {
  const target = { kind: 'element', tag: 'img', src: 'https://example.com/hero.png', nth: 0, of: 1, x: 0.25, y: 0.75 };
  assert.deepEqual(readSignal({ ...base(), target: spot(target) }, now).target, spot(target));
  for (const patch of [{ src: 'https://example.com/account/photo' }, { id: 'walletBalance' }]) assert.ok(readSignal({ ...base(), target: spot({ ...target, ...patch }) }, now), JSON.stringify(patch));
  for (const patch of [
    { x: Infinity }, { y: -0.1 }, { x: 1.1 }, { x: '0.5' }, { tag: 'input' },
    { src: 'javascript:alert(1)' }, { src: 'https://localhost/photo.png' },
    { src: 'https://example.com/a?token=secret' }, { src: 'https://example.com/a#token=secret' },
    { src: 'https://example.com/' + 'x'.repeat(2048) }, { label: 'x'.repeat(161) },
    { id: 'bad selector]' },
    { src: undefined, path: 'img:nth-child(2)' }, { src: undefined, role: 'img' },
    { tag: 'canvas', src: undefined, text: 'Chart' },
  ]) assert.equal(readSignal({ ...base(), target: spot({ ...target, ...patch }) }, now), undefined, JSON.stringify(patch));
});

test('signal page and element URLs share credential and local-host exclusions', () => {
  for (const name of ['token', 'access_token', 'refreshToken', 'id_token', 'auth', 'authorization', 'jwt', 'sessionId', 'apiKey', 'secret', 'password', 'signature', 'credential', 'X-Amz-Signature']) {
    for (const suffix of [`?${name}=secret`, `#/page?x=1&${name}=secret`]) {
      const url = 'https://example.com/article' + suffix;
      assert.equal(signalIdentityUrl(url), undefined, url);
      assert.equal(readSignal({ ...base(), url }, now), undefined, url);
      assert.equal(readSignal({ ...base(), target: spot({ kind: 'element', tag: 'a', href: url, nth: 0, of: 1, x: .5, y: .5 }) }, now), undefined, url);
    }
  }
  for (const host of ['LOCALHOST.', 'box.local.', 'printer.internal.', 'router.home.arpa', 'sub.localhost']) {
    const url = `https://${host}/page`;
    assert.equal(signalIdentityUrl(url), undefined, url);
    assert.equal(readSignal({ ...base(), url }, now), undefined, url);
  }
});

test('signal identity allows catalog coin-route tokens and ordinary public parameters', () => {
  const address = '0x39dbed3a2bd333467115de45665cc57f813c4571';
  for (const suffix of [`?token=${address}`, `#/page?x=1&token=${address}`]) {
    const url = `https://gmgn.ai/base/token/${address}${suffix}`;
    assert.equal(signalIdentityUrl(url), url);
    assert.equal(readSignal({ ...base(), url }, now).url, url);
    const target = spot({ kind: 'element', tag: 'a', href: url, nth: 0, of: 1, x: .5, y: .5 });
    assert.deepEqual(readSignal({ ...base(), target }, now).target, target);
    // On token sites a `token` parameter holding a contract address is page identity, not a credential.
    assert.equal(signalIdentityUrl('https://gmgn.ai/article' + suffix), 'https://gmgn.ai/article' + suffix);
    assert.equal(signalIdentityUrl(`https://dexscreener.com/base/${address}${suffix}`), `https://dexscreener.com/base/${address}${suffix}`);
    assert.equal(signalIdentityUrl('https://gmgn.ai/article?token=secret-session-value'), undefined);
  }
  const url = 'https://example.com/article?author=alice&tokenSymbol=PALS#/page?x=1';
  assert.equal(signalIdentityUrl(url), url);
  // Only technical exclusions apply: an ordinary path such as /account is a public page like any other.
  assert.equal(signalIdentityUrl('https://example.com/account'), 'https://example.com/account');
});

test('signal parsing removes untrusted identity fields and copies the target', () => {
  const value = { ...base(), personId: 'forged', target: { kind: 'page', x: .5 } };
  const parsed = readSignal(value, now);
  assert.equal(parsed.personId, undefined);
  assert.deepEqual(parsed.target, { kind: 'page' });
  assert.notEqual(parsed.target, value.target);
});

test('signal settings keep bounded volume and known shortcut choices', () => {
  assert.equal(normalizeSignalSettings({ volume: 999 }).volume, 100);
  assert.equal(normalizeSignalSettings({ volume: -10 }).volume, 0);
  assert.equal(normalizeSignalSettings({ volume: NaN }).volume, 30);
  assert.deepEqual(normalizeSignalSettings({}).key, ['Alt']);
  assert.deepEqual(normalizeSignalSettings({ key: ['Shift', 'Control'] }).key, ['Control', 'Shift']);
  assert.deepEqual(normalizeSignalSettings({ key: ['Meta'] }).key, ['Alt']);
  assert.deepEqual(normalizeSignalSettings({ key: ['Alt', 'Meta'] }).key, ['Alt']);
  assert.deepEqual(normalizeSignalSettings({ key: [] }).key, ['Alt']);
  assert.deepEqual(normalizeSignalSettings({}).wheel, ['danger', 'watch', 'together', 'agree', 'gm', 'attention', 'question', 'paper-hands']);
  const wheel = normalizeSignalSettings({ wheel: ['help', 'help', 'nope', 'popcorn'] }).wheel;
  assert.deepEqual(wheel.slice(0, 2), ['help', 'popcorn']);
  assert.equal(wheel.length, 8); assert.equal(new Set(wheel).size, 8);
});
test('unsupported wheel entries use the defaults', () => {
  assert.deepEqual(normalizeSignalSettings({ wheel: ['unknown-emote-a', 'unknown-emote-b', 'unknown-emote-c'] }).wheel, [...defaultWheel]);
});
test('every signal and emote ships its art, wheel still, sound and names', () => {
  const root = new URL('../apps/extension/public/signals/', import.meta.url);
  const has = path => existsSync(new URL(path, root));
  const zh = JSON.parse(readFileSync(new URL('../packages/i18n/src/zh-CN.json', import.meta.url), 'utf8')).extension.signal;
  const en = JSON.parse(readFileSync(new URL('../packages/i18n/src/en.json', import.meta.url), 'utf8')).extension.signal;
  for (const kind of signalKinds) {
    assert.ok(has(`art/${kind}.svg`) && has(`sounds/${kind}.m4a`), kind);
    assert.ok(zh[kind] && en[kind], kind);
  }
  for (const emote of signalEmotes) {
    assert.ok(has(`emotes/${emote}.webp`) && has(`thumbs/${emote}.webp`) && has(`sounds/${emote}.m4a`), emote);
    assert.ok(zh[`emote_${emote}`] && en[`emote_${emote}`], emote);
  }
  assert.ok(has('sounds/tick.m4a'));
  for (const entry of [...signalKinds, ...signalEmotes]) assert.ok(has(wheelIcon(entry)), entry);
});
