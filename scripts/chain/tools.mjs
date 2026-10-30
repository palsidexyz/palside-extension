import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const contractsRoot = path.join(root, 'contracts');
export function requireDependencies() {
  const dependencies = JSON.parse(readFileSync(path.join(contractsRoot, 'dependencies.json'), 'utf8'));
  for (const [name, dependency] of Object.entries(dependencies)) {
    for (const file of [`vendor/${name}`, dependency.licenseFile]) {
      if (!existsSync(path.join(contractsRoot, file))) throw new Error(`Missing contracts/${file}; run npm run chain:prepare`);
    }
  }
}
export function requireArtifacts() {
  for (const name of ['MockPALS', 'PalsideRedPacket']) {
    const file = `out/${name}.sol/${name}.json`;
    if (!existsSync(path.join(contractsRoot, file))) throw new Error(`Missing contracts/${file}; run npm run chain:prepare and npm run chain:generate`);
  }
}
export function localDeployment() {
  const file = path.join(contractsRoot, 'deployments/local.json');
  if (!existsSync(file)) throw new Error('Missing contracts/deployments/local.json; run npm run chain:prepare and npm run chain:generate, then node scripts/chain/deploy.mjs against local Anvil');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function tool(name) {
  const override = process.env[`PALSIDE_${name.toUpperCase()}_PATH`];
  if (override) return override;
  for (const candidate of [path.join(homedir(), '.foundry/bin', name), path.join(root, 'output/tooling/foundry-v1.5.0', name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return name;
}
export function run(name, args, options = {}) {
  const result = spawnSync(tool(name), args, { cwd: contractsRoot, stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${name} is unavailable; install Foundry, then run npm run chain:prepare and npm run chain:generate`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${name} failed (${result.status})`);
  return result;
}
