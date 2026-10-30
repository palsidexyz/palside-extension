import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarPath, defaultAvatar, defaultAvatarName, defaultAvatarNames, teamDefaultAvatars } from '../packages/shared/src/person-avatars.ts';

const ids = Array.from({ length: 60 }, (_, index) => `member-${index}`);

test('members of one team never share a default portrait until all 24 are taken', () => {
  const portraits = teamDefaultAvatars(ids);
  const first = ids.slice(0, defaultAvatarNames.length).map(id => portraits.get(id));
  assert.equal(new Set(first).size, defaultAvatarNames.length);
  // After 24 the set starts again, so the 25th member gets a portrait an earlier member already has.
  assert.ok(first.includes(portraits.get(ids[defaultAvatarNames.length])));
});

test('earlier members keep their own portrait; a later one with the same portrait takes the next free one', () => {
  const [a, b] = ids.flatMap((x, i) => ids.slice(i + 1).filter(y => defaultAvatarName(y) === defaultAvatarName(x)).map(y => [x, y]))[0];
  const portraits = teamDefaultAvatars([a, b]);
  assert.equal(portraits.get(a), defaultAvatar(a));
  const next = defaultAvatarNames[(defaultAvatarNames.indexOf(defaultAvatarName(a)) + 1) % defaultAvatarNames.length];
  assert.equal(portraits.get(b), avatarPath(next));
});
