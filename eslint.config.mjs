import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const globals = createRequire(require.resolve("eslint-config-next"))("globals");

const eslintConfig = defineConfig([
  // React and accessibility rules apply to every host; Next rules only to the website.
  ...nextVitals.flatMap(config => {
    if (!config.rules) return [config];
    const rules = Object.entries(config.rules);
    return [
      { ...config, rules: Object.fromEntries(rules.filter(([name]) => !name.startsWith("@next/next/"))) },
      { files: ["apps/website/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"], rules: Object.fromEntries(rules.filter(([name]) => name.startsWith("@next/next/"))) },
    ];
  }),
  ...nextTs,
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: { "no-undef": "error" },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "tests/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs}", "**/*.config.{js,mjs,cjs}", "apps/{server,indexer}/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.browser).map(name => [name, "off"])),
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/{extension,admin}/**/*.{js,mjs,cjs}", "packages/{ui,design}/**/*.{js,mjs,cjs}"],
    ignores: ["**/*.config.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map(name => [name, "off"])),
        ...globals.browser,
      },
    },
  },
  { settings: { next: { rootDir: "apps/website/" } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/.source/**",
    "out/**",
    "output/**",
    "build/**",
    "apps/admin/dist/**",
    "**/next-env.d.ts",
    "**/.wxt/**",
    "**/.output/**",
    ".local/**",
  ]),
]);

export default eslintConfig;
