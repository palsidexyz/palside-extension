import { MINUTE_MS } from '@palside/shared/units';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { encryptedCrypto } from './helpers/encrypted-room.mjs';

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts') && /\/(?:runtime\/annotations\/(?:signal-service|signals|chart-marks|chart-drawings|chart-drawing-store)|page-layer\/chart-scale)\.ts$/.test(context.parentURL ?? '')) return next(specifier + '.ts', context);
  return next(specifier, context);
} });
const { SignalService } = await import('../apps/extension/src/runtime/annotations/signal-service.ts');
const { CHART_MARK_EVENT, CHART_LASER_MS, CHART_POINTS, addChartMark, chartMarkAlive, readChartStroke, readChartMark } = await import('../apps/extension/src/runtime/annotations/chart-marks.ts');
const { CHART_DRAWING_POINTS, CHART_TEXT_MAX, CHART_PROPS_MAX, addChartDrawing, createdAt, readChartAxis, readChartDrawing, readChartDrawingGeometry, readChartProps, thinDrawingPoints } = await import('../apps/extension/src/runtime/annotations/chart-drawings.ts');
const { chartScale, readChartBridge, readChartDraw, readChartShow, readChartValue, thinPath } = await import('../apps/extension/src/page-layer/chart-scale.ts');
const { validateChartBridge, chartBridgePolicy } = await import('../scripts/lib/extension-artifact.mjs');
hooks.deregister();

const T = 1_762_000_000;
const pen = (n = 3) => Array.from({ length: n }, (_, i) => [T + i * 60, 0.0021 + i * 1e-5, i * 10]);

test('a laser stroke is bounded: point counts, times, values and stroke timing', () => {
  assert.deepEqual(readChartStroke(pen()), pen());
  assert.equal(readChartStroke(pen(CHART_POINTS + 1)), undefined);
  assert.equal(readChartStroke([]), undefined);
  for (const bad of [[[T, 0, 0]], [[T, -1, 0]], [[T, Infinity, 0]], [[1, 1, 0]], [[T, 1, CHART_LASER_MS + 1]], [[T, 1, 5], [T, 1, 4]], [[T, 1]], [[T, 1, 0.5]], [['1', 1, 0]]]) assert.equal(readChartStroke(bad), undefined, JSON.stringify(bad));
});

test('a wire mark needs a public page address and a send time within the clock window', () => {
  const now = 5_000_000;
  const mark = { id: '0123456789abcdef', teamId: 'team', url: 'https://gmgn.ai/sol/token/abc', sentAt: now, points: pen() };
  assert.deepEqual(readChartMark(mark, now), mark);
  assert.equal(readChartMark({ ...mark, sentAt: now - MINUTE_MS }, now), undefined);
  assert.equal(readChartMark({ ...mark, url: 'https://gmgn.ai/sol/token/abc?utm_source=x' }, now), undefined, 'tracking parameters never travel');
  assert.equal(readChartMark({ ...mark, id: 'short' }, now), undefined);
});

test('the received list drops repeats and keeps the newest within its limit; a laser leaves after its life', () => {
  const mark = (personId, id) => ({ id, personId, teamId: 'team', url: 'u', points: [], sentAt: 0, at: 0 });
  assert.equal(addChartMark([mark('a', '1')], mark('a', '1')).length, 1);
  assert.equal(addChartMark(Array.from({ length: 64 }, (_, i) => mark('a', String(i))), mark('a', 'new')).at(0).id, '1');
  assert.equal(chartMarkAlive({ at: 0 }, CHART_LASER_MS - 1), true);
  assert.equal(chartMarkAlive({ at: 0 }, CHART_LASER_MS), false);
});

const line = (n = 2) => Array.from({ length: n }, (_, i) => [T + i * 60, 0.0021 + i * 1e-5]);
test('a drawing is any TradingView tool by name, with bounded points and its own properties', () => {
  assert.deepEqual(readChartDrawingGeometry('trend_line', line()), { shape: 'trend_line', points: line() });
  for (const shape of ['sticker', 'emoji', 'icon', 'fib_retracement', 'long_position', 'xabcd_pattern']) assert.equal(readChartDrawingGeometry(shape, line())?.shape, shape);
  for (const shape of ['Trend Line', 'trend-line', '_ray', 'ray_', '', 'x'.repeat(49), undefined, 5]) assert.equal(readChartDrawingGeometry(shape, line()), undefined, String(shape));
  assert.equal(readChartDrawingGeometry('brush', line(CHART_DRAWING_POINTS + 1)), undefined);
  assert.equal(readChartDrawingGeometry('trend_line', []), undefined);
  for (const bad of [[[T, 0]], [[1, 1]], [[T, Infinity]], [[T]], [['1', 1]]]) assert.equal(readChartDrawingGeometry('trend_line', bad), undefined, JSON.stringify(bad));
  const props = { text: 'look', color: '#2962FF', size: 40, bold: true, level1: { coeff: 0.618, visible: true }, intervalsVisibilities: { ticks: true } };
  assert.deepEqual(readChartDrawingGeometry('text', line(1), props), { shape: 'text', points: line(1), props });
  const thin = thinDrawingPoints(line(500));
  assert.equal(thin.length, CHART_DRAWING_POINTS); assert.deepEqual(thin.at(0), line(500).at(0)); assert.deepEqual(thin.at(-1), line(500).at(-1));
});

test('a drawing and a laser stroke carry their axis: what the chart plotted and one candle on it; a malformed axis is left out', () => {
  const axis = { key: 'sol/Dez…/USD/MCAP · Bonk', at: [[T, 248_600_000], [T + 3600, 249_100_000]] };
  assert.deepEqual(readChartAxis(axis), axis);
  for (const bad of [undefined, 'x', {}, { ...axis, key: '' }, { ...axis, key: 'x'.repeat(161) }, { ...axis, key: 'a\nb' }, { ...axis, at: [] }, { ...axis, at: [T, 1] }, { ...axis, at: [[T]] }, { ...axis, at: [[1, 2]] }, { ...axis, at: [[T, 0]] }, { ...axis, at: [[T, Infinity]] }, { ...axis, at: Array.from({ length: 7 }, (_, i) => [T + i, 1]) }]) assert.equal(readChartAxis(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(readChartDrawingGeometry('trend_line', line(), undefined, axis), { shape: 'trend_line', points: line(), axis });
  assert.deepEqual(readChartDrawingGeometry('trend_line', line(), undefined, { key: 5 }), { shape: 'trend_line', points: line() }, 'the drawing still goes, unscaled');
  const wire = { id: '0123456789abcdef', teamId: 'team', url: 'https://gmgn.ai/sol/token/abc', sentAt: 1, shape: 'trend_line', points: line(), axis };
  assert.deepEqual(readChartDrawing(wire), wire);
  const now = 5_000_000, mark = { id: '0123456789abcdef', teamId: 'team', url: 'https://gmgn.ai/sol/token/abc', sentAt: now, points: pen(), axis };
  assert.deepEqual(readChartMark(mark, now), mark);
  const { axis: _, ...plain } = mark;
  assert.deepEqual(readChartMark({ ...mark, axis: { key: 'x' } }, now), plain);
});

test('a property bag keeps plain data and leaves out the rest, and each chart keeps its own lock and visibility', () => {
  assert.deepEqual(readChartProps({ sticker: 'elon', size: 110, angle: 1.57, frozen: true, visible: false, title: '' }), { sticker: 'elon', size: 110, angle: 1.57, title: '' });
  assert.deepEqual(readChartProps({ text: 'x'.repeat(CHART_TEXT_MAX + 1), linewidth: 2, bad: Infinity, 'odd key': 1, nested: { visible: false } }), { linewidth: 2, nested: { visible: false } });
  assert.deepEqual(readChartProps({ deep: { a: { b: { c: { d: 1 } } } } }), { deep: { a: { b: {} } } });
  for (const bad of [undefined, null, 5, 'text', [1, 2], {}, { frozen: true }]) assert.equal(readChartProps(bad), undefined, JSON.stringify(bad));
  assert.equal(readChartProps({ text: 'x'.repeat(200), ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'y'.repeat(100)])) }), undefined, `over ${CHART_PROPS_MAX} characters`);
});

test('a wire drawing needs a public page address; without geometry it records a deletion', () => {
  const base = { id: '0123456789abcdef', teamId: 'team', url: 'https://gmgn.ai/sol/token/abc', sentAt: 5 };
  assert.deepEqual(readChartDrawing({ ...base, shape: 'ray', points: line() }), { ...base, shape: 'ray', points: line() });
  assert.deepEqual(readChartDrawing(base), base);
  assert.equal(readChartDrawing({ ...base, shape: 'ray' }), undefined, 'half a geometry is not a deletion');
  assert.equal(readChartDrawing({ ...base, url: base.url + '?utm_source=x', shape: 'ray', points: line() }), undefined);
  assert.equal(readChartDrawing({ ...base, id: 'short' }), undefined);
  assert.equal(readChartDrawing({ ...base, asset: 'Solana:So11111111111111111111111111111111111111112' })?.asset, 'Solana:So11111111111111111111111111111111111111112', 'the author page token travels');
  for (const asset of ['nope', ':x', 'Solana:nope', 5]) assert.equal(readChartDrawing({ ...base, asset })?.asset, undefined);
});

test('one record per member and drawing, whichever order the events are read in', () => {
  const record = (personId, id, eventId, timestamp, patch = { shape: 'ray', points: line() }) => ({ id, teamId: 'team', url: 'u', sentAt: 0, personId, eventId, timestamp, expiresAt: 9e12, ...patch });
  const edit = record('a', 'one', 'e2', 20), original = record('a', 'one', 'e1', 10), removed = record('a', 'one', 'e3', 30, {});
  assert.deepEqual(addChartDrawing([original], edit).map(item => item.eventId), ['e2']);
  assert.deepEqual(addChartDrawing([edit], original).map(item => item.eventId), ['e2'], 'history read after a live edit changes nothing');
  assert.deepEqual(addChartDrawing([removed], edit).map(item => item.eventId), ['e3'], 'a deletion read first still beats the older line');
  assert.equal(addChartDrawing([record('b', 'one', 'e9', 5)], edit).length, 2, 'the same id from another member is another line');
  assert.deepEqual(addChartDrawing([record('a', 'x', 'e0', 1), record('a', 'y', 'e1', 2)], record('a', 'z', 'e2', 3), 2).map(item => item.id), ['y', 'z'], 'the newest of a squad stay');
});

test('a drawing keeps the time it was first made through edits, whichever order the events are read in', () => {
  const record = (eventId, timestamp, patch = { shape: 'ray', points: line() }) => ({ id: 'one', teamId: 'team', url: 'u', sentAt: 0, personId: 'a', eventId, timestamp, expiresAt: 9e12, ...patch });
  const made = record('e1', 10), edit = record('e2', 20), removed = record('e3', 30, {});
  assert.equal(createdAt(addChartDrawing([made], edit)[0]), 10, 'an edit is not a new drawing');
  const late = addChartDrawing([edit], made);
  assert.deepEqual(late.map(item => [item.eventId, createdAt(item)]), [['e2', 10]], 'history read after the edit still dates the drawing');
  assert.notEqual(late[0], edit, 'the kept record changes, so it is stored and shown again');
  const same = [addChartDrawing([made], edit)[0]];
  assert.equal(addChartDrawing(same, made)[0], same[0], 'an event already counted changes nothing');
  assert.equal(createdAt(addChartDrawing(addChartDrawing([made], edit), removed)[0]), 10);
  assert.equal(createdAt(record('e9', 40)), 40, 'a record without createdAt was made at its own time');
});

test('show requests and answers are bounded', () => {
  assert.deepEqual(readChartShow(JSON.stringify({ id: 'abc', native: 'n1' })), { id: 'abc', native: 'n1' });
  assert.deepEqual(readChartShow(JSON.stringify({ id: 'abc', shown: true })), { id: 'abc', shown: true });
  assert.deepEqual(readChartShow(JSON.stringify({ id: 'abc', native: 5, shown: 'yes' })), { id: 'abc' });
  for (const bad of [undefined, 'abc', JSON.stringify({}), JSON.stringify({ id: 'x'.repeat(65) }), 'x'.repeat(301)]) assert.equal(readChartShow(bad), undefined);
});

test('what the bridge reports is validated before anything is sent', () => {
  const create = { op: 'create', native: 'abc', shape: 'ray', points: line() };
  assert.deepEqual(readChartDraw(JSON.stringify(create)), create);
  assert.deepEqual(readChartDraw(JSON.stringify({ op: 'remove', native: 'abc' })), { op: 'remove', native: 'abc' });
  assert.deepEqual(readChartDraw(JSON.stringify({ op: 'adopted', native: 'abc', id: 'd1' })), { op: 'adopted', native: 'abc', id: 'd1' });
  for (const bad of ['', 'x', JSON.stringify({ op: 'create', native: 'abc' }), JSON.stringify({ ...create, native: '' }), JSON.stringify({ ...create, points: [['a', 1]] }), JSON.stringify({ op: 'other', native: 'abc' })]) assert.equal(readChartDraw(bad), undefined, bad);
  for (const props of [5, 'x', [1]]) assert.deepEqual(readChartDraw(JSON.stringify({ ...create, props })), create, 'a bag that is not an object is left behind');
  assert.deepEqual(readChartDraw(JSON.stringify({ ...create, props: { emoji: '🚀' } })), { ...create, props: { emoji: '🚀' } });
  assert.deepEqual(readChartDraw(JSON.stringify({ ...create, axis: { key: 'k', at: [[T, 1]] } })), { ...create, axis: { key: 'k', at: [[T, 1]] } }, 'the axis goes on to be read with the drawing');
  assert.equal(readChartDraw(create), undefined, 'only strings cross from the page');
});

const geometry = (patch = {}) => ({ box: [10, 20, 600, 300], bars: [[T, 5], [T + 60, 11], [T + 120, 17], [T + 300, 23], [T + 360, 29]], values: [0.001, 0.003], log: false, ...patch });

test('the bridge message the page could forge is validated before anything is drawn', () => {
  assert.deepEqual(readChartBridge(JSON.stringify(geometry())), geometry());
  for (const bad of ['', 'x', JSON.stringify({}), JSON.stringify(geometry({ box: [0, 0, 10, 10] })), JSON.stringify(geometry({ bars: [[T, 5], [T, 6]] })), JSON.stringify(geometry({ bars: [[T, 5], [T + 60, 4]] })), JSON.stringify(geometry({ values: [1, 1] })), JSON.stringify(geometry({ values: [0, 2], log: true })), JSON.stringify(geometry({ log: 'yes' })), 'x'.repeat(80_001)]) assert.equal(readChartBridge(bad), undefined, bad.slice(0, 60));
  assert.equal(readChartBridge({ box: [] }), undefined, 'only strings cross from the page');
  const axis = { key: 'SOL · SOL/USD (Market Cap)', ref: [[T, 1_136_457_110], [T + 900, 1_137_000_000]] };
  assert.deepEqual(readChartBridge(JSON.stringify(geometry({ axis }))), geometry({ axis }));
  assert.deepEqual(readChartBridge(JSON.stringify(geometry({ axis: { key: axis.key, ref: [[T, -1]] } }))), geometry({ axis: { key: axis.key } }), 'a bad candle leaves the name');
  for (const bad of [{ key: '' }, { key: 5 }, { key: 'a\u0000' }, 'x']) assert.deepEqual(readChartBridge(JSON.stringify(geometry({ axis: bad }))), geometry(), 'a bad axis reads as none');
});

test('the chart\'s open on another axis\'s candle is read back bounded; no candle means no value', () => {
  assert.deepEqual(readChartValue(JSON.stringify({ key: 'k', at: [T, 86.2], value: 1.1e9 })), { key: 'k', at: [T, 86.2], value: 1.1e9 });
  assert.deepEqual(readChartValue(JSON.stringify({ key: 'k', at: [T, 86.2] })), { key: 'k', at: [T, 86.2] });
  for (const value of [0, -1, 'x', null]) assert.deepEqual(readChartValue(JSON.stringify({ key: 'k', at: [T, 86.2], value })), { key: 'k', at: [T, 86.2] });
  for (const bad of ['', 'x', JSON.stringify({ at: [T, 1] }), JSON.stringify({ key: 'k', at: [T] }), 'x'.repeat(1_001)]) assert.equal(readChartValue(bad), undefined, bad.slice(0, 40));
  assert.equal(readChartValue({ key: 'k', at: [T, 1] }), undefined, 'only strings cross from the page');
});

test('a time lands inside its own candle, gaps included, and extends past the bars at the usual bar width', () => {
  const scale = chartScale(geometry());
  assert.equal(scale.timeToX(T + 60), 8, 'a bar opens at its left edge');
  assert.equal(scale.timeToX(T + 90), 11, 'and its middle is its centre');
  assert.equal(scale.timeToX(T + 119), 13.9, 'late in a bar is still that bar, not the next');
  assert.equal(scale.timeToX(T + 210), 17, 'a gap belongs to the bar before it');
  assert.equal(scale.timeToX(T + 390), 29, 'the last bar is a whole bar');
  assert.equal(scale.timeToX(T - 60), -4);
  assert.equal(scale.timeToX(T + 480), 38);
  for (const x of [-20, 5, 14, 20, 29, 50]) assert.ok(Math.abs(scale.timeToX(scale.xToTime(x)) - x) < 1e-9, `x ${x}`);
  // Drawn on one-minute candles at 12:45, it stays in the 12:00 candle on the hourly chart.
  const bar = 3600, hourly = chartScale(geometry({ bars: [[T, 100], [T + bar, 110], [T + 2 * bar, 120]] }));
  const x = hourly.timeToX(T + bar * 0.75);
  assert.ok(x >= 95 && x < 105, `x ${x}`);
  assert.equal(scale.valueToY(0.003), 0);
  assert.equal(scale.valueToY(0.001), 300);
  const log = chartScale(geometry({ values: [1, 100], log: true }));
  assert.ok(Math.abs(log.valueToY(10) - 150) < 1e-9);
  assert.ok(Math.abs(log.yToValue(75) - Math.sqrt(1000)) < 1e-9);
});

test('a freehand path thins to its limit and keeps both ends', () => {
  const points = Array.from({ length: 1000 }, (_, i) => [i, Math.sin(i / 20) * 50]);
  const thin = thinPath(points, point => point, 160);
  assert.equal(thin.length, 160);
  assert.equal(thin[0], points[0]); assert.equal(thin.at(-1), points.at(-1));
  const still = thinPath([[0, 0], [0.5, 0], [1, 0], [0.2, 0.2]], point => point, 160);
  assert.deepEqual(still, [[0, 0], [0.2, 0.2]], 'jitter under two pixels is dropped, the last point kept');
});

test('the main-world bridge source stays small: no extension API, network, messaging or storage', () => {
  const source = readFileSync(new URL('../apps/extension/entrypoints/chart-bridge.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.deepEqual(validateChartBridge(source), []);
  for (const bad of ['chrome.runtime.sendMessage(1)', 'browser.runtime.id', 'fetch("https://x")', 'window.postMessage(1)', 'localStorage.x', 'eval("1")']) assert.ok(validateChartBridge(`${source}\n${bad}`).length, bad);
  assert.equal(chartBridgePolicy.world, 'MAIN');
  // The background is the one place that loads it, into a single document's main world.
  const background = readFileSync(new URL('../apps/extension/src/background/signals.ts', import.meta.url), 'utf8');
  assert.match(background, /executeScript\(\{ target: \{ tabId: info\.tabId, documentIds: \[documentId\] \}, world: 'MAIN', files: \[CHART_BRIDGE_FILE\] \}\)/);
  assert.match(background, /CHART_BRIDGE_FILE = '\/chart-bridge\.js'/);
});

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const calls = [], encrypted = [];
  const session = { account: { id: 'self' }, matrix: { userId: '@self', deviceId: 'SELF' } };
  const team = { id: 'team', joined: true, roomId: '!team', memberIds: ['self', 'peer'], people: [{ id: 'self', matrixId: '@self' }, { id: 'peer', matrixId: '@peer' }] };
  const devices = new Map([['@peer', new Map([['PEER', {}]])]]);
  const cryptoApi = { ...encryptedCrypto(), async getUserDeviceInfo() { return devices; }, async encryptToDeviceMessages(type, targets, content) { encrypted.push({ type, targets, content }); return { batch: targets.map(target => ({ ...target, payload: { ciphertext: 'encrypted' } })) }; } };
  const runtime = {
    state: { signals: [], preferences: { current: 'team' }, remoteTeams: [team], data: { teams: [{ id: 'team', readonly: false }] } },
    auth: { session, client: { getCrypto: () => cryptoApi }, requireConnection() {}, scope() { return { check() {}, async wait(value) { return await value; } }; } },
    api: { async request(path, options) { calls.push({ path, options }); return { delivered: 1 }; } }, emit() {},
  };
  const service = new SignalService(runtime);
  t.after(() => service.reset());
  const event = (content, sender = '@peer') => ({ isEncrypted: () => true, getType: () => CHART_MARK_EVENT, getSender: () => sender, getContent: () => content });
  return { runtime, service, session, calls, encrypted, event };
}

test('a laser stroke is sent once as its own event and kept for this device; a teammate stroke arrives once', async t => {
  const f = fixture(t);
  const url = 'https://gmgn.ai/sol/token/abc';
  assert.deepEqual(await f.service.sendMark('team', { url, points: pen() }, async () => true), { queued: 1 });
  assert.equal(f.encrypted[0].type, CHART_MARK_EVENT);
  assert.deepEqual(f.encrypted[0].content.points, pen());
  assert.equal(f.calls[0].path, 'viewing.react');
  assert.deepEqual(f.runtime.state.chartMarks.map(mark => mark.personId), ['self']);
  await assert.rejects(f.service.sendMark('team', { url, points: pen() }, async () => false), 'the background guard still decides');
  const wire = { id: 'abcdef0123456789', teamId: 'team', url, sentAt: Date.now(), points: pen(2) };
  f.service.consumeMark(f.event(wire), f.session);
  f.service.consumeMark(f.event(wire), f.session);
  f.service.consumeMark(f.event({ ...wire, id: 'fedcba9876543210' }, '@stranger'), f.session);
  assert.deepEqual(f.runtime.state.chartMarks.map(mark => mark.personId), ['self', 'peer']);
  t.mock.timers.tick(CHART_LASER_MS);
  assert.deepEqual(f.runtime.state.chartMarks, [], 'strokes leave after their life');
});
