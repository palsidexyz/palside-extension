import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const status = detail => `Contract verification status:\nResponse: \`OK\`\nDetails: \`${detail}\`\n`;
async function verificationRoot(t) {
  const directory = await mkdtemp('/tmp/palside-verification-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts/chain'), { recursive: true });
  await mkdir(path.join(directory, 'contracts'));
  for (const name of ['verify.mjs', 'tools.mjs']) await copyFile(path.join(root, 'scripts/chain', name), path.join(directory, 'scripts/chain', name));
  await writeFile(path.join(directory, 'contracts/dependencies.json'), '{}');
  return directory;
}

for (const [name, output, succeeds] of [
  ['Blockscout failure with process exit zero', status('Fail - Unable to verify'), false],
  ['queued request without a final result', status('Pending in queue'), false],
  ['submission accepted without verification', 'Submitted contract for verification:\nResponse: `OK`\n', false],
  ['pending then verified', status('Pending in queue') + status('Pass - Verified') + 'Contract successfully verified\n', true],
  ['already verified response', status('Already Verified') + 'Contract source code already verified\n', true],
  ['already verified lookup', 'Contract [src/PalsideRedPacket.sol:PalsideRedPacket] 0x1234 is already verified. Skipping verification.\n', true],
  ['failure after an earlier success', status('Pass - Verified') + status('Fail - Unable to verify'), false],
]) {
  test(`source verification CLI handles ${name}`, async t => {
    const directory = await verificationRoot(t);
    const tool = path.join(directory, 'tool.mjs');
    const calls = path.join(directory, 'calls.txt');
    await writeFile(tool, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv[2] === 'abi-encode') console.log('0x00');\nelse process.stdout.write(${JSON.stringify(output)});\n`);
    await chmod(tool, 0o700);
    const deployment = path.join(directory, 'deployment.json');
    await writeFile(deployment, JSON.stringify({ chainId: 4663, ...Object.fromEntries(
      ['redPacket', 'signer']
        .map((field, index) => [field, `0x${(index + 1).toString(16).padStart(40, '0')}`]),
    ) }));
    const result = spawnSync(process.execPath, ['scripts/chain/verify.mjs', `--deployment=${deployment}`, '--submit'], {
      cwd: directory, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PALSIDE_CAST_PATH: tool, PALSIDE_FORGE_PATH: tool },
    });
    assert.ifError(result.error);
    assert.equal(result.status, succeeds ? 0 : 1, result.stderr);
    const commands = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[0], ['abi-encode', 'constructor(address)', `0x${'2'.padStart(40, '0')}`]);
    const args = commands[1];
    assert.ok(args.includes('src/PalsideRedPacket.sol:PalsideRedPacket'));
    if (!succeeds) assert.match(result.stderr, /PalsideRedPacket: source verification not confirmed/);
  });
}

for (const [chainId, url] of [[4663, 'https://robinhoodchain.blockscout.com/api/']]) {
  test(`source verification prints the ${chainId} packet command without submitting`, async t => {
    const directory = await verificationRoot(t);
    const deployment = path.join(directory, 'deployment.json');
    const redPacket = `0x${'1'.repeat(40)}`, signer = `0x${'2'.repeat(40)}`;
    await writeFile(deployment, JSON.stringify({ chainId, redPacket, signer }));
    const forge = path.join(directory, 'forge');
    await writeFile(forge, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    const cast = path.join(directory, 'cast');
    await writeFile(cast, `#!${process.execPath}\nconsole.log('0x${'0'.repeat(24)}${signer.slice(2)}');\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, ['scripts/chain/verify.mjs', `--deployment=${deployment}`], {
      cwd: directory, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PALSIDE_FORGE_PATH: forge, PALSIDE_CAST_PATH: cast },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { executable: 'forge', cwd: 'contracts', args: [
      'verify-contract', redPacket, 'src/PalsideRedPacket.sol:PalsideRedPacket', '--chain', String(chainId), '--verifier', 'blockscout', '--verifier-url', url, '--constructor-args', `0x${'0'.repeat(24)}${signer.slice(2)}`, '--watch',
    ] });
  });
}
