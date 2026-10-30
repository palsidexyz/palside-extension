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

type OpenStickyRequest = { id: string; url?: string; teamId?: string };
const openStickyListeners = new Set<(request: OpenStickyRequest) => void>();
export function onOpenSticky(listener: (request: OpenStickyRequest) => void) { openStickyListeners.add(listener); return () => { openStickyListeners.delete(listener); }; }

const openRoomListeners = new Set<(key: RoomKey) => void>();
export function onOpenRoom(listener: (key: RoomKey) => void) { openRoomListeners.add(listener); return () => { openRoomListeners.delete(listener); }; }

/** Commands about this panel's window and its active tab; the background checks the window against the asking panel. */
const windowCommands = new Set(['selection-enabled', 'capture', 'link-card', 'locate-ref', 'locate-sticky']);

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

export async function openPage(url: string, reuse = false) {
  const result: Reply = await browser.runtime.sendMessage({ type: 'palside/open', url, reuse });
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
};

/** The panel's port to the background: state, language, page status and danmaku settings in; `hello`, `resync` and activity out. Reconnects on loss. */
export function observeState({ onState, onError, onLanguage, onDisconnect, onPage, onCaptured, onDanmaku }: PanelHandlers) {
  let port: ReturnType<typeof browser.runtime.connect> | undefined;
  let closed = false;
  let firstConnection = true;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    if (closed) {
      return;
    }
    try {
      port = browser.runtime.connect({ name: 'palside/panel' });
    } catch {
      onDisconnect();
      reconnect = setTimeout(connect, 500);
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
        if (hotSubscription?.chain !== undefined) void command('room-hot', hotSubscription).catch(() => {});
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
          latest = applyPatch(latest, patch);
          onState(stateForPanel(latest, windowId));
        }
      }
      if (message.type === 'error') {
        onError(message.message);
      }
      if (message.type === 'open-room' && isRoomKey(message.key)) {
        for (const listener of openRoomListeners) listener(message.key);
      }
      if (message.type === 'open-sticky' && typeof message.id === 'string') {
        for (const listener of openStickyListeners) listener({ id: message.id, url: message.url, teamId: message.teamId });
      }
      if (message.type === 'danmaku') {
        onDanmaku(message.settings);
      }
      if (message.type === 'page') {
        onPage(message.status);
      }
      if (message.type === 'captured') {
        onCaptured({ src: message.src, teamId: message.teamId });
      }
    });
    current.onDisconnect.addListener(() => {
      if (port === current) {
        port = undefined;
        onDisconnect();
      }
      if (!closed) {
        reconnect = setTimeout(connect, 500);
      }
    });
  }

  connect();
  let lastActivity = 0;
  const activity = (event: Event) => {
    if (!event.isTrusted || Date.now() - lastActivity < 1000) {
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
    for (const type of ['pointerdown', 'click', 'keydown', 'wheel']) {
      window.removeEventListener(type, activity, { capture: true });
    }
    port?.disconnect();
  };
}
