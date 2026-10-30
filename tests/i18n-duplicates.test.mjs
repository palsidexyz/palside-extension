import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function flatten(dictionary, prefix = '') {
  return Object.fromEntries(Object.entries(dictionary).flatMap(([key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[name, value]] : Object.entries(flatten(value, name));
  }));
}

const messages = Object.fromEntries(await Promise.all(['en', 'zh-CN'].map(async locale => [
  locale, flatten(JSON.parse(await readFile(new URL(`../packages/i18n/src/${locale}.json`, import.meta.url), 'utf8'))),
])));

const allowedDuplicates = [
  { keys: ['common.member', 'extension.web.member'], reason: 'A person fallback label versus the membership role shown in the website preview.' },
  { keys: ['extension.copy.remove', 'extension.copy.removeDevice'], reason: 'Different objects: captain removal of a message versus account device removal.' },
  { keys: ['extension.copy.imageFormats', 'extension.errors.IMAGE_TYPE'], reason: 'Error code lookup is separate from image-picker guidance.' },
  { keys: ['extension.copy.showPhrase', 'extension.sticky.show', 'extension.room.show'], reason: 'Different actions: reveal a recovery phrase, restore a hidden sticky note, or expand a folded message.' },
  { keys: ['extension.copy.hidePhrase', 'extension.sticky.hide'], reason: 'Different actions: conceal a recovery phrase versus hide a sticky note from the page.' },
  { keys: ['extension.copy.invitePasswordOff', 'extension.settings.notifyOff'], reason: 'Different settings: join-code protection versus notification delivery.' },
  { keys: ['extension.copy.openProfile', 'extension.dynamic.viewTeam'], reason: 'Different destinations: a person profile versus a squad; name identifies different objects.' },
  { keys: ['extension.errors.MATRIX_UNAVAILABLE', 'extension.errors.MATRIX_ERROR'], reason: 'Error code lookup requires one key per server error code.' },
  { keys: ['extension.errors.RATE_LIMITED', 'extension.errors.M_LIMIT_EXCEEDED'], reason: 'Error code lookup requires one key per server error code.' },
  { keys: ['extension.errors.LOGIN_REQUIRED', 'extension.runtime.signInFirst'], reason: 'Error code lookup is separate from the runtime sign-in precondition.' },
  { keys: ['extension.errors.INTERNAL_ERROR', 'extension.errors.DRAINING'], reason: 'Error code lookup requires one key per server error code.' },
  { keys: ['extension.errors.DEVICE_REVOKED', 'extension.runtime.deviceRevoked'], reason: 'Error code lookup is separate from the runtime device-session notice.' },
  { keys: ['extension.dynamic.deviceRemoved', 'extension.sites.removed'], reason: 'Different objects: a signed-in device versus an allowed website.' },
  { keys: ['extension.discussion.fewer', 'extension.reading.collapse'], reason: 'Different actions: shorten a discussion list versus collapse one long message.' },
  { keys: ['extension.overlay.medium', 'extension.style.mid'], reason: 'Different settings: Danmaku speed versus density.' },
  { keys: ['extension.top.back', 'extension.room.back', 'extension.reading.returnTo'], reason: 'Different destinations: a viewed page, squad chat, or a chat reading position.' },
  { keys: ['extension.access.sites', 'extension.privacy.perm_sites'], reason: 'Privacy permission lookup uses the structured perm_<permission> key pattern.' },
  { keys: ['extension.access.none', 'extension.room.blockedNone'], reason: 'Different sets: enabled page-interaction features versus blocked people.' },
  { keys: ['extension.center.sites', 'extension.settings.sites'], reason: 'Different lists: favorite websites versus websites with interaction permission.' },
  { keys: ['extension.web.signal', 'extension.privacy.feature_signal'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern.' },
  { keys: ['extension.web.sticky', 'extension.privacy.feature_sticky'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern.' },
  { keys: ['extension.web.share', 'extension.privacy.feature_share'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern.' },
  { keys: ['extension.web.category_all', 'extension.hot.all'], reason: 'Different filters: website categories versus chains in the hot list.' },
  { keys: ['extension.settings.notifications', 'extension.privacy.feature_notify'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern.' },
  { keys: ['extension.sites.tokenData', 'extension.privacy.feature_token'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern.' },
  { keys: ['extension.room.name', 'extension.privacy.feature_room', 'extension.wallet.kindRoom'], reason: 'Privacy feature lookup uses the structured feature_<id> key pattern; the red packet kind names the room it is sent into.' },
  { keys: ['extension.copy.inviteShort', 'extension.wallet.kindInvitation'], reason: 'Different things: the invite action versus the invitation red packet kind.' },
  { keys: ['extension.web.category_custom', 'extension.wallet.custom'], reason: 'Different things: a custom site category versus a custom tip amount.' },
  { keys: ['extension.hot.noneRising', 'extension.hot.noneTop'], reason: 'Different lists: rising activity versus the top activity ranking.' },
  { keys: ['extension.privacy.perm_active', 'extension.privacy.revoke_active_title'], reason: 'Privacy permission and revocation-title lookups use structured permission keys.' },
  { keys: ['extension.privacy.feature_quote', 'extension.reading.quote'], reason: 'Privacy feature lookup names page quoting; chat reading labels a quoted message excerpt.' },
  { keys: ['extension.privacy.read.share.who', 'extension.privacy.read.quote.who', 'extension.privacy.read.signal.who', 'extension.privacy.read.sticky.who'], reason: 'Privacy table lookup requires read.<feature>.who for each feature.' },
  { keys: ['extension.privacy.read.quote.keep', 'extension.privacy.read.sticky.keep', 'extension.privacy.read.shot.keep'], reason: 'Privacy table lookup requires read.<feature>.keep for each feature.' },
  { keys: ['extension.privacy.read.quote.no', 'extension.privacy.read.sticky.no'], reason: 'Privacy table lookup requires read.<feature>.no for each feature.' },
];

function duplicateGroups(website) {
  const groups = new Map();
  for (const [key, en] of Object.entries(messages.en)) {
    if (key.startsWith('website.') !== website) continue;
    assert.equal(typeof messages['zh-CN'][key], 'string', `Missing zh-CN translation: ${key}`);
    const signature = JSON.stringify([en, messages['zh-CN'][key]]);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(key);
  }
  return [...groups.values()].filter(keys => keys.length > 1);
}

const sortedGroups = groups => groups.map(keys => [...keys].sort()).sort((a, b) => a[0].localeCompare(b[0]));

test('non-website bilingual duplicates match the explicit allowed groups and reasons', () => {
  const listedKeys = new Set();
  for (const { keys, reason } of allowedDuplicates) {
    assert.ok(typeof reason === 'string' && reason.trim() && !/[\r\n]/.test(reason), `One-line reason required: ${keys.join(', ')}`);
    assert.ok(keys.length > 1, `Duplicate group must contain at least two keys: ${keys.join(', ')}`);
    for (const key of keys) {
      assert.ok(!key.startsWith('website.'), `Website keys are excluded: ${key}`);
      assert.ok(!listedKeys.has(key), `Key appears more than once in allowedDuplicates: ${key}`);
      listedKeys.add(key);
    }
  }
  assert.deepEqual(sortedGroups(duplicateGroups(false)), sortedGroups(allowedDuplicates.map(({ keys }) => keys)),
    'Merge same-concept duplicates or document the exact group and a reason in allowedDuplicates; remove stale entries.');
});

test('website bilingual duplicates are audited', () => {
  assert.deepEqual(sortedGroups(duplicateGroups(true)), []);
});
