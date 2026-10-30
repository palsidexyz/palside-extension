import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { launchChrome, until } from "../scripts/lib/headless-chrome.mjs";

test("PIN input follows native editing and normalizes before limiting", async t => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { PinInput } from './packages/ui/src/components/field/pin-input';
        let revision = 0;
        const root = createRoot(document.getElementById('root'));
        function Fixture({ initial = '', custom = false, ...props }) {
          const [value, setValue] = useState(initial);
          return <PinInput {...props} value={value} normalize={custom ? text => text.replace(/[^a-z]/gi, '').toUpperCase() : undefined}
            onSelect={() => window.selected++} onFocus={() => window.focused++}
            onValueChange={next => { window.changes.push(next); setValue(next); }} />;
        }
        window.mount = props => {
          window.changes = []; window.selected = 0; window.focused = 0;
          flushSync(() => root.render(<Fixture key={revision++} {...props} />));
          window.input = document.querySelector('input');
          input.focus();
        };
        window.snapshot = () => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd,
          active: [...document.querySelectorAll('[aria-hidden]')].findIndex(cell => cell.hasAttribute('data-active')) });
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, outfile: "pin-test.js", format: "iife", jsx: "automatic",
  });
  const chrome = await launchChrome();
  t.after(() => chrome.close());
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  // Headless targets are unfocused; selection events need a focused document.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const evaluate = async expression => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await evaluate("document.body.innerHTML = '<div id=\"root\"></div>'");
  await evaluate(`document.head.appendChild(document.createElement('style')).textContent = ${JSON.stringify(bundle.outputFiles.find(file => file.path.endsWith('.css')).text)}`);
  await evaluate(bundle.outputFiles[0].text);
  const mount = props => evaluate(`mount(${JSON.stringify(props)})`);
  const selection = async (start, end = start, direction = "forward") => {
    await evaluate(`input.setSelectionRange(${start}, ${end}, '${direction}')`);
    await until(async () => (await evaluate("snapshot().active")) === Math.min(direction === "backward" ? start : end, 5), "selection highlight");
  };
  const insert = text => send("Input.insertText", { text });
  const key = async (key, code, windowsVirtualKeyCode) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };

  for (const reveal of [false, true]) {
    await t.test(`caret and replacement, reveal=${reveal}`, async () => {
      await mount({ initial: "123456", reveal, outlined: true });
      await selection(3);
      await key("ArrowLeft", "ArrowLeft", 37);
      await until(async () => (await evaluate("snapshot().active")) === 2, "left arrow");
      await key("ArrowRight", "ArrowRight", 39);
      await until(async () => (await evaluate("snapshot().active")) === 3, "right arrow");
      await key("Home", "Home", 36);
      await until(async () => (await evaluate("snapshot().active")) === 0, "Home");
      await key("End", "End", 35);
      await until(async () => (await evaluate("snapshot().active")) === 5, "End");
      const point = await evaluate("(() => { const r = input.getBoundingClientRect(); return { x: r.left + 1, y: r.top + r.height / 2 }; })()");
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      await until(async () => (await evaluate("snapshot().active")) === 0, "click caret");
      await selection(1, 4, "backward");
      await insert("9 8");
      assert.deepEqual(await evaluate("snapshot()"), { value: "19856", start: 3, end: 3, active: 3 });
      await insert("7");
      assert.equal(await evaluate("input.value"), "198756");
      assert.equal(await evaluate("input.type"), reveal ? "text" : "password");
      assert.equal(await evaluate("document.querySelectorAll('input').length"), 1);
      assert.ok(await evaluate("selected > 0 && focused === 1"));
    });
  }

  await t.test("formatted paste, typing limit and autofill input events", async () => {
    await mount({ autoComplete: "one-time-code" });
    // CDP inserts text through Chrome's native editing path, including selection replacement.
    await insert("123 456");
    assert.equal(await evaluate("input.value"), "123456");
    await insert("7");
    assert.equal(await evaluate("input.value"), "123456");
    await selection(0, 6);
    await insert("654321");
    assert.equal(await evaluate("input.value"), "654321");
    await selection(2);
    await insert(" ");
    assert.deepEqual(await evaluate("snapshot()"), { value: "654321", start: 2, end: 2, active: 2 });
    await key("Backspace", "Backspace", 8);
    assert.equal(await evaluate("input.value"), "64321");
    assert.equal(await evaluate("input.autocomplete"), "one-time-code");
    // Model the value replacement and input event delivered by an OTP autofill provider.
    await evaluate(`
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '987654');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '987654' }));
    `);
    assert.equal(await evaluate("changes.at(-1)"), "987654");
    assert.equal(await evaluate("input.value"), "987654");
  });

  await t.test("custom normalization applies before the limit", async () => {
    await mount({ custom: true, reveal: true });
    await insert("ab cd ef");
    assert.equal(await evaluate("input.value"), "ABCDEF");
    await selection(1, 4);
    await insert("x y");
    assert.deepEqual(await evaluate("snapshot()"), { value: "AXYEF", start: 3, end: 3, active: 3 });
  });

  await t.test("disabled input rejects native editing", async () => {
    await mount({ initial: "123", disabled: true });
    await insert("456");
    assert.equal(await evaluate("input.value"), "123");
    assert.deepEqual(await evaluate("changes"), []);
    assert.equal(await evaluate("document.activeElement === input"), false);
  });
});
