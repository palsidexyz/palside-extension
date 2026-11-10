import { MessageError,errorMessage,message as uiMessage,renderMessage,translator } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { freshPageSignals,pageAsset,pageTeam,type PageConnection } from '../runtime/browser/page-layer-host.ts';
import type { PageChartMark,PageDrawing,PageDrawingPerson,PageDown,PageUp } from '../runtime/browser/page-protocol.ts';
import { chartMarkAlive,readChartStroke } from '../runtime/annotations/chart-marks.ts';
import { readChartAxis,readChartDrawingGeometry } from '../runtime/annotations/chart-drawings.ts';
import { defaultSignalSettings,normalizeSignalSettings,readSignal,signalEmotes,SIGNAL_TTL,type SignalSettings } from '../runtime/annotations/signals.ts';
import type { Reply } from '../runtime/transport/reply';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import { pageScopeUrl,samePage } from '../domain/annotations/interaction.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

const settingsKey = (accountId: string) => `palside:signal-settings:${accountId}`;
/** The one main-world script, bundled with the extension (scripts/lib/extension-artifact.mjs `chartBridgePolicy`). */
export const CHART_BRIDGE_FILE = '/chart-bridge.js';
/** 共享画线's toolbar entry and its panel, drawn by the page while the feature is on. */
const CHART_LABELS = ['toolbar', 'sync', 'syncOn', 'syncOff', 'mark', 'markNote', 'members', 'search', 'show', 'hide', 'hideAll', 'showAll', 'unsynced', 'failed', 'guide', 'guideOff'];
const LABELS = ['attention', 'danger', 'question', 'help', 'agree', 'disagree', 'watch', 'together', 'locate', 'failed', 'emote', ...signalEmotes.map(emote => `emote_${emote}`)];

/**
 * 信号 on pages: settings (local to each account in this browser), each page's `signal-config`, and sending and receiving.
 * Every open tab of a 网页互动 site with signals on, in a window with a panel, shows the squad's signals for its page (`pageKey`),
 * focused or not and in front or not. Sending is from the tab in front; the offscreen sender re-checks that through a one-time host
 * token after its asynchronous encryption.
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
  /** Bumped when the tab in front changes, so a send started on another tab cannot finish. */
  let activityVersion = 0;
  const configVersions = new WeakMap<Port, number>();
  /** Host tokens of sends in flight; the offscreen document asks `palside/signal-current` before it relays. */
  const sends = new Map<string, () => Promise<boolean>>();
  /** Documents the chart bridge was loaded into; a document keeps its id until it goes away. */
  const bridged = new Set<string>();

  type Gate = (info: { url?: string; windowId?: number }) => boolean;
  const signalOn: Gate = info => bg.allows('signal', info.url) && bg.interactivePage(info);
  const chartOn: Gate = info => bg.allows('chart', info.url) && bg.interactivePage(info);
  /** The page shows this feature: its site allows it, Chrome allows the site and no screenshot is being taken in its window. */
  async function receivable(port: Port, info: PageConnection, version = bg.sessionVersion, gate: Gate = signalOn) {
    const url = info.url, accountId = bg.state?.account?.id, teamId = pageTeam(bg.state), tabVersion = bg.tabVersions.get(info.tabId);
    const valid = () => version === bg.sessionVersion && bg.tabVersions.get(info.tabId) === tabVersion && bg.pages.pagePorts.get(port) === info && info.url === url && accountId === bg.state?.account?.id && teamId === pageTeam(bg.state) && Boolean(teamId) && gate(info) && !bg.capture.captures.has(info.windowId);
    if (!valid()) return false;
    const access = await accessStatus(url, browser);
    return Boolean(valid() && access.site && !port.sender?.tab?.incognito && (!info.documentId || port.sender?.documentId === info.documentId));
  }
  /** The page may send: it shows signals and is the tab in front of its window, unchanged since the send began. */
  async function eligible(port: Port, info: PageConnection, version = bg.sessionVersion, gate: Gate = signalOn) {
    const activity = activityVersion, url = info.url;
    if (!await receivable(port, info, version, gate) || activity !== activityVersion) return false;
    const tab = await bg.activeTab(info.windowId);
    return Boolean(activity === activityVersion && tab?.id === info.tabId && tab.url === url && !tab.incognito);
  }
  async function signalConfig(port: Port, info: PageConnection) {
    const configVersion = (configVersions.get(port) ?? 0) + 1;
    configVersions.set(port, configVersion);
    const url = info.url, version = bg.sessionVersion;
    await loadSettings();
    const t = translator((await bg.language.get()).locale);
    const labels = { ...Object.fromEntries(LABELS.map(key => [key, t(`extension.signal.${key}`)])), cancel: t('common.cancel') };
    const on = await receivable(port, info, version);
    if (version !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url || configVersions.get(port) !== configVersion) return;
    port.postMessage({ type: 'signal-config', on, settings: currentSettings(), labels } satisfies PageDown);
    const chart = await receivable(port, info, version, chartOn);
    if (version !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url || configVersions.get(port) !== configVersion) return;
    port.postMessage({ type: 'chart-config', on: chart, labels: { ...Object.fromEntries(CHART_LABELS.map(key => [key, t(`extension.chart.${key}`)])), gotIt: t('extension.start.gotIt'), clear: t('extension.copy.clearPhrase') } } satisfies PageDown);
    sentMarks.delete(port); sentDrawings.delete(port);
    await pushMarks(port, info, version);
    await pushDrawings(port, info, version);
  }
  /** What each page last drew, so an unchanged list is not sent again. */
  const sentMarks = new WeakMap<Port, string>();
  const sentDrawings = new WeakMap<Port, string>();
  /** A person's steady colour on the page: 0 for you, then teammates in squad order. */
  const tintOf = (people: { id: string }[], self: string | undefined, id: string) => id === self ? 0 : 1 + Math.max(0, people.filter(person => person.id !== self).findIndex(person => person.id === id)) % 5;
  /** The squad's live laser strokes for this page: same team, same page key. */
  async function pushMarks(port: Port, info: PageConnection, version = bg.sessionVersion) {
    const state = bg.state, teamId = pageTeam(state), url = info.url, now = Date.now();
    const on = await receivable(port, info, version, chartOn);
    const people = state?.remoteTeams.find(team => team.id === teamId)?.people ?? [];
    const self = state?.account?.id;
    const marks = on ? (state?.chartMarks ?? []).filter(mark => mark.teamId === teamId && chartMarkAlive(mark, now) && samePage(mark.url, url, pageAsset(mark.url, state), info.asset)) : [];
    const items: PageChartMark[] = [];
    for (const mark of marks) {
      const points = readChartStroke(mark.points), axis = readChartAxis(mark.axis);
      if (points) items.push({ id: `${mark.personId}:${mark.id}`, points, ...(axis ? { axis } : {}), at: mark.at, author: await bg.pagePerson(mark.personId), tint: tintOf(people, self, mark.personId) });
    }
    if (version !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url) return;
    const signature = JSON.stringify(items.map(item => [item.id, item.author.name, item.tint]));
    if (sentMarks.get(port) === signature) return;
    sentMarks.set(port, signature);
    try { port.postMessage({ type: 'marks', items } satisfies PageDown); } catch { /* page gone */ }
  }
  /** The squad's drawings for this page, without anyone this device hides, and the list of who drew. */
  async function pushDrawings(port: Port, info: PageConnection, version = bg.sessionVersion) {
    const state = bg.state, teamId = pageTeam(state), url = info.url;
    const on = await receivable(port, info, version, chartOn);
    await loadSettings();
    const { chartShare, chartHideAll, chartHidden, chartIntro, chartOpened } = currentSettings();
    const people = state?.remoteTeams.find(team => team.id === teamId)?.people ?? [], self = state?.account?.id;
    const records = on ? (state?.chartDrawings ?? []).filter(record => record.teamId === teamId && record.shape && samePage(record.url, url, pageAsset(record.url, state), info.asset)) : [];
    const items: PageDrawing[] = [], counts = new Map<string, number>(), latest = new Map<string, number>();
    for (const record of records) {
      const geometry = readChartDrawingGeometry(record.shape, record.points, record.props, record.axis);
      if (!geometry) continue;
      const mine = record.personId === self;
      if (!mine) { counts.set(record.personId, (counts.get(record.personId) ?? 0) + 1); latest.set(record.personId, Math.max(latest.get(record.personId) ?? 0, record.timestamp)); }
      if (mine || !chartHideAll && !chartHidden.includes(record.personId)) items.push({ ...geometry, id: record.id, owner: record.personId, mine, tint: tintOf(people, self, record.personId), at: record.timestamp });
    }
    const persons: PageDrawingPerson[] = [];
    // Whoever drew last comes first.
    for (const [id, count] of [...counts].sort((x, y) => latest.get(y[0])! - latest.get(x[0])!)) persons.push({ ...await bg.pagePerson(id), id, count, tint: tintOf(people, self, id), hidden: chartHideAll || chartHidden.includes(id) });
    if (version !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url) return;
    const signature = JSON.stringify([items, persons, chartShare, chartHideAll, chartIntro, chartOpened]);
    if (sentDrawings.get(port) === signature) return;
    sentDrawings.set(port, signature);
    try { port.postMessage({ type: 'drawings', items, people: persons, share: chartShare, hideAll: chartHideAll, intro: chartIntro, opened: chartOpened } satisfies PageDown); } catch { /* page gone */ }
  }
  /** One 共享画线 send from the tab in front, through the same one-time host token as a signal. */
  async function chartSend(port: Port, info: PageConnection, requestId: unknown, reply: 'mark-result' | 'drawing-result', command: (scope: string, teamId: string) => { name: 'mark-send' | 'drawing-send'; payload: Record<string, unknown> } | undefined) {
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) return;
    const version = bg.sessionVersion, url = info.url, accountId = bg.state?.account?.id, teamId = pageTeam(bg.state);
    const valid = () => version === bg.sessionVersion && bg.pages.pagePorts.get(port) === info && info.url === url && accountId === bg.state?.account?.id && teamId === pageTeam(bg.state);
    const token = crypto.randomUUID(), activity = activityVersion;
    const canSend = async () => valid() && activity === activityVersion && await eligible(port, info, version, chartOn) && valid() && activity === activityVersion;
    let result: Reply;
    try {
      const scope = pageScopeUrl(url), built = scope && teamId ? command(scope, teamId) : undefined;
      if (!built || !await eligible(port, info, version, chartOn) || !valid()) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
      await bg.ensureRuntime();
      if (!valid() || !await eligible(port, info, version, chartOn) || !valid()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      if (sends.size >= 32) throw new MessageError(uiMessage('extension.runtime.signalRateLimited'));
      sends.set(token, canSend);
      const expiry = bg.setTimeout(() => sends.delete(token), SIGNAL_TTL);
      try { result = await browser.runtime.sendMessage({ target: 'palside/offscreen', command: { name: built.name, payload: { ...built.payload, hostToken: token } } }); }
      finally { bg.clearTimeout(expiry); sends.delete(token); }
    } catch (error) { result = { ok: false, message: 'Chart unavailable', text: errorMessage(error) }; }
    const { locale } = await bg.language.get();
    if (!valid()) return;
    port.postMessage({ type: reply, requestId, ok: result.ok, ...(!result.ok ? { error: renderMessage(locale, result.text ?? errorMessage(result)) } : {}) } satisfies PageDown);
  }
  async function broadcastSignals() {
    await Promise.all([...bg.pages.pagePorts].map(([port, info]) => signalConfig(port, info).catch(() => {})));
    await bg.pages.pushPageStatus();
  }

  return {
    async clearAccount(accountId: string) {
      await changes;
      await browser.storage.local.remove(settingsKey(accountId));
      if (settingsAccount === accountId) { loadVersion++; settingsAccount = undefined; settings = { ...defaultSignalSettings }; loadError = undefined; }
    },
    get signalsReady() { return loadSettings(); },
    signalSettings: currentSettings,
    signalConfig, broadcastSignals,
    /** The tab in front changed: sends in flight stop, and every page re-checks whether it shows signals. */
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
    /** A one-time host token for another page-started send (跟看's scroll); the offscreen document re-checks it like a signal's. */
    issueHostToken(canSend: () => Promise<boolean>) {
      if (sends.size >= 32) return;
      const token = crypto.randomUUID();
      sends.set(token, canSend);
      const expiry = bg.setTimeout(() => sends.delete(token), SIGNAL_TTL);
      return { token, release: () => { bg.clearTimeout(expiry); sends.delete(token); } };
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
        const payload = readSignal({ id: crypto.randomUUID(), teamId, url: pageScopeUrl(url), sentAt: Date.now(), kind: message.kind, target: message.target, emote: message.emote, asset: info.asset });
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
    /** A laser stroke. */
    sendPageMark(port: Port, info: PageConnection, message: Extract<PageUp, { type: 'mark-send' }>) {
      return chartSend(port, info, message.requestId, 'mark-result', (url, teamId) => {
        const points = readChartStroke(message.points), axis = readChartAxis(message.axis);
        return points && { name: 'mark-send', payload: { teamId, url, points, ...(axis ? { axis } : {}) } };
      });
    },
    /** A drawing, its edit or its deletion. */
    sendPageDrawing(port: Port, info: PageConnection, message: Extract<PageUp, { type: 'drawing-send' }>) {
      return chartSend(port, info, message.requestId, 'drawing-result', (url, teamId) => {
        if (message.shape === undefined) return { name: 'drawing-send', payload: { teamId, url, id: message.id } };
        const geometry = readChartDrawingGeometry(message.shape, message.points, message.props, message.axis);
        return geometry && { name: 'drawing-send', payload: { teamId, url, id: message.id, ...geometry, ...(info.asset ? { asset: info.asset } : {}) } };
      });
    },
    /**
     * The panel's switches, from a page that shows 共享画线. Turning 共享给小队 off takes back everything you shared in this squad, on
     * every page: one deletion per drawing, through the same checked send. On your own charts the drawings stay as the site's own.
     */
    async changeChartPref(port: Port, info: PageConnection, message: Extract<PageUp, { type: 'chart-pref' }>) {
      const accountId = account();
      if (!accountId || !await receivable(port, info, bg.sessionVersion, chartOn)) return;
      await loadSettings();
      const before = currentSettings(), hidden = before.chartHidden, { share, hideAll, hide, intro, opened } = message;
      await this.changeSignalSettings({
        ...(typeof share === 'boolean' ? { chartShare: share } : {}),
        ...(typeof hideAll === 'boolean' ? { chartHideAll: hideAll } : {}),
        ...(intro === true ? { chartIntro: true } : {}),
        ...(opened === true ? { chartOpened: true } : {}),
        ...(hide && typeof hide.id === 'string' ? { chartHidden: hide.hidden ? [...hidden, hide.id] : hidden.filter(id => id !== hide.id) } : {}),
      }, accountId);
      if (share !== false) return;
      const teamId = pageTeam(bg.state);
      const mine = (bg.state?.chartDrawings ?? []).filter(record => record.teamId === teamId && record.personId === accountId && record.shape);
      for (const [index, record] of mine.entries()) {
        if (currentSettings().chartShare || account() !== accountId || pageTeam(bg.state) !== teamId) return;
        await chartSend(port, info, `unshare-${Date.now().toString(36)}-${index}`, 'drawing-result', (_scope, team) => ({ name: 'drawing-send', payload: { teamId: team, url: record.url, id: record.id } }));
      }
    },
    /** 共享画线 changed: every page showing it redraws its page's lists. */
    async routeMarks() {
      await Promise.all([...bg.pages.pagePorts].flatMap(([port, info]) => [pushMarks(port, info).catch(() => {}), pushDrawings(port, info).catch(() => {})]));
    },
    /**
     * The page found a TradingView chart. The chart bridge runs in that document's main world, where the chart's own API lives,
     * once per document and only where 共享画线 runs. It sees shapes and their properties, never names or accounts: see chart-bridge.ts.
     */
    async chartFound(port: Port, info: PageConnection) {
      const version = bg.sessionVersion, documentId = port.sender?.documentId;
      if (!documentId || port.sender?.documentId !== info.documentId && info.documentId) return;
      if (bridged.has(documentId) || !await receivable(port, info, version, chartOn)) return;
      if (version !== bg.sessionVersion || bridged.has(documentId)) return;
      bridged.add(documentId);
      if (bridged.size > 256) bridged.delete(bridged.values().next().value!);
      await browser.scripting.executeScript({ target: { tabId: info.tabId, documentIds: [documentId] }, world: 'MAIN', files: [CHART_BRIDGE_FILE] }).catch(() => { bridged.delete(documentId); });
    },
    /** New live signals go to every open tab showing their page (`pageKey`), in front or not. */
    async routeSignals(previous: RuntimeState | undefined, next: RuntimeState) {
      const version = bg.sessionVersion;
      await Promise.all([...bg.pages.pagePorts].map(async ([port, info]) => {
        const url = info.url, items = freshPageSignals(previous, next, url, info.asset);
        if (!items.length || !await receivable(port, info, version)) return;
        for (const item of items) {
          const author = await bg.pagePerson(item.personId);
          if (bg.state?.account?.id !== next.account?.id || pageTeam(bg.state) !== pageTeam(next) || info.url !== url || item.at + SIGNAL_TTL <= Date.now()) return;
          port.postMessage({ type: 'signal', item, author } satisfies PageDown);
        }
      }));
    },
  };
}
