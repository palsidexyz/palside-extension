/** Test-only Vite server for `apps/extension/integration`. Never a replacement for native Chrome extension acceptance. */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import { bounded } from './headless-chrome.mjs';

const extension = new URL('../../apps/extension/', import.meta.url);
export const reviewRoot = fileURLToPath(new URL('integration', extension));

// Every page except the live-services harness (`index.html`) runs on fixtures and gets the service guard first.
const reviewPages = {
  name: 'palside-review-pages',
  transformIndexHtml: (_html, { path }) => [
    { tag: 'link', attrs: { rel: 'icon', href: 'data:,' }, injectTo: 'head-prepend' },
    ...(path === '/index.html' ? [] : [{ tag: 'script', attrs: { type: 'module', src: '/review-harness.ts' }, injectTo: 'head-prepend' }]),
  ],
};

export async function startReviewServer({ port = 0, logLevel = 'info' } = {}) {
  const { createServer } = await import(pathToFileURL(createRequire(new URL('package.json', extension)).resolve('vite')).href);
  // 关于 reads the version from the manifest, which these plain pages do not have.
  const { version } = JSON.parse(await readFile(new URL('package.json', extension), 'utf8'));
  const server = await createServer({
    // Multi-page: a missing file is a 404, never the HTML fallback, so broken asset references surface as errors.
    root: reviewRoot, appType: 'mpa', configFile: false, logLevel, plugins: [reviewPages],
    define: { __PALSIDE_VERSION__: JSON.stringify(version) },
    server: { host: '127.0.0.1', port, strictPort: port !== 0, fs: { allow: [fileURLToPath(new URL('../..', extension))] } },
    publicDir: '../public',
    css: { postcss: { plugins: [tailwindcss()] } },
  });
  try {
    await server.listen();
    return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
  } catch (error) {
    try { await bounded(server.close(), 'review server shutdown'); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Review server startup and cleanup failed'); }
    throw error;
  }
}
