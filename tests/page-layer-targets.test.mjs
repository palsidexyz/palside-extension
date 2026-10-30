/* global document, location -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionTarget, locate, readable, invalidateTargets } from '../apps/extension/src/page-layer/targets.ts';

function element(tag = 'p', properties = {}) {
  return {
    tagName: tag.toUpperCase(), nodeType: 1, children: [], isConnected: true, parentElement: null,
    get parentNode() { return this.parentElement; },
    get firstChild() { return this.children[0] ?? null; },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; },
    private: ['form', 'input', 'button', 'textarea', 'select', 'canvas', 'iframe'].includes(tag),
    contains(item) { return item === this || this.children.some(child => child === item || child.contains?.(item)); },
    getAttribute(name) { return this.attributes?.[name] ?? null; },
    closest(selector) { return (selector === 'palside-page-layer' ? tag === selector : this.private) ? this : this.parentElement?.closest(selector) ?? null; },
    querySelector() { return this.children.find(child => child.private || child.querySelector?.()); },
    matches(tags) { return tags.split(',').includes(tag); },
    getBoundingClientRect() { return { width: 200, height: 20 }; },
    ...properties,
  };
}
function node(parent, value, denied = false) {
  const result = { nodeType: 3, length: value.length, parentElement: parent, get nextSibling() { return parent.children[parent.children.indexOf(this) + 1] ?? null; }, isConnected: true, reads: 0, get data() { this.reads += 1; assert.equal(denied, false, 'private text was read'); return value; }, substringData(start, count) { assert.ok(count <= 1024); return this.data.slice(start, start + count); } };
  parent.children.push(result);
  document.notify?.({ type: 'childList', target: parent, addedNodes: [result], removedNodes: [] });
  return result;
}
function fixture() {
  const original = new Map();
  const set = (key, value) => { if (!original.has(key)) original.set(key, globalThis[key]); globalThis[key] = value; };
  const roots = [], observers = [];
  set('MutationObserver', class {
    records = []; active = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; this.records = []; }
    takeRecords() { return this.records.splice(0); }
  });
  set('location', { hostname: 'example.com' });
  set('Node', { TEXT_NODE: 3 }); set('NodeFilter', { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 });
  set('getComputedStyle', item => ({ display: item.tagName === 'SPAN' ? 'inline' : 'block', visibility: 'visible', opacity: '1', ...item.computedStyle }));
  set('document', {
    body: element('body'),
    notify(record) { for (const observer of observers) if (observer.active) observer.records.push(record); },
    createTreeWalker(root, flags, filter) {
      roots.push(root);
      function* walk(item) {
        for (const child of item.children ?? []) {
          const shown = flags & (1 << (child.nodeType - 1));
          const decision = shown ? filter?.acceptNode(child) ?? 1 : 3;
          if (decision === 1) yield child;
          if (decision !== 2) yield* walk(child);
        }
      }
      const iterator = walk(root);
      return { nextNode: () => iterator.next().value ?? null };
    },
    createRange() { return {
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      toString() {
        const nodes = [];
        const collect = item => { if (item.nodeType === 3) nodes.push(item); else for (const child of item.children ?? []) collect(child); };
        collect(document.body);
        const start = nodes.indexOf(this.startContainer), end = nodes.indexOf(this.endContainer);
        return nodes.slice(start, end + 1).map((item, index) => item.data.slice(index === 0 ? this.startOffset : 0, start + index === end ? this.endOffset : item.length)).join('');
      },
    }; },
  });
  document.documentElement = document.body;
  return { roots, set, observers, restore() { invalidateTargets(); for (const [key, value] of original) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}
function mount(tag = 'p', properties = {}, parent = document.body) {
  const child = element(tag, { parentElement: parent, ...properties });
  parent.children.push(child);
  document.notify?.({ type: 'childList', target: parent, addedNodes: [child], removedNodes: [] });
  return child;
}

function selection(start, end, owner, selected) {
  return { startContainer: start, endContainer: end, startOffset: 0, endOffset: end.length, commonAncestorContainer: owner, intersectsNode: item => selected.includes(item), cloneRange() { return { ...this }; }, toString() { throw new Error('unfiltered selection text must not be read'); } };
}

test('selected quotes restore split nodes, whitespace, composed emoji and UTF-16 offsets', () => {
  const env = fixture();
  try {
    const p = mount();
    const nodes = ['before ', '你好', ' ', '👩‍💻', ' after'].map(value => node(p, value));
    const picked = selectionTarget(selection(nodes[1], nodes[3], p, nodes.slice(1, 4))).item;
    assert.equal(picked.target.exact, '你好 👩‍💻');
    const range = locate(picked.target).range;
    assert.equal(range.startContainer, nodes[1]);
    assert.equal(range.startOffset, 0);
    assert.equal(range.endContainer, nodes[3]);
    assert.equal(range.endOffset, nodes[3].length);
    assert.equal(range.toString(), picked.target.exact);
    const inside = selectionTarget({ ...selection(nodes[0], nodes[0], p, [nodes[0]]), startOffset: 1, endOffset: 3 }).item;
    const found = locate(inside.target).range;
    assert.equal(found.startOffset, 1);
    assert.equal(found.endOffset, 3);
  } finally { env.restore(); }
});

test('selected quotes save 24 Unicode characters of context and require that context when locating', () => {
  const env = fixture();
  try {
    for (const [prefix, exact, suffix] of [
      ['prefix '.repeat(10), '引用内容', ' suffix'.repeat(10)],
      ['😀'.repeat(40), 'quoted', '🙂'.repeat(40)],
    ]) {
      document.body.children = [];
      const p = mount(); const text = node(p, prefix + exact + suffix);
      const picked = selectionTarget({ ...selection(text, text, p, [text]), startOffset: prefix.length, endOffset: prefix.length + exact.length }).item;
      assert.deepEqual(picked.target, { kind: 'quote', exact, prefix: Array.from(prefix).slice(-24).join(''), suffix: Array.from(suffix).slice(0, 24).join('') });
      const found = locate(picked.target).range;
      assert.equal(found.startOffset, prefix.length);
      assert.equal(found.endOffset, prefix.length + exact.length);
      document.body.children = [];
      node(mount(), `different ${exact} context`);
      assert.equal(locate(picked.target), undefined);
    }
  } finally { env.restore(); }
});

test('a selected item yields a local multi-node range without a body text index', () => {
  const env = fixture();
  try {
    const p = mount(); const a = node(p, 'hello '), b = node(p, 'world');
    const picked = selectionTarget(selection(a, b, p, [a, b])).item;
    assert.equal(picked.target.exact, 'hello world');
    const found = locate(picked.target);
    assert.equal(found.range.startContainer, a);
    assert.equal(found.range.endContainer, b);
    assert.equal(found.range.endOffset, 5);
    assert.ok(env.roots.includes(document.body));
    document.body.children = [];
    const refreshed = mount(); const replacement = node(refreshed, 'hello world');
    assert.equal(locate(picked.target).range.startContainer, replacement, 'refresh requires no local picking cache');
  } finally { env.restore(); }
});

test('native selections spanning sibling blocks restore from the same actual DOM text', () => {
  const env = fixture();
  try {
    const first = mount(), second = mount(); const alpha = node(first, 'alpha'), beta = node(second, 'beta');
    const picked = selectionTarget(selection(alpha, beta, document.body, [first, alpha, second, beta])).item;
    assert.equal(picked.target.exact, 'alphabeta');
    let found = locate(picked.target);
    assert.equal(found.range.startContainer, alpha); assert.equal(found.range.endContainer, beta);
    assert.equal(found.range.toString(), picked.target.exact);
    document.body.children = [];
    const newAlpha = node(mount('div'), 'alpha'), newBeta = node(mount('div'), 'beta');
    found = locate(picked.target);
    assert.equal(found.range.startContainer, newAlpha); assert.equal(found.range.endContainer, newBeta);
    document.body.children = [];
    node(mount(), 'alpha '); node(mount(), 'beta');
    assert.equal(locate(picked.target), undefined, 'actual whitespace is never removed to bridge words');
    document.body.children = [];
    node(mount(), 'alpha'); node(mount('button'), 'secret', true); node(mount(), 'beta');
    assert.equal(locate(picked.target), undefined, 'excluded content remains a hard boundary across blocks');
  } finally { env.restore(); }
});

test('selection preserves whitespace and excludes unrelated hidden siblings before any text read', () => {
  const env = fixture();
  try {
    const p = mount(); const a = node(p, 'hello '), b = node(p, '🌏');
    const hidden = element('span', { private: true, parentElement: p }); p.children.push(hidden);
    const secret = node(hidden, 'account secret', true);
    const range = selection(a, b, p, [a, b]);
    const picked = selectionTarget(range).item;
    assert.equal(picked.target.exact, 'hello 🌏');
    assert.equal(secret.reads, 0);
    assert.equal(locate(picked.target).range.endContainer, b);
  } finally { env.restore(); }
});

test('form, button, editable or hidden contents reject a selected block before reading its descendants', () => {
  const env = fixture();
  try {
    for (const tag of ['form', 'button', 'input', 'textarea', 'select', 'div']) {
      const p = element(); const privateNode = element(tag, { private: true, parentElement: p }); p.children.push(privateNode);
      const secret = node(privateNode, 'do not read', true);
      assert.equal(selectionTarget(selection(secret, secret, p, [privateNode, secret])).item, undefined);
      assert.equal(readable(privateNode), false);
      assert.equal(secret.reads, 0);
    }
    const hidden = element('p', { computedStyle: { visibility: 'hidden' } });
    const hiddenText = node(hidden, 'hidden', true);
    assert.equal(selectionTarget(selection(hiddenText, hiddenText, hidden, [hiddenText])).item, undefined);
  } finally { env.restore(); }
});

test('selection crossing a private subtree is rejected without reading that subtree', () => {
  const env = fixture();
  try {
    const p = element(); const a = node(p, 'public');
    const privateNode = element('input', { private: true, parentElement: p }); p.children.push(privateNode);
    const secret = node(privateNode, 'do not read', true);
    const range = selection(a, secret, p, [a, privateNode, secret]);
    assert.equal(selectionTarget(range).item, undefined);
    assert.equal(secret.reads, 0);
  } finally { env.restore(); }
});

test('native ranges select a short excerpt of a long div without reading unrelated buttons', () => {
  const env = fixture();
  try {
    const p = mount('div'); const text = node(p, 'x'.repeat(500) + ' selected sentence ' + 'y'.repeat(500));
    const button = mount('button', {}, p); const secret = node(button, 'button private contents', true);
    const range = { ...selection(text, text, text, [text]), startOffset: 501, endOffset: 518 };
    const result = selectionTarget(range);
    assert.equal(result.item.target.exact, 'selected sentence');
    assert.equal(secret.reads, 0);
  } finally { env.restore(); }
});

test('selection reports overlong and private ranges explicitly and counts Unicode characters', () => {
  const env = fixture();
  try {
    for (const value of ['x'.repeat(201), '🌏'.repeat(201)]) {
      const p = mount(); const text = node(p, value);
      assert.deepEqual(selectionTarget(selection(text, text, p, [text])), { reason: 'too-long' });
    }
    const p = mount(); const text = node(p, '🌏'.repeat(200));
    assert.equal(selectionTarget(selection(text, text, p, [text])).item.target.exact, '🌏'.repeat(200));
    for (const name of ['trade-history', 'wallet-balance', 'positions', 'orders']) {
      const privateNode = mount('div', { attributes: { class: name } }); const secret = node(privateNode, 'do not read', true);
      assert.deepEqual(selectionTarget(selection(secret, secret, privateNode, [secret])), { reason: 'unavailable' });
      assert.equal(secret.reads, 0);
    }
  } finally { env.restore(); }
});

test('all native selections remain exact quotes including complete addresses', () => {
  const env = fixture();
  try {
    for (const value of ['0x1234567890AbCdEf1234567890AbCdEf12345678', 'So11111111111111111111111111111111111111112']) {
      const p = mount(); const text = node(p, value);
      const result = selectionTarget(selection(text, text, p, [text]));
      assert.equal(result.item.target.kind, 'quote');
      assert.equal(result.item.target.exact, value);
    }
    for (const value of ['internationalization', '0x123456…5678', '0x123456', 'z'.repeat(44), 'x0x1234567890abcdef1234567890abcdef12345678y']) {
      const p = mount(); const text = node(p, value);
      const picked = selectionTarget(selection(text, text, p, [text])).item;
      assert.equal(picked.target.kind, 'quote');
      assert.equal(picked.target.exact, value);
    }
  } finally { env.restore(); }
});

test('a teammate quote locates across inline nodes and whitespace using both saved contexts', () => {
  const env = fixture();
  try {
    const wrong = mount(); node(wrong, 'wrong hello 🌏 context');
    const p = mount(); const head = node(p, 'before hello ');
    const span = mount('span', {}, p); const tail = node(span, '\n🌏'); node(p, ' after');
    const target = { kind: 'quote', exact: 'hello 🌏', prefix: 'before ', suffix: ' after' };
    const range = locate(target).range;
    assert.equal(range.startContainer, head);
    assert.equal(range.startOffset, 7);
    assert.equal(range.endContainer, tail);
    assert.equal(range.endOffset, 3);
    assert.equal(locate({ ...target, suffix: 'changed' }), undefined);
  } finally { env.restore(); }
});

test('numeric whitespace is preserved and ambiguous normalized quotes are never guessed', () => {
  const env = fixture();
  try {
    node(mount(), 'Price 12 3 USD');
    const target = { kind: 'quote', exact: '1 23', prefix: 'Price ', suffix: ' USD' };
    assert.equal(locate(target), undefined);
    document.body.children = [];
    const exact = node(mount(), 'Price 1\n\t23 USD');
    assert.equal(locate(target).range.startContainer, exact);
    node(mount(), 'Price 1 23 USD');
    assert.equal(locate(target), undefined);
    document.body.children = [];
    node(mount(), 'Price 123 USD');
    assert.equal(locate(target), undefined);
  } finally { env.restore(); }
});

test('quote contexts disambiguate repeated text inside a window but reject overlapping full matches', () => {
  const env = fixture();
  try {
    const source = node(mount(), 'aaaa');
    const target = { kind: 'quote', exact: 'aa', prefix: 'a', suffix: 'a' };
    const range = locate(target).range;
    assert.equal(range.startContainer, source);
    assert.equal(range.startOffset, 1);
    assert.equal(range.endOffset, 3);
    node(mount(), 'a');
    assert.equal(locate(target), undefined, 'two overlapping context windows are ambiguous');
  } finally { env.restore(); }
});

test('quote matching rechecks actual Range text before accepting a streamed match', () => {
  const env = fixture();
  try {
    const source = node(mount(), 'before price 123 after');
    source.substringData = () => 'before price 456 after';
    assert.equal(locate({ kind: 'quote', exact: 'price 456', prefix: 'before ', suffix: ' after' }), undefined);
  } finally { env.restore(); }
});

test('known text is found deep in a large node', () => {
  const env = fixture();
  try {
    const p = mount(); const source = node(p, 'x'.repeat(4000) + ' context target text after ' + 'y'.repeat(4000));
    const range = locate({ kind: 'quote', exact: 'target text', prefix: 'context ', suffix: ' after' }).range;
    assert.equal(range.startContainer, source);
    assert.equal(range.startOffset, 4009);
    assert.equal(range.endOffset, 4020);
    document.body.children = [];
    node(mount(), 'new contents');
    assert.equal(locate({ kind: 'quote', exact: 'target text', prefix: 'context ', suffix: ' after' }), undefined);
  } finally { env.restore(); }
});

test('ambiguous quotes are not guessed and excluded subtrees never bridge a match', () => {
  const env = fixture();
  try {
    node(mount(), 'duplicate'); node(mount(), 'duplicate');
    assert.equal(locate({ kind: 'quote', exact: 'duplicate', prefix: '', suffix: '' }), undefined);
    document.body.children = [];
    const p = mount(); node(p, 'hello');
    node(mount('button', {}, p), 'secret', true);
    node(p, 'world');
    assert.equal(locate({ kind: 'quote', exact: 'helloworld', prefix: '', suffix: '' }), undefined);
  } finally { env.restore(); }
});

test('fresh pages locate full and abbreviated addresses, including split nodes and later candidates', () => {
  const env = fixture();
  try {
    const target = { kind: 'address', text: '0x1234567890abcdef1234567890abcdef12345678' };
    node(mount(), 'Other 0x9999999999999999999999999999999999999999');
    const p = mount(); const a = node(p, 'Address: 0x1234567890');
    const b = node(mount('span', {}, p), 'abcdef1234567890abcdef12345678');
    let range = locate(target).range;
    assert.equal(range.startContainer, a); assert.equal(range.startOffset, 9);
    assert.equal(range.endContainer, b); assert.equal(range.endOffset, b.length);
    document.body.children = [];
    const shortened = node(mount(), '0x123456…5678');
    range = locate(target).range;
    assert.equal(range.startContainer, shortened);
    assert.equal(range.endOffset, shortened.length);
    document.body.children = [];
    const full = node(mount(), target.text.toUpperCase());
    assert.equal(locate({ kind: 'address', text: '0x123456...5678' }).range.startContainer, full);
    document.body.children = [];
    const solana = 'So11111111111111111111111111111111111111112';
    node(mount(), solana);
    assert.ok(locate({ kind: 'address', text: solana }));
    assert.equal(locate({ kind: 'address', text: solana.toLowerCase() }), undefined);
  } finally { env.restore(); }
});

test('local search rejects private, hidden and sensitive-region text before reading it', () => {
  const env = fixture();
  const panel = element('section', { attributes: { class: 'trade-panel' } });
  try {
    const target = { kind: 'quote', exact: 'known target', prefix: '', suffix: '' };
    for (const tag of ['form', 'input', 'textarea', 'select', 'button', 'iframe']) node(mount(tag), target.exact, true);
    node(mount('div', { private: true }), target.exact, true);
    node(mount('div', { attributes: { class: 'wallet-balance' } }), target.exact, true);
    for (const computedStyle of [{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }, { contentVisibility: 'hidden' }]) node(mount('div', { computedStyle }), target.exact, true);
    panel.parentElement = document.body; document.body.children.push(panel);
    node(panel, target.exact, true);
    const visible = node(mount(), target.exact);
    assert.equal(locate(target).range.startContainer, visible);
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    node(mount('button'), address, true);
    const publicAddress = node(mount(), address);
    assert.equal(locate({ kind: 'address', text: address }).range.startContainer, publicAddress);
  } finally { env.restore(); }
});

test('chart area prefers the chart over a layout column whose class mentions chart', async () => {
  const { genericChart } = await import('../apps/extension/src/page-layer/adapters.ts');
  const box = (className, width, height, children = []) => ({ className, children, contains(item) { return item === this || children.some(child => child.contains(item)); }, getBoundingClientRect: () => ({ width, height }) });
  const chart = box('h-full chart-anchor-main', 334, 312);
  const column = box('flex flex-col chart-column', 654, 574, [chart]);
  const original = globalThis.document;
  globalThis.document = { querySelectorAll: selector => selector.startsWith('[class') ? [column, chart] : [] };
  try { assert.equal(genericChart(), chart); } finally { globalThis.document = original; }
});

test('many quote and address targets share one synchronous traversal until an outside-host mutation', () => {
  const env = fixture();
  try {
    const targets = Array.from({ length: 30 }, (_, i) => ({ kind: 'quote', exact: `target ${i}!`, prefix: 'before ', suffix: ' after' }));
    for (const target of targets) node(mount(), `before ${target.exact} after `);
    const address = { kind: 'address', text: '0x1234567890abcdef1234567890abcdef12345678' };
    node(mount(), ` ${address.text} `);
    const host = mount('palside-page-layer', { private: true });
    for (const target of targets) assert.equal(locate(target)?.range.toString(), target.exact);
    assert.equal(locate(address)?.range.toString(), address.text);
    assert.equal(env.roots.length, 1);
    document.notify({ type: 'attributes', target: host });
    assert.equal(locate(targets[0])?.range.toString(), targets[0].exact);
    assert.equal(env.roots.length, 1, 'host projections preserve the index');
    node(mount(), `before ${targets[0].exact} after `);
    assert.equal(locate(targets[0]), undefined, 'pending mutation records invalidate uniqueness before observer delivery');
    assert.equal(locate(targets[1])?.range.toString(), targets[1].exact);
    assert.equal(env.roots.length, 2);
    const observer = env.observers.find(item => item.active);
    observer.callback([{ type: 'characterData', target: document.body.children[1].children[0] }]);
    assert.ok(locate(targets[1]));
    assert.equal(env.roots.length, 3, 'delivered mutations also invalidate the index');
  } finally { env.restore(); }
});

test('a complete synchronous index finds quotes and addresses beyond 262144 units and 12000 nodes', () => {
  const env = fixture();
  try {
    for (let i = 0; i < 12_001; i += 1) node(mount(), 'x'.repeat(24));
    const quote = { kind: 'quote', exact: 'quote near the end', prefix: 'before ', suffix: ' after' };
    const source = node(mount(), ` before ${quote.exact} after `);
    const address = { kind: 'address', text: '0x1234567890abcdef1234567890abcdef12345678' };
    const tail = node(mount(), ` ${address.text} `);
    assert.equal(locate(quote)?.range.startContainer, source);
    assert.equal(locate(address)?.range.startContainer, tail);
    assert.equal(env.roots.length, 1);
  } finally { env.restore(); }
});

test('zero-height body permits fixed content and comments do not split cross-node quotes', () => {
  const env = fixture();
  try {
    document.body.getBoundingClientRect = () => ({ width: 800, height: 0 });
    const owner = mount('div', { computedStyle: { position: 'fixed' } });
    const start = node(owner, 'before known ');
    owner.children.push({ nodeType: 8, parentElement: owner });
    const end = node(mount('span', {}, owner), 'target after');
    const target = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const range = locate(target)?.range;
    assert.equal(range?.startContainer, start);
    assert.equal(range?.endContainer, end);
    assert.equal(range?.toString(), target.exact);
    assert.equal(locate({ ...target, prefix: 'xxxxxx ' }), undefined);
    node(mount(), 'before known target after');
    assert.equal(locate(target), undefined, 'two context matches are ambiguous');
    owner.computedStyle.visibility = 'hidden';
    document.notify({ type: 'attributes', target: owner });
    assert.equal(locate(target)?.range.startContainer, document.body.children[1].children[0]);
  } finally { env.restore(); }
});

test('attribute reveals, adjacent context and address token boundaries invalidate the shared index', () => {
  const env = fixture();
  try {
    const quote = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const owner = mount('div', { computedStyle: { display: 'none' } });
    const prefix = node(owner, 'before '); node(owner, 'known target after');
    assert.equal(locate(quote), undefined);
    owner.computedStyle.display = 'block';
    document.notify({ type: 'attributes', target: owner });
    assert.equal(locate(quote)?.range.toString(), quote.exact);
    Object.defineProperty(prefix, 'data', { get: () => 'xxxxxx ' });
    document.notify({ type: 'characterData', target: prefix });
    assert.equal(locate(quote), undefined);
    const address = { kind: 'address', text: '0x1234567890abcdef1234567890abcdef12345678' };
    const p = mount(); const source = node(p, ` ${address.text}`);
    assert.equal(locate(address)?.range.startContainer, source);
    node(p, 'z');
    assert.equal(locate(address), undefined, 'an adjacent token character disqualifies the address');
    const other = node(mount(), ` ${address.text} `);
    assert.equal(locate(address)?.range.startContainer, other);
    node(mount(), ` ${address.text} `);
    assert.equal(locate(address)?.range.startContainer, other, 'addresses retain their first match');
  } finally { env.restore(); }
});

test('the shared index serves one task, so a style change without a mutation record is seen next time', async () => {
  const env = fixture();
  try {
    const quote = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const owner = mount('div', { computedStyle: { display: 'none' } });
    node(owner, 'before known target after');
    assert.equal(locate(quote), undefined);
    owner.computedStyle.display = 'block';
    assert.equal(locate(quote), undefined, 'the same task reuses its traversal');
    await Promise.resolve();
    assert.equal(locate(quote)?.range.toString(), quote.exact);
    assert.equal(env.roots.length, 2);
  } finally { env.restore(); }
});

test('page clear and URL changes release the shared index', () => {
  const env = fixture();
  try {
    const target = { kind: 'quote', exact: 'known target', prefix: '', suffix: '' };
    node(mount(), target.exact);
    assert.ok(locate(target)?.range);
    location.href = 'https://example.com/next';
    assert.ok(locate(target)?.range);
    assert.equal(env.roots.length, 2);
    invalidateTargets();
    assert.ok(locate(target)?.range);
    assert.equal(env.roots.length, 3);
    assert.equal(env.observers.filter(item => item.active).length, 1);
  } finally { env.restore(); }
});

test('long whitespace and empty-node traversals complete without truncation', () => {
  const env = fixture();
  try {
    const target = { kind: 'quote', exact: 'known target', prefix: '', suffix: '' };
    node(mount(), target.exact);
    node(mount(), ' '.repeat(262_145));
    assert.equal(locate(target).range.toString(), target.exact);
    document.body.children = [];
    node(mount(), target.exact);
    for (let i = 0; i < 12_000; i += 1) mount();
    assert.equal(locate(target).range.toString(), target.exact);
  } finally { env.restore(); }
});

test('chunk boundaries preserve quote context, whitespace, ambiguity and address tokens', () => {
  const env = fixture();
  try {
    const target = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    for (const offset of [8180, 8185, 8190]) {
      document.body.children = [];
      const source = node(mount(), 'x'.repeat(offset) + 'before known\n\t target after');
      const range = locate(target).range;
      assert.equal(range.startContainer, source);
      assert.equal(range.toString(), 'known\n\t target');
      node(mount(), 'x'.repeat(8192) + 'before known target after');
      assert.equal(locate(target), undefined);
    }
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    for (const token of [address, '0x123456...5678']) {
      document.body.children = [];
      node(mount(), 'x'.repeat(8180) + token + ' ');
      const source = node(mount(), ' '.repeat(8180) + token + ' ');
      const range = locate({ kind: 'address', text: address }).range;
      assert.equal(range.startContainer, source, 'an overflowing token cannot become an address at a chunk boundary');
      assert.equal(range.toString(), token);
    }
  } finally { env.restore(); }
});
