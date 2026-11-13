import { DEVICE_IDLE_SECONDS } from '@palside/shared/rules/accounts';
import { errorMessage } from '@palside/i18n';
import { createPageOpener } from '../runtime/browser/open-page.ts';
import type { NotificationIdentity } from '../runtime/chat/notification-policy.ts';
import { createContext,type BackgroundEnv,type Context } from './context.ts';
import { capture } from './capture.ts';
import { commands } from './commands.ts';
import { danmaku } from './danmaku.ts';
import { follow,type FollowRequest } from './follow.ts';
import { images } from './images.ts';
import { locator } from './locate.ts';
import { notifications } from './notifications.ts';
import { pages } from './pages.ts';
import { panel } from './panel.ts';
import { panelWindows } from './panel-windows.ts';
import { sharing } from './sharing.ts';
import { roomTab } from './room-tab.ts';
import { signals } from './signals.ts';
import { siteIcons } from './site-icons.ts';
import { siteRevoke } from './site-revoke.ts';
import { stateSync } from './state.ts';
import { refs } from './refs.ts';
import { updates } from './update.ts';

export type { BackgroundEnv } from './context.ts';

/** The worker's parts. Each part reaches the others through `bg.<part>`; members resolve lazily, so parts may depend on each other. */
export interface Parts {
  images: ReturnType<typeof images>;
  capture: ReturnType<typeof capture>;
  pages: ReturnType<typeof pages>;
  refs: ReturnType<typeof refs>;
  locator: ReturnType<typeof locator>;
  danmaku: ReturnType<typeof danmaku>;
  follow: ReturnType<typeof follow>;
  signals: ReturnType<typeof signals>;
  siteIcons: ReturnType<typeof siteIcons>;
  siteRevoke: ReturnType<typeof siteRevoke>;
  sharing: ReturnType<typeof sharing>;
  roomTab: ReturnType<typeof roomTab>;
  notifications: ReturnType<typeof notifications>;
  sync: ReturnType<typeof stateSync>;
  panel: ReturnType<typeof panel>;
  panelWindows: ReturnType<typeof panelWindows>;
  commands: ReturnType<typeof commands>;
  updates: ReturnType<typeof updates>;
}
export type Background = Context & Parts & { openPage: (url: string) => Promise<void> };

/** Starts the MV3 service worker: builds the parts, then registers every browser listener synchronously. */
export function startBackground(env: BackgroundEnv) {
  const { browser } = env;
  const bg = createContext(env) as Background;
  bg.openPage = env.openPage ?? createPageOpener(browser);
  bg.panelWindows = panelWindows(bg);
  bg.images = images(bg);
  bg.capture = capture(bg);
  bg.pages = pages(bg);
  bg.refs = refs(bg);
  bg.locator = locator(bg);
  bg.danmaku = danmaku(bg);
  bg.follow = follow(bg);
  bg.signals = signals(bg);
  bg.siteIcons = siteIcons(bg, bg.env.iconImage);
  bg.siteRevoke = siteRevoke(bg);
  bg.sharing = sharing(bg);
  bg.roomTab = roomTab(bg);
  bg.notifications = notifications(bg);
  bg.sync = stateSync(bg);
  bg.panel = panel(bg);
  bg.commands = commands(bg);
  bg.updates = updates(bg);

  // Toolbar icon: open the panel ourselves, so the clicked tab gets activeTab.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  browser.action.onClicked.addListener(tab => {
    bg.capture.grantActiveTab(tab);
    void bg.pages.pushPageStatus();
    if (!tab.incognito) void browser.sidePanel.open({ windowId: tab.windowId }).then(() => bg.sharing.observer.refresh(true)).catch(() => {});
  });

  // 截图 shortcut: the key press hands the tab to Palside (activeTab) and starts the page editor.
  browser.commands.onCommand.addListener((name, tab) => { if (name === 'capture') bg.capture.shortcut(tab); });

  browser.runtime.onInstalled.addListener(details => {
    // An update reloaded the extension: the runtime comes back at once, so notifications and 网页互动 carry on as before.
    if (details.reason === 'update') { void bg.ensureRuntime().catch(() => {}); return; }
    if (details.reason !== 'install') return;
    void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') }).catch(() => {});
  });
  // Chrome downloaded a newer version; the worker decides when it applies (background/update.ts).
  browser.runtime.onUpdateAvailable.addListener(details => bg.updates.available(details.version));

  // The website asks to open an invitation or a team page in the panel.
  browser.runtime.onMessageExternal.addListener((message, sender, respond) => {
    if (!sender.url || new URL(sender.url).origin !== new URL(env.websiteUrl).origin) return;
    const command = message?.type === 'palside/invite' && /^[A-Za-z0-9_-]{32}$/.test(message.code) ? { name: 'external-invite' as const, payload: { code: message.code } }
      : message?.type === 'palside/team' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.id) ? { name: 'external-team' as const, payload: { id: message.id } } : undefined;
    if (!command) { respond({ present: true, accepted: false, opened: false }); return; }
    // sidePanel.open needs the page click's user activation, which ends at the first await.
    const opened = sender.tab?.windowId !== undefined && !sender.tab.incognito
      ? browser.sidePanel.open({ windowId: sender.tab.windowId }).then(() => true, () => false) : Promise.resolve(false);
    let answered = false;
    const receipt = (shown: boolean) => {
      if (answered) return;
      answered = true;
      bg.clearTimeout(timer);
      respond({ present: true, accepted: true, opened: shown });
    };
    const timer = bg.setTimeout(() => receipt(false), 250);
    void opened.then(receipt);
    void bg.run(command).catch(error => ({ ok: false as const, message: 'Action failed', text: errorMessage(error) })).then(async result => {
      if (result.ok) return;
      // Runtime notices survive a panel connecting after the command finishes.
      const notice = await bg.run({ name: 'host-notice', payload: { message: result.text ?? errorMessage(result) } }).catch(() => undefined);
      if (!notice?.ok && sender.tab?.windowId !== undefined) bg.notifyWindow(sender.tab.windowId, result);
    });
    return true;
  });

  browser.runtime.onConnect.addListener(port => {
    if (port.name === 'palside/page') bg.pages.connectPage(port);
    else if (port.name === 'palside/panel') bg.panel.connectPanel(port);
    else if (port.name === 'palside/image') bg.images.connectImage(port);
  });

  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return;
    const fromPanel = bg.extensionPage(sender.url, '/sidepanel.html') && !sender.tab;
    const fromOffscreen = bg.extensionPage(sender.url, '/offscreen.html') && !sender.tab;
    const answer = (work: Promise<unknown>, fail: (error: unknown) => unknown) => { void work.then(respond, error => respond(fail(error))); return true; };
    const failed = (error: unknown) => ({ ok: false, message: 'Action failed', code: (error as { code?: string })?.code, text: errorMessage(error) });

    // The image window, and the panel's image commands.
    if (bg.extensionPage(sender.url, '/image.html') || fromPanel && String(message.command?.name).startsWith('image-session-')) {
      if (message.type !== 'palside/command') return;
      return answer(bg.images.imageCommand(message.command?.name, message.command?.payload ?? {}, sender).then(value => ({ ok: true, value })),
        error => ({ ok: false, message: 'Action failed', code: (error as { code?: string })?.code, text: bg.images.imageFailure(error) }));
    }
    if (fromOffscreen) {
      switch (message.type) {
        case 'palside/account-cleanup':
          if (typeof message.accountId !== 'string' || !message.accountId) return;
          return answer(Promise.all([
            bg.notifications.clearAccount(message.accountId),
            ...(message.preservePreferences === true ? [] : [bg.signals.clearAccount(message.accountId)]),
          ]).then(() => ({ ok: true })), failed);
        case 'palside/runtime-ready': bg.sync.runtimeReady(message.epoch); return;
        case 'palside/runtime-error':
          for (const port of bg.panels.keys()) bg.post(port, { type: 'error', message: message.message });
          return;
        case 'palside/state-patch': bg.sync.acceptPatch(message.patch); return;
        case 'palside/notify': void bg.notifications.notify((message.payload ?? {}) as NotificationIdentity).catch(() => {}); return;
        case 'palside/signal-current': return answer(bg.signals.signalCurrent(message.token).then(ok => ({ ok })), () => ({ ok: false }));
        case 'palside/foreground': return answer(bg.sharing.sharedPageVisible(message.url).then(visible => ({ visible })), () => ({ visible: false }));
      }
      return;
    }
    if (!fromPanel) return;
    if (message.type === 'palside/command') return answer(bg.commands.panelCommand(message.command ?? {}, sender.url!, sender.documentId), failed);
    if (message.type === 'palside/open') return answer(bg.openPage(String(message.url)).then(value => ({ ok: true, value })), failed);
    if (message.type === 'palside/follow' && Number.isInteger(message.windowId)) return answer(bg.follow.request(message.windowId, readFollow(message.request)).then(() => ({ ok: true })), failed);
  });

  bg.notifications.listenNotifications();
  browser.permissions.onAdded.addListener(added => {
    bg.notifications.listenNotifications();
    bg.pages.syncPermissions(Boolean(added.origins?.length));
    if (added.origins?.length) { void bg.roomTab.refresh(); void bg.siteIcons.added(added.origins).then(() => bg.sharing.observer.refresh()); }
  });
  browser.permissions.onRemoved.addListener(removed => {
    // Revoke page sessions synchronously, before any queued permission reads can finish.
    if (removed.origins?.length) bg.pages.clearPages();
    // 共享在看 cannot run without 读取您的浏览记录: switch it off and say why.
    if (removed.permissions?.includes('tabs') && bg.state?.preferences.share) void bg.run({ name: 'toggle', payload: { share: false, revoked: true } }).catch(() => {});
    bg.pages.syncPermissions(Boolean(removed.origins?.length));
    // 弹幕 follows a tab's token only on an added site.
    if (removed.origins?.length) { void bg.roomTab.refresh(); void bg.siteIcons.prune(); bg.siteRevoke.removed(removed.origins); }
  });

  browser.windows.onRemoved.addListener(windowId => { void bg.roomTab.refresh(); bg.capture.discardCapture(windowId); bg.images.imageWindowClosed(windowId); });
  // Focus on another app or a window without a panel keeps the current panel window, its shared page and its 弹幕.
  browser.windows.onFocusChanged.addListener(windowId => {
    bg.panelWindows.focused(windowId);
    void bg.roomTab.refresh();
    void bg.sharing.observer.refresh(windowId !== browser.windows.WINDOW_ID_NONE);
  });
  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    void browser.tabs.get(tabId).then(tab => bg.siteIcons.tab(tab)).catch(() => {});
    void bg.roomTab.refresh();
    bg.capture.discardCapture(windowId);
    bg.signals.signalActivity();
    void bg.follow.routeLead().catch(() => {});
    void bg.sharing.observer.refresh(true);
    void bg.pages.pushPageStatus();
    void bg.pages.restoreActivePage(windowId).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'loading') bg.capture.invalidateActiveTab(tabId, change.url ?? tab.url);
    // `loading` alone may be a same-document history change; a capture's connected page reports its own end by disconnecting.
    const capture = bg.capture.captures.get(tab.windowId);
    if ((change.url !== undefined || change.status === 'loading' && !capture?.page) && (capture?.tabId === tabId || tab.active)) bg.capture.discardCapture(tab.windowId);
    bg.pages.tabNavigated(tabId, change, tab);
    bg.follow.tabNavigated(tabId, change, tab);
    // Chrome has a page's icon only late in its first load, long after its title: teammates get it the moment it is kept.
    if (change.favIconUrl || change.status === 'complete') void bg.siteIcons.tab(tab).finally(() => { if (tab.active && [...bg.panels.values()].includes(tab.windowId)) void bg.sharing.observer.refresh(); });
    if (tab.active) void bg.roomTab.refresh();
    if (tab.active && [...bg.panels.values()].includes(tab.windowId) && (change.url || change.status || change.title)) void bg.sharing.observer.refresh();
  });
  browser.tabs.onRemoved.addListener((tabId, { windowId }) => {
    bg.capture.invalidateActiveTab(tabId);
    if (bg.capture.captures.get(windowId)?.tabId === tabId) bg.capture.discardCapture(windowId);
    bg.pages.tabClosed(tabId);
    bg.follow.tabClosed(tabId);
    void bg.roomTab.refresh();
    void bg.sharing.observer.refresh();
  });

  // 活跃 lasts five minutes after the last input; onStateChanged follows the same interval and reports a locked screen as 离开.
  browser.idle.onStateChanged.addListener(value => {
    // Idle keeps the shared page (quietly reading a chart is still watching); a locked screen ends it.
    bg.sharing.updateDeviceState(value); void bg.sharing.observer.refresh(value === 'active');
    // A locked screen forgets the wallet's unlocked signing key; the next payment asks for the password.
    if (value === 'locked' && bg.state?.authenticated) void bg.run({ name: 'wallet-lock', payload: {} }).catch(() => {});
  });
  browser.idle.setDetectionInterval(DEVICE_IDLE_SECONDS);
  void browser.idle.queryState(DEVICE_IDLE_SECONDS).then(value => bg.sharing.updateDeviceState(value)).catch(() => {});
  void bg.pages.registerPageLayer().catch(() => {});
  // A site revoked while the worker slept leaves its icon behind.
  void bg.siteIcons.prune().catch(() => {});
  return bg;
}

/** A panel's 跟看 request, checked field by field. */
function readFollow(value: unknown): FollowRequest {
  const request = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const url = typeof request.url === 'string' && request.url.length <= 4096 ? request.url : undefined;
  const name = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
  const teamId = name(request.teamId), personId = name(request.personId);
  const title = name(request.title);
  if (request.op === 'go' && url) return { op: 'go', url, start: request.start === true, ...(teamId && personId ? { teamId, personId } : {}), ...(title ? { title } : {}) };
  if (request.op === 'pause') return { op: 'pause' };
  if (request.op === 'resume') return url ? { op: 'resume', url } : { op: 'resume' };
  return { op: 'stop' };
}
