import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, ApiError, responseError } from '../apps/extension/src/runtime/transport/api.ts';

test('API rejects malformed success DTOs with a typed response error', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ teams: 'broken' }));
  await assert.rejects(new Api('https://api.test').request('accounts.snapshot'), error => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
});
test('API validates requests before sending and uses contract paths and methods', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json({ saved: true }); });
  const api = new Api('https://api.test');
  await assert.rejects(api.request('teams.preferences', { params: { id: 'squad' }, body: { muted: 1 } }));
  assert.equal(calls.length, 0);
  assert.deepEqual(await api.request('teams.preferences', { params: { id: 'squad' }, body: { muted: true, readIds: ['$a'] } }), { saved: true });
  assert.equal(calls[0].url, 'https://api.test/teams/squad/preferences');
  assert.equal(calls[0].options.method, 'PATCH');
});
test('business errors validate code and parameters and use milliseconds with header fallback', async () => {
  const error = await responseError(Response.json({ error: 'RATE_LIMITED', retryAfterMs: 1250 }, { status: 429, headers: { 'Retry-After': '9' } }));
  assert.equal(error.code, 'RATE_LIMITED'); assert.equal(error.retryAfterMs, 1250);
  const fallback = await responseError(Response.json({ error: 'MATRIX_UNAVAILABLE' }, { status: 503, headers: { 'Retry-After': '9' } }));
  assert.equal(fallback.retryAfterMs, 9000);
  const invalid = await responseError(Response.json({ error: 'RATE_LIMITED', retryAfter: 3 }, { status: 429 }));
  assert.equal(invalid.code, 'INVALID_RESPONSE');
});

test('profile tags dedupe preset IDs across languages and preserve custom text', async () => {
  const { profileTags, presetTagIds } = await import('../packages/shared/src/contracts/profiles.ts');
  const { hasTag, tagLabel } = await import('../apps/extension/src/domain/account/profile-tags.ts');
  const { messagesFor } = await import('../packages/i18n/src/core.ts');
  const tags = decodeContract(profileTags, [{ preset: 'short-term' }, { text: '  My   Plan  ' }, { text: 'my plan' }]);
  assert.deepEqual(tags, [{ preset: 'short-term' }, { text: 'My Plan' }]);
  for (const locale of ['en', 'zh-CN']) {
    const translate = key => key.split('.').reduce((value, part) => value[part], messagesFor(locale));
    assert.equal(tagLabel(tags[0], translate), locale === 'en' ? 'Short-term' : '短线');
    assert.equal(tagLabel(tags[1], translate), 'My Plan');
    assert.equal(presetTagIds.filter(preset => !hasTag(tags, { preset })).includes('short-term'), false);
  }
  assert.deepEqual(decodeContract(profileTags, [{ preset: 'short-term' }, { text: 'Short-term' }]), [{ preset: 'short-term' }, { text: 'Short-term' }]);
});

test('IPC validates known commands and their payloads before dispatch', async () => {
  const { parseCommand } = await import('../apps/extension/src/runtime/transport/command-map.ts');
  for (const input of [{ name: 'unknown' }, { name: 'profile', payload: { tags: ['短线'] } }, { name: 'toggle', payload: { share: 1 } }, { name: 'devices', payload: { token: 'injected' } }, { name: 'signal-settings', payload: { settings: { sound: 'yes' } } }, { name: 'danmaku-settings', payload: { settings: { opacity: 'high' } } }, { name: 'image-session-update', payload: { id: 'image', expectedRevision: 0, document: { invalid: undefined } } }, { name: 'room-stance', payload: { key: 'wrong', value: 'bull' } }]) assert.throws(() => parseCommand(input));
  assert.deepEqual(parseCommand({ name: 'profile', payload: { tags: [{ preset: 'short-term' }, { text: ' My  Plan ' }] } }), { name: 'profile', payload: { tags: [{ preset: 'short-term' }, { text: 'My Plan' }] } });
  assert.deepEqual(parseCommand({ name: 'room-tab', payload: { asset: null } }), { name: 'room-tab', payload: { asset: null } });
  assert.deepEqual(parseCommand({ name: 'snapshot' }), { name: 'snapshot', payload: {} });
});

test('lobby IPC accepts optional search and discovery sort with the HTTP query constraints', async () => {
  const { parseCommand } = await import('../apps/extension/src/runtime/transport/command-map.ts');
  const { endpointsById } = await import('../packages/shared/src/contracts/endpoints.ts');
  const { LOBBY_SEARCH_LENGTH } = await import('../packages/shared/src/contracts/limits.ts');
  assert.deepEqual(parseCommand({ name: 'lobby' }), { name: 'lobby', payload: {} });
  for (const payload of [{}, { q: '' }, { sort: 'heat' }, { q: '小队 & %_', sort: 'latest' }, { q: 'x'.repeat(LOBBY_SEARCH_LENGTH) }]) {
    assert.deepEqual(parseCommand({ name: 'lobby', payload }).payload, decodeContract(endpointsById['teams.lobby'].query, payload));
  }
  for (const payload of [{ q: 1 }, { q: 'bad\nquery' }, { q: 'x'.repeat(LOBBY_SEARCH_LENGTH + 1) }, { sort: 'oldest' }, { sort: 1 }, { extra: true }]) {
    assert.throws(() => parseCommand({ name: 'lobby', payload }));
    assert.throws(() => decodeContract(endpointsById['teams.lobby'].query, payload));
  }
});

test('command types reject unknown names and mismatched payloads at compile time', async () => {
  const ts = (await import('typescript')).default;
  const file = new URL('../apps/extension/src/runtime/transport/command-type-test.ts', import.meta.url).pathname;
  const source = `import type { Command } from './command-map.ts';
    const valid: Command = { name: 'profile', payload: { tags: [{ preset: 'short-term' }] } };
    // @ts-expect-error Unknown command names cannot cross IPC.
    const unknown: Command = { name: 'unknown-command' };
    // @ts-expect-error A toggle payload contains booleans.
    const malformed: Command = { name: 'toggle', payload: { share: 'yes' } };
    const defaultLobby: Command = { name: 'lobby' };
    const searchLobby: Command = { name: 'lobby', payload: { q: 'query', sort: 'latest' } };
    // @ts-expect-error Lobby only supports the server discovery sort choices.
    const invalidSort: Command = { name: 'lobby', payload: { sort: 'oldest' } };
    // @ts-expect-error Lobby search must be text.
    const invalidQuery: Command = { name: 'lobby', payload: { q: 123 } };
    void [valid, unknown, malformed, defaultLobby, searchLobby, invalidSort, invalidQuery];`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = path => path === file ? source : read(path);
  host.fileExists = path => path === file || exists(path);
  const program = ts.createProgram([file], options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(error => error.file?.fileName === file);
  assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), []);
});
