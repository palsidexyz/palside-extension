import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_API_ORIGIN, RELEASE_WEBSITE_ORIGIN } from '../packages/shared/src/extension.ts';
import { releaseExtension } from '../scripts/release-extension.mjs';
import { verifyReproducible } from '../scripts/verify-reproducible.mjs';
import { sha256 } from '../scripts/lib/release-files.mjs';

const env = {
  SOURCE_DATE_EPOCH: '1700000001',
  PALSIDE_RELEASE_BUILD: 'false',
  WXT_API_URL: 'http://127.0.0.1:8787',
  WXT_WEBSITE_URL: 'http://localhost:3000',
};

async function fixture(t, { failedGate, mismatch = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'palside-release-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  const directory = join(output, 'chrome-mv3');
  const calls = [];
  let builds = 0;
  return {
    calls, directory,
    options: {
      env,
      verifyBuild: options => verifyReproducible({ ...options, output }),
      async run(command, args, options) {
        assert.equal(command, args[0] === 'run' ? 'npm' : process.execPath);
        assert.equal(options.env.PALSIDE_RELEASE_BUILD, 'true');
        assert.equal(options.env.WXT_API_URL, RELEASE_API_ORIGIN);
        assert.equal(options.env.WXT_WEBSITE_URL, RELEASE_WEBSITE_ORIGIN);
        calls.push(args);
        if (calls.length === failedGate) throw new Error('gate failed');
        if (args[1] === 'build:extension') {
          await assert.rejects(readdir(output), { code: 'ENOENT' });
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, 'background.js'), mismatch ? `build ${++builds}` : 'reproducible bytes');
        }
      },
    },
  };
}

test('release runner typechecks, compares two clean production builds, verifies and packages those bytes', async t => {
  const f = await fixture(t);
  const result = await releaseExtension({
    ...f.options,
    async packageArtifact(options) {
      assert.equal(options.directory, f.directory);
      assert.deepEqual(options.expectedHashes, new Map([['background.js', sha256('reproducible bytes')]]));
      assert.equal(await readFile(join(options.directory, 'background.js'), 'utf8'), 'reproducible bytes');
      f.calls.push(['package', options.epoch]);
      return 'packaged';
    },
  });
  assert.equal(result, 'packaged');
  assert.deepEqual(f.calls, [
    ['run', 'typecheck', '--workspace', '@palside/extension'],
    ['run', 'build:extension'],
    ['run', 'build:extension'],
    ['run', 'verify:extension'],
    ['scripts/third-party-licenses.mjs', '--check'],
    ['package', env.SOURCE_DATE_EPOCH],
  ]);
  assert.equal(env.PALSIDE_RELEASE_BUILD, 'false');
});

for (const failedGate of [1, 2, 3, 4, 5]) {
  test(`release runner stops when gate ${failedGate} fails`, async t => {
    const f = await fixture(t, { failedGate });
    await assert.rejects(releaseExtension({
      ...f.options,
      packageArtifact() { assert.fail('must not package'); },
    }), /gate failed/);
    assert.equal(f.calls.length, failedGate);
  });
}

test('release runner stops before artifact verification and packaging when build hashes differ', async t => {
  const f = await fixture(t, { mismatch: true });
  await assert.rejects(releaseExtension({
    ...f.options,
    packageArtifact() { assert.fail('must not package'); },
  }), /Extension build is not reproducible:\nbackground\.js: first=[a-f0-9]{64} second=[a-f0-9]{64}/);
  assert.equal(f.calls.length, 3);
});

for (const missingBuild of [1, 2]) {
  test(`reproducibility comparison reports files missing from build ${missingBuild}`, async t => {
    const f = await fixture(t);
    let builds = 0;
    await assert.rejects(releaseExtension({
      ...f.options,
      async run(command, args, options) {
        await f.options.run(command, args, options);
        if (args[1] === 'build:extension' && ++builds !== missingBuild) {
          await writeFile(join(f.directory, 'extra.js'), 'extra');
        }
      },
      packageArtifact() { assert.fail('must not package'); },
    }), missingBuild === 1 ? /extra\.js: first=missing second=[a-f0-9]{64}/ : /extra\.js: first=[a-f0-9]{64} second=missing/);
    assert.equal(f.calls.length, 3);
  });
}

test('release runner rejects missing CI epoch before running any gates', async () => {
  await assert.rejects(releaseExtension({
    env: { CI: 'true' },
    run() { assert.fail('must not run'); },
    packageArtifact() { assert.fail('must not package'); },
  }), /SOURCE_DATE_EPOCH is required in CI/);
});
