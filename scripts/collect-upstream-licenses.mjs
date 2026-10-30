// Explicit maintenance command: fetch pinned upstream license evidence, never execute downloaded code.
// Run after reviewing dependency upgrades; ordinary builds use the checked-in snapshot offline.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarEntries } from './lib/tar-entries.mjs';
import { licenseHosts, noticePaths } from './third-party-licenses.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'scripts/licenses');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const npmOnly = process.argv.includes('--npm-only');
const previous = npmOnly ? JSON.parse(await readFile(join(output, 'upstream.json'), 'utf8')) : null;
const texts = previous ? { ...previous.texts } : {}, packages = {}, rust = [];
if (previous?.schema !== undefined && previous.schema !== 1) throw new Error('Unsupported upstream snapshot');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function writeSnapshot(rust) {
  const reachable = new Set([...Object.values(packages), ...rust.crates].flatMap(source => source.notices.map(notice => notice.sha256)));
  const retainedTexts = {};
  for (const sha256 of reachable) {
    const text = texts[sha256];
    if (typeof text !== 'string' || digest(text) !== sha256) throw new Error(`Missing or altered referenced notice: ${sha256}`);
  }
  for (const [sha256, text] of Object.entries(texts)) if (reachable.has(sha256)) retainedTexts[sha256] = text;
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'upstream.json'), JSON.stringify({ schema: 1, packages, rust, texts: retainedTexts }, null, 2) + '\n');
}
const noticePattern = /(?:^|\/)(?:licen[sc]es?|notices?|third-party-notices|copying|authors|copyright(?:notice)?)(?:[._-][^/]*)?$/i;
const notice = { test: path => noticePattern.test(path) && !/\.(?:rs|js|ts|map|json|html|c|h)$/i.test(path) };
const containsLicense = file => notice.test(file.path) || /(?:^|\/)readme(?:\.md)?$/i.test(file.path) && /Permission is hereby granted,[\s\S]*THE SOFTWARE IS PROVIDED[\s\S]*WARRANT/i.test(file.bytes.toString('utf8'));
// Recover interrupted collection by content digest, never by an untrusted filename.
const cached = new Map();
for (const directory of (await readdir(tmpdir())).filter(name => name.startsWith('palside-upstream-'))) {
  try {
    const path = join(tmpdir(), directory, 'source');
    const bytes = await readFile(path);
    for (const algorithm of ['sha256', 'sha512']) cached.set(`${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`, path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function download(url, integrity) {
  if (integrity && cached.has(integrity)) return readFile(cached.get(integrity));
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  // Every downloaded artifact gets a separate empty directory, never used as cwd.
  const directory = await mkdtemp(join(tmpdir(), 'palside-upstream-'));
  await writeFile(join(directory, 'source'), bytes);
  return bytes;
}
function entries(bytes) {
  return tarEntries(bytes, path => notice.test(path) || /(?:^|\/)(?:Cargo\.toml|\.cargo_vcs_info\.json|matrix_sdk_crypto_wasm_bg\.wasm|readme(?:\.md)?)$/i.test(path));
}
function save(file, bytes, source) {
  const sha256 = digest(bytes);
  texts[sha256] = bytes.toString('utf8');
  return { file, sha256, source };
}
async function official(repository, revision, file) {
  const source = `https://raw.githubusercontent.com/${repository}/${revision}/${file}`;
  return save(file, await download(source), source);
}
const repositories = new Map();
async function crateNotices(files, crate) {
  const manifest = files.find(f => f.path === `${crate.name}-${crate.version}/Cargo.toml`)?.bytes.toString('utf8');
  const repositoryMatch = manifest?.match(/^repository = "https:\/\/(github.com|codeberg.org)\/([^"\s]+)"$/m);
  const repositoryHost = repositoryMatch?.[1];
  const repository = repositoryMatch?.[2]?.split('/').slice(0, 2).join('/').replace(/\.git$/, '');
  const vcsFile = files.find(f => f.path.endsWith('/.cargo_vcs_info.json'));
  if (!repository || !vcsFile) throw new Error(`Missing immutable upstream identity: ${crate.name}@${crate.version}`);
  const vcs = JSON.parse(vcsFile.bytes);
  if (!/^[a-f0-9]{40}$/.test(vcs.git.sha1) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid upstream identity: ${crate.name}`);
  const source = repositoryHost === 'github.com' ? `https://codeload.github.com/${repository}/tar.gz/${vcs.git.sha1}` : `https://codeberg.org/${repository}/archive/${vcs.git.sha1}.tar.gz`;
  if (!repositories.has(source)) repositories.set(source, entries(await download(source)));
  const upstream = await repositories.get(source);
  const subdirectory = vcs.path_in_vcs || '';
  const found = upstream.filter(f => {
    const path = f.path.slice(f.path.indexOf('/') + 1);
    const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')));
    return notice.test(path) && (!parent || subdirectory === parent || subdirectory.startsWith(`${parent}/`) || /^(?:LICENSES|licenses)\//.test(path));
  }).map(f => save(f.path.slice(f.path.indexOf('/') + 1), f.bytes, source));
  // cms 0.2.3 explicitly offers Apache-2.0 in its README but omits the
  // standalone text. Preserve that grant and the same repository's Apache text.
  if (!found.length && crate.name === 'cms' && crate.version === '0.2.3') {
    for (const file of ['cms/README.md', 'der/LICENSE-APACHE']) {
      const entry = upstream.find(f => f.path.endsWith(`/${file}`));
      if (!entry) throw new Error(`Missing CMS license evidence: ${file}`);
      found.push(save(file, entry.bytes, source));
    }
  }
  if (!found.length) throw new Error(`No upstream license at pinned commit: ${crate.name}@${crate.version} ${source}`);
  return { notices: found, upstream: { repository: `https://${repositoryHost}/${repository}`, revision: vcs.git.sha1, path: subdirectory, source } };
}
const fallbacks = {
  'wxt@0.21.4': ['wxt-dev/wxt', '8fea9b4837282f4ad2a0d085ced6bee1a7de08fb', 'LICENSE'],
  '@wxt-dev/browser@0.3.0': ['wxt-dev/wxt', 'a747b9c7ecd635c633ade13314552abfdb345bba', 'LICENSE'],
  'client-only@0.0.1': ['facebook/react', '1dd4ecbdabf826f527fc9a58c05ea70375b7d170', 'LICENSE'],
  // Official 0.45.2 tag resolves to this commit; npm omits gitHead and the license file.
  'drizzle-orm@0.45.2': ['drizzle-team/drizzle-orm', '273c78071d4841b497f5144734b38294df7ec64b', 'LICENSE'],
};
const keys = new Set(licenseHosts(lock).flatMap(host => noticePaths(lock, host)));
for (const path of [...keys].sort()) {
  const pkg = lock.packages[path], name = pkg.name ?? path.split('node_modules/').at(-1);
  const saved = previous?.packages[path];
  if (saved && (saved.notices.length || saved.excluded) && saved.name === name && saved.version === pkg.version && saved.integrity === pkg.integrity && saved.license === pkg.license) {
    for (const item of saved.notices) if (typeof texts[item.sha256] !== 'string' || digest(texts[item.sha256]) !== item.sha256) throw new Error(`Altered cached notice: ${path}/${item.file}`);
    packages[path] = saved;
    continue;
  }
  const bytes = await download(pkg.resolved, pkg.integrity);
  const [algorithm, expected] = pkg.integrity.split('-');
  if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error(`Integrity mismatch: ${path}`);
  const files = await entries(bytes);
  const notices = files.filter(containsLicense).map(f => save(f.path.replace(/^package\//, ''), f.bytes, pkg.resolved));
  if (!notices.length && fallbacks[`${name}@${pkg.version}`]) notices.push(await official(...fallbacks[`${name}@${pkg.version}`]));
  // This release explicitly grants MIT through the author's permalink. Preserve
  // the release's link, pinned author/template evidence, and the exact current
  // rendition. 2026 is the observed dynamic year, NOT a claimed release year.
  if (!notices.length && name === 'abstract-logging' && pkg.version === '2.0.1') {
    const metadata = JSON.parse(await download('https://registry.npmjs.org/abstract-logging/2.0.1'));
    if (metadata.dist?.integrity !== pkg.integrity || metadata.gitHead !== '80dfaef91ee87008f4ed2b6e78921d383bccd406') throw new Error('abstract-logging 2.0.1 release identity mismatch');
    const readme = files.find(file => file.path === 'package/Readme.md');
    if (!readme?.bytes.toString('utf8').includes('[MIT License](http://jsumners.mit-license.org/)')) throw new Error('Missing abstract-logging author license link');
    const source = 'https://jsumners.mit-license.org/@2026/license.txt';
    const text = await download(source);
    if (digest(text) !== 'af15a41ce02371f77476b7a201e036c0ae6c5d6d2a233b4e5f0fd5fca123457e') throw new Error('Changed abstract-logging linked license rendition; review upstream evidence');
    notices.push(save('Readme.md', readme.bytes, pkg.resolved));
    notices.push(await official('remy/mit-license', '73ebb8ca1e2280883e92498e18fcdb1c633c226c', 'users/jsumners.json'));
    notices.push(await official('remy/mit-license', '73ebb8ca1e2280883e92498e18fcdb1c633c226c', 'licenses/MIT.ejs'));
    notices.push(save('MIT-license-current-2026.txt', text, source));
  }
  // The maintainer explicitly identifies the historical 0.2.0 notice in
  // LICENSE-NOTES.md. Keep that version-specific evidence with the full text;
  // do not substitute the differently attributed current package notice.
  if (!notices.length && name === 'eastasianwidth' && pkg.version === '0.2.0') {
    const metadata = JSON.parse(await download('https://registry.npmjs.org/eastasianwidth/0.2.0'));
    if (metadata.dist?.integrity !== pkg.integrity || metadata.gitHead !== 'b89f04d44dc786885615e94cd6e2ba1ef7866fa4') throw new Error('eastasianwidth 0.2.0 release identity mismatch');
    notices.push(await official('komagata/eastasianwidth', '1d41951a59d63fb2d77cda021050fc070cae424a', 'MIT-LICENSE.txt'));
    notices.push(await official('komagata/eastasianwidth', '1cae8a1e507ad6bd5da2e9a01c0f6c90131699bf', 'LICENSE-NOTES.md'));
  }
  const binary = files.find(f => f.path.endsWith('/matrix_sdk_crypto_wasm_bg.wasm'));
  packages[path] = { name, version: pkg.version, integrity: pkg.integrity, license: pkg.license, notices, ...(binary ? { binary: { file: binary.path.replace(/^package\//, ''), sha256: digest(binary.bytes) } } : {}) };
  console.log(`npm ${name}@${pkg.version}: ${notices.length} notices`);
}
// Same upstream repositories; retain their license and embedded dependency notices.
for (const [path, pkg] of Object.entries(packages)) {
  if (pkg.notices.length) continue;
  let sibling;
  if (pkg.name.startsWith('@next/')) sibling = 'node_modules/next';
  if (pkg.name.startsWith('@rolldown/binding-')) sibling = 'node_modules/rolldown';
  if (pkg.name === '@swc/counter') sibling = 'node_modules/@swc/core';
  if (sibling) pkg.notices = packages[sibling].notices.filter(n => !n.file.includes('/'));
  if (pkg.name.startsWith('@img/sharp-libvips-') && pkg.version === '1.3.4') pkg.notices.push(await official('lovell/sharp-libvips', 'ebb95f8add54eee8bed840e3fb587e4cbec857d7', 'THIRD-PARTY-NOTICES.md'));
  if (pkg.name === '@schummar/icu-type-parser' && pkg.version === '1.21.5') pkg.excluded = 'TypeScript declarations only; no runtime implementation';
  if (!pkg.notices.length && !pkg.excluded) {
    const metadataURL = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`;
    const metadata = JSON.parse(await download(metadataURL));
    if (metadata.dist?.integrity !== pkg.integrity) throw new Error(`Npm release integrity mismatch: ${path}`);
    if (!/^[a-f0-9]{40}$/.test(metadata.gitHead ?? '')) { console.error(`Unresolved npm revision/license: ${path}@${pkg.version}`); continue; }
    const repositoryURL = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    const repository = repositoryURL?.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
    if (!repository) { console.error(`Unresolved npm repository/license: ${path}@${pkg.version}`); continue; }
    const source = `https://codeload.github.com/${repository}/tar.gz/${metadata.gitHead}`;
    if (!repositories.has(source)) repositories.set(source, entries(await download(source)));
    const upstream = await repositories.get(source);
    const directory = metadata.repository?.directory ?? '';
    pkg.notices = upstream.filter(file => {
      const name = file.path.slice(file.path.indexOf('/') + 1);
      const parent = name.slice(0, Math.max(0, name.lastIndexOf('/')));
      return containsLicense(file) && (!parent || parent === directory || directory.startsWith(`${parent}/`) || /^(?:LICENSES|licenses)\//.test(name));
    }).map(file => save(file.path.slice(file.path.indexOf('/') + 1), file.bytes, source));
    pkg.upstream = { repository: `https://github.com/${repository}`, revision: metadata.gitHead, path: directory, source, npmRelease: metadataURL };
    if (!pkg.notices.length) console.error(`Unresolved npm license text: ${path}@${pkg.version}`);
  }
}
if (npmOnly) {
  const crypto = packages['node_modules/@matrix-org/matrix-sdk-crypto-wasm'];
  if (!previous.rust || previous.rust.version !== crypto?.version || previous.rust.npmRelease.integrity !== crypto.integrity || digest(previous.rust.cargo) !== previous.rust.cargoSha256) throw new Error('Crypto changed; collect its complete Rust closure without --npm-only');
  await writeSnapshot(previous.rust);
  const unresolved = Object.values(packages).filter(pkg => !pkg.notices.length && !pkg.excluded);
  console.log(`Collected ${Object.keys(packages).length} npm package records; preserved pinned Rust closure; ${unresolved.length} unresolved licenses`);
  process.exit(unresolved.length ? 1 : 0);
}
const revision = 'a3d573d1aa41b9d593a9615837e812cb77cff336';
const cargoURL = `https://raw.githubusercontent.com/matrix-org/matrix-sdk-crypto-wasm/${revision}/Cargo.lock`;
const metadataURL = 'https://registry.npmjs.org/@matrix-org/matrix-sdk-crypto-wasm/18.9.0';
const metadata = JSON.parse(await download(metadataURL));
const cryptoPackage = packages['node_modules/@matrix-org/matrix-sdk-crypto-wasm'];
if (metadata.gitHead !== revision || metadata.dist.integrity !== cryptoPackage.integrity) throw new Error('Crypto release revision/integrity mismatch');
const cargo = await download(cargoURL);
// Cargo.lock is generated; only flat package identity fields are needed. Do not evaluate source.
const crates = cargo.toString('utf8').split('[[package]]').slice(1).map(section => Object.fromEntries([...section.matchAll(/^(name|version|source|checksum) = "([^"]+)"$/gm)].map(m => [m[1], m[2]])));
for (const crate of crates) {
  if (!crate.source) continue;
  if (!crate.source.startsWith('registry+')) throw new Error(`Unreviewed Cargo source: ${crate.source}`);
  const url = `https://static.crates.io/crates/${crate.name}/${crate.name}-${crate.version}.crate`;
  const bytes = await download(url, `sha256-${Buffer.from(crate.checksum, 'hex').toString('base64')}`);
  if (digest(bytes) !== crate.checksum) throw new Error(`Cargo checksum mismatch: ${crate.name}`);
  const files = await entries(bytes);
  const notices = files.filter(f => notice.test(f.path)).map(f => save(f.path.slice(f.path.indexOf('/') + 1), f.bytes, url));
  const supplement = notices.length ? {} : await crateNotices(files, crate);
  rust.push({ ...crate, notices, ...supplement });
  console.log(`rust ${crate.name}@${crate.version}: ${(supplement.notices ?? notices).length} notices`);
}
await writeSnapshot({ package: '@matrix-org/matrix-sdk-crypto-wasm', version: '18.9.0', revision, cargoURL, cargoSha256: digest(cargo), cargo: cargo.toString('utf8'), npmRelease: { source: metadataURL, gitHead: metadata.gitHead, integrity: metadata.dist.integrity }, scope: 'Conservative complete Cargo.lock closure including build and test dependencies', crates: rust });
if (Object.values(packages).some(pkg => !pkg.notices.length && !pkg.excluded)) process.exitCode = 1;
