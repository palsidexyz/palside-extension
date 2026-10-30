import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as shared from '../packages/shared/src/extension.ts';
import { validateExtensionManifest } from '../scripts/lib/extension-artifact.mjs';

function config(env) {
  const source = readFileSync(new URL('../apps/extension/wxt.config.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', 'const config = ');
  const result = vm.runInNewContext(ts.transpileModule(source + '\nconfig;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { ...shared, URL, process: { env }, defineConfig: value => value, tailwindcss: () => ({}) });
  return { manifest: result.manifest, vite: result.vite() };
}
test('release config rejects foreign origins and injects the same pinned origin into the background', () => {
  const env = { PALSIDE_RELEASE_BUILD: 'true', WXT_API_URL: 'https://api.palside.xyz', WXT_WEBSITE_URL: 'https://palside.xyz' };
  for (const value of ['https://other.example', 'https://palside.xyz.evil.example', 'http://palside.xyz', 'https://palside.xyz:8443', 'https://user@palside.xyz', 'https://palside.xyz/path', 'https://palside.xyz?x=1', undefined]) {
    assert.throws(() => config({ ...env, WXT_WEBSITE_URL: value }), undefined, String(value));
  }
  const result = config(env);
  assert.equal('key' in result.manifest, false, 'the store rejects a manifest key');
  assert.equal(result.manifest.externally_connectable.matches[0], shared.RELEASE_WEBSITE_ORIGIN + '/*');
  assert.equal(JSON.parse(result.vite.define['import.meta.env.WXT_WEBSITE_URL']), shared.RELEASE_WEBSITE_ORIGIN);
});
test('local builds default to the local website and must not reach release', () => {
  assert.equal(config({}).manifest.externally_connectable.matches[0], 'http://localhost:3000/*');
  assert.equal(config({}).manifest.key, shared.EXTENSION_PUBLIC_KEY, 'local builds keep the published ID');
  assert.equal(JSON.parse(config({}).vite.define['import.meta.env.WXT_WEBSITE_URL']), 'http://localhost:3000');
  assert.throws(() => config({ PALSIDE_RELEASE_BUILD: 'true', WXT_API_URL: 'https://api.palside.xyz', WXT_WEBSITE_URL: 'http://localhost:3000' }));
});
test('the artifact validator pins external messages to the expected website', () => {
  const ok = { externally_connectable: { matches: ['http://localhost:3000/*'] } };
  const only = manifest => validateExtensionManifest(manifest, 'http://localhost:3000').filter(error => error.startsWith('External messages'));
  assert.deepEqual(only(ok), []);
  assert.equal(only({ externally_connectable: { matches: ['https://*/*'] } }).length, 1);
  assert.equal(only({ externally_connectable: { matches: ['http://localhost:3000/*'], ids: ['*'] } }).length, 1);
  assert.equal(validateExtensionManifest(ok).filter(error => error.startsWith('External messages')).length, 1, 'release default is the published site');
});
