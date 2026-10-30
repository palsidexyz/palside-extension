import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isMain = url => Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === url;

export function validateRelativePath(path) {
  if (!path || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe file path: ${JSON.stringify(path)}`);
  }
  return path;
}

export async function listFiles(directory, { ignoreMetadata = false } = {}) {
  const paths = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      if (ignoreMetadata && !relative && entry.name === '_metadata' && entry.isDirectory()) continue;
      const path = validateRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Not a regular file or directory: ${path}`);
    }
  }
  await walk();
  return paths.sort();
}

export function releaseZipName(manifest) {
  if (typeof manifest?.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error('manifest.json must contain a numeric Chrome extension version');
  }
  return `palside-${manifest.version}-chrome.zip`;
}
