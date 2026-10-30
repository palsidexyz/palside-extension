import { errorMessage } from '@palside/i18n';
import { createPageOpener } from '../runtime/browser/open-page.ts';
import type { NotificationIdentity } from '../runtime/chat/notification-policy.ts';
import { createContext,type BackgroundEnv,type Context } from './context.ts';
import { capture } from './capture.ts';
import { commands } from './commands.ts';
import { danmaku } from './danmaku.ts';
import { images } from './images.ts';
import { notifications } from './notifications.ts';
import { pages } from './pages.ts';
import { panel } from './panel.ts';
import { selection } from './selection.ts';
import { sharing } from './sharing.ts';
import { roomTab } from './room-tab.ts';
import { signals } from './signals.ts';
import { stateSync } from './state.ts';
import { stickies } from './stickies.ts';

export type { BackgroundEnv } from './context.ts';

/** The worker's parts. Each part reaches the others through `bg.<part>`; members resolve lazily, so parts may depend on each other. */
export interface Parts {
  images: ReturnType<typeof images>;
  capture: ReturnType<typeof capture>;
  pages: ReturnType<typeof pages>;
  selection: ReturnType<typeof selection>;
  stickies: ReturnType<typeof stickies>;
  danmaku: ReturnType<typeof danmaku>;
  signals: ReturnType<typeof signals>;
  sharing: ReturnType<typeof sharing>;
  roomTab: ReturnType<typeof roomTab>;
  notifications: ReturnType<typeof notifications>;
  sync: ReturnType<typeof stateSync>;
  panel: ReturnType<typeof panel>;
  commands: ReturnType<typeof commands>;
}
export type Background = Context & Parts & { openPage: (url: string, reuse?: boolean) => Promise<void> };

/** Starts the MV3 service worker: builds the parts, then registers every browser listener synchronously. */
export function startBackground(env: BackgroundEnv) {
  const { browser } = env;
  const bg = createContext(env) as Background;
  bg.openPage = env.openPage ?? createPageOpener(browser);
  bg.images = images(bg);
  bg.capture = capture(bg);
  bg.pages = pages(bg);
  bg.selection = selection(bg);
  bg.stickies = stickies(bg);
  bg.danmaku = danmaku(bg);
  bg.signals = signals(bg);
  bg.sharing = sharing(bg);
  bg.roomTab = roomTab(bg);
  bg.notifications = notifications(bg);
  bg.sync = stateSync(bg);
  bg.panel = panel(bg);
  bg.commands = commands(bg);

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
    if (details.reason !== 'install') return;
    void bg.language.get().then(({ locale }) => browser.tabs.create({ url: `${env.websiteUrl.replace(/\/$/, '')}/${locale}/installed` })).catch(() => {});
  });

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
        case 'palside/runtime-ready': bg.sync.runtimeReady(message.epoch); return;
        case 'palside/runtime-error':
          for (const port of bg.panels.keys()) bg.post(port, { type: 'error', message: message.message });
          return;
        case 'palside/state-patch': bg.sync.acceptPatch(message.patch); return;
        case 'palside/notify': void bg.notifications.notify((message.payload ?? {}) as NotificationIdentity).catch(() => {}); return;
        case 'palside/signal-current': return answer(bg.signals.signalCurrent(message.token).then(ok => ({ ok })), () => ({ ok: false }));
        case 'palside/token-page': return answer(bg.sharing.readTokenPage(message.request).then(metadata => ({ metadata })), () => ({}));
        case 'palside/foreground': return answer(bg.sharing.sharedPageVisible(message.url).then(visible => ({ visible })), () => ({ visible: false }));
      }
      return;
    }
    if (!fromPanel) return;
    if (message.type === 'palside/command') return answer(bg.commands.panelCommand(message.command ?? {}, sender.url!, sender.documentId), failed);
    if (message.type === 'palside/open') return answer(bg.openPage(String(message.url), message.reuse === true).then(value => ({ ok: true, value })), failed);
  });

  bg.notifications.listenNotifications();
  browser.permissions.onAdded.addListener(added => {
    bg.notifications.listenNotifications();
    bg.pages.syncPermissions(Boolean(added.origins?.length));
    if (added.origins?.length) void bg.roomTab.refresh();
  });
  browser.permissions.onRemoved.addListener(removed => {
    // Revoke page sessions synchronously, before any queued permission reads can finish.
    if (removed.origins?.length) bg.pages.clearPages();
    // 共享在看 cannot run without 读取您的浏览记录: switch it off and say why.
    if (removed.permissions?.includes('tabs') && bg.state?.toggles.share) void bg.run({ name: 'toggle', payload: { share: false, revoked: true } }).catch(() => {});
    bg.pages.syncPermissions(Boolean(removed.origins?.length));
    // 弹幕 follows a tab's token only on an added site.
    if (removed.origins?.length) void bg.roomTab.refresh();
  });

  browser.windows.onRemoved.addListener(windowId => { void bg.roomTab.refresh(); bg.capture.discardCapture(windowId); bg.selection.discardPick(windowId); bg.images.imageWindowClosed(windowId); });
  browser.windows.onFocusChanged.addListener(windowId => { void bg.roomTab.refresh(windowId); bg.signals.signalActivity(); void bg.sharing.observer.refresh(true); });
  browser.tabs.onActivated.addListener(({ windowId }) => {
    void bg.roomTab.refresh();
    bg.capture.discardCapture(windowId);
    bg.selection.resetWindowSelection(windowId);
    bg.signals.signalActivity();
    void bg.sharing.observer.refresh(true);
    void bg.pages.pushPageStatus();
    void bg.pages.restoreActivePage(windowId).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'loading') bg.capture.invalidateActiveTab(tabId, change.url ?? tab.url);
    if ((change.status === 'loading' || change.url !== undefined) && (bg.capture.captures.get(tab.windowId)?.tabId === tabId || tab.active)) bg.capture.discardCapture(tab.windowId);
    bg.pages.tabNavigated(tabId, change, tab);
    if (tab.active) void bg.roomTab.refresh();
    if (tab.active && [...bg.panels.values()].includes(tab.windowId)) {
      if (change.url || change.status) void bg.sharing.observer.refresh(false, !change.url && change.status === 'complete');
      else if (change.title !== undefined) bg.sharing.observer.metadataChanged();
    }
  });
  browser.tabs.onRemoved.addListener((tabId, { windowId }) => {
    bg.capture.invalidateActiveTab(tabId);
    if (bg.capture.captures.get(windowId)?.tabId === tabId) bg.capture.discardCapture(windowId);
    bg.pages.tabClosed(tabId);
    void bg.roomTab.refresh();
    void bg.sharing.observer.refresh(false, true);
  });

  // 活跃 lasts five minutes after the last input; onStateChanged follows the same interval.
  browser.idle.onStateChanged.addListener(value => { bg.sharing.updateDeviceState(value === 'active' ? 'active' : 'away'); void bg.sharing.observer.refresh(value === 'active'); });
  browser.idle.setDetectionInterval(300);
  void browser.idle.queryState(300).then(value => bg.sharing.updateDeviceState(value === 'active' ? 'active' : 'away')).catch(() => {});
  void bg.pages.registerPageLayer().catch(() => {});
  return bg;
}
