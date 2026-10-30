import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../packages/ui/", import.meta.url));
const source = join(root, "src");
// Runtime dependencies allowed by docs/components/conventions.md.
const allowed = ["react", "react-dom", "@palside/design", "motion", "lucide-react", "@radix-ui/react-slot", "clsx", "@number-flow/react"];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
function specifiers(file, text) {
  const result = [];
  (function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteralLike(specifier)) result.push(specifier.text);
    ts.forEachChild(node, visit);
  })(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return result;
}
const packageName = specifier => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

test("shared UI imports only its declared runtime and stays inside its package", async () => {
  const problems = [];
  for (const file of (await files(source)).filter(file => /\.(ts|tsx)$/.test(file))) {
    const text = await readFile(file, "utf8");
    const name = relative(root, file);
    for (const specifier of specifiers(file, text)) {
      if (specifier.startsWith(".")) {
        if (relative(source, resolve(dirname(file), specifier)).startsWith("..")) problems.push(`${name}: ${specifier} leaves packages/ui/src`);
      } else if (!allowed.includes(packageName(specifier))) problems.push(`${name}: ${specifier}`);
    }
    if (/\bchrome\.\w/.test(text)) problems.push(`${name}: uses chrome.*`);
    if (/\bprocess\.env\b/.test(text)) problems.push(`${name}: reads process.env`);
  }
  assert.deepEqual(problems, []);
});

test("component subpaths match their folders and internal modules stay private", async () => {
  const { exports } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(exports["./internal/*"], null);
  const folders = (await readdir(join(source, "components"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const components = Object.entries(exports).filter(([, target]) => target?.startsWith("./src/components/"));
  assert.deepEqual(components.map(([path]) => path.slice(2)).sort(), folders);
  for (const [path, target] of components) assert.equal(target, `./src/components/${path.slice(2)}/index.ts`);
  for (const [path, target] of Object.entries(exports).filter(([, target]) => target && !target.startsWith("./src/components/"))) assert.equal(target, `./src/${path.slice(2)}.ts`, path);
});

test("every shared UI export points at an existing module", async () => {
  const { exports } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const missing = [];
  for (const [path, target] of Object.entries(exports)) {
    if (target === null) continue;
    await access(join(root, target)).catch(() => missing.push(`${path} -> ${target}`));
  }
  assert.deepEqual(missing, []);
});
