import test from 'node:test';
import assert from 'node:assert/strict';
import { pageName } from '../apps/extension/src/runtime/viewing/page-title.ts';

test('cleans token and market titles', () => {
  assert.equal(pageName('PEPE $0.00001 | GMGN.AI', 'gmgn.ai'), 'PEPE');
  assert.equal(pageName('+12.3% PEPE – Birdeye', 'birdeye.so'), 'PEPE');
  assert.equal(pageName('SOL / USDC | DEX Screener', 'dexscreener.com'), 'SOL / USDC');
  assert.equal(pageName('$0.00001 PEPE · AXIOM', 'axiom.trade'), 'PEPE');
  assert.equal(pageName('$CASHCAT +12.5% | Price, Chart & Holders | DEX Screener', 'dexscreener.com'), '$CASHCAT');
  assert.equal(pageName('Birdeye - BONK Price', 'birdeye.so'), 'BONK');
  assert.equal(pageName('Elon Musk on X: "hello" / X', 'x.com'), 'Elon Musk on X: "hello"');
});

test('cleans common site titles and keeps useful page names', () => {
  assert.equal(pageName('A post on X | X.com', 'x.com'), 'A post on X');
  assert.equal(pageName('Fix parser bug · GitHub', 'github.com'), 'Fix parser bug');
  assert.equal(pageName('Example article | Example', 'example.com'), 'Example article');
  assert.equal(pageName('github.com', 'github.com'), undefined);
});

test('collapses whitespace and truncates by grapheme', () => {
  assert.equal(pageName('  Hello   world  ', 'example.com'), 'Hello world');
  const long = pageName(`${'界'.repeat(100)} | Example`, 'example.com');
  assert.equal(Array.from(long).length, 80);
});
