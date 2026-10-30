import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/release-files.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const LICENSE_HOSTS = ['extension', 'website', 'server', 'admin', 'indexer'];
export const licenseHosts = lock => LICENSE_HOSTS.filter(host => lock.packages[`apps/${host}`]);
const fontHosts = ['extension', 'website', 'admin'];
const copiedLicenses = [
  ['LICENSE', 'Palside-MIT.txt'],
  ['packages/design/fonts/Geist-OFL.txt', 'Geist-OFL.txt'],
  ['packages/design/fonts/GeistMono-OFL.txt', 'GeistMono-OFL.txt'],
];

// Follow the lockfile's actual nested resolution, not a scan of all node_modules.
export function runtimePackages(lock, workspace) {
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    const pkg = lock.packages[key];
    if (!pkg) throw new Error(`Missing locked dependency: ${key}`);
    seen.add(key);
    if (pkg.link) return visit(pkg.resolved);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort(compare)) {
      let directory = key;
      for (;;) {
        const candidate = posix.join(directory, 'node_modules', name);
        if (lock.packages[candidate]) { visit(candidate); break; }
        if (!directory) throw new Error(`Unresolved locked dependency: ${key} -> ${name}`);
        directory = posix.dirname(directory);
        if (directory === '.') directory = '';
      }
    }
  }
  visit(workspace);
  return [...seen].filter(key => key.includes('node_modules/') && !lock.packages[key].link).sort(compare);
}

export function noticePaths(lock, host) {
  const paths = runtimePackages(lock, `apps/${host}`);
  // These helpers execute in the shipped extension; WXT's build graph does not.
  for (const name of host === 'extension' ? ['wxt', '@wxt-dev/browser', 'tailwindcss'] : host === 'website' ? ['tailwindcss'] : []) {
    const path = [`apps/${host}/node_modules/${name}`, `node_modules/${name}`].find(path => lock.packages[path]);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths.sort(compare);
}

function verifyRust(snapshot, source) {
  const rust = snapshot.rust;
  if (!rust || rust.version !== source.version || rust.npmRelease?.integrity !== source.integrity || rust.npmRelease?.gitHead !== rust.revision) throw new Error('Rust license snapshot does not match crypto WASM');
  if (typeof rust.cargo !== 'string' || hash(rust.cargo) !== rust.cargoSha256) throw new Error('Missing or altered pinned Cargo.lock');
  const locked = rust.cargo.split('[[package]]').slice(1).map(section => Object.fromEntries([...section.matchAll(/^(name|version|source|checksum) = "([^"]+)"$/gm)].map(m => [m[1], m[2]]))).filter(crate => crate.source);
  if (locked.length !== rust.crates.length) throw new Error('Incomplete Cargo license closure');
  for (const [index, crate] of locked.entries()) {
    if (!crate.source.startsWith('registry+') || !/^[a-f0-9]{64}$/.test(crate.checksum) || ['name', 'version', 'source', 'checksum'].some(key => crate[key] !== rust.crates[index][key])) throw new Error(`Cargo license identity mismatch: ${crate.name}`);
  }
}

export async function licenseBundle(root = project, host = 'extension') {
  if (!LICENSE_HOSTS.includes(host)) throw new Error(`Unknown host: ${host}`);
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const snapshot = JSON.parse(await readFile(join(root, 'scripts/licenses/upstream.json'), 'utf8'));
  const packages = [], index = [], unresolved = [];
  const verifiedTexts = new Set();
  const paths = noticePaths(lock, host);
  if (snapshot.schema !== 1) throw new Error('Unsupported upstream license snapshot');
  function append(source, ecosystem, path) {
    const name = `${ecosystem === 'cargo' ? 'Rust ' : ''}${source.name}@${source.version}`;
    const notices = [];
    for (const notice of source.notices) {
      const text = snapshot.texts[notice.sha256];
      if (!verifiedTexts.has(notice.sha256)) {
        if (!text?.trim() || hash(text) !== notice.sha256) throw new Error(`Missing or altered upstream license: ${name}/${notice.file}`);
        verifiedTexts.add(notice.sha256);
      }
      const lines = text.split(/\r?\n/);
      notices.push({ ...notice, textId: notice.sha256, lines: lines.length - (lines.at(-1) === '' ? 1 : 0),
        copyrightLines: lines.flatMap((line, index) => /copyright|©|SPDX-FileCopyrightText/i.test(line) ? [index + 1] : []),
      });
    }
    index.push({ ecosystem, name: source.name, version: source.version, ...(path ? { path } : {}), license: source.license ?? 'NOASSERTION', notices });
  }
  for (const path of paths.sort(compare)) {
    const locked = lock.packages[path], source = snapshot.packages[path];
    const name = locked.name ?? path.split('node_modules/').at(-1);
    if (!source || source.name !== name || source.version !== locked.version || source.integrity !== locked.integrity || source.license !== locked.license) throw new Error(`License snapshot differs from lock: ${path}; run the reviewed upstream collection`);
    // All locked platforms are included in the same immutable snapshot. The
    // current machine's optional native installations never change the output.
    if (source.excluded) {
      if (source.name !== '@schummar/icu-type-parser' || source.version !== '1.21.5' || source.excluded !== 'TypeScript declarations only; no runtime implementation') throw new Error(`Unreviewed license exclusion: ${path}`);
      continue;
    }
    if (!source.notices.length) unresolved.push(`${source.name}@${source.version}: upstream package contains no license text`);
    append(source, 'npm', path);
    packages.push({ path, ...source });
    if (source.name === '@matrix-org/matrix-sdk-crypto-wasm') {
      verifyRust(snapshot, source);
      for (const crate of snapshot.rust.crates) {
        if (!crate.notices.length) unresolved.push(`Rust ${crate.name}@${crate.version}: missing license text`);
        append(crate, 'cargo');
      }
    }
  }
  const texts = [...verifiedTexts].sort(compare).map(id => ({ id, sha256: id, bytes: Buffer.byteLength(snapshot.texts[id]) }));
  const entries = index.map(entry => [
    `===== ${entry.ecosystem}: ${entry.name}@${entry.version} =====`,
    ...(entry.path ? [`Package path: ${entry.path}`] : []),
    `SPDX expression: ${entry.license}`,
    ...entry.notices.flatMap(notice => [
      `Notice: ${notice.file}`, `Source: ${notice.source}`, `Text ID: ${notice.textId}`,
      `Notice lines: 1-${notice.lines}; copyright lines: ${notice.copyrightLines.join(', ') || 'see full notice'}`,
    ]),
  ].join('\n')).join('\n\n');
  const sections = texts.map(({ id }) => `===== TEXT ${id} =====\n${snapshot.texts[id]}\n`);
  const text = `Palside ${host}: third-party runtime dependency notices
Generated offline from package-lock.json and checksum-verified upstream release archives.
Conservative closure includes all locked platforms, embedded Next dependencies, and the complete pinned crypto Cargo.lock (including build/test dependencies).
This inventory is not proof of asset authorization.
Text IDs are SHA-256 digests of exact upstream text, including copyright headers.
Notice and copyright line numbers refer to that full text (starting at 1).
NOASSERTION means the snapshot does not record an SPDX expression; consult every referenced notice.

PACKAGE AND NOTICE INDEX

${entries}

UNIQUE FULL TEXTS

${sections.join('\n')}`;
  return { text, manifest: { schema: 2, host, packages, ...(host === 'extension' ? { rust: snapshot.rust } : {}), index, texts, unresolved, sha256: hash(text) } };
}

export async function syncThirdPartyLicenses(root = project) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  for (const host of licenseHosts(lock)) {
    const { text, manifest } = await licenseBundle(root, host);
    const target = join(root, `apps/${host}/public/licenses`);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'THIRD-PARTY.txt'), text);
    await writeFile(join(target, 'THIRD-PARTY.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (fontHosts.includes(host)) {
      for (const [source, file] of copiedLicenses) await copyFile(join(root, source), join(target, file));
    }
  }
}

export async function verifyThirdPartyLicenses(directory, { root = project, host = 'extension' } = {}) {
  if (directory instanceof URL) directory = fileURLToPath(directory);
  const expected = await licenseBundle(root, host);
  const actual = await readFile(join(directory, 'licenses/THIRD-PARTY.txt'), 'utf8');
  const manifest = JSON.parse(await readFile(join(directory, 'licenses/THIRD-PARTY.json'), 'utf8'));
  if (actual !== expected.text || JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) throw new Error(`Missing, stale or altered ${host} third-party notices`);
  if (expected.manifest.unresolved.length) throw new Error(`Unresolved ${host} distribution licenses:\n${expected.manifest.unresolved.join('\n')}`);
  if (fontHosts.includes(host)) {
    for (const [source, file] of copiedLicenses) {
      const actual = await readFile(join(directory, 'licenses', file));
      if (!actual.equals(await readFile(join(root, source)))) throw new Error(`Missing, stale or altered ${host} license: ${file}`);
    }
  }
  return expected.manifest;
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--check') {
      const failures = [];
      const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
      for (const host of licenseHosts(lock)) {
        try { await verifyThirdPartyLicenses(join(project, `apps/${host}/public`), { host }); }
        catch (error) { failures.push(error.message); }
      }
      if (failures.length) throw new Error(failures.join('\n'));
    } else if (process.argv.length === 2) await syncThirdPartyLicenses();
    else throw new Error('Usage: node scripts/third-party-licenses.mjs [--check]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
