import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { launchChrome, until } from "../scripts/lib/headless-chrome.mjs";

test("anchored layers preserve refs, focus, geometry and subscription lifecycles", async t => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { Popover, PopoverTrigger, PopoverContent } from './packages/ui/src/components/popover/popover';
        import { Menu, MenuTrigger, MenuContent, MenuItem } from './packages/ui/src/components/menu/menu';
        import { Tooltip } from './packages/ui/src/components/tooltip/tooltip';
        const observers = new Map();
        const NativeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeObserver {
          observe(node, options) { if (!observers.has(this)) observers.set(this, new Set()); observers.get(this).add(node); super.observe(node, options); }
          disconnect() { observers.delete(this); super.disconnect(); }
        };
        const listeners = [];
        for (const [target, types] of [[window, ['resize']], [document, ['scroll']], [visualViewport, ['resize', 'scroll']]]) {
          for (const type of types) {
            const active = new Set(); listeners.push(active);
            const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
            target.addEventListener = (name, fn, options) => { if (name === type) active.add(fn); add(name, fn, options); };
            target.removeEventListener = (name, fn, options) => { if (name === type) active.delete(fn); remove(name, fn, options); };
          }
        }
        window.subscriptions = () => ({ observers: observers.size, listeners: listeners.map(set => set.size),
          boundaries: [...observers.values()].flatMap(set => [...set].map(node => node.id)).filter(id => id === 'inner' || id === 'outer') });
        const root = createRoot(document.getElementById('root'));
        function Fixture({ menu = false, tooltip = false, asChild = false, triggerRef, contentRef, childRef, items = [false, false, false], anchorLeft = 260, anchorTop = 250, innerWidth = 400, innerHeight = 500, ...options }) {
          const Root = menu ? Menu : Popover, Trigger = menu ? MenuTrigger : PopoverTrigger, Content = menu ? MenuContent : PopoverContent;
          const triggerStyle = { position: 'fixed', left: anchorLeft, top: anchorTop, width: 60, height: 30 };
          return <div id="outer" style={{ position: 'fixed', left: 100, top: 50, width: 500, height: 650 }}>
            <div id="inner" style={{ position: 'fixed', left: 140, top: 100, width: innerWidth, height: innerHeight }}>
              {tooltip ? <Tooltip content={'Long tooltip content '.repeat(30)}><button style={triggerStyle}>Help</button></Tooltip> :
                <Root {...options}>
                  <Trigger ref={triggerRef} asChild={asChild} style={triggerStyle}>{asChild ? <button ref={childRef}>Open</button> : 'Open'}</Trigger>
                  <Content ref={contentRef}>{menu ? items.map((disabled, index) => <MenuItem key={index} disabled={disabled}>Item {index}</MenuItem>) : 'Content'}</Content>
                </Root>}
            </div>
          </div>;
        }
        window.render = props => flushSync(() => root.render(<Fixture {...props} />));
        window.unmount = () => flushSync(() => root.render(null));
        window.surface = () => document.querySelector('[popover]');
        window.trigger = () => document.querySelector('[data-slot$="-trigger"]');
        window.geometry = () => { const rect = surface().getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, side: surface().dataset.side }; };
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, outfile: "overlay-test.js", format: "iife", jsx: "automatic",
  });
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  const evaluate = async expression => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const viewport = width => send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await viewport(800);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await evaluate('document.body.innerHTML = \'<div id="root"></div>\'');
  await evaluate(`document.head.appendChild(document.createElement('style')).textContent = ${JSON.stringify(bundle.outputFiles.find(file => file.path.endsWith(".css")).text)}`);
  await evaluate(bundle.outputFiles.find(file => file.path.endsWith(".js")).text);
  const render = props => evaluate(`render(${JSON.stringify(props)})`);
  const open = async () => {
    await evaluate("trigger().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); surface().showPopover()");
    await until(() => evaluate("surface().dataset.state === 'open' && surface().style.visibility === 'visible'"), "layer opens");
  };
  const closed = () => until(() => evaluate("!surface().matches(':popover-open') && subscriptions().observers === 0"), "layer closes and releases observers");
  const key = name => evaluate(`surface().dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true })); document.activeElement.textContent`);

  await t.test("React 19 refs assign, stay stable, replace and clean up on unmount", async () => {
    for (const asChild of [false, true]) {
      await evaluate(`
        window.calls = [];
        window.objectTrigger = { current: null }; window.objectContent = { current: null };
        window.childRef = node => { calls.push(node ? 'child:set' : 'child:null'); return () => calls.push('child:cleanup'); };
        window.props = { asChild: ${asChild}, triggerRef: objectTrigger, contentRef: objectContent, childRef };
        render(props);
      `);
      assert.equal(await evaluate("objectTrigger.current === trigger() && objectContent.current === surface()"), true);
      await evaluate("render(props)");
      await open();
      assert.deepEqual(await evaluate("calls"), asChild ? ["child:set"] : []);
      await evaluate(`
        window.callback = label => node => { calls.push(label + (node ? ':set' : ':null')); return () => calls.push(label + ':cleanup'); };
        props = { ...props, triggerRef: callback('trigger'), contentRef: callback('content') }; render(props);
      `);
      assert.equal(await evaluate("objectTrigger.current === null && objectContent.current === null"), true);
      await evaluate("calls.length = 0; render(props)");
      assert.deepEqual(await evaluate("calls"), []);
      await evaluate("props = { ...props, triggerRef: callback('next-trigger'), contentRef: callback('next-content') }; render(props)");
      assert.deepEqual(await evaluate("calls.filter(value => !value.startsWith('child:')).sort()"), ["content:cleanup", "next-content:set", "next-trigger:set", "trigger:cleanup"]);
      await evaluate("calls.length = 0; unmount()");
      assert.deepEqual(await evaluate("calls.sort()"), [...(asChild ? ["child:cleanup"] : []), "next-content:cleanup", "next-trigger:cleanup"]);
      await evaluate("calls.length = 0; render({ triggerRef: node => { calls.push(node ? 'set' : 'null'); }, contentRef: objectContent }); unmount()");
      assert.deepEqual(await evaluate("calls"), ["set", "null"]);
      assert.equal(await evaluate("objectContent.current"), null);
    }
  });

  await t.test("menu arrows enter at either end, wrap and skip disabled items", async () => {
    await render({ menu: true, items: [true, false, true, false, false, true] });
    await open();
    assert.equal(await evaluate("document.activeElement === surface()"), true);
    assert.equal(await key("ArrowUp"), "Item 4");
    assert.equal(await key("ArrowDown"), "Item 1");
    assert.equal(await key("ArrowDown"), "Item 3");
    assert.equal(await key("ArrowUp"), "Item 1");
    assert.equal(await key("ArrowUp"), "Item 4");
    await evaluate("surface().focus()");
    assert.equal(await key("ArrowDown"), "Item 1");
    assert.equal(await key("End"), "Item 4");
    assert.equal(await key("Home"), "Item 1");
    await render({ menu: true, items: [true, false, true] });
    await evaluate("surface().focus()");
    assert.equal(await key("ArrowUp"), "Item 1");
    assert.equal(await key("ArrowDown"), "Item 1");
    await render({ menu: true, items: [true, true] });
    await evaluate("surface().focus()");
    await key("ArrowUp");
    assert.equal(await evaluate("document.activeElement === surface()"), true);
    await evaluate("unmount()");
  });

  await t.test("rendered minimum width respects narrow viewports and boundaries", async () => {
    await render({}); await open();
    assert.equal((await evaluate("geometry()")).width, 200);
    await evaluate("unmount()");
    await viewport(200);
    await render({ anchorLeft: 20 }); await open();
    let rect = await evaluate("geometry()");
    assert.equal(rect.width, 184);
    assert.ok(rect.left >= 8 && rect.left + rect.width <= 192);
    await evaluate("unmount()");
    await viewport(800);
    await render({ boundarySelector: "#inner", innerWidth: 180 }); await open();
    rect = await evaluate("geometry()");
    assert.equal(rect.width, 164);
    assert.ok(rect.left >= 148 && rect.left + rect.width <= 312);
    await evaluate("unmount()");
  });

  await t.test("open subscriptions follow alignment, side and boundary and clean up once", async () => {
    await render({}); await open();
    assert.equal((await evaluate("geometry()")).left, 260);
    await render({ align: "end", side: "top", boundarySelector: "#inner" });
    let rect = await evaluate("geometry()");
    assert.equal(rect.left, 148); assert.equal(rect.side, "top");
    assert.deepEqual(await evaluate("subscriptions()"), { observers: 1, listeners: [1, 1, 1, 1], boundaries: ["inner"] });
    await render({ align: "end", side: "top", boundarySelector: "#outer" });
    assert.deepEqual(await evaluate("subscriptions()"), { observers: 1, listeners: [1, 1, 1, 1], boundaries: ["outer"] });
    await evaluate("trigger().style.left = '350px'; document.dispatchEvent(new Event('scroll'))");
    rect = await evaluate("geometry()");
    assert.equal(rect.left, 210); assert.equal(rect.side, "top");
    await evaluate("document.getElementById('outer').style.width = '300px'");
    await until(async () => (await evaluate("geometry().left")) === 192, "new boundary resize is observed");
    for (const event of ["window.dispatchEvent(new Event('resize'))", "visualViewport.dispatchEvent(new Event('resize'))", "visualViewport.dispatchEvent(new Event('scroll'))"]) {
      await evaluate(`surface().style.left = '0px'; ${event}`);
      assert.equal(await evaluate("geometry().left"), 192);
    }
    await evaluate("surface().hidePopover()"); await closed();
    assert.deepEqual(await evaluate("subscriptions().listeners"), [0, 0, 0, 0]);
    await open();
    await evaluate("unmount()");
    assert.deepEqual(await evaluate("subscriptions()"), { observers: 0, listeners: [0, 0, 0, 0], boundaries: [] });
  });

  await t.test("anchors outside either axis or in zero-area boundaries dismiss", async () => {
    for (const change of ["trigger().style.left = '540px'", "trigger().style.left = '80px'", "trigger().style.top = '600px'", "trigger().style.top = '70px'", "document.getElementById('inner').style.width = '0px'", "document.getElementById('inner').style.height = '0px'"]) {
      await render({ boundarySelector: "#inner" }); await open();
      await evaluate(`${change}; document.dispatchEvent(new Event('scroll'))`); await closed();
      await evaluate("unmount()");
    }
    await render({ boundarySelector: "#inner", anchorLeft: 130 }); await open();
    assert.equal(await evaluate("surface().matches(':popover-open')"), true);
    await evaluate("unmount()");
  });

  await t.test("visible tooltips keep the viewport-minus-16 sizing with or without the 240px CSS cap", async () => {
    await render({ tooltip: true });
    await evaluate("document.querySelector('button').focus()");
    await until(() => evaluate("surface().style.visibility === 'visible'"), "tooltip opens");
    const rect = await evaluate("geometry()");
    assert.ok(rect.width > 240 && rect.width <= 784);
    assert.equal(await evaluate("getComputedStyle(surface()).maxWidth"), "784px");
    await evaluate("window.cap = document.createElement('style'); cap.textContent = '[role=tooltip] { max-width: min(240px, calc(100vw - 16px)); }'; document.head.append(cap)");
    assert.deepEqual(await evaluate("geometry()"), rect);
    await evaluate("cap.remove(); unmount()");
  });
});
