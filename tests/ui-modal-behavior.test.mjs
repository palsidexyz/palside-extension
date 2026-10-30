import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { launchChrome, until } from '../scripts/lib/headless-chrome.mjs';

test('shared pointer guard requires a backdrop press and release', () => {
  const source = readFileSync(new URL('../packages/ui/src/internal/backdrop-dismiss.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  runInNewContext(outputText, { exports, require: () => ({ useRef: value => ({ current: value }) }) });
  let closes = 0;
  const handlers = exports.useBackdropDismiss(event => event.backdrop, () => closes++);
  const inside = { backdrop: false, stopPropagation() {} };
  const outside = { backdrop: true, stopPropagation() {} };
  handlers.onPointerDown(inside);
  handlers.onClick(outside);
  assert.equal(closes, 0, 'drag out');
  handlers.onPointerDown(outside);
  handlers.onClick(inside);
  assert.equal(closes, 0, 'drag in');
  handlers.onPointerDown(outside);
  handlers.onPointerCancel();
  handlers.onClick(outside);
  assert.equal(closes, 0, 'cancelled press');
  handlers.onPointerDown(outside);
  handlers.onClick(outside);
  assert.equal(closes, 1, 'backdrop click');
  handlers.onClick(outside);
  assert.equal(closes, 1, 'press is consumed');
});

// Compile only the fixture and its component imports in memory; serve all requests locally.
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from './packages/ui/src/components/dialog/dialog';
import { Sheet } from './packages/ui/src/components/sheet/sheet';
function App() {
  const [config, setConfig] = useState({ type: 'dialog' });
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  window.configure = setConfig;
  window.openModal = () => setOpen(true);
  window.openInner = () => setInner(true);
  window.closes ??= [];
  const close = value => { window.closes.push('outer'); setOpen(value); };
  const innerClose = value => { window.closes.push('inner'); setInner(value); };
  const content = <><input id="field" data-autofocus /><button id="inner-trigger" onClick={() => setInner(true)}>Inner</button>
    {config.innerType === 'sheet' ? <Sheet open={inner} onOpenChange={innerClose} aria-labelledby="inner-title"><h2 id="inner-title">Inner</h2></Sheet>
      : <Dialog open={inner} onOpenChange={innerClose} title="Inner" pending={config.innerPending}><input /></Dialog>}</>;
  return <><button id="trigger" onClick={() => setOpen(true)}>Open</button><div id="boundary" style={{position:'fixed',left:100,top:80,width:500,height:500}}>
    {config.type === 'sheet' ? <Sheet open={open} onOpenChange={close} aria-labelledby="sheet-title"><h2 id="sheet-title">Sheet</h2>{content}</Sheet>
      : <Dialog open={open} onOpenChange={close} title="Dialog" placement={config.placement} boundarySelector={config.boundarySelector} kind={config.kind}>{content}</Dialog>}
  </div></>;
}
createRoot(document.getElementById('root')).render(<App />);`;

test('rendered modal dismissal, nesting, focus and boundaries', async t => {
  const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: 'modal-fixture', jsx: 'automatic', loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/fixture.js' ? js : req.url === '/fixture.css' ? css : '<link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const count = () => evaluate('document.querySelectorAll("dialog[open]").length');
  const escape = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await settle();
  };
  async function setup(config) {
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    await until(() => evaluate('typeof window.configure === "function"'), 'fixture ready');
    await evaluate(`configure(${JSON.stringify(config)})`);
    await settle();
    await evaluate('document.getElementById("trigger").focus(); openModal()');
    await until(async () => await count() === 1, 'modal open');
    await evaluate('Promise.all([...document.getAnimations()].map(animation => animation.finished))');
  }
  const pointer = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  for (const type of ['dialog', 'sheet']) {
    await t.test(`${type}: drag-out stays open; backdrop click dismisses and restores focus`, async () => {
      await setup({ type });
      const inside = await evaluate('(() => { const r = document.getElementById("field").getBoundingClientRect(); return {x:r.left+5,y:r.top+5}; })()');
      await pointer('mousePressed', inside.x, inside.y);
      await pointer('mouseMoved', 10, 10);
      await pointer('mouseReleased', 10, 10);
      await settle();
      assert.equal(await count(), 1);
      assert.deepEqual(await evaluate('window.closes'), []);
      await pointer('mousePressed', 10, 10);
      await pointer('mouseReleased', 10, 10);
      await settle();
      if (type === 'sheet') assert.equal(await evaluate('document.querySelector("[data-slot=sheet-content]")?.inert'), true);
      await until(async () => await count() === 0, 'modal dismissed');
      assert.equal(await evaluate('document.activeElement.id'), 'trigger');
      assert.deepEqual(await evaluate('window.closes'), ['outer']);
    });
    for (const innerType of ['dialog', 'sheet']) {
      await t.test(`${type} containing ${innerType}: Escape closes only innermost`, async () => {
        await setup({ type, innerType });
        await evaluate('document.getElementById("inner-trigger").focus(); openInner()');
        await until(async () => await count() === 2, 'nested modal');
        await escape();
        await until(async () => await count() === 1, 'inner dismissed');
        assert.deepEqual(await evaluate('window.closes'), ['inner']);
        assert.equal(await evaluate('document.activeElement.id'), 'inner-trigger');
        await escape();
        await until(async () => await count() === 0, 'outer dismissed');
        assert.equal(await evaluate('document.activeElement.id'), 'trigger');
      });
    }
  }
  await t.test('bottom uses visible viewport; live boundary changes preserve focus and clear geometry', async () => {
    await setup({ type: 'dialog', placement: 'bottom' });
    const bottom = () => evaluate('document.querySelector("dialog").getBoundingClientRect().bottom');
    assert.ok(Math.abs(await bottom() - await evaluate('innerHeight - 12')) < 1);
    await evaluate('document.getElementById("field").focus(); configure({placement:"bottom",boundarySelector:"#boundary"})');
    await settle();
    assert.ok(Math.abs(await bottom() - 568) < 1);
    assert.equal(await evaluate('document.activeElement.id'), 'field');
    await evaluate('configure({placement:"bottom",boundarySelector:"#missing"})');
    await settle();
    assert.ok(Math.abs(await bottom() - await evaluate('innerHeight - 12')) < 1);
    await evaluate(`Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), { offsetLeft: 30, offsetTop: 40, width: 600, height: 500 }) }); window.dispatchEvent(new Event('resize'))`);
    await settle();
    assert.ok(Math.abs(await bottom() - 528) < 1);
    assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().left'), 150);
    await evaluate('configure({placement:"center",kind:"view"})');
    await settle();
    assert.equal(await evaluate('document.querySelector("dialog").style.cssText'), '');
    assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().width'), 560);
    assert.equal(await evaluate('document.querySelector("dialog").getBoundingClientRect().height'), await evaluate('innerHeight - 16'));
    assert.equal(await evaluate('document.activeElement.id'), 'field');
    assert.deepEqual(await evaluate('window.closes'), []);
  });
});
