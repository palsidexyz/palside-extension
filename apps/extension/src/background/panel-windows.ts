import type { Background } from './index.ts';

/**
 * The panel window the user last worked in. 共享在看 publishes its active tab and 弹幕 follows its token.
 * Focus moving to another app or to a window without a panel keeps it; focusing another panel window, or opening a panel there, moves it.
 */
export function panelWindows(bg: Background) {
  const order: number[] = [];
  const open = () => new Set([...bg.panels.values()].filter((id): id is number => id !== undefined));
  /** Drops windows whose panels closed and adds new panel windows behind the ones the user worked in. */
  function prune() {
    const windows = open();
    for (let index = order.length - 1; index >= 0; index--) if (!windows.has(order[index]!)) order.splice(index, 1);
    for (const id of windows) if (!order.includes(id)) order.unshift(id);
  }
  return {
    /** Focus reached a window. A window without a panel (or another app, `WINDOW_ID_NONE`) leaves the current one in place. */
    focused(windowId: number | undefined) {
      if (windowId === undefined || !open().has(windowId)) return;
      const index = order.indexOf(windowId); if (index >= 0) order.splice(index, 1);
      order.push(windowId);
    },
    /** The current panel window, or undefined when no panel is open. */
    current() { prune(); return order.at(-1); },
    /** A restarted worker learns the last focused window from Chrome once. */
    async restore() {
      try { const window = await bg.browser.windows.getLastFocused(); this.focused(window.id); } catch { /* No window. */ }
    },
  };
}
