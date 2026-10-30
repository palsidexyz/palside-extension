import { MessageError,errorMessage,message as uiMessage,renderMessage,translator } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { freshPageSignals,pageTeam,type PageConnection } from '../runtime/browser/page-layer-host.ts';
import type { PageDown,PageUp } from '../runtime/browser/page-protocol.ts';
import { defaultSignalSettings,normalizeSignalSettings,readSignal,signalEmotes,SIGNAL_TTL,type SignalSettings } from '../runtime/annotations/signals.ts';
import type { Reply } from '../runtime/transport/reply';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import { pageScopeUrl } from '../domain/annotations/interaction.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

const settingsKey = (accountId: string) => `palside:signal-settings:${accountId}`;
const LABELS = ['attention', 'danger', 'question', 'help', 'agree', 'disagree', 'watch', 'together', 'send', 'unavailable', 'page', 'unmatched', 'locate', 'failed', 'empty', 'emote', ...signalEmotes.map(emote => `emote_${emote}`)];

/**
 * 信号 on pages: settings (local to each account in this browser), each page's `signal-config`, and sending and receiving. A page may signal only
 * while it is the focused window's active tab on a 网页互动 site with signals on; the offscreen sender re-checks that through a
 * one-time host token after its asynchronous encryption.
 */
export function signals(bg: Background) {
  const { browser } = bg;
  let settings: SignalSettings = { ...defaultSignalSettings };
  let loadError: unknown;
  const account = () => bg.state?.authenticated ? bg.state.account?.id : undefined;
  let settingsAccount: string | undefined;
  let loadVersion = 0;
  let ready = Promise.resolve();
  let changes = Promise.resolve();
  function loadSettings() {
    const accountId = account();
    if (settingsAccount === accountId) return ready;
    settingsAccount = accountId;
    settings = { ...defaultSignalSettings }; loadError = undefined;
    const version = ++loadVersion;
    ready = accountId ? browser.storage.local.get([settingsKey(accountId)]).then(local => {
      if (version === loadVersion && account() === accountId) settings = normalizeSignalSettings(local[settingsKey(accountId)]);
    }).catch(error => { if (version === loadVersion) loadError = error; }) : Promise.resolve();
    return ready;
  }
  const currentSettings = () => settingsAccount === account() ? settings : { ...defaultSignalSettings };
  /** Bumped on focus and tab changes, so a send started on the old focus cannot finish. */
  let activityVersion = 0;
  const configVersions = new WeakMap<Port, number>();
  /** Host tokens of sends in flight; the offscreen document asks `palside/signal-current` before it relays. */
  const sends = new Map<string, () => Promise<boolean>>();

  function signalOn(info: { url?: string; windowId?: number }) { return bg.allows('signal') && bg.interactivePage(info); }
  async function eligible(port: Port, info: PageConnection, version = bg.sessionVersion) {
    const url = info.url, accountId = bg.state?.account?.id, teamId = pageTeam(bg.state), tabVersion = bg.tabVersions.get(info.tabId), activity = activityVersion;
    const valid = () => activity === activityVersion && version === bg.sessionVersion && bg.tabVersions.get(info.tabId) === tabVersion && bg.pages.pagePorts.get(port) === info && info.url === url && accountId === bg.state?.account?.id && teamId === pageTeam(bg.state) && Boolean(teamId) && signalOn(info) && !bg.capture.captures.has(info.windowId);
    if (!valid()) return false;
    const [access, window, tab] = await Promise.all([accessStatus(url, browser), browser.windows.get(info.windowId), bg.activeTab(info.windowId)]);
    return Boolean(valid() && access.site && window.focused && !window.incognito && tab?.id === info.tabId && tab.url === url && !tab.incognito && tab.status !== 'loading' && (!info.documentId || port.sender?.documentId === info.documentId));
  }
  async function signalConfig(port: Port, info: PageConnection) {
    const configVersion = (configVersions.get(port) ?? 0) + 1;
    configVersions.set(port, configVersion);
    const url = info.url, version = bg.sessionVersion;
    await loadSettings();
    const t = translator((await bg.language.get()).locale);
    const labels = { ...Object.fromEntries(LABELS.map(key => [key, t(`extension.signal.${key}`)])), cancel: t('common.cancel') };
    const on = await eligible(port, info, version);
    if (version !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url || configVersions.get(port) !== configVersion) return;
    port.postMessage({ type: 'signal-config', on, settings: currentSettings(), labels } satisfies PageDown);
  }
  async function broadcastSignals() {
    await Promise.all([...bg.pages.pagePorts].map(([port, info]) => signalConfig(port, info).catch(() => {})));
    await bg.pages.pushPageStatus();
  }

  return {
    get signalsReady() { return loadSettings(); },
    signalSettings: currentSettings,
    signalConfig, broadcastSignals,
    /** Focus or the active tab changed: sends in flight stop, and every page re-checks whether it may signal. */
    signalActivity() { activityVersion++; void broadcastSignals().catch(() => {}); },
    async readSignalSettings() { await changes; await loadSettings(); return currentSettings(); },
    changeSignalSettings(patch: unknown, expectedAccountId: unknown) {
      const accountId = account();
      const check = () => {
        if (!accountId) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
        if (expectedAccountId !== accountId || accountId !== account()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      };
      const work = changes.then(async () => {
        check(); await loadSettings(); check();
        if (loadError) throw loadError;
        const next = normalizeSignalSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) });
        await browser.storage.local.set({ [settingsKey(accountId!)]: next });
        check(); settings = next;
        await broadcastSignals();
        return next;
      });
      changes = work.then(() => {}, () => {});
      return work;
    },
    /** The offscreen document asks whether a send's host token is still current. */
    async signalCurrent(token: unknown) {
      const guard = typeof token === 'string' ? sends.get(token) : undefined;
      return Boolean(guard && await guard() && sends.get(token as string) === guard);
    },
    async sendPageSignal(port: Port, info: PageConnection, message: Extract<PageUp, { type: 'signal-send' }>) {
      if (typeof message.requestId !== 'string' || !/^[\w-]{1,100}$/.test(message.requestId)) return;
      const version = bg.sessionVersion, url = info.url, accountId = bg.state?.account?.id, teamId = pageTeam(bg.state);
      const valid = () => version === bg.sessionVersion && bg.pages.pagePorts.get(port) === info && info.url === url && accountId === bg.state?.account?.id && teamId === pageTeam(bg.state);
      const token = crypto.randomUUID(), activity = activityVersion;
      const sameSend = () => valid() && activity === activityVersion;
      const canSend = async () => sameSend() && await eligible(port, info, version) && sameSend();
      let result: Reply;
      try {
        const payload = readSignal({ id: crypto.randomUUID(), teamId, url: pageScopeUrl(url), sentAt: Date.now(), kind: message.kind, target: message.target, emote: message.emote });
        if (!payload || !await eligible(port, info, version) || !valid()) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
        await bg.ensureRuntime();
        if (!valid() || !await eligible(port, info, version) || !valid()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
        if (sends.size >= 32) throw new MessageError(uiMessage('extension.runtime.signalRateLimited'));
        sends.set(token, canSend);
        const expiry = bg.setTimeout(() => sends.delete(token), SIGNAL_TTL);
        try { result = await browser.runtime.sendMessage({ target: 'palside/offscreen', command: { name: 'signal-send', payload: { ...payload, hostToken: token } } }); }
        finally { bg.clearTimeout(expiry); sends.delete(token); }
      } catch (error) { result = { ok: false, message: 'Signal unavailable', text: errorMessage(error) }; }
      if (result.ok && !await canSend()) result = { ok: false, message: 'Signal context changed', text: uiMessage('extension.runtime.contextChanged') };
      const { locale } = await bg.language.get();
      if (!valid()) return;
      port.postMessage({ type: 'signal-result', requestId: message.requestId, ok: result.ok, ...(!result.ok ? { error: renderMessage(locale, result.text ?? errorMessage(result)) } : {}) } satisfies PageDown);
    },
    /** New live signals go to the open pages of their exact URL. */
    async routeSignals(previous: RuntimeState | undefined, next: RuntimeState) {
      const version = bg.sessionVersion;
      for (const [port, info] of bg.pages.pagePorts) {
        const url = info.url;
        for (const item of freshPageSignals(previous, next, url)) {
          if (!await eligible(port, info, version)) break;
          const author = await bg.pagePerson(item.personId);
          if (bg.state?.account?.id !== next.account?.id || pageTeam(bg.state) !== pageTeam(next) || info.url !== url || item.sentAt + SIGNAL_TTL <= Date.now() || !await eligible(port, info, version)) break;
          port.postMessage({ type: 'signal', item, author } satisfies PageDown);
        }
      }
    },
  };
}
