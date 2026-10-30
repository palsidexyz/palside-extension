import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { productionModules } from './helpers/production-module.mjs';
import { readMessageRefTarget, readRefCaption, readRefTarget } from '../apps/extension/src/domain/annotations/social.ts';

const line = { kind: 'danmaku', id: 'm1', author: 'acct-1', name: 'Degen_88', at: 1_760_000_000_000 };

test('a quoted 弹幕 line is a message ref target, never a page target', () => {
  assert.deepEqual(readMessageRefTarget(line), line);
  assert.equal(readRefTarget(line), undefined);
  assert.deepEqual(readMessageRefTarget({ kind: 'quote', exact: 'hello', prefix: '', suffix: '' }), { kind: 'quote', exact: 'hello', prefix: '', suffix: '' });
  for (const bad of [{ ...line, id: '' }, { ...line, author: 1 }, { ...line, at: Number.NaN }, { ...line, at: 0 }, { ...line, name: 'x'.repeat(41) }, { ...line, kind: 'other' }]) assert.equal(readMessageRefTarget(bad), undefined);
});

test('a 弹幕 caption keeps the whole line while page captions stay short', () => {
  const text = '这'.repeat(60);
  assert.equal(readRefCaption(text, line), text);
  assert.equal(readRefCaption(text, { kind: 'quote', exact: 'ab', prefix: '', suffix: '' }), undefined);
});

test('quoted 弹幕 lines produce no page flashes and cannot be located by the page host', async () => {
  const load = productionModules();
  const { pageDiff } = load('apps/extension/src/runtime/browser/page-layer-host.ts');
  const { stickies } = load('apps/extension/src/background/stickies.ts');
  const view = { kind: 'website', url: 'https://example.test/token' };
  const previous = { authenticated: true, account: { id: 'self' }, preferences: { current: 'team' }, remoteTeams: [{ id: 'team', joined: true }], data: { messages: [] } };
  const message = { id: 'message', teamId: 'team', author: 'friend', status: 'sent', liveArrival: true, ref: { view, target: line, caption: 'the line' } };
  const state = { ...previous, data: { messages: [message] } };
  assert.equal(pageDiff(previous, state, [{ url: view.url }]).length, 0);
  const pageQuote = { ...message, ref: { ...message.ref, target: { kind: 'quote', exact: 'hello', prefix: '', suffix: '' } } };
  assert.equal(pageDiff(previous, { ...state, data: { messages: [pageQuote] } }, [{ url: view.url }])[0].flashes.length, 1);
  const bg = { state, browser: {}, openPage() { assert.fail('room references never open a browser page'); } };
  const located = (await stickies(bg).locateRef({ teamId: 'team', messageId: 'message' }, 'chrome-extension://panel')).value;
  assert.equal(located.result, 'missing'); assert.equal(located.opened, false);
});

test('clicking a quoted 弹幕 opens the room at its line, or reports unavailable when rooms are off', () => {
  const calls = [], exports = {};
  const jsx = (type, props) => ({ type, props });
  const source = ts.transpileModule(readFileSync('apps/extension/src/features/palside/annotations/message-ref.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mocks = {
    useTranslations: () => key => key, useState: () => [false, () => {}], Tooltip: 'Tooltip', RefLine: 'RefLine', composerStyles: {},
    roomKeyFor: () => 'token:Ethereum:token', roomsOn: c => !c.off,
    setSocialUi: patch => calls.push(['social', patch]), openRoom: (_c, key) => calls.push(['room', key]), message: key => key,
  };
  vm.runInNewContext(`(function(require, exports) { ${source} })`)((name) => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : mocks, exports);
  const c = { live: {}, setNotice: value => calls.push(['notice', value]) };
  const message = { ref: { target: line, view: {}, caption: 'the line' } };
  exports.MessageRef({ c, message }).props.children.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['social', { roomLine: 'm1' }], ['room', 'token:Ethereum:token']]);
  calls.length = 0; c.off = true;
  exports.MessageRef({ c, message }).props.children.props.onClick();
  assert.deepEqual(calls, [['notice', 'extension.composer.refUnavailable']]);
});
