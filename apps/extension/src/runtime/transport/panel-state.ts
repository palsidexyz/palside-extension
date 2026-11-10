import type { RuntimeState } from '../composition/runtime-state';

const memo = new WeakMap<RuntimeState, Map<number | undefined, RuntimeState>>();

/** Shared account data is common; notification navigation belongs to one window. */
export function stateForPanel(state: RuntimeState, windowId: number | undefined): RuntimeState {
  const cached = memo.get(state)?.get(windowId);
  if (cached) return cached;
  let result = state;
  if (state.jumpMessageId && (windowId === undefined || state.jumpWindowId !== windowId)) {
    result = { ...state, jumpMessageId: undefined, jumpWindowId: undefined };
  }
  // 弹幕 follows the panel window the user last worked in; any other window's panel says so instead of waiting.
  const rooms = state.rooms as RuntimeState['rooms'] | undefined;
  const elsewhere = windowId !== undefined && rooms?.window !== undefined && rooms.window !== windowId;
  if (rooms && elsewhere !== Boolean(rooms.elsewhere)) result = { ...result, rooms: { ...result.rooms, elsewhere } };
  let byWindow = memo.get(state);
  if (!byWindow) {
    byWindow = new Map();
    memo.set(state, byWindow);
  }
  byWindow.set(windowId, result);
  return result;
}
