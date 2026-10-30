import { overlayStyles } from './overlay-style';
import { avatarTints } from './palette';
import type { PageLabels,PagePerson } from '../runtime/browser/page-protocol';
export const defaultLabels: PageLabels = { quote: '', mark: '', saved: '', openMark: '', cancel: '', refEdge: '{name}', above: '', below: '', you: '', locale: 'en' };
export function face(person: PagePerson) {
  const element = document.createElement('span');
  element.className = 'avatar';
  let hash = 0;
  for (const character of person.name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  element.style.background = avatarTints[Math.abs(hash) % avatarTints.length]!;
  element.textContent = person.name.slice(0, 1).toUpperCase();
  if (person.avatar?.startsWith('data:image/')) {
    const image = new Image();
    image.alt = '';
    image.src = person.avatar;
    element.replaceChildren(image);
  }
  return element;
}
function pageIsLight() {
  const values = getComputedStyle(document.body).backgroundColor.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return values.length >= 3 && values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722 > 180;
}
export type OverlayHost = ReturnType<typeof createOverlayHost>;
export function createOverlayHost() {
  const host = document.createElement('palside-page-layer');
  host.style.cssText = 'all:initial!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important';
  const shadow = host.attachShadow({ mode: 'closed' });
  const stage = document.createElement('div');
  stage.className = 'stage';
  if (pageIsLight()) stage.dataset.theme = 'light';
  const style = document.createElement('style');
  style.textContent = overlayStyles;
  const documentLayer = document.createElement('div');
  documentLayer.className = 'document-layer';
  shadow.append(style, stage, documentLayer);
  document.documentElement.append(host);


  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const context = { host, shadow, stage, documentLayer, motion, labels: { ...defaultLabels }, picking: false, reducedMotion: motion.matches, disposed: false, timers: new Set<number>(), later, documentPoint, isControl };
  host.toggleAttribute('data-reduced', context.reducedMotion);
  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => { context.timers.delete(timer); if (!context.disposed) callback(); }, delay);
    context.timers.add(timer);
    return timer;
  }
  const origin = () => host.getBoundingClientRect();
  function documentPoint(x: number, y: number) { const at = origin(); return { x: x - at.left, y: y - at.top }; }
  function isControl(event: Event) {
    if (!event.composedPath().includes(host)) return false;
    const point = event as MouseEvent;
    const element = event.type.startsWith('key') ? shadow.activeElement : shadow.elementFromPoint(point.clientX, point.clientY);
    return Boolean(element?.closest('button,input,form,.sticky-card,.dm,.capture-editor'));
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu', 'dragstart', 'keydown', 'keyup']) {
    shadow.addEventListener(type, event => event.stopPropagation());
  }


  return context;
}
