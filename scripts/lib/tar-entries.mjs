import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
    const output = [], errors = [];
    child.stdout.on('data', bytes => output.push(bytes));
    child.stderr.on('data', bytes => errors.push(bytes));
    child.once('error', error => reject(new Error(`Cannot run system tar (${error.code}). Install tar and make it available on PATH.`, { cause: error })));
    child.once('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(`System tar failed (${code}): ${Buffer.concat(errors).toString('utf8')}`)));
  });
}

/** Read regular archive members through stdout; no archive paths are written to disk. */
export async function tarEntries(bytes, include = () => true) {
  const directory = await mkdtemp(join(tmpdir(), 'palside-tar-'));
  const archive = join(directory, 'source');
  try {
    await writeFile(archive, bytes);
    const names = (await tar(['-tf', archive])).toString('utf8').trimEnd().split('\n');
    const types = (await tar(['-tvf', archive])).toString('utf8').trimEnd().split('\n');
    if (names.length !== types.length) throw new Error('Unsupported tar member listing');
    const result = [];
    const seen = new Set();
    for (const [index, path] of names.entries()) {
      if (!types[index].startsWith('-') || !include(path)) continue;
      if (seen.has(path)) throw new Error(`Duplicate tar member: ${path}`);
      seen.add(path);
      result.push({ path, bytes: await tar(['-xOf', archive, '--', path]) });
    }
    return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
