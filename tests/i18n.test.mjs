import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@formatjs/icu-messageformat-parser';
import { acceptLanguages, matchLanguages, resolveLanguage, languagePreference, localeOrEnglish, localizedPath, chatTime, deadlineTime, pastTime, errorMessage, renderMessage } from '../packages/i18n/src/core.ts';

test('language matching uses ordered supported candidates and strict saved values', () => {
  for (const [input, expected] of [[['en-US', 'zh-CN'], 'en'], [['zh-TW', 'en'], 'zh-CN'], [['ja', 'en', 'zh'], 'en'], [['ja', 'zh'], 'zh-CN'], [['ZH-hant-HK'], 'zh-CN'], [['english', '*', 'zh_bad', 'ja'], 'en'], [[], 'en']]) assert.equal(matchLanguages(input), expected);
  assert.equal(resolveLanguage('en', ['zh-CN']), 'en');
  assert.equal(resolveLanguage('auto', ['zh-CN']), 'zh-CN');
  assert.equal(languagePreference('zh-TW'), 'auto');
  assert.equal(localeOrEnglish('zh-TW'), 'en');
  assert.equal(localeOrEnglish('zh-CN'), 'zh-CN');
});
test('HTTP preferences respect weights, invalid and excluded ranges', () => {
  assert.deepEqual(acceptLanguages('ja, zh-CN;q=0.8, en;q=0.9, zh;q=0, *;q=1, de;q=2, fr;q=bad'), ['ja', 'en', 'zh-CN']);
  assert.equal(matchLanguages(acceptLanguages('en;q=0,zh;q=1')), 'zh-CN');
  assert.deepEqual(acceptLanguages('zh;q=0.8,en;q=0.8'), ['zh', 'en']);
});
test('locale path replacement preserves only the path and recognizes full segments', () => {
  assert.equal(localizedPath('/zh-CN/privacy', 'en'), '/en/privacy');
  assert.equal(localizedPath('/en', 'zh-CN'), '/zh-CN');
  assert.equal(localizedPath('/zh-CN/privacy'), '/privacy');
  assert.equal(localizedPath('/english', 'zh-CN'), '/zh-CN/english');
});
function signatures(messages, prefix = '') {
  return Object.fromEntries(Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string') return Object.entries(signatures(value, path));
    const params = new Set();
    function visit(nodes) { for (const node of nodes) { if (node.type !== 0 && node.value) params.add(node.value); if (node.options) for (const option of Object.values(node.options)) visit(option.value); if (node.children) visit(node.children); } }
    visit(parse(value));
    return [[path, [...params].sort()]];
  }));
}
test('all dictionaries have valid ICU and matching keys and parameters', async () => {
  const en = JSON.parse(await readFile(new URL('../packages/i18n/src/en.json', import.meta.url)));
  const zh = JSON.parse(await readFile(new URL('../packages/i18n/src/zh-CN.json', import.meta.url)));
  assert.deepEqual(signatures(en), signatures(zh));
});
test('privacy promises distinguish website data, private content and deliberate sharing', async () => {
  const checks = {
    en: {
      wallet: /wallet or account data from other websites, including balances and orders/,
      encrypted: /Private messages, attachments and Share viewing content are encrypted on your devices/,
      public: /Recruitment profiles and metadata are not/,
      automatic: /Share viewing.*never automatically shares page content, your screen or page actions/,
      selected: /Quotes and screenshots are shared only when you select and send them/,
    },
    'zh-CN': {
      wallet: /其他网站的钱包或账户数据，包括余额和订单/,
      encrypted: /私密消息、附件与共享在看内容在设备端加密/,
      public: /招募资料与元数据不加密/,
      automatic: /共享在看.*不会自动分享网页内容、屏幕或页面操作/,
      selected: /引用与截图仅在你主动选择并发送后分享/,
    },
  };
  for (const [locale, expected] of Object.entries(checks)) {
    const dictionary = JSON.parse(await readFile(new URL(`../packages/i18n/src/${locale}.json`, import.meta.url)));
    assert.match(dictionary.extension.trust.neverWallet, expected.wallet);
    assert.match(dictionary.website.features.encryption.description, expected.encrypted);
    assert.match(dictionary.website.features.encryption.description, expected.public);
    assert.match(dictionary.website.questions.privacy.answer, expected.automatic);
    assert.match(dictionary.website.questions.privacy.answer, expected.selected);
  }
});
test('discovery limit copy describes the count without assuming a ranking order', () => {
  const text = { key: 'website.pages.resultLimit', values: { count: 100 } };
  assert.equal(renderMessage('en', text), 'Showing 100 squads. Search to find more.');
  assert.equal(renderMessage('zh-CN', text), '显示 100 个小队，搜索可查找更多');
});
test('chat time comes only from reliable timestamps and remains 24 hour', () => {
  assert.equal(chatTime(undefined, 'en'), '');
  assert.equal(chatTime(NaN, 'zh-CN'), '');
  const time = new Date(2026, 8, 29, 19, 5).getTime();
  assert.equal(chatTime(time, 'en', time), '19:05');
  assert.equal(chatTime(time, 'zh-CN', time), '19:05');
});

test('past moments read as just now, minutes ago within the hour, then a short date', () => {
  const now = new Date(2026, 9, 17, 12, 0).getTime();
  assert.equal(pastTime(now - 20_000, 'zh-CN', now), '刚刚');
  assert.equal(pastTime(now - 20_000, 'en', now), 'just now');
  assert.equal(pastTime(now - 5 * 60_000, 'zh-CN', now), '5分钟前');
  assert.equal(pastTime(new Date(2026, 9, 16, 9, 5).getTime(), 'zh-CN', now), '10月16日 09:05');
  assert.equal(pastTime(NaN, 'en', now), '');
});

test('deadlines read as today, tomorrow or a weekday within the coming week', () => {
  const now = new Date(2026, 9, 17, 2, 0).getTime();
  const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  assert.equal(deadlineTime(at(17, 23), 'zh-CN', now), '今天 23:00');
  assert.equal(deadlineTime(at(18, 1, 50), 'zh-CN', now), '明天 01:50');
  assert.equal(deadlineTime(at(18, 1, 50), 'en', now), 'tomorrow 01:50');
  assert.equal(deadlineTime(at(21, 9), 'zh-CN', now), '周三 09:00');
  assert.equal(deadlineTime(at(30, 9), 'zh-CN', now), '10月30日 09:00');
  assert.equal(deadlineTime(at(30, 9), 'en', now), 'Oct 30, 09:00');
  assert.equal(deadlineTime(NaN, 'en', now), '');
});

test('worker commits before broadcasting, serializes writers, and keeps successful choices on failures', async () => {
  const { createLanguageController } = await import('../apps/extension/src/runtime/transport/language.ts');
  let saved = 'auto'; let fail = false; const changes = []; let browsers = ['zh-TW', 'en'];
  const host = { storage: { local: { get: async () => ({ 'palside:language': saved }), set: async value => { if (fail) throw new Error('full'); saved = value['palside:language']; } } }, i18n: { getAcceptLanguages: async () => browsers, getUILanguage: () => 'en' } };
  const controller = createLanguageController(host, value => { assert.equal(value.preference, saved); changes.push(value); });
  assert.deepEqual(await controller.get(), { preference: 'auto', locale: 'zh-CN' });
  await Promise.all([controller.save('en'), controller.save('zh-CN')]);
  assert.equal((await controller.get()).locale, 'zh-CN');
  fail = true; await assert.rejects(controller.save('en'));
  assert.equal((await controller.get()).locale, 'zh-CN');
  assert.equal(changes.length, 3);
  fail = false; browsers = ['en']; await controller.refresh(); assert.equal((await controller.get()).locale, 'zh-CN');
  await controller.save('auto'); assert.equal((await controller.get()).locale, 'en');
});
test('read-only fallback uses UI language only when ordered browser languages are unavailable', async () => {
  const { readLanguage } = await import('../apps/extension/src/runtime/transport/language.ts');
  let languages = ['ja']; let writes = 0;
  const host = { storage: { local: { get: async () => { throw new Error('read failed'); }, set: async () => { writes++; } } }, i18n: { getAcceptLanguages: async () => languages, getUILanguage: () => 'zh-TW' } };
  assert.equal((await readLanguage(host)).locale, 'en');
  languages = []; assert.equal((await readLanguage(host)).locale, 'zh-CN');
  assert.equal(writes, 0);
});

test('contract errors have dictionary entries and the four invitation meanings stay distinct', async () => {
  const { errors } = await import('../packages/shared/src/contracts/errors.ts');
  const expected = {
    en: ['This invite is still waiting for a reply', 'Your join is still being confirmed', 'This account can’t be invited right now', 'This squad can’t be joined right now'],
    'zh-CN': ['邀请正在等待对方回复', '加入结果正在确认', '暂时无法邀请这个账号', '暂时无法加入这个小队'],
  };
  for (const locale of ['en', 'zh-CN']) {
    const dictionary = JSON.parse(await readFile(new URL(`../packages/i18n/src/${locale}.json`, import.meta.url))).extension.errors;
    for (const code of Object.keys(errors)) assert.equal(typeof dictionary[code], 'string', `${locale}: ${code}`);
    assert.deepEqual(['INVITE_AWAITING_REPLY', 'INVITE_JOIN_PENDING', 'INVITE_ACCOUNT_UNAVAILABLE', 'INVITE_TEAM_UNAVAILABLE'].map(code => dictionary[code]), expected[locale]);
  }
});

test('profile preset labels use stable IDs across viewer languages', async () => {
  const { presetTagIds } = await import('../packages/shared/src/contracts/profiles.ts');
  for (const locale of ['en', 'zh-CN']) {
    const member = JSON.parse(await readFile(new URL(`../packages/i18n/src/${locale}.json`, import.meta.url))).extension.member;
    assert.equal(typeof member.tagPresets, 'object');
    assert.deepEqual(Object.keys(member.tagPresets), [...presetTagIds]);
  }
});


test('invitation error codes render their own localized meanings', () => {
  const expected = {
    INVITE_AWAITING_REPLY: ['This invite is still waiting for a reply', '邀请正在等待对方回复'],
    INVITE_JOIN_PENDING: ['Your join is still being confirmed', '加入结果正在确认'],
    INVITE_ACCOUNT_UNAVAILABLE: ['This account can’t be invited right now', '暂时无法邀请这个账号'],
    INVITE_TEAM_UNAVAILABLE: ['This squad can’t be joined right now', '暂时无法加入这个小队'],
  };
  for (const [code, texts] of Object.entries(expected)) for (const [index, locale] of ['en', 'zh-CN'].entries()) assert.equal(renderMessage(locale, errorMessage({ code })), texts[index]);
});

test('contract error parameters match the ICU arguments selected for display', async () => {
  const { errors } = await import('../packages/shared/src/contracts/errors.ts');
  const dictionaries = Object.fromEntries(await Promise.all(['en', 'zh-CN'].map(async locale => [locale,
    JSON.parse(await readFile(new URL(`../packages/i18n/src/${locale}.json`, import.meta.url))),
  ])));
  const expected = Object.fromEntries(Object.entries(dictionaries).map(([locale, dictionary]) => [locale, signatures(dictionary)]));
  const failures = [];
  const samples = [
    {},
    { retryAfterMs: 1_000 }, { retryAfterMs: 61_000 }, { retryAfterMs: 3_601_000 },
    { lockedUntil: 123_000, retryAfterMs: 61_000 }, { remaining: 2 },
    { reason: 'COUNT', maximum: 5 }, { reason: 'LENGTH', maximum: 12 },
    { expiresAt: null }, { expiresAt: 123_000 },
    { reason: 'SPONSOR_UNAVAILABLE' },
  ];
  for (const [code, definition] of Object.entries(errors)) {
    let valid = 0;
    for (const sample of samples) {
      let params; try { params = decodeContract(definition.params, sample); } catch { continue; }
      valid++;
      const text = errorMessage({ code, ...params });
      const actual = Object.keys(text.values ?? {}).sort();
      assert.notEqual(text.key, 'common.error', `${code}: must render its contract error, not the generic fallback`);
      for (const [locale, dictionary] of Object.entries(dictionaries)) {
        if (JSON.stringify(actual) !== JSON.stringify(expected[locale][text.key])) failures.push({ locale, code, key: text.key, expected: expected[locale][text.key], actual });
        assert.notEqual(renderMessage(locale, text), dictionary.common.error, `${locale}: ${code} must render without falling back`);
      }
    }
    assert.ok(valid, `No parameter fixture for ${code}`);
  }
  assert.deepEqual(failures, []);
});
