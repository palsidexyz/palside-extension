/* global document -- installed on globalThis by this file's DOM fixture */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findText, matchRange, scanning } from '../apps/extension/src/page-layer/page-text.ts';

/** The page-text lookup signals anchor through: one match is the place, several are never guessed. */
function locate(target) {
  const found = findText(target, 2);
  return !found?.length ? undefined : found.length > 1 ? 'ambiguous' : { range: matchRange(found[0]) };
}

function element(tag = 'p', properties = {}) {
  return {
    tagName: tag.toUpperCase(), nodeType: 1, children: [], isConnected: true, parentElement: null,
    get parentNode() { return this.parentElement; },
    get firstChild() { return this.children[0] ?? null; },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; },
    private: ['input', 'textarea', 'select', 'canvas', 'iframe'].includes(tag),
    contains(item) { return item === this || this.children.some(child => child === item || child.contains?.(item)); },
    getAttribute(name) { return this.attributes?.[name] ?? null; },
    closest(selector) { return (selector === 'palside-page-layer' ? tag === selector : this.private) ? this : this.parentElement?.closest(selector) ?? null; },
    querySelector() { return this.children.find(child => child.private || child.querySelector?.()); },
    matches(tags) { return Boolean(this.private) || tags.split(',').includes(tag); },
    getBoundingClientRect() { return { width: 200, height: 20 }; },
    ...properties,
  };
}
function node(parent, value, denied = false) {
  const result = { nodeType: 3, length: value.length, parentElement: parent, parentNode: parent, get nextSibling() { return parent.children[parent.children.indexOf(this) + 1] ?? null; }, isConnected: true, reads: 0, get data() { this.reads += 1; assert.equal(denied, false, 'private text was read'); return value; }, substringData(start, count) { assert.ok(count <= 1024); return this.data.slice(start, start + count); } };
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
      // The DOM TreeWalker algorithm, so a walk that starts mid-page only asks the filter about the nodes it passes.
      const parent = node => node === root ? null : node.parentElement ?? null;
      const kids = node => node.children ?? [];
      const sibling = (node, step) => { const list = parent(node) ? kids(parent(node)) : []; return list[list.indexOf(node) + step] ?? null; };
      const decide = node => (flags & (1 << (node.nodeType - 1))) ? filter?.acceptNode(node) ?? 1 : 3;
      const walker = {
        currentNode: root,
        nextNode() {
          let node = walker.currentNode, result = 1;
          for (;;) {
            while (result !== 2 && kids(node).length) { node = kids(node)[0]; result = decide(node); if (result === 1) return walker.currentNode = node; }
            let next = null;
            for (let temp = node; temp && temp !== root; temp = parent(temp)) { next = sibling(temp, 1); if (next) break; }
            if (!next) return null;
            node = next; result = decide(node); if (result === 1) return walker.currentNode = node;
          }
        },
        previousNode() {
          let node = walker.currentNode;
          while (node !== root) {
            let previous = sibling(node, -1);
            while (previous) {
              node = previous; let result = decide(node);
              while (result !== 2 && kids(node).length) { node = kids(node).at(-1); result = decide(node); }
              if (result === 1) return walker.currentNode = node;
              previous = sibling(node, -1);
            }
            const up = parent(node); if (!up) return null;
            node = up; if (decide(node) === 1) return walker.currentNode = node;
          }
          return null;
        },
      };
      return walker;
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
      compareBoundaryPoints(how, other) {
        const nodes = [];
        const collect = item => { if (item.nodeType === 3) nodes.push(item); else for (const child of item.children ?? []) collect(child); };
        collect(document.body);
        const point = (range, end) => nodes.indexOf(end ? range.endContainer : range.startContainer) * 1e6 + (end ? range.endOffset : range.startOffset);
        const end = how === 2; // END_TO_END
        return Math.sign(point(this, end) - point(other, end));
      },
    }; },
  });
  document.documentElement = document.body;
  let walks = 0;
  Object.defineProperty(document.body, 'firstChild', { get() { walks += 1; return this.children[0] ?? null; } });
  return { roots, set, observers, walks: () => walks, restore() { for (const [key, value] of original) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}
function mount(tag = 'p', properties = {}, parent = document.body) {
  const child = element(tag, { parentElement: parent, ...properties });
  parent.children.push(child);
  document.notify?.({ type: 'childList', target: parent, addedNodes: [child], removedNodes: [] });
  return child;
}

test('a teammate anchor is found across inline nodes and whitespace using both saved contexts', () => {
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

test('ambiguous text is not guessed and excluded subtrees never bridge a match', () => {
  const env = fixture();
  try {
    node(mount(), 'duplicate'); node(mount(), 'duplicate');
    assert.equal(locate({ kind: 'quote', exact: 'duplicate', prefix: '', suffix: '' }), 'ambiguous');
    document.body.children = [];
    const p = mount(); node(p, 'hello');
    node(mount('input', {}, p), 'secret', true);
    node(p, 'world');
    assert.equal(locate({ kind: 'quote', exact: 'helloworld', prefix: '', suffix: '' }), undefined);
  } finally { env.restore(); }
});

test('local search rejects excluded and hidden text before reading it', () => {
  const env = fixture();
  try {
    const target = { kind: 'quote', exact: 'known target', prefix: '', suffix: '' };
    for (const tag of ['input', 'textarea', 'select', 'iframe']) node(mount(tag), target.exact, true);
    node(mount('div', { private: true }), target.exact, true);
    for (const computedStyle of [{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }, { contentVisibility: 'hidden' }]) node(mount('div', { computedStyle }), target.exact, true);
    const visible = node(mount(), target.exact);
    assert.equal(locate(target).range.startContainer, visible);
  } finally { env.restore(); }
});

test('many targets share one walk inside a scan, and every lookup outside one walks afresh', () => {
  const env = fixture();
  try {
    const targets = Array.from({ length: 30 }, (_, i) => ({ kind: 'quote', exact: `target ${i}!`, prefix: 'before ', suffix: ' after' }));
    for (const target of targets) node(mount(), `before ${target.exact} after `);
    scanning(() => { for (const target of targets) assert.equal(locate(target)?.range.toString(), target.exact); });
    assert.equal(env.walks(), 1);
    node(mount(), `before ${targets[0].exact} after `);
    assert.equal(locate(targets[0]), 'ambiguous', 'a later lookup sees the changed page');
    assert.equal(env.walks(), 2);
  } finally { env.restore(); }
});

test('a large page is walked to its end', () => {
  const env = fixture();
  try {
    for (let i = 0; i < 12_001; i += 1) node(mount(), 'x'.repeat(24));
    const quote = { kind: 'quote', exact: 'quote near the end', prefix: 'before ', suffix: ' after' };
    const source = node(mount(), ` before ${quote.exact} after `);
    assert.equal(locate(quote)?.range.startContainer, source);
  } finally { env.restore(); }
});

test('zero-height body permits fixed content and comments do not split cross-node text', () => {
  const env = fixture();
  try {
    document.body.getBoundingClientRect = () => ({ width: 800, height: 0 });
    const owner = mount('div', { computedStyle: { position: 'fixed' } });
    const start = node(owner, 'before known ');
    owner.children.push({ nodeType: 8, parentElement: owner, get nextSibling() { return owner.children[owner.children.indexOf(this) + 1] ?? null; } });
    const end = node(mount('span', {}, owner), 'target after');
    const target = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const range = locate(target)?.range;
    assert.equal(range?.startContainer, start);
    assert.equal(range?.endContainer, end);
    assert.equal(range?.toString(), target.exact);
    assert.equal(locate({ ...target, prefix: 'xxxxxx ' }), undefined);
    node(mount(), 'before known target after');
    assert.equal(locate(target), 'ambiguous', 'two context matches are ambiguous');
    owner.computedStyle.visibility = 'hidden';
    document.notify({ type: 'attributes', target: owner });
    assert.equal(locate(target)?.range.startContainer, document.body.children[1].children[0]);
  } finally { env.restore(); }
});

test('attribute reveals and adjacent context changes are seen by the next lookup', () => {
  const env = fixture();
  try {
    const quote = { kind: 'quote', exact: 'known target', prefix: 'before ', suffix: ' after' };
    const owner = mount('div', { computedStyle: { display: 'none' } });
    const prefix = node(owner, 'before '); node(owner, 'known target after');
    assert.equal(locate(quote), undefined);
    owner.computedStyle.display = 'block';
    assert.equal(locate(quote)?.range.toString(), quote.exact);
    Object.defineProperty(prefix, 'data', { get: () => 'xxxxxx ' });
    assert.equal(locate(quote), undefined);
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

test('long nodes preserve context, whitespace and ambiguity', () => {
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
      assert.equal(locate(target), 'ambiguous');
    }
  } finally { env.restore(); }
});

test('a box with no area shows its children unless it clips them', () => {
  const env = fixture();
  try {
    const empty = { width: 0, height: 0 };
    const target = { kind: 'quote', exact: 'known target', prefix: '', suffix: '' };
    const anchor = mount('div', { getBoundingClientRect: () => empty });
    const shownText = node(mount('span', {}, anchor), target.exact);
    assert.equal(locate(target).range.startContainer, shownText);
    anchor.computedStyle = { overflow: 'hidden' };
    assert.equal(locate(target), undefined, 'a collapsed panel hides its text');
    const collapsed = mount('p', { getBoundingClientRect: () => empty });
    node(collapsed, 'other words');
    assert.equal(locate({ kind: 'quote', exact: 'other words', prefix: '', suffix: '' }), undefined, 'text straight inside a box with no area is hidden');
  } finally { env.restore(); }
});
