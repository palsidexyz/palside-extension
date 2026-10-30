import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { packageRelease, sourceDateEpoch } from '../scripts/package-release.mjs';
import { releaseExtension } from '../scripts/release-extension.mjs';
import { verifyReproducible } from '../scripts/verify-reproducible.mjs';
import { extensionCommands, extensionPermissions } from '../scripts/lib/extension-artifact.mjs';
import { RELEASE_WEBSITE_ORIGIN } from '../packages/shared/src/extension.ts';
import { verifyInstalled } from '../scripts/verify-installed.mjs';
import { checkLicenses, isAllowedLicense } from '../scripts/check-licenses.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const epoch = '1700000001';
const manifest = {
  manifest_version: 3, name: 'Palside', version: '1.2.3',
  permissions: extensionPermissions,
  commands: extensionCommands,
  action: { default_title: 'Palside' },
  side_panel: { default_path: 'sidepanel.html' },
  background: { service_worker: 'background.js' },
  optional_host_permissions: ['<all_urls>'],
  optional_permissions: ['notifications', 'tabs', 'favicon'],
  externally_connectable: { matches: [`${RELEASE_WEBSITE_ORIGIN}/*`] },
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
};
const run = (script, args) => spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args], { encoding: 'utf8' });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'palside-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'extension'), output = join(root, 'release'), installed = join(root, 'installed');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'empty'));
  await writeFile(join(directory, 'z.js'), '123456789');
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'assets', 'a b.txt'), 'public file');
  await writeFile(join(directory, 'assets', '资料.txt'), 'utf8 path');
  await writeFile(join(directory, 'assets', 'nested.zip'), 'an extension file with a zip suffix');
  await cp(directory, installed, { recursive: true });
  const result = await packageRelease({ directory, output, epoch });
  return { directory, output, installed, zipName: result.zipName, sums: join(output, 'SHA256SUMS.txt'), releaseManifest: join(output, 'manifest.json') };
}

function centralEntries(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 20), 0);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const start = offset, entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const nameLength = zip.readUInt16LE(offset + 28);
    assert.equal(zip.readUInt16LE(offset + 30), 0);
    assert.equal(zip.readUInt16LE(offset + 32), 0);
    assert.equal(zip.readUInt16LE(offset + 4), 0x0314);
    assert.equal(zip.readUInt16LE(offset + 8), 0x0800);
    assert.equal(zip.readUInt16LE(offset + 10), 8);
    assert.equal(zip.readUInt16LE(offset + 36), 0);
    assert.equal(zip.readUInt32LE(offset + 38), (0o100644 << 16) >>> 0);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const local = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    assert.deepEqual(zip.subarray(local + 4, local + 28), zip.subarray(offset + 6, offset + 30));
    assert.equal(zip.readUInt16LE(local + 28), 0);
    assert.equal(zip.subarray(local + 30, local + 30 + nameLength).toString('utf8'), name);
    const size = zip.readUInt32LE(offset + 20);
    const bytes = inflateRawSync(zip.subarray(local + 30 + nameLength, local + 30 + nameLength + size));
    assert.equal(bytes.length, zip.readUInt32LE(offset + 24));
    entries.push({ name, bytes, time: zip.readUInt16LE(offset + 12), date: zip.readUInt16LE(offset + 14), crc: zip.readUInt32LE(offset + 16) });
    offset += 46 + nameLength;
  }
  assert.equal(offset, end);
  assert.equal(offset - start, zip.readUInt32LE(end + 12));
  return entries;
}

test('release ZIP is byte-identical with sorted files, UTC DOS timestamp and fixed attributes', async t => {
  const f = await fixture(t);
  const first = await readFile(join(f.output, f.zipName));
  await chmod(join(f.directory, 'z.js'), 0o755);
  await utimes(join(f.directory, 'z.js'), new Date(), new Date());
  await packageRelease({ directory: f.directory, output: f.output, epoch });
  assert.deepEqual(await readFile(join(f.output, f.zipName)), first);
  const entries = centralEntries(first);
  assert.deepEqual(entries.map(entry => entry.name), ['assets/a b.txt', 'assets/nested.zip', 'assets/资料.txt', 'manifest.json', 'z.js']);
  const date = new Date(Number(epoch) * 1000);
  for (const entry of entries) {
    assert.equal(entry.time, (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1));
    assert.equal(entry.date, ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate());
    assert.deepEqual(entry.bytes, await readFile(join(f.directory, entry.name)));
  }
  assert.equal(entries.find(entry => entry.name === 'z.js').crc, 0xcbf43926);
});

for (const [name, change, diagnostic] of [
  ['identical', undefined, undefined],
  ['changed', directory => writeFile(join(directory, 'z.js'), 'changed after comparison'), /z\.js/],
  ['missing', directory => rm(join(directory, 'z.js')), /z\.js/],
  ['extra', directory => writeFile(join(directory, 'extra.js'), 'added after comparison'), /extra\.js/],
]) test(`release packages only compared bytes: ${name} artifact`, async t => {
  const f = await fixture(t);
  await rm(f.output, { recursive: true });
  const buildOutput = join(f.directory, '..', 'build-output');
  const directory = join(buildOutput, 'chrome-mv3');
  let builds = 0, compared;
  const release = releaseExtension({
    env: { SOURCE_DATE_EPOCH: epoch },
    async run(command, args) {
      if (args[1] === 'build:extension') {
        builds++;
        await cp(f.directory, directory, { recursive: true });
      }
      if (args[1] === 'verify:extension' && change) await change(directory);
    },
    async verifyBuild(options) {
      compared = await verifyReproducible({ ...options, output: buildOutput });
      return compared;
    },
    packageArtifact: options => packageRelease({ ...options, output: f.output }),
  });
  if (change) {
    await assert.rejects(release, error => {
      assert.match(error.message, /Release artifact differs from the reproducible build:/);
      assert.match(error.message, diagnostic);
      return true;
    });
    await assert.rejects(readFile(join(f.output, f.zipName)), { code: 'ENOENT' });
    await assert.rejects(readFile(f.sums), { code: 'ENOENT' });
    await assert.rejects(readFile(f.releaseManifest), { code: 'ENOENT' });
  } else {
    await release;
    const entries = centralEntries(await readFile(join(f.output, f.zipName)));
    assert.deepEqual(new Map(entries.map(({ name, bytes }) => [name, digest(bytes)])), compared.hashes);
    assert.deepEqual(await readFile(f.releaseManifest), entries.find(entry => entry.name === 'manifest.json').bytes);
  }
  assert.equal(builds, 2);
});

for (const [name, external] of [
  ['development website', { matches: ['http://localhost:3000/*'] }],
  ['foreign website', { matches: ['https://other.example/*'] }],
  ['additional website', { matches: [`${RELEASE_WEBSITE_ORIGIN}/*`, 'http://localhost:3000/*'] }],
  ['extension ids', { matches: [`${RELEASE_WEBSITE_ORIGIN}/*`], ids: ['*'] }],
]) test(`release packaging refuses ${name} before writing output`, async t => {
  const f = await fixture(t);
  await rm(f.output, { recursive: true });
  await writeFile(join(f.directory, 'manifest.json'), JSON.stringify({ ...manifest, externally_connectable: external }));
  await assert.rejects(packageRelease({ directory: f.directory, output: f.output, epoch }), /Release manifest rejected:[\s\S]*External messages/);
  await assert.rejects(readFile(join(f.output, f.zipName)), { code: 'ENOENT' });
});

test('release packaging refuses a directory without a manifest before writing output', async t => {
  const f = await fixture(t);
  await rm(f.output, { recursive: true });
  await rm(join(f.directory, 'manifest.json'));
  await assert.rejects(packageRelease({ directory: f.directory, output: f.output, epoch }), /Missing manifest.json/);
  await assert.rejects(readFile(join(f.output, f.zipName)), { code: 'ENOENT' });
});

test('SHA256SUMS contains sorted relative file hashes and ZIP hash; manifest is copied verbatim', async t => {
  const f = await fixture(t);
  const zip = await readFile(join(f.output, f.zipName));
  const expected = centralEntries(zip).map(({ name, bytes }) => `${digest(bytes)}  ${name}`);
  expected.push(`${digest(zip)}  ${f.zipName}`);
  assert.equal(await readFile(f.sums, 'utf8'), expected.join('\n') + '\n');
  assert.deepEqual(await readFile(f.releaseManifest), await readFile(join(f.directory, 'manifest.json')));
});

test('SOURCE_DATE_EPOCH is required in CI and invalid values fail packaging', async t => {
  assert.throws(() => sourceDateEpoch({ CI: 'true' }), /required in CI/);
  assert.throws(() => sourceDateEpoch({ CI: '' }), /required in CI/);
  assert.equal(sourceDateEpoch({ CI: 'true', SOURCE_DATE_EPOCH: epoch }), epoch);
  const f = await fixture(t);
  for (const invalid of ['', '-1', '1.5', 'NaN', '999999999999']) {
    await assert.rejects(packageRelease({ directory: f.directory, output: f.output, epoch: invalid }), /SOURCE_DATE_EPOCH/);
  }
});

test('packaging rejects symlinks', async t => {
  const f = await fixture(t);
  await symlink(join(f.directory, 'z.js'), join(f.directory, 'link.js'));
  await assert.rejects(packageRelease({ directory: f.directory, output: f.output, epoch }), /Not a regular file/);
});

test('verify-installed passes an identical copy through the CLI', async t => {
  const f = await fixture(t);
  const result = run('verify-installed.mjs', [f.installed, f.sums, f.releaseManifest]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5 files match/);
});

test('verify-installed ignores store metadata and update_url and compares JSON semantically', async t => {
  const f = await fixture(t);
  await mkdir(join(f.installed, '_metadata'));
  await writeFile(join(f.installed, '_metadata', 'verified_contents.json'), 'store metadata');
  await writeFile(join(f.installed, 'manifest.json'), JSON.stringify({ update_url: 'https://store.example.test/update', ...Object.fromEntries(Object.entries(manifest).reverse()) }, null, 2));
  assert.deepEqual((await verifyInstalled(f.installed, f.sums, f.releaseManifest)).differences, []);
});

for (const [name, change, diagnostic] of [
  ['changed file', f => writeFile(join(f.installed, 'z.js'), 'changed'), /Different: z\.js/],
  ['changed nested ZIP', f => writeFile(join(f.installed, 'assets', 'nested.zip'), 'changed'), /Different: assets\/nested\.zip/],
  ['missing file', f => rm(join(f.installed, 'z.js')), /Missing: z\.js/],
  ['extra file', f => writeFile(join(f.installed, 'extra.js'), 'extra'), /Extra: extra\.js/],
  ['changed manifest key', f => writeFile(join(f.installed, 'manifest.json'), JSON.stringify({ ...manifest, permissions: ['tabs'] })), /Different: manifest\.json \(keys: permissions\)/],
  ['unknown injected manifest key', f => writeFile(join(f.installed, 'manifest.json'), JSON.stringify({ ...manifest, homepage_url: 'https://unexpected.example' })), /Different: manifest\.json \(keys: homepage_url\)/],
]) test(`verify-installed fails on ${name}`, async t => {
  const f = await fixture(t);
  await change(f);
  const result = run('verify-installed.mjs', [f.installed, f.sums, f.releaseManifest]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, diagnostic);
});

test('verify-installed authenticates release manifest and rejects unsafe or duplicate checksum paths', async t => {
  const f = await fixture(t);
  const sums = await readFile(f.sums, 'utf8');
  for (const path of ['../escape.js', '/absolute.js', 'assets/../escape.js', 'assets\\escape.js']) {
    await writeFile(f.sums, `${sums}${'0'.repeat(64)}  ${path}\n`);
    await assert.rejects(verifyInstalled(f.installed, f.sums, f.releaseManifest), /Unsafe file path/);
  }
  await writeFile(f.sums, `${sums}${sums.split('\n')[0]}\n`);
  await assert.rejects(verifyInstalled(f.installed, f.sums, f.releaseManifest), /Duplicate/);
  await writeFile(f.sums, sums);
  await writeFile(f.releaseManifest, JSON.stringify({ ...manifest, permissions: ['tabs'] }));
  await assert.rejects(verifyInstalled(f.installed, f.sums, f.releaseManifest), /Release manifest.json does not match/);
});

test('license checker accepts allowed SPDX expressions and rejects disallowed, missing or malformed ones', () => {
  for (const expression of ['MIT', '(MIT OR Apache-2.0)', '(BSD-2-Clause OR BSD-3-Clause) AND (ISC OR (0BSD AND MPL-2.0))', 'CC-BY-4.0', 'BlueOak-1.0.0']) assert.equal(isAllowedLicense(expression), true, expression);
  for (const expression of [undefined, '', 'GPL-3.0-only', 'MIT OR GPL-3.0-only', 'GPL-3.0-only OR MIT', 'MIT WITH Classpath-exception-2.0', 'MIT OR', '(MIT', 'MIT Apache-2.0', 'MIT AND ()', 'MIT OR OR ISC', 'MIT)']) assert.equal(isAllowedLicense(expression), false, expression);
});

test('license checker reports production and dev packages, skips root and links, and returns a nonzero CLI exit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'palside-licenses-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockPath = join(root, 'package-lock.json');
  const packages = {
    '': { name: 'root' },
    'node_modules/workspace': { link: true, resolved: 'packages/workspace' },
    'packages/workspace': { name: '@palside/fixture', version: '1.0.0', license: 'MIT' },
    'node_modules/allowed': { version: '1.0.0', license: '(MIT OR Apache-2.0) AND ISC' },
    'node_modules/denied': { version: '2.0.0', license: 'GPL-3.0-only' },
    'node_modules/missing': { version: '3.0.0', dev: true },
  };
  await writeFile(lockPath, JSON.stringify({ packages }));
  const result = await checkLicenses(lockPath);
  assert.equal(result.checked, 4);
  assert.deepEqual(result.findings.map(({ name, version, license }) => ({ name, version, license })), [
    { name: 'denied', version: '2.0.0', license: 'GPL-3.0-only' },
    { name: 'missing', version: '3.0.0', license: '(missing)' },
  ]);
  const cli = run('check-licenses.mjs', [lockPath]);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /denied@2\.0\.0: GPL-3\.0-only/);
  assert.match(cli.stderr, /missing@3\.0\.0: \(missing\)/);
  delete packages['node_modules/denied'];
  delete packages['node_modules/missing'];
  await writeFile(lockPath, JSON.stringify({ packages }));
  assert.equal(run('check-licenses.mjs', [lockPath]).status, 0);
});
