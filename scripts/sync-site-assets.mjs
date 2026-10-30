import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { syncThirdPartyLicenses } from './third-party-licenses.mjs';
import { brandIconSizes, renderBrandPng } from './lib/brand-assets.mjs';
import { assetFolders, hostAssets, presentHosts } from './lib/site-assets.mjs';

const website = presentHosts().includes('website');

await syncThirdPartyLicenses();

for (const [folder, output] of assetFolders) {
  const source = new URL(`../packages/design/assets/${folder}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('sources.json', source), 'utf8'));
  const catalog = new Set(manifest.map(asset => asset.file));
  for (const host of presentHosts()) {
    const allowlist = hostAssets[host];
    const files = allowlist[folder] === 'all' ? catalog : new Set(allowlist[folder]);
    for (const file of files) if (!catalog.has(file)) throw new Error(`Unknown ${folder} asset for ${host}: ${file}`);
    const target = new URL(`../apps/${host}/public/${output}/`, import.meta.url);
    await mkdir(target, { recursive: true });
    // Generated folders contain exactly the host's allowlist, including after renames or removals.
    for (const file of await readdir(target)) if (!files.has(file)) await unlink(new URL(file, target));
    for (const file of files) await copyFile(new URL(file, source), new URL(file, target));
    console.log(`Synced ${files.size} local ${folder} assets to ${host}.`);
  }
}

// Website-only copies: landing art, the extension's own signal art for its demos (ping SVGs and the wheel's emote stills), and the icon.
if (website) {
  await mkdir(new URL('../apps/website/public/landing/art/', import.meta.url), { recursive: true });
  await copyFile(new URL('../packages/design/assets/art/team.webp', import.meta.url), new URL('../apps/website/public/landing/art/team.webp', import.meta.url));
  const source = new URL('../apps/extension/public/signals/', import.meta.url);
  const target = new URL('../apps/website/public/signals/', import.meta.url);
  for (const folder of ['art', 'thumbs']) {
    await mkdir(new URL(`${folder}/`, target), { recursive: true });
    const files = (await readdir(new URL(`${folder}/`, source))).filter(file => /\.(?:svg|webp)$/.test(file));
    for (const file of await readdir(new URL(`${folder}/`, target))) if (!files.includes(file)) await unlink(new URL(`${folder}/${file}`, target));
    for (const file of files) await copyFile(new URL(`${folder}/${file}`, source), new URL(`${folder}/${file}`, target));
  }
  for (const file of ['LICENSE', 'sources.json']) await copyFile(new URL(file, source), new URL(file, target));
  console.log('Synced signal art to the website.');
  await copyFile(new URL('../packages/design/assets/brand/palside.svg', import.meta.url), new URL('../apps/website/app/icon.svg', import.meta.url));
}

// One master feeds Chrome and reusable brand exports. Large exports never enter public/.
{
  const master = new URL('../packages/design/assets/brand/palside.svg', import.meta.url);
  const source = await readFile(master, 'utf8');
  const output = new URL('../output/brand/', import.meta.url);
  await mkdir(output, { recursive: true });
  await copyFile(master, new URL('palside.svg', output));
  for (const size of [...brandIconSizes, 512, 1024]) {
    const bytes = await renderBrandPng(source, size);
    const name = size <= 128 ? `icon-${size}.png` : `palside-${size}.png`;
    await writeFile(new URL(name, output), bytes);
    if (size <= 128) await writeFile(new URL(`../apps/extension/public/${name}`, import.meta.url), bytes);
  }
  console.log('Generated Chrome icons and brand exports from the SVG master.');
}
