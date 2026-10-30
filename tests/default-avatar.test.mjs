import test from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { defaultAvatar, defaultAvatarNames, defaultAvatarOptions } from '../apps/extension/src/features/palside/account/default-avatar.ts';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('default portraits are account-stable and map to the complete bundled collection', async()=>{
  assert.equal(defaultAvatar(''),undefined);
  assert.equal(defaultAvatar('member-42'),defaultAvatar('member-42'));
  const manifest=JSON.parse(await readFile(new URL('../packages/design/assets/avatars/sources.json',import.meta.url),'utf8'));
  assert.equal(defaultAvatarNames.length,24);
  assert.deepEqual(manifest.map(a=>a.id),[...defaultAvatarNames]);
  const expected=new Set(defaultAvatarNames.map(id=>`/avatars/avatar-${id}.webp`));
  const assigned=new Set(Array.from({length:512},(_,i)=>defaultAvatar(`member-${i}`)));
  assert.deepEqual(assigned,expected);
  const actual = (await readdir(new URL('../packages/design/assets/avatars/',import.meta.url))).filter(file=>file.endsWith('.webp')).sort();
  assert.deepEqual(actual,manifest.map(asset=>asset.file).sort(),'Bundled portraits match the manifest');
  assert.equal(new Set(manifest.map(asset=>asset.sha256)).size,24);
  for(const asset of manifest){
    const bytes=await readFile(new URL(`../packages/design/assets/avatars/${asset.file}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal(bytes.length,asset.bytes);
    assert.ok(bytes.length<20_000,asset.file);
    const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,256); assert.equal(info.height,256);
    for(let index=3;index<data.length;index+=4) assert.equal(data[index],255,`${asset.file}: background must be opaque`);

  }
});

test('default-avatar options contain only presentation fields', () => {
  for (const option of defaultAvatarOptions) {
    assert.deepEqual(Object.keys(option).sort(), ['id', 'label', 'src']);
    assert.equal(option.src, `/avatars/avatar-${option.id}.webp`);
    assert.ok(option.label.startsWith('extension.copy.'));
  }
});
