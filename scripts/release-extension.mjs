import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { RELEASE_API_ORIGIN, RELEASE_WEBSITE_ORIGIN } from '../packages/shared/src/extension.ts';
import { isMain } from './lib/release-files.mjs';
import { packageRelease, sourceDateEpoch } from './package-release.mjs';
import { verifyReproducible } from './verify-reproducible.mjs';

const root = new URL('../', import.meta.url);

export async function releaseExtension({ env = process.env, run = execFileSync, verifyBuild = verifyReproducible, packageArtifact = packageRelease } = {}) {
  const releaseEnv = {
    ...env,
    PALSIDE_RELEASE_BUILD: 'true',
    WXT_API_URL: RELEASE_API_ORIGIN,
    WXT_WEBSITE_URL: RELEASE_WEBSITE_ORIGIN,
  };
  const epoch = sourceDateEpoch(releaseEnv);
  const options = { cwd: root, env: releaseEnv, stdio: 'inherit' };
  await run('npm', ['run', 'typecheck', '--workspace', '@palside/extension'], options);
  const { directory, hashes } = await verifyBuild({ env: releaseEnv, run });
  await run('npm', ['run', 'verify:extension'], options);
  await run(process.execPath, ['scripts/third-party-licenses.mjs', '--check'], options);
  return packageArtifact({ directory, expectedHashes: hashes, epoch });
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/release-extension.mjs');
    const result = await releaseExtension();
    console.log(`Packaged ${result.files} files: ${join(result.output, result.zipName)}`);
  } catch (error) {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
