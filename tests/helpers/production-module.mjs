import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = new Map();

/** Evaluate complete production modules with fixture-owned host APIs. */
export function productionModules(globals = {}) {
  const context = vm.createContext({ console, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, Headers, Response, Request, AbortController, crypto, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, ...globals });
  const cache = new Map();
  const injected = (module, file) => new Proxy(module, { get(target, key) { return !(key === 'text' && file?.endsWith('/composition/state.ts')) && Object.hasOwn(globals, key) ? globals[key] : target[key]; } });
  function load(filename) {
    const file = resolve(filename);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} }; cache.set(file, loaded);
    let code = compiled.get(file);
    if (!code) {
      code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
      compiled.set(file, code);
    }
    const imported = specifier => {
      if (specifier === 'wxt/browser') return { browser: globals.browser ?? {} };
      if (specifier === 'matrix-js-sdk') return injected({});
      if (!specifier.startsWith('.')) return injected(require(specifier));
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!target) throw new Error(`Cannot resolve ${specifier} from ${file}`);
      if (target.endsWith('/runtime/composition/config.ts')) return { API_URL: globals.API_URL ?? 'https://service.test' };
      return injected(load(target), target);
    };
    vm.runInContext(`(function(exports, require, module) {\n${code}\n})`, context, { filename: file })(loaded.exports, imported, loaded);
    return loaded.exports;
  }
  return load;
}
