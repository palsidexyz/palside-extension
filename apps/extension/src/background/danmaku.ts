import { ROOM_REPLAY_COUNT,ROOM_REPLAY_GAP_MS,ROOM_REPLAY_WINDOW_MS } from '@palside/shared/contracts/limits';
import { pageAsset,type PageConnection } from '../runtime/browser/page-layer-host.ts';
import { defaultDanmakuSettings,normalizeDanmakuSettings,type DanmakuSettings,type PageDown } from '../runtime/browser/page-protocol.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

const STORAGE_KEY = 'palside:danmaku';

/** Public room flights; queued messages are rechecked against the latest room before release. */
export function danmaku(bg: Background) {
  let settings: DanmakuSettings = { ...defaultDanmakuSettings };
  const loaded = bg.browser.storage.local.get([STORAGE_KEY]).then(value => { settings = normalizeDanmakuSettings(value[STORAGE_KEY]); }).catch(() => {});
  let changes = loaded;
  type Projection = { key: string; seen: Set<string>; sent: Set<string>; queue: string[]; timer?: ReturnType<typeof setTimeout>; paymentsTimer?: ReturnType<typeof setTimeout> };
  const projections = new Map<Port, Projection>();
  const replayed = new Map<number, Map<string, number>>();
  function enabled() { return Boolean(bg.state?.authenticated && bg.state.preferences.rooms?.off !== true && bg.state.preferences.web.interact && bg.state.toggles.interact && settings.enabled); }
  function allows(info: { url?: string; windowId?: number }) {
    const asset = info.url && pageAsset(info.url, bg.state);
    return Boolean(enabled() && asset && bg.state?.rooms?.current?.key === `token:${asset}` && info.windowId !== undefined && [...bg.panels.values()].includes(info.windowId));
  }
  function post(port: Port, message: PageDown) { try { port.postMessage(message); } catch { forget(port); } }
  function forget(port: Port) {
    const projection = projections.get(port);
    if (!projection) return;
    bg.clearTimeout(projection.timer); bg.clearTimeout(projection.paymentsTimer); projections.delete(port);
    try { port.postMessage({ type: 'danmaku-remove', ids: [...projection.sent] } satisfies PageDown); } catch { /* page gone */ }
    try { port.postMessage({ type: 'room-payments', roomKey: null, packets: [] } satisfies PageDown); } catch { /* page gone */ }
  }
  function messages() {
    const blocked = new Set(bg.state?.rooms?.blocked.map(person => person.id));
    return (bg.state?.rooms?.current?.messages ?? []).filter(item => !item.folded && !blocked.has(item.author.id) && item.key === bg.state?.rooms?.current?.key);
  }
  function release(port: Port, info: PageConnection, projection: Projection) {
    projection.timer = undefined;
    if (projections.get(port) !== projection || bg.pages.pagePorts.get(port) !== info || !info.siteGranted || !allows(info) || bg.state?.rooms?.current?.key !== projection.key) { forget(port); return; }
    const id = projection.queue.shift(), item = messages().find(item => item.id === id);
    if (item) {
      projection.sent.add(item.id);
      // The card on hover shows who said it, so the author goes out with a portrait; a retraction meanwhile still wins.
      void bg.roomPagePerson(item.author).then(({ mate, ...author }) => {
        if (projections.get(port) !== projection || !projection.sent.has(item.id)) return;
        post(port, { type: 'danmaku', items: [{ id: item.id, key: item.key, text: item.text, timestamp: item.createdAt, author, self: item.author.id === bg.state?.account?.id, mate }] });
      });
    }
    if (projection.queue.length && projections.get(port) === projection) projection.timer = bg.setTimeout(() => release(port, info, projection), ROOM_REPLAY_GAP_MS);
  }
  function syncPayments(port: Port, info: PageConnection, projection: Projection) {
    bg.clearTimeout(projection.paymentsTimer); projection.paymentsTimer = undefined;
    if (projections.get(port) !== projection) return;
    if (bg.pages.pagePorts.get(port) !== info || !info.siteGranted || !allows(info) || bg.state?.rooms.current?.key !== projection.key) { forget(port); return; }
    const now = Date.now(), room = bg.state.rooms.current;
    const source = !room.loading && bg.state.chainRoom?.key === projection.key ? bg.state.chainRoom : undefined;
    const blocked = new Set(bg.state.rooms.blocked.map(person => person.id));
    const packets = (source?.packets ?? []).filter(item => item.kind === 'room' && item.scope === projection.key && item.status === 'active' && !blocked.has(item.accountId) && item.claimedCount < item.count && item.expiresAt > now);
    post(port, {
      type: 'room-payments', roomKey: projection.key,
      packets: packets.length ? [{ roomKey: projection.key }] : [],
    });
    if (projections.get(port) !== projection) return;
    const deadlines = packets.map(item => item.expiresAt).filter(at => at > now);
    if (deadlines.length) projection.paymentsTimer = bg.setTimeout(() => syncPayments(port, info, projection), Math.min(Math.min(...deadlines) - now, 2_147_483_647));
  }
  function syncPage(port: Port, info: PageConnection) {
    if (bg.pages.pagePorts.get(port) !== info || !info.siteGranted || !allows(info)) { forget(port); return; }
    const room = bg.state!.rooms.current!;
    let projection = projections.get(port);
    if (projection?.key !== room.key) { forget(port); projection = undefined; }
    if (room.loading) { if (projection) syncPayments(port, info, projection); return; }
    const visible = messages(), ids = new Set(visible.map(item => item.id));
    if (!projection) {
      const now = Date.now(), history = replayed.get(info.tabId) ?? new Map<string, number>();
      for (const [key, at] of history) if (now - at >= ROOM_REPLAY_WINDOW_MS) history.delete(key);
      const replay = !history.has(room.key);
      history.set(room.key, history.get(room.key) ?? now); replayed.set(info.tabId, history);
      projection = { key: room.key, seen: new Set(room.messages.map(item => item.id)), sent: new Set(), queue: replay ? visible.filter(item => item.createdAt > now - ROOM_REPLAY_WINDOW_MS && item.createdAt <= now).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(-ROOM_REPLAY_COUNT).map(item => item.id) : [] };
      projections.set(port, projection);
    } else {
      const removed = [...projection.sent].filter(id => !ids.has(id));
      if (removed.length) { post(port, { type: 'danmaku-remove', ids: removed }); for (const id of removed) projection.sent.delete(id); }
      projection.queue = projection.queue.filter(id => ids.has(id));
      // Older pages loaded by room-more are history, not new arrivals.
      const newest = Math.max(0, ...room.messages.filter(item => projection!.seen.has(item.id)).map(item => item.createdAt));
      projection.queue.push(...visible.filter(item => !projection!.seen.has(item.id) && item.createdAt >= newest).map(item => item.id));
      projection.seen = new Set(room.messages.map(item => item.id));
    }
    syncPayments(port, info, projection);
    if (projections.get(port) === projection && projection.queue.length && projection.timer === undefined) release(port, info, projection);
  }
  async function pageConfig(): Promise<PageDown> { await loaded; return { type: 'config', labels: await bg.pageLabels(), danmaku: { ...settings, enabled: enabled() } }; }
  async function broadcastDanmakuSettings() {
    const config = await pageConfig();
    for (const port of bg.panels.keys()) bg.post(port, { type: 'danmaku', settings });
    for (const [port, info] of bg.pages.pagePorts) { post(port, config); syncPage(port, info); }
  }
  return {
    ready: loaded, enabled, allows, syncPage, forget, pageConfig, broadcastDanmakuSettings,
    clear() { for (const port of projections.keys()) forget(port); },
    forgetTab(tabId: number) { replayed.delete(tabId); },
    sendDanmakuSettings(port: Port) { void loaded.then(() => { if (bg.panels.has(port)) bg.post(port, { type: 'danmaku', settings }); }); },
    saveDanmakuSettings(patch: unknown) {
      const saved = changes.then(async () => {
        const next = normalizeDanmakuSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) });
        await bg.browser.storage.local.set({ [STORAGE_KEY]: next }); settings = next;
        await broadcastDanmakuSettings(); bg.pages.pagePolicyChanged(false); bg.pages.restoreAllPages();
      });
      changes = saved.catch(() => {}); return saved;
    },
    openRoom(port: Port, info: PageConnection, key: string) {
      if (!info.siteGranted || !allows(info) || projections.get(port)?.key !== key) return;
      void bg.browser.sidePanel.open({ windowId: info.windowId }).then(() => {
        if (bg.pages.pagePorts.get(port) !== info || !info.siteGranted || !allows(info) || bg.state?.rooms.current?.key !== key) return;
        for (const [panel, windowId] of bg.panels) if (windowId === info.windowId) bg.post(panel, { type: 'open-room', key });
      }).catch(() => {});
    },
  };
}
