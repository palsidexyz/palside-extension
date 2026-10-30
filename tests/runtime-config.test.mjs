import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../apps/extension/src/runtime/composition/config.ts', import.meta.url), 'utf8');
function apiUrl(env) {
  return vm.runInNewContext(`${source.replace(/import\.meta\.env/g, 'env').replace('export const API_URL', 'const API_URL')}\nAPI_URL`, { env });
}

test('ordinary production-mode extension build starts with the local API default', () => {
  assert.equal(apiUrl({ MODE: 'production' }), 'http://127.0.0.1:8787');
});

test('extension runtime uses the same explicit WXT API origin as the build configuration', () => {
  assert.equal(apiUrl({ MODE: 'production', WXT_API_URL: 'https://api.example.test', PALSIDE_PUBLIC_API_URL: 'https://other.example.test' }), 'https://api.example.test');
});
