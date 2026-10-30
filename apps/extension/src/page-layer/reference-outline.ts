import type { PagePerson,PageUp } from '../runtime/browser/page-protocol';
import type { RefTarget } from '../runtime/browser/page-protocol';
import { locate } from './targets';
import { fill } from './text';
import type { OverlayHost } from './overlay-host';
import { face } from './overlay-host';

export function createReferenceOutline(context: OverlayHost, send: (message: PageUp) => void) {
  const { stage, timers, later } = context;
  const references = new Map<string, { refresh: (located: NonNullable<ReturnType<typeof locate>>, person: PagePerson, focus: boolean, duration: number) => void; remove: () => void }>();
  /** One outline per target: another locate refreshes it instead of piling up identical boxes and frame loops. */
  function showReference(target: RefTarget, person: PagePerson, requestId?: string, focus = false, duration = 4_000) {
    const key = JSON.stringify(Object.entries(target).sort(([a], [b]) => a.localeCompare(b)));
    let located = locate(target);
    let element = located?.el ?? located?.range?.startContainer.parentElement;
    if (!located || !element) {
      references.get(key)?.remove();
      if (requestId) send({ type: 'located', requestId, result: 'missing' });
      return;
    }
    const existing = references.get(key);
    if (existing) {
      existing.refresh(located, person, focus, duration);
      if (requestId) send({ type: 'located', requestId, result: 'shown' });
      return;
    }
    const box = document.createElement('div');
    box.className = 'box';
    const tag = document.createElement('div');
    tag.className = 'tag';
    box.append(tag);
    const edge = document.createElement('button');
    edge.className = 'edge';
    edge.hidden = true;
    const edgeText = document.createElement('span');
    edge.append(edgeText);
    edge.addEventListener('click', event => { if (event.isTrusted === false) return; element?.scrollIntoView({ block: 'center', inline: 'center', behavior: context.reducedMotion ? 'auto' : 'smooth' }); });
    stage.append(box, edge);

    let alive = true;
    let frame: number | undefined;
    let fadeTimer: number | undefined;
    let removeTimer: number | undefined;
    const cancelTimers = () => {
      for (const timer of [fadeTimer, removeTimer]) if (timer !== undefined) { window.clearTimeout(timer); timers.delete(timer); }
      fadeTimer = undefined; removeTimer = undefined;
    };
    const remove = () => {
      alive = false;
      cancelTimers();
      box.remove(); edge.remove();
      if (frame !== undefined) cancelAnimationFrame(frame);
      references.delete(key);
    };
    const follow = () => {
      if (!alive) return;
      if (!element?.isConnected) { remove(); return; }
      const rect = (located?.range ?? element).getBoundingClientRect();
      box.style.width = `${rect.width + 6}px`;
      box.style.height = `${rect.height + 6}px`;
      box.style.transform = `translate(${rect.left - 3}px,${rect.top - 3}px)`;
      const tagWidth = tag.offsetWidth;
      tag.style.left = `${Math.min(-2, innerWidth - 8 - tagWidth - (rect.left - 3))}px`;
      const below = rect.top - tag.offsetHeight - 8 < 0;
      tag.style.top = below ? 'calc(100% + 4px)' : '';
      tag.style.bottom = below ? 'auto' : '';
      const direction = rect.bottom < 0 ? 'above' : rect.top > innerHeight ? 'below' : '';
      edge.hidden = !direction;
      if (direction) {
        edgeText.textContent = `${fill(context.labels.refEdge, { name: person.name })} · ${context.labels[direction]}`;
        edge.style.top = direction === 'above' ? '12px' : `${innerHeight - 46}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    const refresh = (next: NonNullable<ReturnType<typeof locate>>, author: PagePerson, shouldFocus: boolean, lifetime: number) => {
      located = next; element = next.el ?? next.range?.startContainer.parentElement; person = author;
      if (!element) { remove(); return; }
      cancelTimers();
      if (frame !== undefined) cancelAnimationFrame(frame);
      box.classList.remove('leaving'); edge.classList.remove('leaving');
      tag.replaceChildren();
      if (person.avatar?.startsWith('data:image/')) tag.append(face(person));
      const name = document.createElement('span'); name.textContent = person.name; tag.append(name);
      if (shouldFocus) element.scrollIntoView({ block: 'center', inline: 'center', behavior: context.reducedMotion ? 'auto' : 'smooth' });
      follow();
      fadeTimer = later(() => { box.classList.add('leaving'); edge.classList.add('leaving'); }, Math.max(0, lifetime - 300));
      removeTimer = later(remove, lifetime);
    };
    references.set(key, { refresh, remove });
    refresh(located, person, focus, duration);
    if (requestId) send({ type: 'located', requestId, result: 'shown' });
  }


  return { show: showReference, clear() { references.forEach(reference => reference.remove()); references.clear(); } };
}
