import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedTokens } from '../apps/extension/src/domain/assets/shared-tokens.ts';

const now = 20 * 86_400_000;
const view = (suffix, name = suffix) => ({ id: suffix, kind: 'asset', chain: 'Ethereum', address: `0x${suffix.padStart(40, '0')}`, name, source: 'DEX Screener', url: `https://dexscreener.com/ethereum/${suffix}`, color: '#000', glyph: name });
const asset = value => `${value.chain}:${value.address}`;
const a = view('abc'), b = view('def');
const message = (id, patch = {}) => ({ id, teamId: 'team', author: 'friend', status: 'sent', text: '', time: '12:00', timestamp: now - 10, expiresAt: now + 100, ...patch });
const card = value => ({ kind: 'asset', assetId: value.id, view: value });
const ref = value => ({ view: value, target: { kind: 'quote', exact: 'Public text', prefix: '', suffix: '' }, caption: 'Public text' });

test('shared tokens count each asset once per message and include token references but exclude ordinary webpages', () => {
  const website = { ...a, id: 'web', kind: 'website', name: 'News', url: 'https://example.com/news' };
  const messages = [message('both', { attachment: card(a), ref: ref(a) }), message('reference', { ref: ref(a) }), message('two-tokens', { attachment: card(a), ref: ref(b) }), message('website-ref', { ref: ref(website) }), message('website-card', { attachment: card(website) })];
  const tokens = sharedTokens({ messages, now, order: 'discussed' });
  assert.deepEqual(tokens.map(item => [item.asset, item.messages]), [[asset(a), 3], [asset(b), 1]]);
});

test('shared tokens include retained messages and omit expired, recalled, pending and future messages', () => {
  const timestamp = now - 12 * 86_400_000;
  const messages = [message('retained', { timestamp, attachment: card(a) }), message('retained-older', { timestamp: timestamp - 1, attachment: card(b) }), message('expired', { expiresAt: now, attachment: card(a) }), message('recalled', { recalled: true, attachment: card(a) }), message('removed', { removedByOwner: true, attachment: card(a) }), message('pending', { status: 'sending', attachment: card(a) }), message('future', { timestamp: now + 1, attachment: card(a) }), message('untimed', { timestamp: undefined, attachment: card(a) }), message('nan', { timestamp: NaN, attachment: card(a) })];
  const input = { messages, now };
  assert.deepEqual(sharedTokens({ ...input, order: 'recent' }).map(item => [item.asset, item.messages]), [[asset(a), 1], [asset(b), 1]]);
});

test('recent and discussed orders reuse one list with latest source and message attribution', () => {
  const latestA = view('abc', 'Latest A');
  const messages = [message('a-old', { timestamp: now - 20, attachment: card(a) }), message('a-new', { timestamp: now - 10, ref: ref(latestA) }), message('b-new', { timestamp: now - 1, attachment: card(b) })];
  const input = { messages, now };
  const recent = sharedTokens({ ...input, order: 'recent' });
  const discussed = sharedTokens({ ...input, order: 'discussed' });
  assert.deepEqual(recent.map(item => item.asset), [asset(b), asset(a)]);
  assert.deepEqual(discussed.map(item => item.asset), [asset(a), asset(b)]);
  assert.equal(discussed[0].view, latestA);
  assert.equal(discussed[0].lastMessage, messages[1]);
});

test('tied timestamps and counts have deterministic source selection and asset order', () => {
  const later = view('abc', 'Chosen');
  const messages = [message('z', { attachment: card(later) }), message('a', { attachment: card(a) }), message('b1', { attachment: card(b) }), message('b2', { attachment: card(b) })];
  const input = { messages, now, order: 'discussed' };
  const tokens = sharedTokens(input);
  assert.equal(tokens[0].asset, asset(a));
  assert.equal(tokens[0].view.name, 'Chosen');
  assert.deepEqual(sharedTokens({ ...input, messages: [...messages].reverse() }), tokens);
});

