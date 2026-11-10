import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import { readable } from '../apps/extension/src/page-layer/page-text.ts';
import { displayHost, normalizeSiteHost } from '../apps/extension/src/domain/assets/site-host.ts';

function region(markup) {
  const { document } = parseHTML(`<html><body>${markup}</body></html>`);
  for (const element of document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ width: 100, height: 20 });
  return document.querySelector('#target');
}

test('page interaction excludes only technical controls, invisible content and non-content elements', t => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = element => element.style;
  t.after(() => { if (previous) globalThis.getComputedStyle = previous; else delete globalThis.getComputedStyle; });
  for (const tag of ['input', 'textarea', 'select', 'script', 'style', 'template', 'noscript', 'canvas', 'iframe', 'palside-page-layer']) {
    assert.equal(readable(region(`<${tag} id="target">text</${tag}>`)), false, tag);
  }
  for (const attribute of ['contenteditable', 'hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"']) {
    assert.equal(readable(region(`<div ${attribute}><span id="target">text</span></div>`)), false, attribute);
  }
  for (const tag of ['button', 'form', 'fieldset', 'section']) {
    assert.equal(readable(region(`<${tag} id="target">text</${tag}>`)), true, tag);
  }
  for (const attribute of ['role="button"', 'role="dialog"', 'autocomplete="off"', 'data-trade-panel', 'data-private', 'id="walletBalance"', 'class="trade-panel"', 'aria-label="交易 余额 private secret password"', 'data-testid="account-orders"']) {
    assert.equal(readable(region(`<div ${attribute}><span id="target">text</span></div>`)), true, attribute);
  }
});

test('add-site input accepts normalized international hosts and pasted links', () => {
  const path = 'apps/extension/src/features/palside/settings/access-sheet.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'typedHost');
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const typedHost = vm.runInNewContext(`${js}\ntypedHost`, { normalizeSiteHost, URL });
  const host = new URL('https://例子.中国').hostname;
  for (const input of ['例子.中国', host, `https://${host}/article`, ' https://例子.中国/article ']) assert.equal(typedHost(input), host);
  for (const input of ['localhost', '127.0.0.1', 'bad..example', 'not a host']) assert.equal(typedHost(input), undefined);
});

test('privacy descriptions reflect technical exclusions with identical translation keys', () => {
  const zh = JSON.parse(readFileSync('packages/i18n/src/zh-CN.json', 'utf8'));
  const en = JSON.parse(readFileSync('packages/i18n/src/en.json', 'utf8'));
  const keys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
  assert.deepEqual(keys(zh), keys(en));
  const descriptions = value => {
    const found = [];
    const visit = node => { for (const [key, child] of Object.entries(node)) { if (key === 'read' && child.signal && child.room) found.push(child); else if (child && typeof child === 'object') visit(child); } };
    visit(value); return found[0];
  };
  for (const kind of ['signal']) {
    assert.match(descriptions(zh)[kind].no, /隐藏内容、画布/);
    assert.doesNotMatch(descriptions(zh)[kind].no, /表单|余额|交易/);
    assert.match(descriptions(en)[kind].no, /hidden content, canvases/);
  }
});

test('a link reads as its host without scheme or leading www; text that is not a URL has none', () => {
  assert.equal(displayHost('https://www.dexscreener.com/base/0x1'), 'dexscreener.com');
  assert.equal(displayHost('https://app.uniswap.org/'), 'app.uniswap.org');
  assert.equal(displayHost('not a url'), undefined);
});
