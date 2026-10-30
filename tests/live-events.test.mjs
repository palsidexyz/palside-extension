import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseEvents } from '../apps/extension/src/runtime/transport/live-events.ts';

test('SSE parser handles comments, CRLF and multiline data', () => {
  const parsed = parseSseEvents(': ping\r\nevent: refresh\r\ndata: {"scope":"me"}\r\ndata: tail\r\n\r\npartial');
  assert.deepEqual(parsed.events, [{ event: 'refresh', data: '{"scope":"me"}\ntail' }]);
  assert.equal(parsed.remainder, 'partial');
});

test('SSE parser defaults event name and ignores comments', () => {
  assert.deepEqual(parseSseEvents(': hello\ndata: ok\n\n').events, [{ event: 'message', data: 'ok' }]);
});

test('presence events carry the three-state account status', () => {
  assert.deepEqual(parseSseEvents('event: presence\ndata: {"account":"alice","state":"away"}\n\n').events, [{ event: 'presence', data: '{"account":"alice","state":"away"}' }]);
});
