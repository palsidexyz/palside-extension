import test from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { defaultTeamAvatar, defaultTeamAvatarNames, defaultTeamAvatarOptions } from '../apps/extension/src/features/palside/teams/default-team-avatar.ts';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('default group portraits are team-stable, opaque, bounded and fully bundled', async()=>{
  assert.equal(defaultTeamAvatar(''),undefined);
  assert.equal(defaultTeamAvatar('team-42'),defaultTeamAvatar('team-42'));
  const manifest=JSON.parse(await readFile(new URL('../packages/design/assets/team-avatars/sources.json',import.meta.url),'utf8'));
  assert.equal(defaultTeamAvatarNames.length,24);
  assert.deepEqual(manifest.map(a=>a.id),[...defaultTeamAvatarNames]);
  const expected=new Set(defaultTeamAvatarNames.map(id=>`/team-avatars/team-avatar-${id}.webp`));
  const assigned=new Set(Array.from({length:512},(_,i)=>defaultTeamAvatar(`team-${i}`)));
  assert.deepEqual(assigned,expected);
  const actual = (await readdir(new URL('../packages/design/assets/team-avatars/',import.meta.url))).filter(file=>file.endsWith('.webp')).sort();
  assert.deepEqual(actual,manifest.map(asset=>asset.file).sort(),'Bundled portraits match the manifest');
  assert.equal(new Set(manifest.map(asset=>asset.sha256)).size,24);
  for(const asset of manifest){
    const bytes=await readFile(new URL(`../packages/design/assets/team-avatars/${asset.file}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal(bytes.length,asset.bytes);
    assert.ok(bytes.length<20_000,asset.file);
    const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,256); assert.equal(info.height,256);
    if (/^(portrait|chat|ride)-/.test(asset.id)) {
      // Full backgrounds cover the corners before the UI applies its shape.
      for (const [left, top] of [[0, 0], [248, 0], [0, 248], [248, 248]]) {
        let white = 0;
        for (let y = top; y < top + 8; y++) for (let x = left; x < left + 8; x++) {
          const offset = (y * info.width + x) * 4;
          if (data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245) white++;
        }
        assert.ok(white < 4, `${asset.file}: white corner at ${left},${top}`);
      }
    }
    for(let index=3;index<data.length;index+=4) assert.equal(data[index],255,`${asset.file}: background must be opaque`);

  }
});

test('default-team-avatar options contain only presentation fields', () => {
  for (const option of defaultTeamAvatarOptions) {
    assert.deepEqual(Object.keys(option).sort(), ['id', 'label', 'src']);
    assert.equal(option.src, `/team-avatars/team-avatar-${option.id}.webp`);
    assert.ok(option.label.startsWith('extension.copy.'));
  }
});
