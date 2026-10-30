import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenLogo, tokenLogoSource, validateTokenLogo } from '../apps/extension/src/runtime/viewing/token-logo.ts';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7N0AAAAASUVORK5CYII=';
test('token PNG snapshots are bounded by bytes, dimensions, signature independent of website', () => {
  assert.equal(tokenLogo(png),png);
  assert.equal(tokenLogo('data:image/svg+xml;base64,PHN2Zz4='),undefined);
  assert.equal(tokenLogo('data:image/png;base64,'+'A'.repeat(32768)),undefined);
  assert.equal(tokenLogo('data:image/png;base64,YWJj'),undefined);
  const data=Buffer.from(png.slice(22),'base64');data.writeUInt32BE(4096,16);
  assert.equal(tokenLogo('data:image/png;base64,'+data.toString('base64')),undefined);
});
test('embedded PNG validation does not conflate URLs with image bytes', () => {
  assert.equal(tokenLogo('https://gmgn.ai/external-res/a.webp?ref=secret'),undefined);
  assert.equal(tokenLogo('https://gmgn.ai/external-res/a.webp'),undefined);
  assert.equal(tokenLogo('https://user:password@gmgn.ai/external-res/a.webp'),undefined);
  assert.equal(tokenLogo('https://evil.example/a.png'),undefined);
});
test('public logo sources preserve only explicit HTTPS image paths', async () => {
  const mobula='https://metadata.mobula.io/assets/logos/'+'a'.repeat(64)+'.png';
  for(const url of [mobula,'https://gmgn.ai/external-res/token_v2.webp','https://cdn.dexscreener.com/cms/images/public-token']) {
    assert.equal(tokenLogoSource(url+'?tracking=discard#fragment'),url);
    assert.equal(await validateTokenLogo(url),url);
  }
  for(const url of ['https://metadata.mobula.io/account','https://metadata.mobula.io/assets/logos/a.svg','https://metadata.mobula.io.evil.example/assets/logos/'+ 'a'.repeat(64)+'.png','https://gmgn.ai/portfolio','http://gmgn.ai/external-res/a.png','https://u:p@gmgn.ai/external-res/a.png','https://127.0.0.1/a.png','https://gmgn.ai:444/external-res/a.png','https://gmgn.ai/external-res/%2e%2e/private.png']) assert.equal(tokenLogoSource(url),undefined);
});

test('embedded thumbnail limits reject oversized bytes and dimensions', () => {
 const bytes=Buffer.from(png.slice(22),'base64');
 for(const dimension of [49,4096]) { const large=Buffer.from(bytes);large.writeUInt32BE(dimension,16);assert.equal(tokenLogo('data:image/png;base64,'+large.toString('base64')),undefined); }
 const padded=Buffer.alloc(8001);bytes.copy(padded);assert.equal(tokenLogo('data:image/png;base64,'+padded.toString('base64')),undefined);
});
