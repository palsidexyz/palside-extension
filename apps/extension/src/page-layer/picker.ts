import type { PageUp } from '../runtime/browser/page-protocol';
import { selectionTarget } from './targets.ts';
import type { Overlay } from './overlay';
import type { RefTarget } from '../runtime/browser/page-protocol';

type Picked = { target: RefTarget; caption: string };
type Choice = Picked & { range: Range; content: string };
const identity = (item: Picked) => JSON.stringify({ target: Object.entries(item.target).sort(([a], [b]) => a.localeCompare(b)), caption: item.caption });

/** Native selection is observed continuously; only a host-bound context may submit it. */
export function createPicker(overlay: Overlay, send: (message: PageUp) => void) {
  let active = false, menuEnabled = true, canSticky = true, selecting = false;
  let contextId: string | undefined;
  let chosen: Choice | undefined;
  let pending: string | undefined;
  let operation: { content: string; requestId: string } | undefined;
  let errorReason: 'too-long' | 'unavailable' | undefined;
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  const ready = () => active && menuEnabled && Boolean(contextId);

  function clear(removeSelection = false) {
    chosen = undefined; pending = undefined; operation = undefined; selecting = false; errorReason = undefined;
    if (selectionTimer !== undefined) clearTimeout(selectionTimer);
    selectionTimer = undefined;
    overlay.hideSelection(); overlay.setPicking(false);
    if (removeSelection) getSelection()?.removeAllRanges();
  }
  function cancel() { clear(true); }
  function invalid(reason: 'too-long' | 'unavailable') {
    chosen = undefined; overlay.hideSelection(); overlay.setPicking(false);
    if (errorReason === reason || !contextId) return;
    errorReason = reason;
    send({ type: 'pick-error', contextId, reason });
  }
  function validatedChoice() {
    if (!chosen) return;
    const range = chosen.range;
    if (range.startContainer.isConnected === false || range.endContainer.isConnected === false) { invalid('unavailable'); return; }
    const result = selectionTarget(range);
    if (!result.item || identity(result.item) !== chosen.content) { invalid(result.reason ?? 'unavailable'); return; }
    return chosen;
  }
  function position(range: Range) {
    const rect = [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  }
  function submit(action: 'quote' | 'sticky') {
    if (!ready() || pending || !contextId) return;
    const item = validatedChoice(); if (!item) return;
    const content = JSON.stringify({ action, target: item.content });
    if (operation?.content !== content) operation = { content, requestId: crypto.randomUUID() };
    pending = operation.requestId;
    overlay.setSelectionPending(true);
    send(action === 'quote'
      ? { type: 'picked', contextId, requestId: pending, target: item.target, caption: item.caption }
      : { type: 'marked', contextId, requestId: pending, action: 'sticky', target: item.target, caption: item.caption, text: '' });
  }
  function choose(item: Picked, range: Range) {
    const content = identity(item);
    if (chosen?.content === content) { chosen.range = range.cloneRange(); overlay.repositionSelection(position(range)); return; }
    chosen = { ...item, range: range.cloneRange(), content };
    operation = undefined; errorReason = undefined;
    overlay.setPicking(true);
    overlay.showSelection(position(range), {
      quote: () => submit('quote'),
      ...(canSticky ? { sticky: () => submit('sticky') } : {}),
      cancel,
    });
  }
  function refreshSelection(revalidate = false) {
    if (!ready() || selecting || pending) return;
    // A focused shadow action may collapse the native selection; its captured Range stays authoritative.
    if (chosen && (revalidate || document.activeElement === overlay.host)) {
      const item = validatedChoice(); if (item) overlay.repositionSelection(position(item.range));
      return;
    }
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) { clear(); return; }
    const range = selection.getRangeAt(0);
    if (overlay.host.contains(range.commonAncestorContainer) || overlay.host.shadowRoot && range.commonAncestorContainer.getRootNode?.() === overlay.host.shadowRoot) return;
    const result = selectionTarget(range);
    if (!result.item) { invalid(result.reason); return; }
    choose(result.item, range);
  }
  function scheduleSelection(event?: Event, revalidate = event?.type === 'scroll' || event?.type === 'resize') {
    if (event?.isTrusted === false) return;
    if (!ready() || selecting || pending) return;
    if (selectionTimer !== undefined) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => { selectionTimer = undefined; refreshSelection(revalidate); }, event?.type === 'selectionchange' ? 100 : 10);
  }
  function nativeStart(event: Event) {
    if (event.isTrusted === false) return;
    if (!ready() || overlay.isControl(event) || pending) return;
    clear(); selecting = true;
  }
  function nativeEnd(event: Event) {
    if (event.isTrusted === false) return;
    if (!ready() || overlay.isControl(event)) return;
    selecting = false; scheduleSelection(event);
  }
  function keydown(event: KeyboardEvent) {
    if (event.isTrusted === false) return;
    if (!ready() || !chosen || event.key !== 'Escape' || overlay.isControl(event)) return;
    event.preventDefault(); event.stopImmediatePropagation(); cancel();
  }
  const changes = new MutationObserver(records => {
    if (!chosen || !ready() || pending) return;
    const owner = chosen.range.commonAncestorContainer;
    if (records.every(record => record.target === overlay.host || overlay.host.contains(record.target))) return;
    if (chosen.range.startContainer.isConnected === false || chosen.range.endContainer.isConnected === false || records.some(record => record.target === owner || record.target.contains(owner) || owner.contains(record.target))) scheduleSelection(undefined, true);
  });
  if (document.documentElement) changes.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'contenteditable', 'data-private'] });
  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('pointerdown', nativeStart, true);
  document.addEventListener('mouseup', nativeEnd, true);
  document.addEventListener('pointerup', nativeEnd, true);
  document.addEventListener('keyup', nativeEnd, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('scroll', scheduleSelection, true);
  window.addEventListener('resize', scheduleSelection);

  return {
    enable(value: boolean) { active = value; if (!value) clear(); else refreshSelection(); },
    set(value: boolean, sticky = true, context?: string) {
      if (!value) { clear(true); contextId = undefined; return; }
      if (context && context !== contextId) { clear(Boolean(contextId)); contextId = context; }
      canSticky = sticky;
      refreshSelection();
    },
    setSelectionEnabled(value: boolean) { menuEnabled = value; if (!value) clear(); else refreshSelection(); },
    result(message: { requestId: string; ok: boolean; error?: string; stickyId?: string; revision?: string; existing?: boolean }) {
      if (!active || pending !== message.requestId) return;
      pending = undefined;
      if (message.ok) { clear(true); if (message.stickyId) overlay.showSavedMark(message.stickyId); }
      else overlay.setSelectionPending(false, message.error);
    },
    clear,
    invalidate() { clear(true); contextId = undefined; },
    dispose() {
      active = false; clear(); changes.disconnect();
      document.removeEventListener('selectionchange', scheduleSelection);
      document.removeEventListener('pointerdown', nativeStart, true);
      document.removeEventListener('mouseup', nativeEnd, true);
      document.removeEventListener('pointerup', nativeEnd, true);
      document.removeEventListener('keyup', nativeEnd, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('scroll', scheduleSelection, true);
      window.removeEventListener('resize', scheduleSelection);
    },
  };
}
