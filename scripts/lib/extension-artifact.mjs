import { EXTENSION_PUBLIC_KEY, RELEASE_API_ORIGIN, RELEASE_WEBSITE_ORIGIN } from '../../packages/shared/src/extension.ts';
import { extensionPagePolicy } from '../../packages/shared/src/extension-policy.ts';

export const extensionPermissions = ['sidePanel', 'storage', 'offscreen', 'idle', 'scripting', 'activeTab'];
/** The one shortcut: 截图, which hands the pressed tab to Palside through activeTab. */
export const extensionCommands = { capture: { suggested_key: { default: 'Alt+Shift+S' }, description: '__MSG_captureCommand__' } };
import { normalizeSiteHost } from '../../apps/extension/src/domain/assets/site-host.ts';
/** `websiteOrigin`: the one site allowed to message the extension; `apiOrigin`: the one service it connects to. Release builds pass the published origins. */
export function validateExtensionManifest(manifest, websiteOrigin = RELEASE_WEBSITE_ORIGIN, releaseBuild = process.env.PALSIDE_RELEASE_BUILD === 'true', apiOrigin = RELEASE_API_ORIGIN) {
  if (process.env.PALSIDE_RELEASE_BUILD !== undefined && process.env.PALSIDE_RELEASE_BUILD !== 'true') throw new Error('PALSIDE_RELEASE_BUILD must be true or unset');
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push('Manifest V3 required');
  if (manifest.side_panel?.default_path !== 'sidepanel.html') errors.push('Side panel entry missing');
  if (!manifest.background?.service_worker) errors.push('Service worker entry missing');
  if (!manifest.action || manifest.action.default_popup) errors.push('Action must open the side panel');
  if (JSON.stringify(manifest.commands ?? {}) !== JSON.stringify(extensionCommands)) errors.push('Only the 截图 keyboard command may be declared');
  if (JSON.stringify([...(manifest.permissions ?? [])].sort()) !== JSON.stringify([...extensionPermissions].sort())) errors.push('Unexpected permissions');
  if (releaseBuild ? 'key' in manifest : manifest.key !== EXTENSION_PUBLIC_KEY) errors.push(releaseBuild ? 'Store manifests must not contain a key; the store assigns the published ID' : 'Local manifests must pin the published extension ID through its key');
  if (manifest.host_permissions?.length) errors.push('Installation must not grant host permissions; the API is reached through CORS');
  if (JSON.stringify(manifest.optional_host_permissions ?? []) !== JSON.stringify(['<all_urls>'])) errors.push('Optional host permissions must be exactly <all_urls>');
  if (JSON.stringify(manifest.optional_permissions) !== JSON.stringify(['notifications', 'tabs', 'favicon', 'tabGroups'])) errors.push('Only notifications, tabs with favicon (共享在看) and tabGroups (跟看) may be optional');
  if (manifest.content_scripts?.length) errors.push('Unexpected public or automatic injection: content_scripts');
  if (manifest.web_accessible_resources?.length && JSON.stringify(manifest.web_accessible_resources) !== JSON.stringify([{ resources: ['signals/*'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true }])) errors.push('Only bundled signal artwork may be public, behind a per-session dynamic URL');
  if (JSON.stringify(manifest.externally_connectable) !== JSON.stringify({ matches: [`${websiteOrigin}/*`] })) errors.push('External messages must come only from the website, with no extension ids');
  const policy = manifest.content_security_policy?.extension_pages ?? '';
  if (policy !== extensionPagePolicy(apiOrigin)) errors.push('Extension pages must run only bundled scripts and crypto WebAssembly, and connect only to the API and registry logo hosts');
  return errors;
}

/**
 * 看盘批注's chart bridge: the one script that runs in a page's main world, where TradingView's API lives. The background loads it
 * into one top-frame document at a time, only where the page layer runs with signals on. It must use no extension API, hold no
 * squad data and reach no network: it reads chart geometry and dispatches it on the chart frame's element.
 */
export const chartBridgePolicy = { file: 'chart-bridge.js', world: 'MAIN' };
export function validateChartBridge(source) {
  const errors = [];
  if (typeof source !== 'string' || !source.length) return ['Missing chart-bridge.js build asset'];
  if (source.length > 24_000) errors.push('The chart bridge must stay small');
  for (const [pattern, reason] of [[/\bchrome\s*\.|\bbrowser\s*\.\s*runtime/, 'extension API'], [/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, 'network access'], [/postMessage|localStorage|sessionStorage|indexedDB|document\.cookie/, 'messaging or storage'], [/\beval\s*\(|new Function/, 'dynamic code']]) {
    if (pattern.test(source)) errors.push(`The chart bridge must not use ${reason}`);
  }
  return errors;
}

/** Any page layer requires site access; automatic registration covers exact granted hosts, or every site after Chrome's menu granted all. */
export const manualPageLayerPolicy = { protocols: ['http:', 'https:'], files: ['page-layer.js'], allFrames: false };
export function validatePageLayerRegistration(registration) {
  if (!registration) return [];
  const errors = [];
  const broad = JSON.stringify(registration.matches) === JSON.stringify(['http://*/*', 'https://*/*']);
  if (!broad && (!Array.isArray(registration.matches) || !registration.matches.length || registration.matches.some(pattern => {
    if (typeof pattern !== 'string') return true;
    const match = pattern.match(/^(?:https?|\*):\/\/([^/*]+)\/\*$/);
    return !match || normalizeSiteHost(match[1]) !== match[1];
  }))) errors.push('Automatic page-layer matches must name exact public hosts over HTTP/HTTPS, or every site');
  if (JSON.stringify(registration.js) !== JSON.stringify(manualPageLayerPolicy.files)) errors.push('Only the bundled page-layer script may be injected');
  if (registration.world !== undefined && registration.world !== 'ISOLATED') errors.push('Page-layer injection must use the isolated world');
  if (registration.allFrames || registration.matchOriginAsFallback) errors.push('Page-layer injection must stay in the matched top frame');
  if (registration.persistAcrossSessions !== false) errors.push('Automatic page layers must revalidate account and site policy after browser restart');
  return errors;
}
