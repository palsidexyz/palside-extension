import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isMain, listFiles, releaseZipName, sha256, validateRelativePath } from './lib/release-files.mjs';

// The store adds its update URL and the item's public key; confirm the list against the first real store installation.
const STORE_INJECTED_MANIFEST_KEYS = Object.freeze(['update_url', 'key']);

function parseSums(text) {
  const hashes = new Map();
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${JSON.stringify(line)}`);
    const path = validateRelativePath(match[2]);
    if (hashes.has(path)) throw new Error(`Duplicate SHA256SUMS path: ${path}`);
    hashes.set(path, match[1]);
  }
  return hashes;
}

function normalizedManifest(bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.json must be an object');
  for (const key of STORE_INJECTED_MANIFEST_KEYS) delete manifest[key];
  return manifest;
}

export async function verifyInstalled(directory, sumsPath, manifestPath) {
  const hashes = parseSums(await readFile(sumsPath, 'utf8'));
  const releaseBytes = await readFile(manifestPath);
  if (hashes.get('manifest.json') !== sha256(releaseBytes)) throw new Error('Release manifest.json does not match SHA256SUMS.txt');
  const releaseManifest = normalizedManifest(releaseBytes);
  const zipName = releaseZipName(releaseManifest);
  if (!hashes.delete(zipName)) throw new Error(`Missing release ZIP checksum: ${zipName}`);
  const actual = new Set(await listFiles(directory, { ignoreMetadata: true }));
  const differences = [];
  for (const [path, hash] of hashes) {
    if (!actual.has(path)) {
      differences.push(`Missing: ${path}`);
      continue;
    }
    const bytes = await readFile(join(directory, path));
    if (path === 'manifest.json') {
      try {
        const installed = normalizedManifest(bytes);
        const keys = [...new Set([...Object.keys(releaseManifest), ...Object.keys(installed)])].sort();
        const changed = keys.filter(key => !isDeepStrictEqual(releaseManifest[key], installed[key]));
        if (changed.length) differences.push(`Different: manifest.json (keys: ${changed.join(', ')})`);
      } catch (error) {
        differences.push(`Different: manifest.json (${error.message})`);
      }
    } else if (sha256(bytes) !== hash) differences.push(`Different: ${path}`);
  }
  for (const path of actual) if (!hashes.has(path)) differences.push(`Extra: ${path}`);
  return { differences, files: hashes.size };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: node scripts/verify-installed.mjs <installed-extension-dir> <SHA256SUMS.txt> <release manifest.json>');
    const result = await verifyInstalled(...process.argv.slice(2));
    if (result.differences.length) {
      console.error(`Installed extension verification failed:\n${result.differences.join('\n')}`);
      process.exitCode = 1;
    } else console.log(`Installed extension verified: ${result.files} files match (manifest compared semantically).`);
  } catch (error) {
    console.error(`Installed extension verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
