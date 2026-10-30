import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productColors } from "../packages/design/colors.ts";

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, " "));
}

// Only top-level theme blocks contribute: the system-theme media query is separate.
function tokenScopes(source) {
  const scopes = new Map();
  let depth = 0, start = 0, bodyStart = 0, selector = "", quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") { i++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") {
      if (depth === 0) { selector = source.slice(start, i).trim(); bodyStart = i + 1; }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        if ([":root", "[data-palside-app]", '[data-palside-app][data-appearance="dark"]'].includes(selector)) {
          const tokens = scopes.get(selector) ?? new Map();
          for (const match of source.slice(bodyStart, i).matchAll(/(?:^|;)\s*(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
            tokens.set(match[1], match[2].trim());
          }
          scopes.set(selector, tokens);
        }
        start = i + 1;
      }
    } else if (char === ";" && depth === 0) start = i + 1;
  }
  return scopes;
}

test("productColors matches its documented light or dark design token", async () => {
  const [colorsSource, tokensSource] = await Promise.all([
    readFile(new URL("../packages/design/colors.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/design/tokens.css", import.meta.url), "utf8"),
  ]);
  const scopes = tokenScopes(stripComments(tokensSource));
  const shared = scopes.get(":root") ?? new Map();
  const light = new Map([...shared, ...scopes.get("[data-palside-app]") ?? []]);
  const dark = scopes.get('[data-palside-app][data-appearance="dark"]') ?? new Map();
  const darkContext = new Map([...light, ...dark]);
  const entries = new Map();
  const source = stripComments(colorsSource);
  for (const match of source.matchAll(/^[ \t]*(?:([\w$]+)|["']([^"']+)["'])\s*:[^\n]*/gm)) {
    entries.set(match[1] ?? match[2], { text: match[0], line: source.slice(0, match.index).split("\n").length });
  }
  const offenders = [];
  for (const [key, actual] of Object.entries(productColors)) {
    const entry = entries.get(key);
    const at = `packages/design/colors.ts:${entry?.line ?? 1} ${key}`;
    const comment = entry?.text.match(/\/\/\s*(--[\w-]+)(?:\s*,\s*(dark))?\s*$/);
    if (!comment) {
      offenders.push(`${at}: missing trailing token comment (// --token or // --token, dark)`);
      continue;
    }
    const [, token, theme] = comment;
    let expected = (theme ? dark : light).get(token);
    if (expected === undefined) {
      offenders.push(`${at}: token ${token} not found in ${theme ?? "light"} theme`);
      continue;
    }
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(expected);
    if (alias) {
      expected = (theme ? darkContext : light).get(alias[1]);
      if (expected === undefined) {
        offenders.push(`${at}: token ${token} refers to missing token ${alias[1]}`);
        continue;
      }
    }
    if (String(actual).toLowerCase() !== expected.toLowerCase()) {
      offenders.push(`${at}: colour differs from ${token}${theme ? ", dark" : ""}: ${actual} != ${expected}`);
    }
  }
  assert.deepEqual(offenders, []);
});
