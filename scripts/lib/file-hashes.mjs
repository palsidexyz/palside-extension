import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function hashDirectory(directory) {
  const paths = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else paths.push(path);
    }
  }
  await walk();
  const hashes = new Map();
  for (const path of paths.sort()) {
    const bytes = await readFile(join(directory, path));
    hashes.set(path, createHash('sha256').update(bytes).digest('hex'));
  }
  return hashes;
}
