import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verificationArguments, failureCode } from '../scripts/verify-local-chain.mjs';

const local = { PALSIDE_ENV: 'development', PALSIDE_CHAIN_LOCAL_RELAY: 'true', PALSIDE_CHAIN_RPC_URL: 'http://127.0.0.1:8545' };
test('local chain verifier refuses unsafe environments before making requests', () => {
  assert.equal(verificationArguments([], local).rpc, 'http://127.0.0.1:8545/');
  for (const env of [{}, { ...local, PALSIDE_ENV: 'production' }, { ...local, PALSIDE_CHAIN_LOCAL_RELAY: 'false' }]) assert.throws(() => verificationArguments([], env));
  assert.throws(() => verificationArguments(['--force'], local), { code: 'NO_ARGUMENTS_ALLOWED' });
  for (const rpc of ['https://127.0.0.1:8545', 'http://example.com:8545', 'http://127.0.0.1:18545', 'http://user:secret@127.0.0.1:8545', 'http://127.0.0.1:8545/key', 'http://127.0.0.1:8545?secret=key', 'not a URL']) {
    assert.throws(() => verificationArguments([], { ...local, PALSIDE_CHAIN_RPC_URL: rpc }), { code: 'LOCAL_RPC_REQUIRED' });
    assert.throws(() => verificationArguments([], { ...local, PALSIDE_CHAIN_RPC: rpc }), { code: 'LOCAL_RPC_REQUIRED' });
  }
});
test('failure output preserves server codes without echoing exception secrets', () => {
  assert.equal(failureCode({ serverCode: 'CHAIN_DISABLED', code: 'HTTP_403' }), 'CHAIN_DISABLED');
  for (const error of [new Error('mnemonic private key jwt postgres://secret'), { code: 'postgres://secret' }, { serverCode: 'Bearer secret\nPASS forged' }]) assert.equal(failureCode(error), 'CHECK_FAILED');
});
test('documented command fails closed without live services and emits no secret', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-local-chain.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PALSIDE_ENV: 'production', PALSIDE_CHAIN_RPC_URL: 'http://secret:password@example.com' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL guards: DEVELOPMENT_REQUIRED/);
  assert.doesNotMatch(result.stdout + result.stderr, /password|example\.com/);
  assert.doesNotMatch(result.stdout, /PASS/);
});
