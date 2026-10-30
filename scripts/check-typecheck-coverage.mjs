import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/release-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoots = /^(?:apps\/[^/]+\/(?:src|entrypoints)\/|apps\/website\/(?:app|components|lib|i18n)\/|apps\/admin\/vite\.config\.ts$|apps\/indexer\/ponder\.(?:config\.ts|schema\.ts|env\.d\.ts)$|packages\/[^/]+\/src\/)/;
const sourceExtension = /\.(?:ts|tsx|mts|mjs)$/;
const exclusions = [
  /(?:^|\/)(?:tests?|__tests__|__mocks__|fixtures|__fixtures__|integration)\//,
  /(?:^|\/)(?:generated|__generated__|\.next|\.wxt|\.output|node_modules)\//,
  /\.(?:test|spec|generated)\.(?:ts|tsx|mts|mjs)$/,
];

function isSourceFile(path) {
  return sourceRoots.test(path) && sourceExtension.test(path) && !exclusions.some(pattern => pattern.test(path));
}

function checkTypecheckCoverage(directory = root) {
  const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(path => isSourceFile(path) && existsSync(resolve(directory, path)));
  const { workspaces } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  if (!patterns?.length) throw new Error('package.json must declare workspace directories');
  const programs = [...new Set(globSync(patterns, { cwd: directory })
    .filter(path => existsSync(resolve(directory, path, 'package.json')))
    .map(path => resolve(directory, path, 'tsconfig.json'))
    .filter(path => existsSync(path)))].sort();
  if (!programs.length) throw new Error('No workspace typecheck programs found');
  if (!sources.length) throw new Error('No source files found');
  const covered = new Set();
  for (const program of programs) {
    let output;
    try {
      output = execFileSync(process.execPath, [
        resolve(directory, 'node_modules/typescript/bin/tsc'), '-p', program, '--listFilesOnly', '--pretty', 'false', '--incremental', 'false',
      ], { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      throw new Error(`${relative(directory, program)} could not list its files:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
    for (const path of output.split(/\r?\n/).filter(Boolean)) {
      const absolute = resolve(dirname(program), path);
      if (!existsSync(absolute)) throw new Error(`Unexpected TypeScript output from ${relative(directory, program)}: ${path}`);
      covered.add(realpathSync(absolute));
    }
  }
  const uncovered = sources.filter(path => !existsSync(resolve(directory, path)) || !covered.has(realpathSync(resolve(directory, path)))).sort();
  return { programs: programs.map(path => relative(directory, path)), sourceCount: sources.length, uncovered };
}

if (isMain(import.meta.url)) {
  try {
    const result = checkTypecheckCoverage();
    console.log(`Typecheck coverage: ${result.sourceCount - result.uncovered.length}/${result.sourceCount} source files across ${result.programs.length} programs.`);
    for (const program of result.programs) console.log(`  ${program}`);
    if (result.uncovered.length) {
      console.error(`Uncovered source files:\n${result.uncovered.map(path => `  ${path}`).join('\n')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Typecheck coverage failed: ${error.message}`);
    process.exitCode = 1;
  }
}
