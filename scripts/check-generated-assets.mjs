import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain, validateRelativePath } from './lib/release-files.mjs';
import { licenseBundle, licenseHosts, verifyThirdPartyLicenses } from './third-party-licenses.mjs';
import { assetFolders, hostAssets, presentHosts } from './lib/site-assets.mjs';
import { brandIconSizes, renderBrandPng } from './lib/brand-assets.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

export async function checkDistributionLicenses(root = project) {
  const failures = [];
  for (const [host, directory] of [['admin', 'apps/admin/dist'], ['server', 'apps/server/public']]) {
    // A source-only checkout has generated inputs but may have no built artifact.
    try {
      if (!(await stat(join(root, directory))).isDirectory()) throw Error('Expected a distribution directory');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      failures.push(`DISTRIBUTION ${directory}/licenses: ${error.message}`);
      continue;
    }
    try { await verifyThirdPartyLicenses(join(root, directory), { root, host }); }
    catch (error) { failures.push(`DISTRIBUTION ${directory}/licenses: ${error.message}`); }
  }
  return failures;
}

async function checkGeneratedAssets(root = project) {
  const failures = [];
  const hosts = presentHosts(pathToFileURL(join(root, '/')));
  const website = hosts.includes('website');
  let checked = 0;
  async function checkFile(path, expected) {
    try {
      const actual = await readFile(path);
      if (!actual.equals(expected)) failures.push(`MISMATCH ${relative(root, path)}`);
      checked++;
    } catch (error) {
      failures.push(`${error.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE'} ${relative(root, path)}${error.code === 'ENOENT' ? '' : `: ${error.code ?? error.message}`}`);
    }
  }
  async function checkFolder(path, expected) {
    let entries = [];
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') failures.push(`UNREADABLE ${relative(root, path)}: ${error.code ?? error.message}`); }
    for (const entry of entries) {
      if (!expected.has(entry.name)) failures.push(`EXTRA ${relative(root, join(path, entry.name))}`);
      else if (expected.get(entry.name) === null && !entry.isDirectory()) failures.push(`MISMATCH ${relative(root, join(path, entry.name))}: expected directory`);
    }
    for (const [file, bytes] of expected) if (bytes !== null) await checkFile(join(path, file), bytes);
  }
  for (const [folder, output] of assetFolders) {
    try {
      const source = join(root, 'packages/design/assets', folder);
      const manifest = JSON.parse(await readFile(join(source, 'sources.json'), 'utf8'));
      const expected = new Map();
      for (const asset of manifest) {
        if (['avatars', 'team-avatars'].includes(folder) && (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || !Number.isInteger(asset.bytes))) throw Error(`Missing output checksum or byte length: ${asset.file}`);
        const file = validateRelativePath(asset.file);
        const bytes = await readFile(join(source, file));
        if (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== asset.sha256) failures.push(`MISMATCH ${relative(root, join(source, file))}: manifest SHA-256`);
        if (asset.bytes !== undefined && bytes.length !== asset.bytes) failures.push(`MISMATCH ${relative(root, join(source, file))}: manifest byte length`);
        expected.set(file, bytes);
      }
      for (const host of hosts) {
        const files = hostAssets[host][folder];
        await checkFolder(join(root, 'apps', host, 'public', output), files === 'all' ? expected : new Map(files.map(file => [file, expected.get(file)])));
      }
    } catch (error) { failures.push(`SOURCE ${folder}: ${error.message}`); }
  }
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  for (const host of licenseHosts(lock)) {
    try {
      const expected = new Map();
      if (['extension', 'website', 'admin'].includes(host)) {
        for (const [source, file] of [['LICENSE', 'Palside-MIT.txt'], ['packages/design/fonts/Geist-OFL.txt', 'Geist-OFL.txt'], ['packages/design/fonts/GeistMono-OFL.txt', 'GeistMono-OFL.txt']]) expected.set(file, await readFile(join(root, source)));
      }
      const { text, manifest } = await licenseBundle(root, host);
      expected.set('THIRD-PARTY.txt', Buffer.from(text));
      expected.set('THIRD-PARTY.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
      // The extension also ships a tracked Danmaku notice in this folder.
      if (host === 'extension') {
        const snapshot = JSON.parse(await readFile(join(root, 'scripts/licenses/upstream.json'), 'utf8'));
        const notice = manifest.packages.find(pkg => pkg.name === 'danmaku')?.notices.find(notice => notice.file === 'LICENSE');
        const text = snapshot.texts[notice?.sha256];
        if (!text || createHash('sha256').update(text).digest('hex') !== notice.sha256) throw Error('Missing or altered Danmaku license snapshot');
        expected.set('Danmaku-MIT.txt', Buffer.from(text));
      }
      await checkFolder(join(root, 'apps', host, 'public/licenses'), expected);
    } catch (error) { failures.push(`SOURCE ${host} licenses: ${error.message}`); }
  }
  failures.push(...await checkDistributionLicenses(root));
  if (website) try {
    const source = join(root, 'apps/extension/public/signals'), target = join(root, 'apps/website/public/signals');
    const expected = new Map([['art', null], ['thumbs', null]]);
    for (const file of ['LICENSE', 'sources.json']) expected.set(file, await readFile(join(source, file)));
    await checkFolder(target, expected);
    for (const folder of ['art', 'thumbs']) {
      const files = (await readdir(join(source, folder))).filter(file => /\.(?:svg|webp)$/.test(file));
      const assets = new Map();
      for (const file of files) assets.set(file, await readFile(join(source, folder, file)));
      await checkFolder(join(target, folder), assets);
    }
  } catch (error) { failures.push(`SOURCE signals: ${error.message}`); }
  try {
    const source = join(root, 'apps/extension/public/signals');
    const { entries } = JSON.parse(await readFile(join(root, 'tooling/signal-sounds/manifest.json'), 'utf8'));
    const expected = new Map();
    for (const asset of entries) {
      const file = validateRelativePath(asset.file);
      const bytes = await readFile(join(source, file));
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) failures.push(`MISMATCH signals/${file}: manifest SHA-256`);
      if (bytes.length !== asset.bytes) failures.push(`MISMATCH signals/${file}: manifest byte length`);
      if (!file.startsWith('sounds/') || file.slice(7).includes('/')) throw Error(`Unexpected sound path: ${file}`);
      expected.set(file.slice(7), bytes);
    }
    await checkFolder(join(source, 'sounds'), expected);
  } catch (error) { failures.push(`SOURCE signal sounds: ${error.message}`); }
  try {
    const icon = await readFile(join(root, 'packages/design/assets/brand/palside.svg'));
    if (website) await checkFile(join(root, 'apps/website/app/icon.svg'), icon);
    for (const size of brandIconSizes) await checkFile(join(root, `apps/extension/public/icon-${size}.png`), await renderBrandPng(icon.toString('utf8'), size));
  } catch (error) { failures.push(`SOURCE icons: ${error.message}`); }
  if (website) try {
    await checkFile(join(root, 'apps/website/public/landing/art/team.webp'), await readFile(join(root, 'packages/design/assets/art/team.webp')));
  } catch (error) { failures.push(`SOURCE landing art: ${error.message}`); }
  return { checked, failures };
}

if (isMain(import.meta.url)) {
  const { checked, failures } = await checkGeneratedAssets();
  if (failures.length) {
    console.error(`Generated asset check failed (${failures.length}):\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`PASS generated assets: ${checked} files match their sources and manifests`);
}
