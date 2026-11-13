import { parseCommand } from '../runtime/transport/command-map.ts';
import { MessageError,errorMessage,message as uiMessage,translator } from '@palside/i18n';
import type { Browser,browser as extensionBrowser } from 'wxt/browser';
import { createLanguageController } from '../runtime/transport/language.ts';
import { siteAllows, siteDraws, type InteractionFeature, pageScopeUrl } from '../domain/annotations/interaction.ts';
import type { CaptureLabels,PageLabels,PagePerson } from '../runtime/browser/page-protocol.ts';
import { pageTeam,pageUrlHost } from '../runtime/browser/page-layer-host.ts';
import type { Command } from '../runtime/transport/command-map';
import type { Reply } from '../runtime/transport/reply';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import type { createTabObserver } from '../runtime/browser/tab-observer.ts';
import type { SiteIcon } from '../domain/assets/site-icon.ts';
import { defaultAvatar,teamDefaultAvatars } from '@palside/shared/person-avatars';

export type Port = Browser.runtime.Port;
export type Tab = Browser.tabs.Tab;

/** What the worker runs on. Production passes the extension's `browser`; tests pass fakes and their own clock. */
export type BackgroundEnv = {
  browser: typeof extensionBrowser;
  websiteUrl: string;
  fetch?: typeof fetch;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  createTabObserver?: typeof createTabObserver;
  /** How an icon file becomes the kept icon; the default draws it on a canvas. */
  iconImage?: (blob: Blob) => Promise<SiteIcon | undefined>;
  openPage?: (url: string) => Promise<void>;
};

/** Shared worker state and the small helpers every part of the background uses. */
export function createContext(env: BackgroundEnv) {
  const { browser } = env;
  const fetcher = env.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // Timers are called as methods of the context; the worker globals reject any other receiver.
  const setTimer = env.setTimeout ?? setTimeout.bind(globalThis);
  const clearTimer = env.clearTimeout ?? clearTimeout.bind(globalThis);
  /** Side panels by port, with the window each one announced in `hello`. */
  const panels = new Map<Port, number | undefined>();
  let creating: Promise<void> | undefined;

  const language = createLanguageController(browser, value => {
    for (const port of panels.keys()) post(port, { type: 'language', state: value });
    void browser.action.setTitle({ title: translator(value.locale)('extension.host.open') }).catch(() => {});
  });

  /** Posts to a panel, forgetting it if it has gone. */
  function post(port: Port, message: unknown) {
    try { port.postMessage(message); return true; } catch { panels.delete(port); return false; }
  }

  async function ensureRuntime() {
    creating ??= (async () => {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType], documentUrls: [browser.runtime.getURL('/offscreen.html')] });
      if (!contexts.length) await browser.offscreen.createDocument({ url: '/offscreen.html', reasons: ['BLOBS' as Browser.offscreen.Reason], justification: 'Hosts Palside\'s single end-to-end encryption runtime: Matrix crypto (WebAssembly and its IndexedDB key store), local wallet signing, and decrypted image attachments served as Blob URLs to every open side panel.' });
    })().finally(() => { creating = undefined; });
    await creating;
  }

  async function dataUrl(body: { arrayBuffer(): Promise<ArrayBuffer> }, type: string) {
    let binary = '';
    for (const byte of new Uint8Array(await body.arrayBuffer())) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
  }
  const responseUrl = (response: Response) => dataUrl(response, response.headers.get('content-type') || 'image/png');

  /** Chrome's globe for sites it has no icon for, read once to tell it apart from a real icon. */
  const avatars = new Map<string, string>();
  const avatarLoads = new Map<string, Promise<string | undefined>>();
  let avatarEpoch = 0;
  let avatarAccount: string | undefined;
  // 弹幕 authors are mostly strangers: their portraits are cached apart from members', whose cache is pruned to the people list.
  const roomAvatars = new Map<string, Promise<string | undefined>>();
  function clearAvatarCache() { avatarEpoch++; avatars.clear(); avatarLoads.clear(); roomAvatars.clear(); avatarAccount = undefined; }
  async function roomAvatar(url: string) {
    const epoch = avatarEpoch;
    let work = roomAvatars.get(url);
    if (!work) {
      work = fetcher(url).then(response => response.ok ? responseUrl(response) : undefined).catch(() => undefined);
      roomAvatars.set(url, work);
      while (roomAvatars.size > 64) roomAvatars.delete(roomAvatars.keys().next().value!);
    }
    const avatar = await work;
    if (!avatar) roomAvatars.delete(url);
    return epoch === avatarEpoch ? avatar : undefined;
  }

  const ctx = {
    env, browser, panels, language, post,
    fetch: fetcher, setTimeout: setTimer, clearTimeout: clearTimer,
    state: undefined as RuntimeState | undefined,
    /** Bumped when which pages may run 网页互动 changes (rules, grants, team); queued work started under an older value stops. */
    policyVersion: 0,
    /** Bumped when every page session ends (account, team, origin revocation). */
    sessionVersion: 0,
    /** Bumped per tab on navigation or removal, so work bound to the old document stops. */
    tabVersions: new Map<number, number>(),

    ensureRuntime,
    async run(input: Command): Promise<Reply> {
      const command = parseCommand(input);
      await ensureRuntime();
      return browser.runtime.sendMessage({ target: 'palside/offscreen', command });
    },
    extensionPage(url: string | undefined, path: string) {
      try {
        const value = new URL(url!), root = new URL(browser.runtime.getURL('/'));
        return value.protocol === root.protocol && value.host === root.host && value.pathname === path;
      } catch { return false; }
    },
    async activeTab(windowId: number): Promise<Tab | undefined> {
      return (await browser.tabs.query({ active: true, windowId }))[0];
    },
    dataUrl,
    clearAvatarCache,
    /** A member as the page layer draws them: name plus avatar inlined, since pages cannot load extension or media URLs. */
    async pagePerson(id: string): Promise<PagePerson> {
      const account = ctx.state?.authenticated ? ctx.state.account?.id : undefined;
      if (avatarAccount !== account) { clearAvatarCache(); avatarAccount = account; }
      const person = ctx.state?.data.people.find(value => value.id === id);
      const name = person?.name || 'Member';
      if (!account) return { name };
      if (!person?.avatar) {
        // The same portrait the side panel shows: the open team's default, so two members there never share one.
        // A portrait is decoration: when it cannot be found the name goes alone, and the command that asked carries on.
        const avatar = await (async () => {
          const teamId = pageTeam(ctx.state), team = ctx.state?.remoteTeams.find(value => value.id === teamId);
          const path = (team?.memberIds && teamDefaultAvatars(team.memberIds).get(id)) ?? defaultAvatar(id);
          return path ? await roomAvatar(browser.runtime.getURL(path as '/')) : undefined;
        })().catch(() => undefined);
        return avatar ? { name, avatar } : { name };
      }
      const active = new Set(ctx.state?.data.people.map(value => value.avatar));
      for (const url of avatars.keys()) if (!active.has(url)) avatars.delete(url);
      const url = person.avatar, epoch = avatarEpoch;
      const valid = () => epoch === avatarEpoch && ctx.state?.authenticated && ctx.state.account?.id === account
        && ctx.state.data.people.some(value => value.id === id && value.avatar === url);
      let avatar = avatars.get(url);
      if (avatar) { avatars.delete(url); avatars.set(url, avatar); }
      else {
        let work = avatarLoads.get(url);
        if (!work) {
          work = fetcher(url).then(response => response.ok ? responseUrl(response) : undefined).catch(() => undefined);
          avatarLoads.set(url, work);
        }
        avatar = await work;
        if (avatarLoads.get(url) === work) avatarLoads.delete(url);
        if (!valid()) return { name };
        if (avatar) {
          avatars.set(url, avatar);
          while (avatars.size > 32) avatars.delete(avatars.keys().next().value!);
        }
      }
      return avatar && valid() ? { name, avatar } : { name };
    },
    /** A 弹幕 author as the page draws them: a teammate as a member; anyone else by nickname, with the room portrait or default avatar inlined. */
    async roomPagePerson(author: { id: string; nickname: string }): Promise<PagePerson & { mate: boolean }> {
      const state = ctx.state, self = state?.account?.id;
      const mate = author.id !== self && Boolean(state?.remoteTeams.some(team => team.joined && team.memberIds.includes(author.id)));
      const member = state?.data.people.find(value => value.id === author.id);
      // Someone the room has no name for goes out nameless; the page words them with its own 成员 label.
      const name = member?.name || author.nickname || '';
      if (member?.avatar) return { ...await ctx.pagePerson(author.id), mate };
      const path = defaultAvatar(author.id);
      const url = state?.rooms.avatars[author.id] ?? (path && browser.runtime.getURL(path as '/'));
      if (!url) return { name, mate };
      const avatar = await roomAvatar(url);
      return avatar ? { name, avatar, mate } : { name, mate };
    },
    /** Page-started commands have no panel request waiting on them, so a refusal goes to that window's panels. */
    notifyWindow(windowId: number, result: Reply) {
      if (result.ok) return;
      for (const [port, id] of panels) if (id === windowId) post(port, { type: 'error', message: result.text ?? errorMessage(result) });
    },
    /** The asking panel's window and its active tab; the panel must be connected for that window. */
    async panelTab(windowId: number, senderUrl: string) {
      const panel = [...panels].find(([port, id]) => id === windowId && port.sender?.url === senderUrl)?.[0];
      if (!Number.isInteger(windowId) || !panel) throw new MessageError(uiMessage('extension.runtime.reopenSidebar'));
      const tab = await ctx.activeTab(windowId);
      return panels.get(panel) === windowId ? { panel, tab } : undefined;
    },
    /** The current team is joined, so page work may run for it. */
    teamAvailable() {
      const state = ctx.state;
      return Boolean(state?.authenticated && state.remoteTeams.some(team => team.joined && team.id === state.preferences.current));
    },
    /** 网页互动 is on for the page's site with this feature on, from this account's preferences. */
    allows(feature: InteractionFeature, url: string | undefined) { return siteAllows(ctx.state?.preferences.siteInteraction, pageUrlHost(url), feature); },
    /**
     * 网页互动 runs on a page while it is on for its site, for the current joined team, in a window whose panel is open.
     * Chrome's grant for the site is checked where a page is injected or admitted.
     */
    interactivePage(info: { url?: string; windowId?: number }) {
      const state = ctx.state;
      return Boolean(state && siteDraws(state.preferences.siteInteraction, pageUrlHost(info.url)) && ctx.teamAvailable() && pageScopeUrl(info.url)
        && info.windowId !== undefined && [...panels.values()].includes(info.windowId));
    },
    async pageLabels(): Promise<PageLabels & { capture: CaptureLabels }> {
      const { locale } = await language.get(), t = translator(locale);
      const capture: CaptureLabels = {
        ...Object.fromEntries((['rectangle', 'arrow', 'pen', 'text', 'mosaic', 'undo', 'cancel', 'done'] as const).map(key => [key, t(`extension.capture.${key}`)])),
        copy: t('extension.copy.copy'), copied: t('extension.copy.copied'),
      } as CaptureLabels;
      return {
        packet: t('extension.wallet.packet'), packetFrom: t('extension.wallet.packetFrom', { name: '{name}' }), member: t('common.member'),
        you: t('extension.page.you'), mate: t('extension.room.mate'), capture, locale,
      };
    },
  };
  return ctx;
}

export type Context = ReturnType<typeof createContext>;
