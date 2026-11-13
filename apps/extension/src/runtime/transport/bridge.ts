import { SECOND_MS } from '@palside/shared/units';
import type { CommandName, CommandArgs, CommandResult } from './command-map';
import { errorMessage,MessageError,message as uiMessage,type TextValue } from '@palside/i18n';
import { isRoomKey } from '@palside/shared/contracts/rules';
import type { RoomKey } from '../rooms/contract-types';
import type { LanguageState } from './language';
import { browser } from 'wxt/browser';
import type { Reply } from './reply';
import type { RuntimeState } from '../composition/runtime-state';
import { stateForPanel } from './panel-state.ts';
import { applyPatch,type StatePatch } from './state-patch.ts';
import type { DanmakuSettings,PageStatus } from '../browser/page-protocol';
import { readSiteIcon, type SiteIcon } from '../../domain/assets/site-icon.ts';
import { readUpdateStatus, type UpdateStatus } from '../browser/extension-update.ts';


/** A 弹幕 line, or with `packet` a 红包, clicked on the page. */
const openRoomListeners = new Set<(key: RoomKey, packet?: string) => void>();
export function onOpenRoom(listener: (key: RoomKey, packet?: string) => void) { openRoomListeners.add(listener); return () => { openRoomListeners.delete(listener); }; }

/** 跟看's tab, kept by the background for this panel's window. */
export type FollowStatus = { paused: boolean; ended?: true };
const followListeners = new Set<(status: FollowStatus) => void>();
export function onFollowStatus(listener: (status: FollowStatus) => void) { followListeners.add(listener); return () => { followListeners.delete(listener); }; }
export async function requestFollow(request: { op: 'go'; url: string; start?: boolean; teamId?: string; personId?: string; title?: string } | { op: 'pause' } | { op: 'resume'; url?: string } | { op: 'stop' }) {
  const windowId = (await browser.windows.getCurrent()).id;
  const result: Reply = await browser.runtime.sendMessage({ type: 'palside/follow', windowId, request });
  if (!result?.ok) throw new MessageError(result?.text ?? (result ? errorMessage(result) : uiMessage('common.connectionLost')));
}

/** Commands about this panel's window and its active tab; the background checks the window against the asking panel. */
const windowCommands = new Set(['capture', 'link-card', 'signal-replay', 'drawing-show']);

let hotSubscription: CommandArgs<'room-hot'>[1];
const roomWatches = new Map<string, CommandArgs<'room-watch'>[1]>();

export async function command<N extends CommandName>(...args: CommandArgs<N>): Promise<CommandResult<N>> {
  const [name, input] = args;
  let payload: Record<string, unknown> | undefined = input;
  if (name === 'room-hot') hotSubscription = input as CommandArgs<'room-hot'>[1];
  if (name === 'room-watch') {
    const watch = input as CommandArgs<'room-watch'>[1];
    if (watch.view) roomWatches.set(watch.id, watch); else roomWatches.delete(watch.id);
  }
  if (windowCommands.has(name)) payload = { ...payload, windowId: (await browser.windows.getCurrent()).id };
  const result: Reply<CommandResult<N>> = await browser.runtime.sendMessage({
    type: 'palside/command',
    command: { name, payload },
  });
  if (!result?.ok) {
    const text = result?.text ?? (result ? errorMessage(result) : uiMessage('common.connectionLost'));
    throw Object.assign(new MessageError(text), {
      code: result?.code,
      lockedUntil: result?.lockedUntil, retryAfterMs: result?.retryAfterMs, remaining: result?.remaining,
      text,
    });
  }
  return result.value;
}

export async function openPage(url: string) {
  const result: Reply = await browser.runtime.sendMessage({ type: 'palside/open', url });
  if (!result.ok) {
    throw new MessageError(result.text ?? errorMessage(result));
  }
}

type PanelHandlers = {
  onState: (state: RuntimeState) => void;
  onError: (message: TextValue) => void;
  onLanguage: (state: LanguageState) => void;
  onDisconnect: () => void;
  onPage: (status: PageStatus) => void;
  onCaptured: (capture: { src: string; teamId?: string }) => void;
  onDanmaku: (settings: DanmakuSettings) => void;
  onSiteIcons: (icons: Record<string, SiteIcon>) => void;
  onUpdate?: (status: UpdateStatus) => void;
};

/** The panel's port to the background: state, language, page status, danmaku settings, site icons and the update status in; `hello`, `resync` and activity out. Reconnects on loss. */
export function observeState({ onState, onError, onLanguage, onDisconnect, onPage, onCaptured, onDanmaku, onSiteIcons, onUpdate }: PanelHandlers) {
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  let closed = false;
  let firstConnection = true;
  let retryDelay = 500;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect() {
    clearTimeout(reconnect);
    if (closed || document.visibilityState === 'hidden') return;
    reconnect = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5000);
  }
  const visibilityChanged = () => {
    clearTimeout(reconnect);
    if (!port && document.visibilityState !== 'hidden') connect();
  };
  document.addEventListener('visibilitychange', visibilityChanged);

  function connect() {
    if (closed || document.visibilityState === 'hidden') {
      return;
    }
    try {
      port = browser.runtime.connect({ name: 'palside/panel' });
    } catch {
      onDisconnect();
      scheduleReconnect();
      return;
    }
    const current = port;
    let windowId: number | undefined;
    let latest: RuntimeState | undefined;
    let resyncRequested = false;
    void browser.windows.getCurrent().then(window => {
      windowId = window.id;
      if (port !== current || closed) {
        return;
      }
      try {
        current.postMessage({ type: 'hello', windowId, activity: firstConnection });
        if (hotSubscription?.open) void command('room-hot', hotSubscription).catch(() => {});
        for (const watch of roomWatches.values()) void command('room-watch', watch).catch(() => {});
        firstConnection = false;
        if (latest) {
          onState(stateForPanel(latest, windowId));
        }
      } catch {
        // The disconnect callback owns reconnection.
      }
    });
    current.onMessage.addListener(message => {
      if (port !== current || closed) {
        return;
      }
      if (message.type === 'language') {
        onLanguage(message.state);
      }
      if (message.type === 'state') {
        retryDelay = 500;
        latest = message.state;
        resyncRequested = false;
        onState(stateForPanel(message.state, windowId));
      }
      if (message.type === 'state-patch') {
        const patch = message.patch as StatePatch;
        if (!patch || typeof patch.revision !== 'number' || (patch.base !== undefined && patch.base !== latest?.revision)) {
          if (!resyncRequested) {
            resyncRequested = true;
            try { current.postMessage({ type: 'resync' }); } catch { /* disconnect owns recovery */ }
          }
        } else {
          resyncRequested = false;
          retryDelay = 500;
          latest = applyPatch(latest, patch);
          onState(stateForPanel(latest, windowId));
        }
      }
      if (message.type === 'error') {
        onError(message.message);
      }
      if (message.type === 'open-room' && isRoomKey(message.key)) {
        const packet = typeof message.packet === 'string' && /^0x[0-9a-f]{64}$/i.test(message.packet) ? message.packet : undefined;
        for (const listener of openRoomListeners) listener(message.key, packet);
      }
      if (message.type === 'follow' && message.status && typeof message.status.paused === 'boolean') {
        const status: FollowStatus = message.status.ended === true ? { paused: message.status.paused, ended: true } : { paused: message.status.paused };
        for (const listener of followListeners) listener(status);
      }
      if (message.type === 'update') onUpdate?.(readUpdateStatus(message.status));
      if (message.type === 'danmaku') {
        onDanmaku(message.settings);
      }
      if (message.type === 'site-icons' && message.icons && typeof message.icons === 'object') {
        onSiteIcons(Object.fromEntries(Object.entries(message.icons as Record<string, unknown>).flatMap(([host, value]) => { const icon = readSiteIcon(value); return icon ? [[host, icon]] : []; })));
      }
      if (message.type === 'page') {
        onPage(message.status);
      }
      if (message.type === 'captured') {
        onCaptured({ src: message.src, teamId: message.teamId });
      }
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return;
      port = undefined;
      onDisconnect();
      if (!closed) {
        scheduleReconnect();
      }
    });
  }

  connect();
  let lastActivity = 0;
  const activity = (event: Event) => {
    if (!event.isTrusted || Date.now() - lastActivity < SECOND_MS) {
      return;
    }
    lastActivity = Date.now();
    try {
      port?.postMessage({ type: 'activity' });
    } catch {
      // Reconnection owns recovery.
    }
  };
  for (const type of ['pointerdown', 'click', 'keydown', 'wheel']) {
    window.addEventListener(type, activity, { capture: true, passive: true });
  }
  return () => {
    closed = true;
    clearTimeout(reconnect);
    document.removeEventListener('visibilitychange', visibilityChanged);
    for (const type of ['pointerdown', 'click', 'keydown', 'wheel']) {
      window.removeEventListener(type, activity, { capture: true });
    }
    port?.disconnect();
  };
}
