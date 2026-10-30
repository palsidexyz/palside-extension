import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { chromeArgument, chromeCandidates, chromePath } from '../scripts/lib/chrome-discovery.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'palside-chrome-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('explicit browser paths override discovery and reject directories or non-executables', async t => {
  const root = await fixture(t), browser = join(root, 'browser with spaces');
  await writeFile(browser, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.equal(await chromePath({ env: { CHROME_PATH: browser } }), browser);
  assert.equal(await chromePath({ chrome: browser, env: { CHROME_PATH: '/missing' } }), browser);
  await assert.rejects(chromePath({ chrome: root }), /CHROME_PATH/);
  await chmod(browser, 0o600);
  await assert.rejects(chromePath({ chrome: browser }), /CHROME_PATH/);
  await assert.rejects(chromePath({ chrome: join(root, 'missing') }), /CHROME_PATH/);
  assert.equal(chromeArgument(['--chrome', browser]), browser);
  assert.equal(chromeArgument([]), undefined);
  assert.throws(() => chromeArgument(['--chrome']), /CHROME_PATH/);
});

test('Playwright discovery globs build numbers and supports platform layouts', async t => {
  const root = await fixture(t);
  const layouts = {
    darwin: 'chromium-98765/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    linux: 'chromium-54321/chrome-linux64/chrome',
    win32: 'chromium-12345/chrome-win64/chrome.exe',
  };
  for (const [platform, layout] of Object.entries(layouts)) {
    const browser = join(root, layout);
    await mkdir(dirname(browser), { recursive: true });
    await writeFile(browser, '', { mode: 0o700 });
    const candidates = await chromeCandidates({ platform, home: root, env: { PLAYWRIGHT_BROWSERS_PATH: root } });
    assert.ok(candidates.includes(browser));
  }
  const browser = join(root, 'Library/Caches/ms-playwright/chromium-111/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
  await mkdir(dirname(browser), { recursive: true });
  await writeFile(browser, '', { mode: 0o700 });
  assert.ok((await chromeCandidates({ platform: 'darwin', home: root, env: {} })).includes(browser));
});


test('draft verification reports missing browsers and spawn errors without a startup timeout', async t => {
  const root = await fixture(t), browser = join(root, 'broken-browser');
  const script = new URL('../scripts/verify-draft-recovery.mjs', import.meta.url).pathname;
  const invoke = path => promisify(execFile)(process.execPath, [script, '--chrome', path], { timeout: 10_000 });
  await assert.rejects(invoke(browser), error => !error.killed && /CHROME_PATH/.test(error.stderr));
  await writeFile(browser, '#!/nonexistent/palside-browser-interpreter\n', { mode: 0o700 });
  await assert.rejects(invoke(browser), error => !error.killed && /ENOENT/.test(error.stdout));
});
