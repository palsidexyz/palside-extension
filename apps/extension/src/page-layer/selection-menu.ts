import type { PageUp } from '../runtime/browser/page-protocol';
import type { OverlayHost } from './overlay-host';

export function createSelectionMenu(context: OverlayHost, send: (message: PageUp) => void) {
  const { documentLayer, documentPoint, later } = context;
  let selectionMenu: HTMLElement | undefined;
  function hideSelection() { selectionMenu?.remove(); selectionMenu = undefined; }
  function setPending(element: HTMLElement | undefined, pending: boolean, error?: string) {
    if (!element) return;
    for (const button of element.querySelectorAll<HTMLButtonElement>('button')) button.disabled = pending;
    element.setAttribute('aria-busy', String(pending));
    element.querySelector('[role=alert]')?.remove();
    if (error) { const message = document.createElement('span'); message.setAttribute('role', 'alert'); message.textContent = error; element.append(message); }
  }
  let selectionAt = { x: 8, y: 8 };
  let savedMark: HTMLElement | undefined;
  function repositionSelection(at: { x: number; y: number }) {
    selectionAt = at;
    if (!selectionMenu) return;
    const point = documentPoint(Math.max(8, Math.min(innerWidth - selectionMenu.offsetWidth - 8, at.x)), Math.max(8, Math.min(innerHeight - selectionMenu.offsetHeight - 8, at.y + 8)));
    selectionMenu.style.transform = `translate(${point.x}px,${point.y}px)`;
  }
  function showSavedMark(id: string) {
    savedMark?.remove();
    const status = document.createElement('div'); status.className = 'selection'; status.setAttribute('role', 'status'); status.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px';
    const label = document.createElement('span'); label.textContent = context.labels.saved;
    const open = document.createElement('button'); open.type = 'button'; open.textContent = context.labels.openMark;
    open.addEventListener('click', event => { if (event.isTrusted === false) return; send({ type: 'open-sticky', id }); status.remove(); });
    status.append(label, open); documentLayer.append(status); savedMark = status;
    const point = documentPoint(Math.max(8, Math.min(innerWidth - status.offsetWidth - 8, selectionAt.x)), Math.max(8, Math.min(innerHeight - status.offsetHeight - 8, selectionAt.y + 8)));
    status.style.transform = `translate(${point.x}px,${point.y}px)`;
    later(() => { status.remove(); if (savedMark === status) savedMark = undefined; }, 3500);
  }
  function showSelection(at: { x: number; y: number }, actions: { sticky?: () => void; quote?: () => void; cancel: () => void }) {
    hideSelection(); savedMark?.remove(); savedMark = undefined;
    const menu = document.createElement('div'); menu.className = 'selection'; menu.setAttribute('role', 'group');
    menu.addEventListener('pointerdown', event => { if (event.isTrusted === false) return; event.preventDefault(); });
    menu.addEventListener('keydown', event => { if (event.isTrusted === false) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); actions.cancel(); } });
    const choices = [[context.labels.quote, actions.quote], [context.labels.mark, actions.sticky], [context.labels.cancel, actions.cancel]] as const;
    for (const [label, action] of choices) if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', event => { if (event.isTrusted === false) return; action(); }); menu.append(button); }
    documentLayer.append(menu); selectionMenu = menu;
    repositionSelection(at);
  }

  return { showSelection, repositionSelection, showSavedMark, hideSelection,
    setSelectionPending: (pending: boolean, error?: string) => setPending(selectionMenu, pending, error),
    clear() { hideSelection(); savedMark?.remove(); savedMark = undefined; },
  };
}
