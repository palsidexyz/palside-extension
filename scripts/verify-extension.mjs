import { pageMatches, pageScript } from '../apps/extension/src/runtime/browser/page-layer-host.ts';
import { readFile, access, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateExtensionManifest, validatePageLayerRegistration } from "./lib/extension-artifact.mjs";
import { RELEASE_WEBSITE_ORIGIN } from "../packages/shared/src/extension.ts";
import { verifyThirdPartyLicenses } from './third-party-licenses.mjs';
import { brandIconSizes, renderBrandPng } from './lib/brand-assets.mjs';

const root = new URL("../apps/extension/.output/chrome-mv3/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
const websiteOrigin = process.env.PALSIDE_RELEASE_BUILD ? RELEASE_WEBSITE_ORIGIN : new URL(process.env.WXT_WEBSITE_URL || "http://localhost:3000").origin;
const errors = validateExtensionManifest(manifest, websiteOrigin);
const brand = await readFile(new URL('../packages/design/assets/brand/palside.svg', import.meta.url), 'utf8');
try {
  if ((await readFile(new URL('brand/palside.svg', root), 'utf8')) !== brand) errors.push('Bundled brand SVG differs from its master');
} catch { errors.push('Missing bundled brand SVG'); }
for (const size of brandIconSizes) {
  const name = `icon-${size}.png`;
  if (manifest.icons?.[size] !== name) errors.push(`Missing manifest icon: ${size}`);
  if (size < 128 && manifest.action?.default_icon?.[size] !== name) errors.push(`Missing toolbar icon: ${size}`);
  try {
    if (!(await readFile(new URL(name, root))).equals(await renderBrandPng(brand, size))) errors.push(`Brand icon differs from its master: ${name}`);
  } catch { errors.push(`Missing or unreadable brand icon: ${name}`); }
}
try { await verifyThirdPartyLicenses(root); } catch (error) { errors.push(error.message); }
const policyState = { authenticated: true, preferences: { current: 'verification', web: { share: true, interact: true } }, toggles: { share: false, interact: true }, remoteTeams: [{ id: 'verification', joined: true }] };
const registration = pageScript(pageMatches(policyState, ['*://custom.example.com/*', 'https://secure.example.com/*', 'https://localhost/*']));
errors.push(...validatePageLayerRegistration(registration));
if (JSON.stringify(registration?.matches) !== JSON.stringify(['http://custom.example.com/*', 'https://custom.example.com/*', 'https://secure.example.com/*'])) errors.push('Automatic registrations must follow the exact granted public origins');
const broad = pageScript(pageMatches(policyState, ['<all_urls>']));
errors.push(...validatePageLayerRegistration(broad));
for (const [source, output] of [
  ['LICENSE', 'Palside-MIT.txt'],
  ['packages/design/fonts/Geist-OFL.txt', 'Geist-OFL.txt'],
  ['packages/design/fonts/GeistMono-OFL.txt', 'GeistMono-OFL.txt'],
]) {
  try {
    const original = await readFile(new URL(`../${source}`, import.meta.url));
    const bundled = await readFile(new URL(`licenses/${output}`, root));
    if (!original.equals(bundled)) errors.push(`License differs from source: ${output}`);
  } catch { errors.push(`Missing license: ${output}`); }
}
for (const [folder, output] of [['sites', 'site-logos'], ['chains', 'chain-logos']]) {
const logos = JSON.parse(await readFile(new URL(`../packages/design/assets/${folder}/sources.json`, import.meta.url), 'utf8'));
for (const logo of logos) {
  try {
    const bytes = await readFile(new URL(`${output}/${logo.file}`, root));
    if (createHash('sha256').update(bytes).digest('hex') !== logo.sha256) errors.push(`Site logo differs from source: ${logo.file}`);
  } catch { errors.push(`Missing local site logo: ${logo.file}`); }
}
}
for (const path of [manifest.side_panel?.default_path, manifest.background?.service_worker, 'offscreen.html', 'image.html']) {
  if (!path) continue;
  try { await access(new URL(path, root)); } catch { errors.push(`Missing build asset: ${path}`); }
}
try { await access(new URL('content-scripts/page.js', root)); errors.push('Page-reading script found in the artifact'); } catch { /* No automatic page script is allowed. */ }
try { await access(new URL('page-layer.js', root)); } catch { errors.push('Missing page-layer.js build asset'); }
const pages = await Promise.all(['sidepanel.html', 'image.html', 'offscreen.html'].map(async path => ({ path, html: await readFile(new URL(path, root), 'utf8') })));
let fontCount = 0;
for (const entry of await readdir(new URL("assets/", root))) {
  if (!entry.endsWith(".css")) continue;
  const cssUrl = new URL(`assets/${entry}`, root);
  const css = await readFile(cssUrl, "utf8");
  for (const match of css.matchAll(/url\(["']?([^\s)"']+)["']?\)/g)) {
    const url = match[1];
    if (url.startsWith("data:") || url.startsWith("#")) continue;
    if (/^https?:/.test(url)) { errors.push(`Remote CSS asset: ${url}`); continue; }
    const asset = url.startsWith("/") ? new URL(url.slice(1), root) : new URL(url, cssUrl);
    try { await access(asset); } catch { errors.push(`Unresolved CSS asset: ${url}`); }
    if (/\.woff2(?:$|\?)/.test(url)) fontCount++;
  }
}
if (!fontCount) errors.push("Bundled local fonts missing");
for (const { path, html } of pages) {
  if (/<script[^>]+src=["']https?:/i.test(html) || /localhost|127\.0\.0\.1/.test(html)) errors.push(`Production page contains remote/development script URLs: ${path}`);
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Chrome MV3 artifact verified: local panel, local service worker, pinned extension ID with activeTab, optional notifications, browsing history and per-site access, no required host grants, local Rust crypto WebAssembly.");
