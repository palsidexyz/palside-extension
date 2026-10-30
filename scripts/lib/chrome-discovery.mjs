import { constants } from 'node:fs';
import { access, glob, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export async function chromeCandidates({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const names = platform === 'win32' ? ['chrome.exe', 'chromium.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const installs = platform === 'darwin' ? ['/Applications', join(home, 'Applications')].flatMap(base => [
    join(base, 'Google Chrome.app/Contents/MacOS/Google Chrome'), join(base, 'Chromium.app/Contents/MacOS/Chromium'),
  ]) : platform === 'win32' ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
    join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Chromium/Application/chrome.exe'),
  ]) : ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  const cache = platform === 'darwin' ? join(home, 'Library/Caches/ms-playwright')
    : platform === 'win32' ? join(env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'ms-playwright')
    : join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright');
  const caches = [...new Set([env.PLAYWRIGHT_BROWSERS_PATH, cache].filter(path => path && path !== '0'))];
  const patterns = platform === 'darwin' ? ['chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium', 'chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']
    : platform === 'win32' ? ['chromium-*/chrome-win*/chrome.exe'] : ['chromium-*/chrome-linux*/chrome'];
  const cached = [];
  for (const cwd of caches) {
    for await (const path of glob(patterns, { cwd })) cached.push(resolve(cwd, path));
  }
  return [...new Set([...installs, ...(env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean).flatMap(directory => names.map(name => resolve(directory, name))), ...cached.sort()])];
}

export async function chromePath({ chrome, env = process.env, ...options } = {}) {
  const explicit = chrome ?? (env.CHROME_PATH || undefined);
  if (explicit !== undefined && (typeof explicit !== 'string' || !explicit.trim())) throw new Error('Selected Chrome path must be a non-empty string. Set CHROME_PATH or use --chrome <path>.');
  const candidates = explicit ? [resolve(explicit)] : await chromeCandidates({ env, ...options });
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) { if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  }
  throw new Error(explicit ? 'Selected Chrome executable is missing or not executable. Set CHROME_PATH or use --chrome <path>.' : 'Chrome or Chromium was not found in common installs, PATH or Playwright caches. Set CHROME_PATH or use --chrome <path>.');
}

export function chromeArgument(args) {
  if (!args.length) return undefined;
  if (args.length === 2 && args[0] === '--chrome' && args[1]) return args[1];
  throw new Error('Usage: node scripts/verify-draft-recovery.mjs [--chrome <path>] (or set CHROME_PATH).');
}
