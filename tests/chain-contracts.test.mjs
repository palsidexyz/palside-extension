import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, copyFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mockPalsAbi, redPacketAbi, contractSourceDigests } from '../packages/shared/src/chain/generated.ts';

const find = (abi, name) => abi.find(item => item.name === name);

test('generated contract ABI provenance tracks every contract and pinned build input', async () => {
  assert.equal(Object.keys(contractSourceDigests).length, 4);
  for (const [file, digest] of Object.entries(contractSourceDigests)) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `${file}: run scripts/chain/generate.mjs`);
  }
});

test('MockPALS exposes standard exact approvals without permit or supply controls', () => {
  assert.ok(find(mockPalsAbi, 'approve'));
  assert.ok(find(mockPalsAbi, 'Transfer'));
  for (const name of ['permit', 'mint', 'burn', 'owner']) assert.equal(find(mockPalsAbi, name), undefined);
});

test('claim voucher authorizes recipient while committed allocation stays separate', () => {
  const claim = find(redPacketAbi, 'claim');
  assert.deepEqual(claim.inputs[0].components.map(({ name, type }) => [name, type]), [
    ['packetId', 'bytes32'], ['recipient', 'address'], ['nonce', 'uint256'], ['deadline', 'uint256'],
  ]);
  assert.deepEqual(claim.inputs.slice(1).map(({ name, type }) => [name, type]), [
    ['amount', 'uint256'], ['allocationSalt', 'bytes32'], ['nextAllocationHash', 'bytes32'], ['signature', 'bytes'],
  ]);
  assert.deepEqual(find(redPacketAbi, 'claimBatch').inputs.map(({ name, type }) => [name, type]), [
    ['vouchers', 'tuple[]'], ['amounts', 'uint256[]'], ['allocationSalts', 'bytes32[]'], ['nextAllocationHashes', 'bytes32[]'], ['signatures', 'bytes[]'],
  ]);
  assert.ok(find(redPacketAbi, 'refundExpired'));
  assert.equal(find(redPacketAbi, 'PacketCreated').inputs.at(-1).name, 'expiresAt');
});

test('packet ABI binds its token at creation without a deployment token', () => {
  assert.deepEqual(redPacketAbi.find(item => item.type === 'constructor').inputs.map(({ name, type }) => [name, type]), [['signer_', 'address']]);
  assert.equal(find(redPacketAbi, 'token'), undefined);
  assert.deepEqual(find(redPacketAbi, 'createPacket').inputs.map(({ name, type }) => [name, type]), [
    ['token', 'address'], ['salt', 'bytes32'], ['kind', 'uint8'], ['total', 'uint256'], ['count', 'uint32'], ['equalAmount', 'uint256'], ['allocationHash', 'bytes32'],
  ]);
  assert.deepEqual(find(redPacketAbi, 'PacketCreated').inputs.filter(input => input.indexed).map(input => input.name), ['packetId', 'sender', 'token']);
  assert.deepEqual(find(redPacketAbi, 'packets').outputs.slice(0, 2).map(({ name, type }) => [name, type]), [['sender', 'address'], ['token', 'address']]);
});

test('generator emits ABI and source digests independently of deployment records', async t => {
  const directory = await mkdtemp('/tmp/palside-generate-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['scripts/chain', 'contracts/src', 'contracts/deployments', 'contracts/out/MockPALS.sol', 'contracts/out/PalsideRedPacket.sol']) await mkdir(path.join(directory, folder), { recursive: true });
  for (const file of ['generate.mjs', 'tools.mjs']) await copyFile(new URL(`../scripts/chain/${file}`, import.meta.url), path.join(directory, 'scripts/chain', file));
  for (const file of ['foundry.toml', 'dependencies.json', 'src/MockPALS.sol', 'src/PalsideRedPacket.sol']) await writeFile(path.join(directory, 'contracts', file), '');
  await writeFile(path.join(directory, 'contracts/dependencies.json'), '{}');
  for (const name of ['MockPALS', 'PalsideRedPacket']) await writeFile(path.join(directory, `contracts/out/${name}.sol/${name}.json`), JSON.stringify({ abi: [] }));
  const forge = path.join(directory, 'forge');
  await writeFile(forge, '#!/bin/sh\n[ "$1" = build ] && [ "$2" = --no-cache ]\n', { mode: 0o700 });
  await writeFile(path.join(directory, 'contracts/deployments/4663.json'), JSON.stringify({ chainId: 4663, deployer: `0x${'1'.repeat(40)}`, redPacket: `0x${'2'.repeat(40)}`, signer: `0x${'3'.repeat(40)}` }));
  const result = spawnSync(process.execPath, ['scripts/chain/generate.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PALSIDE_FORGE_PATH: forge } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const generated = await import(path.join(directory, 'packages/shared/src/chain/generated.ts'));
  assert.deepEqual(Object.keys(generated).sort(), ['contractSourceDigests', 'mockPalsAbi', 'redPacketAbi']);
  assert.deepEqual(generated.mockPalsAbi, []);
  assert.deepEqual(generated.redPacketAbi, []);
  assert.equal(Object.keys(generated.contractSourceDigests).length, 4);
  const check = () => spawnSync(process.execPath, ['scripts/chain/generate.mjs', '--check'], { cwd: directory, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PALSIDE_FORGE_PATH: forge } });
  assert.equal(check().status, 0);
  await writeFile(path.join(directory, 'contracts/out/MockPALS.sol/MockPALS.json'), JSON.stringify({ abi: [{ type: 'error', name: 'Changed', inputs: [] }] }));
  const stale = check();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Generated contract ABI is stale; run npm run chain:generate/);
});

test('prepare restores pinned archive contents and licenses and rejects any modified tree', async t => {
  const directory = await mkdtemp('/tmp/palside-prepare-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['scripts/chain', 'contracts', 'package/src']) await mkdir(path.join(directory, folder), { recursive: true });
  await copyFile(new URL('../scripts/chain/prepare.mjs', import.meta.url), path.join(directory, 'scripts/chain/prepare.mjs'));
  await writeFile(path.join(directory, 'package/src/Contract.sol'), 'contract Example {}\n');
  await writeFile(path.join(directory, 'package/LICENSE'), 'fixture license\n');
  const archive = path.join(directory, 'dependency.tgz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', directory, 'package'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const bytes = await readFile(archive);
  const dependency = { version: '1', url: `data:application/gzip;base64,${bytes.toString('base64')}`, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, licenseFile: 'vendor/example/LICENSE' };
  const pins = path.join(directory, 'contracts/dependencies.json');
  await writeFile(pins, JSON.stringify({ example: dependency }));
  const prepare = () => spawnSync(process.execPath, ['scripts/chain/prepare.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
  const installed = prepare();
  assert.equal(installed.status, 0, installed.stderr);
  const vendor = path.join(directory, 'contracts/vendor/example');
  assert.equal(await readFile(path.join(vendor, 'LICENSE'), 'utf8'), 'fixture license\n');
  assert.equal(prepare().status, 0);
  await writeFile(path.join(vendor, 'src/Contract.sol'), 'contract Altered {}\n');
  let rejected = prepare();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Dependency content mismatch/);
  assert.equal(await readFile(path.join(vendor, 'src/Contract.sol'), 'utf8'), 'contract Altered {}\n');
  await copyFile(path.join(directory, 'package/src/Contract.sol'), path.join(vendor, 'src/Contract.sol'));
  await writeFile(path.join(vendor, '.palside-dependency.json'), JSON.stringify(dependency));
  assert.equal(prepare().status, 1);
  await rm(path.join(vendor, '.palside-dependency.json'));
  await rm(path.join(vendor, 'LICENSE'));
  assert.equal(prepare().status, 1);
  await symlink(path.join(directory, 'package/LICENSE'), path.join(vendor, 'LICENSE'));
  rejected = prepare();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unsupported dependency entry/);
  await rm(path.join(vendor, 'LICENSE'));
  await copyFile(path.join(directory, 'package/LICENSE'), path.join(vendor, 'LICENSE'));
  const extra = path.join(directory, 'contracts/vendor/unpinned');
  await mkdir(extra);
  rejected = prepare();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unexpected dependency entry: unpinned/);
  await rm(extra, { recursive: true });
  await writeFile(pins, JSON.stringify({ example: { ...dependency, integrity: `sha256-${Buffer.alloc(32).toString('base64')}` } }));
  rejected = prepare();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Integrity mismatch: example/);
});

test('missing chain inputs give preparation and generation instructions', async t => {
  const directory = await mkdtemp('/tmp/palside-chain-inputs-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts/chain'), { recursive: true });
  await mkdir(path.join(directory, 'contracts'));
  await copyFile(new URL('../scripts/chain/tools.mjs', import.meta.url), path.join(directory, 'scripts/chain/tools.mjs'));
  await writeFile(path.join(directory, 'contracts/dependencies.json'), JSON.stringify({ example: { licenseFile: 'vendor/example/LICENSE' } }));
  const { requireDependencies, requireArtifacts, localDeployment } = await import(path.join(directory, 'scripts/chain/tools.mjs'));
  assert.throws(requireDependencies, /run npm run chain:prepare/);
  assert.throws(requireArtifacts, /run npm run chain:prepare and npm run chain:generate/);
  assert.throws(localDeployment, /node scripts\/chain\/deploy.mjs against local Anvil/);
});
