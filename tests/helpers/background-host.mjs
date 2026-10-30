import { createPatchSliceCache, diffState } from '../../apps/extension/src/runtime/transport/state-diff.ts';
import { startBackground } from '../../apps/extension/src/background/index.ts';

// Chrome reports a site pattern as contained when a broader granted pattern covers it.
function covers(granted, origin) {
  if (granted === origin || granted === '<all_urls>' || granted === '*://*/*') return true;
  const [grantScheme, grantHost] = granted.split('://'), [scheme, host] = origin.split('://');
  return grantScheme === '*' && /^https?$/.test(scheme) && grantHost === host;
}

// Fill the Chrome APIs a fixture leaves out. Origin grants are separate from the
// notification permission, so granting notifications never enables injection.
export function addBackgroundHost(browser, { origins = [] } = {}) {
  const grantedOrigins = new Set(origins);
  const calls = { register: [], unregister: [] };
  const registrations = new Map();
  browser.storage ??= {};
  browser.storage.local ??= { get: async () => ({}), set: async () => {} };
  browser.i18n ??= { getAcceptLanguages: async () => ['en'], getUILanguage: () => 'en' };
  browser.action ??= {};
  browser.action.onClicked ??= { addListener() {} };
  browser.action.setTitle ??= async () => {};
  browser.commands ??= {};
  browser.commands.onCommand ??= { addListener() {} };
  browser.tabs.get ??= async id => {
    const tab = (await browser.tabs.query({})).find(value => value.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}`);
    return tab;
  };
  browser.windows.getLastFocused ??= async () => ({ id: (await browser.tabs.query({ active: true }))[0]?.windowId, focused: true });
  browser.idle ??= {};
  browser.idle.setDetectionInterval ??= () => {};
  browser.scripting ??= {};
  browser.scripting.registerContentScripts ??= async scripts => {
    calls.register.push(scripts);
    for (const script of scripts) registrations.set(script.id, script);
  };
  browser.scripting.unregisterContentScripts ??= async ({ ids } = {}) => {
    calls.unregister.push({ ids });
    if (ids) for (const id of ids) registrations.delete(id);
    else registrations.clear();
  };
  browser.scripting.getRegisteredContentScripts ??= async ({ ids } = {}) => [...registrations.values()].filter(script => !ids || ids.includes(script.id));
  browser.permissions.getAll ??= async () => ({ origins: [...grantedOrigins], permissions: [] });
  const contains = browser.permissions.contains.bind(browser.permissions);
  browser.permissions.contains = async ({ origins: requestedOrigins = [], permissions = [] } = {}) => {
    if (!requestedOrigins.every(origin => [...grantedOrigins].some(granted => covers(granted, origin)))) return false;
    return permissions.length ? contains({ permissions }) : true;
  };
  return { calls, grantedOrigins };
}

/** Starts the real worker on a fake `browser`. The observer is inert unless a test passes its own. */
export function startWorker(browser, env = {}) {
  return startBackground({
    browser,
    websiteUrl: 'http://localhost:3000',
    createTabObserver: () => ({ refresh: async () => {}, metadataChanged() {}, dispose() {} }),
    openPage: async () => {},
    ...env,
  });
}

/** Delivers JSON patches through the offscreen message boundary. */
export function stateSender(browser, sender = { id: browser.runtime.id, url: browser.runtime.getURL('/offscreen.html') }) {
  const cache = createPatchSliceCache();
  let previous;
  return state => {
    const next = { items: { stickies: [] }, drafts: {}, ...state, revision: (previous?.revision ?? 0) + 1 };
    const patch = JSON.parse(JSON.stringify(diffState(previous, next, cache)));
    previous = next;
    browser.runtime.onMessage.emit({ type: 'palside/state-patch', patch }, sender, () => {});
    return patch;
  };
}
