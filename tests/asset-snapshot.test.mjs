import test from 'node:test';
import assert from 'node:assert/strict';
import { assetView } from '../apps/extension/src/domain/assets/model.ts';

test('chosen card snapshot survives later page metadata changes and missing live entries', () => {
  const saved = { id: 'token', name: 'Selected', address: '0x1', logo: 'selected.webp' };
  const attachment = { kind: 'asset', assetId: 'token', view: saved };
  assert.equal(assetView(attachment, [{ ...saved, name: 'Changed', logo: 'changed.webp' }]), saved);
  assert.equal(assetView(attachment, []), saved);
  assert.equal(assetView({ kind: 'image', src: '', name: '' }, [saved]), undefined);
});
test('missing or mismatched snapshots do not read mutable live data', () => {
  const saved = { id: 'token', name: 'Correct' };
  assert.equal(assetView({ kind: 'asset', assetId: 'token' }, [saved]), undefined);
  assert.equal(assetView({ kind: 'asset', assetId: 'token', view: { id: 'other' } }, [saved]), undefined);
  assert.equal(assetView(undefined, [saved]), undefined);
});

test('website page cards keep their immutable snapshot', () => {
  const saved = { version: 1, id: 'website:x:page', kind: 'website', disclosure: 'page', name: 'A post', source: 'x.com', url: 'https://x.com/example/status/1', color: '#e9edf0', glyph: 'X', logo: 'data:image/png;base64,AA' };
  const attachment = { kind: 'asset', assetId: saved.id, view: saved };
  assert.equal(assetView(attachment, [saved]).source, 'x.com');
  assert.equal(assetView(attachment, []).name, 'A post');
});
