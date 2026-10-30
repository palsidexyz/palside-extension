import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { contractsRoot, requireDependencies, run, tool } from './tools.mjs';

// Read-only verification for the explicitly deployed Robinhood packet contract.
// With no --submit flag it prints reviewable commands and makes no network requests.
const record = process.argv.find(arg => arg.startsWith('--deployment='))?.slice('--deployment='.length);
if (!record) throw new Error('Pass --deployment=<Foundry deployment JSON>; add --submit to send source to Blockscout');
const deployment = JSON.parse(await readFile(path.resolve(record), 'utf8'));
if (deployment.chainId !== 4663) throw new Error('Only Robinhood mainnet source verification is configured');
const verifierUrl = 'https://robinhoodchain.blockscout.com/api/';
for (const field of ['redPacket', 'signer']) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployment[field] ?? '')) throw new Error(`Missing deployment field ${field}`);
}
const cases = [
  ['PalsideRedPacket', deployment.redPacket, 'constructor(address)', [deployment.signer]],
];
if (process.argv.includes('--submit')) requireDependencies();
for (const [contract, address, signature, values] of cases) {
  const encoded = run('cast', ['abi-encode', signature, ...values], { encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
  const args = ['verify-contract', address, `src/${contract}.sol:${contract}`, '--chain', String(deployment.chainId), '--verifier', 'blockscout', '--verifier-url', verifierUrl, '--constructor-args', encoded, '--watch'];
  if (process.argv.includes('--submit')) {
    const result = spawnSync(tool('forge'), [...args, '--color', 'never'], { cwd: contractsRoot, encoding: 'utf8', stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${contract}: forge failed (${result.status})`);
    // Foundry 1.5.0 accepts Blockscout status=1 even when result says verification failed.
    const details = [...result.stdout.matchAll(/^Details: `([^`]+)`\s*$/gm)].map(match => match[1]);
    const lastDetail = details.at(-1);
    const verified = lastDetail
      ? ['Pass - Verified', 'Already Verified'].includes(lastDetail)
      : /^(?:Contract successfully verified|Contract source code already verified|Contract \[.+\] .+ is already verified\. Skipping verification\.)\s*$/m.test(result.stdout);
    if (!verified) throw new Error(`${contract}: source verification not confirmed${lastDetail ? ` (${lastDetail})` : ''}`);
  } else console.log(JSON.stringify({ executable: 'forge', cwd: 'contracts', args }));
}
