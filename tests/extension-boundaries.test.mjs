import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { validateExtensionManifest, extensionCommands, extensionPermissions } from "../scripts/lib/extension-artifact.mjs";
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY } from "../packages/shared/src/extension.ts";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

function moduleSpecifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      specifier = node.arguments[0];
      assert.ok(specifier && ts.isStringLiteralLike(specifier), `${file}: literal module specifier required`);
    }
    if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

test('application boundary parser includes type imports, re-exports and dynamic imports without matching prose', () => {
  assert.deepEqual(moduleSpecifiers('example.ts', `
    // import { fake } from '../other/comment.ts';
    const prose = "from '../other/text.ts'";
    import type { Model } from '../other/model.ts';
    export { value } from '../other/value.ts';
    export type { Type } from '../other/type.ts';
    type Shape = import('../other/shape.ts').Shape;
    const lazy = import('../other/lazy.ts');
    const common = require('../other/common.cjs');
    import required = require('../other/required.cjs');
  `), ['../other/model.ts', '../other/value.ts', '../other/type.ts', '../other/shape.ts', '../other/lazy.ts', '../other/common.cjs', '../other/required.cjs']);
});

async function rejectIntegrationGraph(roots, read, resolveImport) {
  const visited = new Set();
  async function visit(file, chain = []) {
    const trace = [...chain, file];
    assert.ok(!/(?:^|\/)apps\/extension\/integration(?:\/|$)/.test(file), trace.join(' -> '));
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of moduleSpecifiers(file, await read(file))) {
      const target = resolveImport(specifier, file);
      if (target) await visit(target, trace);
    }
  }
  for (const root of roots) await visit(root);
}

test('production graphs reject fixture value, type and re-export edges from every host', async () => {
  for (const root of ['src/domain/model.ts', 'src/runtime/host.ts', 'src/features/view.tsx', 'src/page-layer/host.ts', 'src/background/host.ts', 'entrypoints/background.ts', 'entrypoints/sidepanel/main.tsx']) {
    for (const edge of ["import { value } from './fixture.ts';", "import type { Model } from './fixture.ts';", "export { value } from './fixture.ts';", "export type { Model } from './fixture.ts';", "type Model = import('./fixture.ts').Model;", "const fixture = import('./fixture.ts');"]) {
      const entry = `apps/extension/${root}`;
      const bridge = 'packages/shared/src/bridge.ts';
      const fixture = 'apps/extension/integration/fixture.ts';
      const sources = new Map([[entry, "export * from './bridge.ts';"], [bridge, edge], [fixture, '']]);
      await assert.rejects(rejectIntegrationGraph([entry], async file => sources.get(file), specifier => specifier === './bridge.ts' ? bridge : fixture), /apps\/extension\/integration\/fixture.ts/);
    }
  }
  await rejectIntegrationGraph(['apps/extension/entrypoints/main.ts'], async () => 'export const value = 1;', () => undefined);
});

test('production applications do not import another application source', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const apps = (await readdir(join(root, 'apps'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const names = new Map(await Promise.all(apps.map(async app => [JSON.parse(await readFile(join(root, 'apps', app, 'package.json'), 'utf8')).name, app])));
  const failures = [];
  // Integration fixtures intentionally compose hosts; build output and dependencies are not source.
  const excluded = new Set(['node_modules', 'integration', 'tests', '__tests__', 'public', 'dist', 'coverage']);
  async function files(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await files(path));
      else if (/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) result.push(path);
    }
    return result;
  }
  for (const app of apps) {
    const directory = join(root, 'apps', app);
    const config = ts.readConfigFile(join(directory, 'tsconfig.json'), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
    assert.deepEqual(errors, []);
    const productionFiles = await files(directory);
    await rejectIntegrationGraph(productionFiles, file => readFile(file, 'utf8'), (specifier, file) => {
      const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName
        ?? (specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined);
      if (!target || target.includes('/node_modules/')) return;
      if (target.includes('/apps/extension/integration/')) return target;
      return /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(target) && ts.sys.fileExists(target) ? target : undefined;
    });
    for (const file of productionFiles) {
      for (const specifier of moduleSpecifiers(file, await readFile(file, 'utf8'))) {
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
        const target = resolved ?? (specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined);
        const path = target && relative(root, target).split(sep).join('/');
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        const targetApp = path?.match(/^apps\/([^/]+)\//)?.[1] ?? names.get(packageName);
        if (targetApp && targetApp !== app) failures.push(`${relative(root, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test("sidepanel module graph excludes HTTP endpoint tables, error machinery and the schema engine", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const configPath = fileURLToPath(new URL("../apps/extension/tsconfig.json", import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL("../apps/extension/", import.meta.url)));
  assert.deepEqual(errors, []);
  const visited = new Set();
  async function visit(file, chain = []) {
    if (visited.has(file)) return;
    visited.add(file);
    const path = relative(root, file);
    const trace = [...chain, path];
    assert.doesNotMatch(path, /^packages\/shared\/src\/contracts\/(?:endpoints?\.ts|errors\.ts|routes\/)/, trace.join(" -> "));
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = [];
    function walk(node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        if (clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every(item => item.isTypeOnly))) return;
        imports.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(item => item.isTypeOnly))) return;
        imports.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), `Expected literal import in ${path}`);
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of imports) {
      if (/\.(?:css|json)$/.test(specifier)) continue;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      assert.ok(resolved, `Cannot resolve ${specifier} from ${path}`);
      assert.doesNotMatch(resolved.resolvedFileName, /\/node_modules\/typebox\//, [...trace, specifier].join(" -> "));
      if (resolved.resolvedFileName.includes("/node_modules/")) continue;
      await visit(resolved.resolvedFileName, trace);
    }
  }
  await visit(fileURLToPath(new URL("../apps/extension/entrypoints/sidepanel/main.tsx", import.meta.url)));
  assert.ok(visited.has(fileURLToPath(new URL("../packages/shared/src/contracts/rules.ts", import.meta.url))));
});

test("artifact requires URL metadata permission and rejects website access or automatic injection", () => {
  const manifest = { externally_connectable: { matches: ["https://palside.xyz/*"] }, manifest_version: 3, side_panel: { default_path: "sidepanel.html" }, background: { service_worker: "background.js" }, action: {}, permissions: extensionPermissions, optional_permissions: ['notifications', 'tabs', 'favicon'], optional_host_permissions: ['<all_urls>'], commands: extensionCommands, content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" } };
  assert.deepEqual(validateExtensionManifest(manifest), []);
  assert.ok(validateExtensionManifest({ ...manifest, commands: undefined }).length, "the 截图 shortcut is declared");
  assert.ok(validateExtensionManifest({ ...manifest, commands: { ...extensionCommands, _execute_action: { suggested_key: { default: 'Alt+Shift+P' } } } }).length, "no other shortcut");
  assert.ok(validateExtensionManifest({ ...manifest, optional_host_permissions: ['https://*/*'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, content_scripts: [{ matches: ['https://example.com/*'], js: ['page.js'] }] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, host_permissions: ["<all_urls>"] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, host_permissions: ['https://api.example/*'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, key: EXTENSION_PUBLIC_KEY }).length, "the store rejects a manifest key");
  const local = { ...manifest, externally_connectable: { matches: ["http://localhost:3000/*"] } };
  assert.ok(validateExtensionManifest(local, "http://localhost:3000").length, "local builds pin the published ID");
  assert.deepEqual(validateExtensionManifest({ ...local, key: EXTENSION_PUBLIC_KEY }, "http://localhost:3000"), []);
  assert.ok(validateExtensionManifest({ ...manifest, permissions: ["sidePanel", "tabs"] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, optional_permissions: ['tabs', 'favicon', 'notifications'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, optional_permissions: ['notifications', 'tabs'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, optional_permissions: ['notifications'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, optional_permissions: ['notifications', 'tabs', 'favicon', 'history'] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, optional_permissions: [] }).length);
  assert.ok(validateExtensionManifest({ ...manifest, action: { default_popup: "popup.html" } }).length);
  assert.ok(validateExtensionManifest({ ...manifest, content_security_policy: { extension_pages: "script-src 'unsafe-eval'" } }).length);
});

test("activeTab is a required permission and tabs is only optional, asked for 共享在看", async () => {
  assert.ok(extensionPermissions.includes("activeTab"));
  assert.equal(extensionPermissions.includes("tabs"), false);
  const config = await readFile(new URL("../apps/extension/wxt.config.ts", import.meta.url), "utf8");
  assert.match(config, /permissions:\s*\[[^\]]*"activeTab"/);
  assert.doesNotMatch(config, /\bpermissions:\s*\[[^\]]*"tabs"/);
  assert.match(config, /optional_permissions:\s*\["notifications", "tabs", "favicon"\]/);
  const manifest = { externally_connectable: { matches: ["https://palside.xyz/*"] }, manifest_version: 3, side_panel: { default_path: "sidepanel.html" }, background: { service_worker: "background.js" }, action: {}, permissions: extensionPermissions.filter(name => name !== "activeTab"), optional_permissions: ["notifications", "tabs", "favicon"], optional_host_permissions: ["<all_urls>"] };
  assert.ok(validateExtensionManifest(manifest).includes("Unexpected permissions"), "dropping activeTab is rejected");
});

test("pinned extension ID is derived from the manifest key", () => {
  const hash = createHash("sha256").update(Buffer.from(EXTENSION_PUBLIC_KEY, "base64")).digest("hex").slice(0, 32);
  assert.equal([...hash].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join(""), EXTENSION_ID);
});

test('release manifest restricts external messaging to the exact website with no extension ids', () => {
  const manifest = { manifest_version: 3, side_panel: { default_path: 'sidepanel.html' }, background: { service_worker: 'background.js' }, action: {}, permissions: extensionPermissions, optional_permissions: ['notifications', 'tabs', 'favicon'], optional_host_permissions: ['<all_urls>'], commands: extensionCommands, content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }, externally_connectable: { matches: ['https://palside.xyz/*'] } };
  assert.deepEqual(validateExtensionManifest(manifest), []);
  for (const external of [undefined, {}, { matches: ['https://*/*'] }, { matches: ['https://other.example/*'] }, { matches: ['http://localhost:3000/*'] }, { matches: ['https://palside.xyz/*', 'https://other.example/*'] }, { matches: ['https://palside.xyz/*'], ids: [] }, { matches: ['https://palside.xyz/*'], ids: ['*'] }, { matches: ['https://palside.xyz/*'], accepts_tls_channel_id: true }]) {
    assert.ok(validateExtensionManifest({ ...manifest, externally_connectable: external }).length, JSON.stringify(external));
  }
});

async function extensionImports() {
  const { readdir } = await import('node:fs/promises');
  const root = fileURLToPath(new URL('../apps/extension/src/', import.meta.url));
  const config = ts.readConfigFile(fileURLToPath(new URL('../apps/extension/tsconfig.json', import.meta.url)), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL('../apps/extension/', import.meta.url)));
  const files = (await readdir(root, { recursive: true })).filter(file => /\.tsx?$/.test(file));
  const edges = [];
  for (const file of files) {
    const absolute = `${root}${file}`;
    const source = ts.createSourceFile(absolute, await readFile(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    function walk(node) {
      let specifier, typeOnly = false;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier?.text;
        const clause = ts.isImportDeclaration(node) ? node.importClause : node;
        const bindings = clause?.namedBindings ?? clause?.exportClause;
        typeOnly = Boolean(clause?.isTypeOnly || (bindings?.elements?.length && bindings.elements.every(item => item.isTypeOnly)));
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        specifier = node.argument.literal.text; typeOnly = true;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.ok(ts.isStringLiteral(node.arguments[0]), `${file}: literal dynamic import required`);
        specifier = node.arguments[0].text;
      }
      if (specifier) {
        const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule;
        edges.push({ from: file, to: resolved ? relative(root, resolved.resolvedFileName) : specifier, specifier, typeOnly });
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  return { files, edges };
}

test('domain models and rules depend only on domain, shared code and i18n types', async () => {
  const { files, edges } = await extensionImports();
  for (const name of ['account', 'chat', 'teams', 'assets', 'annotations', 'images']) {
    assert.ok(files.some(file => file.startsWith(`domain/${name}/`)), `Missing domain/${name}`);
  }
  for (const edge of edges.filter(edge => edge.from.startsWith('domain/'))) {
    assert.ok(edge.to.startsWith('domain/') || edge.specifier.startsWith('@palside/shared/') || edge.specifier === '@palside/i18n' && edge.typeOnly, JSON.stringify(edge));
    assert.ok(!edge.specifier.includes('showcase'), JSON.stringify(edge));
  }
});

test('runtime and page layer consume domain rules without feature dependencies', async () => {
  const { edges } = await extensionImports();
  for (const edge of edges.filter(edge => /^(?:runtime|page-layer)\//.test(edge.from))) {
    assert.ok(!edge.to.startsWith('features/'), JSON.stringify(edge));
  }
});

test('features consume host ports without background or page layer internals', async () => {
  const { edges } = await extensionImports();
  for (const edge of edges.filter(edge => edge.from.startsWith('features/'))) {
    assert.ok(!/^(?:background|page-layer)\//.test(edge.to), JSON.stringify(edge));
  }
});

test('feature and runtime modules have explicit responsibility directories', async () => {
  const { files } = await extensionImports();
  for (const file of files) {
    assert.ok(!/^features\/palside\/[^/]+$/.test(file), file);
    assert.ok(!/^runtime\/[^/]+$/.test(file), file);
    assert.ok(!/^(?:features\/palside|runtime|domain)\/.*\/index\.ts$/.test(file), file);
  }
});
