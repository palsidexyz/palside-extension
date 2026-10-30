import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { isMain, listFiles, releaseZipName, sha256 } from './lib/release-files.mjs';
import { validateExtensionManifest } from './lib/extension-artifact.mjs';

const root = new URL('../', import.meta.url);
const defaultDirectory = fileURLToPath(new URL('apps/extension/.output/chrome-mv3/', root));
const defaultOutput = fileURLToPath(new URL('apps/extension/.output/release/', root));

export function sourceDateEpoch(env = process.env) {
  if (env.SOURCE_DATE_EPOCH !== undefined) return env.SOURCE_DATE_EPOCH;
  if (env.CI !== undefined) throw new Error('SOURCE_DATE_EPOCH is required in CI');
  return execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }).trim();
}

function dosTimestamp(epoch) {
  if (!/^\d+$/.test(String(epoch)) || !Number.isSafeInteger(Number(epoch))) throw new Error('SOURCE_DATE_EPOCH must be non-negative integer seconds');
  const date = new Date(Math.max(Number(epoch), 315532800) * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 2107) throw new Error('SOURCE_DATE_EPOCH exceeds the ZIP timestamp range');
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files, timestamp) {
  if (files.length >= 0xffff) throw new Error('ZIP64 is not supported');
  const local = [], central = [];
  let offset = 0;
  for (const { path, bytes } of files) {
    const name = Buffer.from(path, 'utf8');
    const compressed = deflateRawSync(bytes, { level: 9 });
    if (name.length > 0xffff || bytes.length >= 0xffffffff || compressed.length >= 0xffffffff) throw new Error(`ZIP limits exceeded: ${path}`);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(timestamp.time, 10);
    header.writeUInt16LE(timestamp.date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
    if (offset >= 0xffffffff) throw new Error('ZIP64 is not supported');
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length >= 0xffffffff) throw new Error('ZIP64 is not supported');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function packageRelease({ directory = defaultDirectory, output = defaultOutput, epoch = sourceDateEpoch(), expectedHashes } = {}) {
  const timestamp = dosTimestamp(epoch);
  const files = [];
  for (const path of await listFiles(directory)) files.push({ path, bytes: await readFile(join(directory, path)) });
  if (expectedHashes) {
    const actualHashes = new Map(files.map(({ path, bytes }) => [path, sha256(bytes)]));
    const differences = [...new Set([...expectedHashes.keys(), ...actualHashes.keys()])].sort()
      .filter(path => expectedHashes.get(path) !== actualHashes.get(path));
    if (differences.length) throw new Error(`Release artifact differs from the reproducible build:\n${differences.join('\n')}`);
  }
  const manifest = files.find(file => file.path === 'manifest.json');
  if (!manifest) throw new Error('Missing manifest.json in extension directory');
  const parsedManifest = JSON.parse(manifest.bytes.toString('utf8'));
  const zipName = releaseZipName(parsedManifest);
  const errors = validateExtensionManifest(parsedManifest);
  if (errors.length) throw new Error(`Release manifest rejected:\n${errors.join('\n')}`);
  if (files.some(file => file.path === zipName)) throw new Error(`Extension file conflicts with release ZIP: ${zipName}`);
  const zip = zipFiles(files, timestamp);
  const sums = [...files.map(({ path, bytes }) => `${sha256(bytes)}  ${path}`), `${sha256(zip)}  ${zipName}`].join('\n') + '\n';
  await mkdir(output, { recursive: true });
  await writeFile(join(output, zipName), zip);
  await writeFile(join(output, 'SHA256SUMS.txt'), sums);
  await writeFile(join(output, 'manifest.json'), manifest.bytes);
  return { zipName, files: files.length, output };
}

if (isMain(import.meta.url)) {
  try {
    const result = await packageRelease();
    console.log(`Packaged ${result.files} files: ${join(result.output, result.zipName)}`);
  } catch (error) {
    console.error(`Release packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
