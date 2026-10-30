import type { PageSticky,PageUp } from '../runtime/browser/page-protocol';
import { locate,invalidateTargets,type Located } from './targets';
import { mergePins,pinPoint,stickyCard,createStickyHighlight } from './pins';
import type { OverlayHost } from './overlay-host';
import { face } from './overlay-host';

export function createStickyProjection(context: OverlayHost, send: (message: PageUp) => void, scheduleDanmakuArea: () => void) {
  const { host, documentLayer, documentPoint, timers, later, isControl } = context;
  const pins = document.createElement('div'); pins.className = 'pins'; documentLayer.append(pins);
  let stickies: PageSticky[] = [];
  let stickyFrame: number | undefined;
  let missingKey = '';
  let stickyScanTimer: number | undefined;
  let stickyScanAt = 0;
  let openCard: HTMLElement | undefined;
  const stickyLocations = new Map<string, (Located & { start?: Node; end?: Node }) | undefined>();
  const highlight = typeof CSS.highlights !== 'undefined' && typeof Highlight !== 'undefined' ? createStickyHighlight() : undefined;
  function hasViewportAnchor(element?: Element | null) {
    for (let node = element; node; node = node.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(node).position)) return true;
    return false;
  }
  function stickyLocation(sticky: PageSticky) {
    if (!stickyLocations.has(sticky.id)) {
      const located = locate(sticky.target);
      stickyLocations.set(sticky.id, located && { ...located, start: located.range?.startContainer, end: located.range?.endContainer });
    }
    return stickyLocations.get(sticky.id);
  }

  function closeCard() {
    openCard?.classList.remove('open');
    openCard = undefined;
  }

  /** Pins follow the latest positions; overlapping ones merge into one pin with stacked faces and a count. A pin is reused while its group is unchanged, so hovering survives redraws. */
  const pinNodes = new Map<string, { pin: HTMLButtonElement; card: HTMLElement; x: number; y: number; content: string }>();
  function drawStickies() {
    if (stickyFrame !== undefined) cancelAnimationFrame(stickyFrame);
    stickyFrame = undefined;
    stickyScanAt = performance.now();
    const found: { item: PageSticky; x: number; y: number }[] = [];
    const missing: string[] = [];
    const ranges: Range[] = [];
    for (const sticky of stickies) {
      const located = stickyLocation(sticky);
      const element = located?.el ?? located?.range?.startContainer.parentElement;
      const rect = (located?.range ?? located?.el)?.getBoundingClientRect();
      if (located && element?.isConnected && rect && rect.width + rect.height > 0) {
        found.push({ item: sticky, ...pinPoint(rect) });
        ranges.push(located.range);
      } else missing.push(sticky.id);
    }
    highlight?.update(ranges);
    const key = missing.sort().join(',');
    if (key !== missingKey) {
      missingKey = key;
      send({ type: 'stickies-located', missing });
    }
    const groups = mergePins(found);
    const keys = new Set(groups.map(group => group.items.map(item => item.id).join(',')));
    for (const [groupKey, node] of pinNodes) if (!keys.has(groupKey)) {
      if (openCard === node.card) closeCard();
      node.pin.remove();
      node.card.remove();
      pinNodes.delete(groupKey);
    }
    for (const group of groups) {
      const groupKey = group.items.map(item => item.id).join(',');
      const content = JSON.stringify(group.items);
      let node = pinNodes.get(groupKey);
      if (node && node.content !== content) {
        if (openCard === node.card) closeCard();
        node.pin.remove(); node.card.remove();
        pinNodes.delete(groupKey);
        node = undefined;
      }
      node ??= createPin(group.items, groupKey, content);
      node.x = group.x;
      node.y = group.y;
      const visible = group.items.some(item => {
        const located = stickyLocations.get(item.id);
        for (let parent = (located?.el ?? located?.range?.startContainer.parentElement)?.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const rect = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (group.y < rect.top || group.y > rect.bottom)) return false;
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (group.x < rect.left || group.x > rect.right)) return false;
        }
        return true;
      });
      node.pin.toggleAttribute('data-off', !visible);
      // The pin's sharp corner points at the spot; near the right edge it opens to the left instead.
      const width = node.pin.offsetWidth || 28;
      const flip = group.x + width > innerWidth - 4;
      node.pin.toggleAttribute('data-flip', flip);
      const at = documentPoint(flip ? group.x - width : group.x, group.y - 28);
      node.pin.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px)`;
      if (!visible && openCard === node.card) closeCard();
      else if (openCard === node.card) placeCard(node);
    }
  }

  function placeCard(node: { card: HTMLElement; x: number; y: number }) {
    const width = node.card.offsetWidth || 260;
    const height = node.card.offsetHeight || 80;
    const left = Math.max(8, Math.min(innerWidth - width - 8, node.x - 14));
    const top = node.y - 34 - height >= 8 ? node.y - 34 - height : Math.min(innerHeight - height - 8, node.y + 6);
    const at = documentPoint(left, top);
    node.card.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y)}px)`;
  }

  function createPin(items: PageSticky[], groupKey: string, content: string) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    const name = (item: PageSticky) => item.self ? context.labels.you : item.author.name;
    const people = [...new Map(items.map(item => [item.author.name, item])).values()];
    people.slice(0, 2).forEach(item => pin.append(face(item.author)));
    if (items.length > 1) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(items.length);
      pin.append(count);
    }
    pin.setAttribute('aria-label', items.map(item => `${name(item)}: ${item.text || (item.target.kind === 'quote' ? item.target.exact : context.labels.openMark)}`).join('\n'));
    const card = stickyCard(items, item => face(item.author), name, context.labels.locale);
    const node = { pin, card, x: 0, y: 0, content };
    let leave: number | undefined;
    const hold = (event: Event) => {
      if (event.isTrusted === false) return;
      if (leave !== undefined) { window.clearTimeout(leave); timers.delete(leave); }
      leave = undefined;
      if (openCard !== card) closeCard();
      openCard = card;
      card.classList.add('open');
      const rect = pin.getBoundingClientRect();
      node.x = rect.left; node.y = rect.bottom;
      placeCard(node);
    };
    const release = (event: Event) => { if (event.isTrusted === false) return; leave = later(() => { if (openCard === card) closeCard(); }, 120); };
    pin.addEventListener('focus', event => { if (event.isTrusted === false) return; closeCard(); });
    pin.title = items.map(item => item.text || (item.target.kind === 'quote' ? item.target.exact : name(item))).join('\n');
    card.addEventListener('mouseenter', hold);
    card.addEventListener('mouseleave', release);
    const open = (event: Event) => { if (event.isTrusted === false) return; send({ type: 'open-sticky', id: items[0]!.id }); };
    pin.addEventListener('click', open);
    card.addEventListener('click', open);
    pins.append(pin, card);
    pinNodes.set(groupKey, node);
    return node;
  }

  function scheduleStickies() {
    if (stickyFrame !== undefined || !stickies.length && !pins.childElementCount) return;
    stickyFrame = requestAnimationFrame(drawStickies);
  }
  const resizeObserver = new ResizeObserver(() => { scheduleStickies(); scheduleDanmakuArea(); });
  function observeTargets() {
    resizeObserver.disconnect();
    if (document.body) resizeObserver.observe(document.body);
    for (const located of stickyLocations.values()) {
      for (let node = located?.el ?? located?.range?.startContainer.parentElement; node; node = node.parentElement) resizeObserver.observe(node);
    }
  }
  const mutations = new MutationObserver(records => {
    const changes = records.filter(record => !host.contains(record.target));
    if (!changes.length) return;
    invalidateTargets();
    for (const [id, located] of stickyLocations) {
      const element = located?.el ?? located?.range?.commonAncestorContainer;
      const detached = located?.start?.isConnected === false || located?.end?.isConnected === false;
      const related = (node: Node) => Boolean(element && (element.contains(node) || node.contains(element)));
      const changed = changes.some(record => {
        // A body-level tooltip or sibling insertion does not change an existing text anchor.
        // Removed endpoints are checked separately because live Ranges move to their former parent.
        if (record.type === 'childList') return [...record.addedNodes, ...record.removedNodes].some(related);
        return related(record.target);
      });
      if (!element || !element.isConnected || detached || changed) stickyLocations.delete(id);
    }
    if (stickyScanTimer === undefined) stickyScanTimer = window.setTimeout(() => { stickyScanTimer = undefined; scheduleStickies(); }, Math.max(80, 250 - (performance.now() - stickyScanAt)));
    scheduleDanmakuArea();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['id', 'class', 'style', 'hidden', 'aria-hidden', 'inert', 'contenteditable', 'role', 'data-private', 'data-trade-panel', 'aria-label', 'data-testid', 'autocomplete'] });
  let openHighlightTimer: number | undefined;
  const cancelHighlightOpen = (event?: Event) => { if (event?.isTrusted === false) return; if (openHighlightTimer !== undefined) { window.clearTimeout(openHighlightTimer); timers.delete(openHighlightTimer); openHighlightTimer = undefined; } };
  const openHighlighted = (event: MouseEvent) => {
    if (event.isTrusted === false) return;
    cancelHighlightOpen();
    if (context.picking || context.disposed || event.defaultPrevented || event.button !== 0 || event.detail > 1 || !getSelection()?.isCollapsed || isControl(event)) return;
    if (event.target instanceof Element && event.target.closest('a,button,input,textarea,select,[contenteditable],[role="button"],[role="link"]')) return;
    const matches = stickies.filter(item => {
      const range = stickyLocations.get(item.id)?.range;
      return range && [...range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    });
    if (!matches.length) return;
    const id = matches[0]!.id;
    openHighlightTimer = later(() => {
      openHighlightTimer = undefined;
      if (!context.picking && !context.disposed && getSelection()?.isCollapsed && stickies.some(item => item.id === id)) send({ type: 'open-sticky', id });
    }, 400);
  };
  const cancelSelectedHighlightOpen = (event: Event) => { if (event.isTrusted === false) return; if (!getSelection()?.isCollapsed) cancelHighlightOpen(); };
  document.addEventListener('click', openHighlighted);
  document.addEventListener('pointerdown', cancelHighlightOpen, true);
  document.addEventListener('dblclick', cancelHighlightOpen, true);
  document.addEventListener('selectionchange', cancelSelectedHighlightOpen);
  const scroll = (event: Event) => {
    const viewport = event.target === document || event.target === window;
    const anchored = [...stickyLocations.values()].some(item => hasViewportAnchor(item?.el ?? item?.range?.startContainer.parentElement));
    if (!viewport || anchored) drawStickies();
  };
  const resize = () => { scheduleStickies(); };
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', scroll, { passive: true, capture: true });


  return { updateStickies(items: PageSticky[]) {
      const previous = new Map(stickies.map(item => [item.id, item]));
      stickies = items;
      for (const id of stickyLocations.keys()) {
        const next = items.find(item => item.id === id);
        if (!next || JSON.stringify(previous.get(id)?.target) !== JSON.stringify(next.target)) stickyLocations.delete(id);
      }
      if (stickyFrame !== undefined) cancelAnimationFrame(stickyFrame);
      drawStickies();
      observeTargets();
    },
    clear() {
      cancelHighlightOpen();
      if (stickyScanTimer !== undefined) window.clearTimeout(stickyScanTimer);
      stickyScanTimer = undefined;
      if (stickyFrame !== undefined) cancelAnimationFrame(stickyFrame);
      stickyFrame = undefined;
      resizeObserver.disconnect();
      stickies = []; stickyLocations.clear(); highlight?.update([]);
      missingKey = ''; closeCard(); pinNodes.clear(); pins.replaceChildren();
    },
    dispose() {
      mutations.disconnect();
      document.removeEventListener('click', openHighlighted);
      document.removeEventListener('pointerdown', cancelHighlightOpen, true);
      document.removeEventListener('dblclick', cancelHighlightOpen, true);
      document.removeEventListener('selectionchange', cancelSelectedHighlightOpen);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', scroll, true);
      highlight?.dispose();
    },
  };
}
