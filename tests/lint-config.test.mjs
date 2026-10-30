import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });

test('JavaScript undefined names are errors', async () => {
  for (const extension of ['js', 'mjs', 'cjs']) {
    const [result] = await eslint.lintText('missingName();', { filePath: `scripts/lint-fixture.${extension}` });
    assert.deepEqual(result.messages.map(({ ruleId, severity }) => ({ ruleId, severity })), [
      { ruleId: 'no-undef', severity: 2 },
    ]);
  }
});

test('scripts and tests use Node globals without browser globals', async () => {
  for (const directory of ['scripts', 'tests']) {
    const [result] = await eslint.lintText('console.log(process.pid, Buffer.alloc(0), WebSocket, navigator.userAgent);\nwindow.alert("test");', {
      filePath: `${directory}/lint-fixture.mjs`,
    });
    assert.deepEqual(result.messages.map(({ ruleId, message }) => ({ ruleId, message })), [
      { ruleId: 'no-undef', message: "'window' is not defined." },
    ]);
  }
});

test('integration JavaScript uses browser globals without Node globals', async () => {
  const [result] = await eslint.lintText('window.alert(document.title);\nconsole.log(process.pid);', {
    filePath: 'apps/extension/integration/lint-fixture.mjs',
  });
  assert.deepEqual(result.messages.map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: 'no-undef', message: "'process' is not defined." },
  ]);
});

test('TypeScript leaves undefined-name checking to the compiler', async () => {
  const [result] = await eslint.lintText('missingName();', { filePath: 'scripts/lint-fixture.ts' });
  assert.equal(result.messages.some(message => message.ruleId === 'no-undef'), false);
});

test('output evidence is globally ignored', async () => {
  assert.equal(await eslint.isPathIgnored('output/x.mjs'), true);
  assert.equal(await eslint.isPathIgnored('output/nested/x.mjs'), true);
});
