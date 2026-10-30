import { readFile } from 'node:fs/promises';
import { licenseHosts, verifyThirdPartyLicenses } from './third-party-licenses.mjs';
import { isMain } from './lib/release-files.mjs';

const ALLOWED_LICENSES = Object.freeze([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0',
  'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0', 'MPL-2.0',
]);

/** Reviewed LGPL use: sharp's prebuilt libvips binaries are loaded dynamically by the website image optimizer and are not part of the extension. */
const REVIEWED_EXCEPTIONS = Object.freeze([/^@img\/sharp-/]);

export function isAllowedLicense(expression) {
  if (typeof expression !== 'string') return false;
  const tokens = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*|\S/g) ?? [];
  let index = 0;
  function primary() {
    if (tokens[index] === '(') {
      index++;
      const allowed = or();
      if (tokens[index++] !== ')') throw new Error('Expected closing parenthesis');
      return allowed;
    }
    const token = tokens[index++];
    if (!token || !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token) || ['AND', 'OR', 'WITH'].includes(token)) throw new Error('Expected license identifier');
    return ALLOWED_LICENSES.includes(token);
  }
  function and() {
    let allowed = primary();
    while (tokens[index] === 'AND') {
      index++;
      const next = primary();
      allowed = allowed && next;
    }
    return allowed;
  }
  function or() {
    let allowed = and();
    while (tokens[index] === 'OR') {
      index++;
      const next = and();
      allowed = allowed && next;
    }
    return allowed;
  }
  try { return or() && index === tokens.length; } catch { return false; }
}

export async function checkLicenses(path = new URL('../package-lock.json', import.meta.url)) {
  const lock = JSON.parse(await readFile(path, 'utf8'));
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) throw new Error('Lock file must contain packages entries');
  const findings = [];
  let checked = 0;
  for (const [path, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!path || pkg.link) continue;
    checked++;
    const name = pkg.name ?? path.split('node_modules/').at(-1);
    if (!isAllowedLicense(pkg.license) && !REVIEWED_EXCEPTIONS.some(pattern => pattern.test(name))) findings.push({
      path, name, version: pkg.version ?? '(unknown)', license: pkg.license ?? '(missing)',
    });
  }
  return { findings, checked };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/check-licenses.mjs [package-lock.json]');
    const { findings, checked } = await checkLicenses(process.argv[2]);
    if (findings.length) {
      console.error(`License check failed: ${findings.length} of ${checked} packages need review.`);
      for (const item of findings) console.error(`${item.name}@${item.version}: ${item.license} (${item.path})`);
      process.exitCode = 1;
    } else {
      if (!process.argv[2]) {
        const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
        for (const host of licenseHosts(lock)) await verifyThirdPartyLicenses(new URL(`../apps/${host}/public/`, import.meta.url), { host });
        console.log('Third-party outputs verified: every indexed notice and unique text is present.');
      }
      console.log(`License check passed: ${checked} packages (production and development).`);
    }
  } catch (error) {
    console.error(`License check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
