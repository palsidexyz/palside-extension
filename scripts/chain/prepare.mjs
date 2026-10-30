import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = JSON.parse(await readFile(path.join(root, 'contracts/dependencies.json'), 'utf8'));
const vendor = path.join(root, 'contracts/vendor');
async function contents(directory) {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name);
    const stat = await lstat(file);
    if (stat.isDirectory()) entries.push([name, await contents(file)]);
    else if (stat.isFile()) entries.push([name, createHash('sha256').update(await readFile(file)).digest('hex'), Boolean(stat.mode & 0o111)]);
    else throw new Error(`Unsupported dependency entry: ${file}`);
  }
  return entries;
}
await mkdir(vendor, { recursive: true });
if (!(await lstat(vendor)).isDirectory()) throw new Error('Dependency content mismatch: vendor must be a directory');
for (const name of await readdir(vendor)) {
  if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency entry: ${name}`);
}
for (const [name, dependency] of Object.entries(dependencies)) {
  const destination = path.join(vendor, name);
  // Archives are downloaded into their own empty directory. No upstream scripts are executed.
  const staging = await mkdtemp(path.join(tmpdir(), 'palside-dependency-'));
  try {
    const response = await fetch(dependency.url);
    if (!response.ok) throw new Error(`Download failed: ${dependency.url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const [algorithm, expected] = dependency.integrity.split('-');
    if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error(`Integrity mismatch: ${name}`);
    const archive = path.join(staging, 'archive.tgz');
    await writeFile(archive, bytes);
    const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    if (listing.status !== 0 || listing.stdout.split('\n').some(entry => entry.startsWith('/') || entry.split('/').includes('..'))) throw new Error(`Unsafe archive: ${name}`);
    const extracted = path.join(staging, 'extracted');
    await mkdir(extracted);
    const result = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Extraction failed: ${name}`);
    const expectedContents = JSON.stringify(await contents(extracted));
    const installed = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!installed) await cp(extracted, destination, { recursive: true, force: false, errorOnExist: true });
    else if (!installed.isDirectory()) throw new Error(`Dependency content mismatch: ${name}`);
    if (JSON.stringify(await contents(destination)) !== expectedContents) throw new Error(`Dependency content mismatch: ${name}; use a clean vendor tree and run npm run chain:prepare`);
    await readFile(path.join(root, 'contracts', dependency.licenseFile));
    console.log(`Prepared ${name}@${dependency.version}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
