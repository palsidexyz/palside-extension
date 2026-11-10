import { DAY_MS, SECOND_MS } from '@palside/shared/units';
import { siteByDomain } from '@palside/shared/sites';
import { grantedHost } from '../runtime/browser/permissions.ts';
import { pageUrlHost } from '../runtime/browser/page-layer-host.ts';
import { iconCandidates, iconPlate, readSiteIcon, SITE_ICON_HEAD, SITE_ICON_LENGTH, SITE_ICON_SIZE, type SiteIcon } from '../domain/assets/site-icon.ts';
import type { Background } from './index.ts';
import type { Port, Tab } from './context.ts';

const STORAGE_KEY = 'palside:site-icons';
/** The largest image file read for an icon. */
const ICON_BYTES = 1_048_576;
const TIMEOUT_MS = 8 * SECOND_MS;
/** A tab's icon replaces the stored one at most this often, unless it changed. */
const TAB_REFRESH_MS = DAY_MS;
/** Icons read from Chrome's own favicon cache, for sites that were never added: marked so revoking a grant keeps them. */
const CHROME = 'chrome';
/** At most this many such icons are kept; the least recently refreshed go first. */
const CHROME_LIMIT = 200;

/** The largest icon a shared page carries, the limit its receivers accept. */
const SHARED_ICON_LENGTH = 8192;

type Stored = SiteIcon & { at: number; from?: string };
export type IconImage = (blob: Blob) => Promise<SiteIcon | undefined>;

function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Draws an image file into the 64px icon, contained and centred, with its plate; an SVG is kept as it is when small. */
export const rasterizeIcon: IconImage = async blob => {
  if (!blob.size || blob.size > ICON_BYTES) return;
  const head = await blob.slice(0, 256).text();
  if (/svg/i.test(blob.type) || /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    const text = await blob.text();
    if (/<script|<foreignObject|\son[a-z]+\s*=/i.test(text)) return;
    const src = `data:image/svg+xml;base64,${base64(new TextEncoder().encode(text))}`;
    return src.length <= SITE_ICON_LENGTH ? { src } : undefined;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 2 || bitmap.height < 2) return;
    const scale = Math.min(SITE_ICON_SIZE / bitmap.width, SITE_ICON_SIZE / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(SITE_ICON_SIZE, SITE_ICON_SIZE);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (SITE_ICON_SIZE - width) / 2, (SITE_ICON_SIZE - height) / 2, width, height);
    const pixels = context.getImageData(0, 0, SITE_ICON_SIZE, SITE_ICON_SIZE).data;
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) return;
    const plate = iconPlate(pixels);
    let image = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    if (image.type !== 'image/webp') image = await canvas.convertToBlob({ type: 'image/png' });
    const src = `data:${image.type};base64,${base64(new Uint8Array(await image.arrayBuffer()))}`;
    return src.length <= SITE_ICON_LENGTH ? plate ? { src, plate } : { src } : undefined;
  } finally { bitmap.close(); }
};

/**
 * Icons of sites outside the catalog, kept on this device in `storage.local`, so every view of a site shows the same logo; the
 * page a person shares carries this same icon in the encrypted 共享在看 message, so teammates fetch nothing from the site. An added site's icon is taken when Chrome grants it — one request to that site for its homepage and the icon
 * it declares, without cookies — and refreshed from the tab's own icon. Any other site's icon comes from Chrome's favicon cache
 * (the optional icon permission of 共享在看) when its tab is open; Chrome's default globe is never kept. Removing an added site drops
 * its fetched icon; 清除本地数据 drops all.
 */
export function siteIcons(bg: Background, image: IconImage = rasterizeIcon) {
  let icons: Record<string, Stored> = {};
  const loaded = bg.browser.storage.local.get([STORAGE_KEY]).then(value => {
    const stored = value[STORAGE_KEY];
    if (!stored || typeof stored !== 'object') return;
    for (const [host, entry] of Object.entries(stored as Record<string, unknown>)) {
      const icon = readSiteIcon(entry), at = (entry as { at?: unknown }).at, from = (entry as { from?: unknown }).from;
      if (icon && typeof at === 'number') icons[host] = { ...icon, at, ...(typeof from === 'string' ? { from } : {}) };
    }
  }).catch(() => {});
  let writes: Promise<unknown> = loaded;
  const loading = new Map<string, Promise<void>>();
  /** Reads of Chrome's own favicon cache, kept apart from site downloads: a read is local and quick, so a page's status may wait for
   *  it, never for a download from the site. */
  const reading = new Map<string, Promise<void>>();
  /** Bumped by 清除本地数据 and revocation, so a load that started before stops. */
  let epoch = 0;

  const custom = (host: string | undefined): host is string => Boolean(host && !siteByDomain(host));
  async function grantedHosts() {
    return new Set(((await bg.browser.permissions.getAll()).origins ?? []).map(grantedHost).filter(custom));
  }
  function view() {
    return Object.fromEntries(Object.entries(icons).map(([host, { src, plate }]) => [host, plate ? { src, plate } : { src }]));
  }
  function send(port: Port) { void loaded.then(() => { if (bg.panels.has(port)) bg.post(port, { type: 'site-icons', icons: view() }); }); }
  function change(update: (icons: Record<string, Stored>) => Record<string, Stored>) {
    const saved = writes.then(async () => {
      const next = update({ ...icons });
      if (JSON.stringify(next) === JSON.stringify(icons)) return;
      if (Object.keys(next).length) await bg.browser.storage.local.set({ [STORAGE_KEY]: next });
      else await bg.browser.storage.local.remove(STORAGE_KEY);
      icons = next;
      for (const port of bg.panels.keys()) send(port);
    });
    writes = saved.catch(() => {});
    return saved;
  }

  async function get(url: string) {
    const response = await bg.fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return response;
  }
  async function head(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < SITE_ICON_HEAD) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(text)) break;
    }
    void reader.cancel().catch(() => {});
    return text;
  }
  /** Chrome's cached icon for a page, unless it is Chrome's default globe or the icon permission is missing. */
  let globe: Promise<string | undefined> | undefined;
  async function fromChrome(url: string) {
    if (!await bg.browser.permissions.contains({ permissions: ['favicon'] }).catch(() => false)) return;
    const bytes = async (pageUrl: string) => {
      const response = await bg.fetch(bg.browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64` as '/'));
      if (!response.ok) return;
      const blob = await response.blob();
      return { blob, key: base64(new Uint8Array(await blob.arrayBuffer())) };
    };
    globe ??= bytes('https://palside.invalid/').then(value => value?.key, () => { globe = undefined; return undefined; });
    const [icon, fallback] = await Promise.all([bytes(url), globe]);
    if (!icon || !fallback || icon.key === fallback) return;
    return image(icon.blob);
  }
  async function fromUrl(url: string) {
    const response = await get(url);
    if (Number(response.headers.get('content-length')) > ICON_BYTES) return;
    return image(await response.blob());
  }
  async function fromSite(host: string) {
    const base = `https://${host}/`;
    let candidates = [new URL('/favicon.ico', base).href];
    try {
      const page = await get(base);
      if (/html/i.test(page.headers.get('content-type') ?? '')) candidates = iconCandidates(await head(page), page.url || base);
      else void page.body?.cancel().catch(() => {});
    } catch { /* the homepage failed; its favicon may still load */ }
    for (const url of candidates.slice(0, 4)) {
      try { const icon = await fromUrl(url); if (icon) return icon; } catch { /* next candidate */ }
    }
  }
  function store(host: string, icon: SiteIcon, from?: string) {
    return change(next => ({ ...next, [host]: { ...icon, at: Date.now(), ...(from ? { from } : {}) } }));
  }

  /** Loads a newly allowed site's icon once; a site that already has one keeps it. */
  function fetchIcon(host: string) {
    const running = loading.get(host);
    if (running) return running;
    const started = epoch;
    const work = (async () => {
      await loaded;
      if (icons[host] || !(await grantedHosts()).has(host)) return;
      const icon = await fromSite(host);
      if (icon && started === epoch && (await grantedHosts()).has(host)) await store(host, icon);
    })().catch(() => {}).finally(() => loading.delete(host));
    loading.set(host, work);
    return work;
  }
  /** Keeps Chrome's cached icon of a site; the oldest of these go past the limit. A download from the site that lands later wins. */
  function takeFromChrome(host: string, url: string) {
    const running = reading.get(host);
    if (running) return running;
    const started = epoch;
    const work = (async () => {
      const icon = await fromChrome(url).catch(() => undefined);
      if (!icon || started !== epoch || (icons[host] && icons[host].from !== CHROME)) return;
      await change(next => {
        const all = { ...next, [host]: { ...icon, at: Date.now(), from: CHROME } };
        const chrome = Object.entries(all).filter(([, entry]) => entry.from === CHROME).sort(([, a], [, b]) => a.at - b.at);
        for (const [old] of chrome.slice(0, Math.max(0, chrome.length - CHROME_LIMIT))) delete all[old];
        return all;
      });
    })().catch(() => {}).finally(() => { if (reading.get(host) === work) reading.delete(host); });
    reading.set(host, work);
    return work;
  }
  /** Keeps only the icons of sites Chrome still allows one by one. */
  async function prune() {
    await loaded;
    const granted = await grantedHosts();
    const kept = (host: string) => granted.has(host) || icons[host]?.from === CHROME;
    if (Object.keys(icons).some(host => !kept(host))) { epoch++; await change(next => Object.fromEntries(Object.entries(next).filter(([host, entry]) => granted.has(host) || entry.from === CHROME))); }
  }

  return {
    ready: loaded, send, fetchIcon, prune,
    /** Chrome granted origins: take the icon of every new non-catalog site among them. */
    added(origins: readonly string[] | undefined) {
      return Promise.all([...new Set((origins ?? []).map(grantedHost).filter(custom))].map(fetchIcon));
    },
    /** The open tab of a non-catalog site shows its icon: keep it when it changed or the stored one is a day old. A site that was
     *  never added takes Chrome's cached icon instead (its own address cannot be read without the site's grant). */
    async tab(tab: Tab) {
      const host = pageUrlHost(tab.url), from = tab.favIconUrl;
      if (!custom(host) || tab.incognito) return;
      await loaded;
      const stored = icons[host];
      if (!(await grantedHosts()).has(host)) {
        if (stored && Date.now() - stored.at < TAB_REFRESH_MS) return;
        return takeFromChrome(host, tab.url!);
      }
      if (!from || !/^(?:https:|data:image\/)/.test(from) || from.length > ICON_BYTES) return;
      if (stored?.from === from && Date.now() - stored.at < TAB_REFRESH_MS) return;
      if (loading.has(host)) return;
      const started = epoch;
      const work = (async () => {
        const icon = await fromUrl(from).catch(() => undefined);
        if (icon && started === epoch && (await grantedHosts()).has(host)) await store(host, icon, from);
        // A first visit after a failed or cleared load: try the site itself.
        else if (!icon && !icons[host] && started === epoch) { loading.delete(host); await fetchIcon(host); }
      })().catch(() => {}).finally(() => { if (loading.get(host) === work) loading.delete(host); });
      loading.set(host, work);
      await work;
    },
    /** The icon a shared page carries: the one this device shows for the site. A catalog site has none, everyone has its artwork. */
    async shareable(url: string) {
      const host = pageUrlHost(url);
      if (!custom(host)) return;
      await loaded;
      if (!icons[host]) await takeFromChrome(host, url);
      const src = icons[host]?.src;
      return src && src.length <= SHARED_ICON_LENGTH ? src : undefined;
    },
    /** 清除本地数据: every icon goes; an allowed site takes its icon again the next time it is open. */
    clear() { epoch++; return change(() => ({})); },
  };
}
