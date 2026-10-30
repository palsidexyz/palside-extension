import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDirectory } from './lib/file-hashes.mjs';
import { isMain } from './lib/release-files.mjs';

const root = new URL('../', import.meta.url);
const defaultOutput = fileURLToPath(new URL('apps/extension/.output/', root));

export async function verifyReproducible({ env = process.env, run = execFileSync, output = defaultOutput } = {}) {
  const directory = join(output, 'chrome-mv3');
  async function build() {
    await rm(output, { recursive: true, force: true });
    await run('npm', ['run', 'build:extension'], { cwd: root, env, stdio: 'inherit' });
    return hashDirectory(directory);
  }

  const first = await build();
  const second = await build();
  const differences = [];
  for (const path of [...new Set([...first.keys(), ...second.keys()])].sort()) {
    if (first.get(path) === second.get(path)) continue;
    differences.push(`${path}: first=${first.get(path) ?? 'missing'} second=${second.get(path) ?? 'missing'}`);
  }
  if (differences.length) throw new Error(`Extension build is not reproducible:\n${differences.join('\n')}`);
  console.log(`Extension build reproducible: ${first.size} files match.`);
  return { directory, hashes: second };
}

if (isMain(import.meta.url)) {
  try {
    await verifyReproducible();
  } catch (error) {
    console.error(`Reproducibility verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
