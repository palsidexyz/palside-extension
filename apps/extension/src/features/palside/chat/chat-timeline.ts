import { ChatArrivals,captureReadingPosition,glideEase,glidePlan,latestTolerance,parseReadingPosition,readingTop,type ReadingPosition } from './chat-reading';
import { isMessageVisible } from './message-visibility';
import type { Message } from '../../../domain/chat/model';

const emptySnapshot = { away: false, newCount: 0, canReturn: false, target: '', trail: '', landing: 0 };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One return stop: where the reader was, and the message that was the jump target there ('' for the first stop). */
type TrailStop = { position: ReadingPosition; target: string };
type Snapshot = typeof emptySnapshot;
type VisibleReporter = (ids: string[]) => Promise<unknown>;

/** Owns one account/team/window's scroll state, including while its chat is hidden. */
export class ChatTimeline {
  private root?: HTMLDivElement;
  private content?: HTMLDivElement;
  private active = false;
  private messages: Message[] = [];
  private arrivals = new ChatArrivals();
  private position: ReadingPosition = { latest: true, top: 0, anchors: [] };
  private trail: TrailStop[] = [];
  private glideFrame = 0;
  private landing = 0;
  private snapshot = emptySnapshot;
  private listeners = new Set<() => void>();
  private resize?: ResizeObserver;
  private modals?: MutationObserver;
  private obscured = false;
  private timer?: ReturnType<typeof setTimeout>;
  private reporter?: VisibleReporter;
  private reported = '';
  private persisted = '';
  private programmedTop?: number;
  private height = 0;
  private scrollHeight = 0;
  private connected = false;
  private revision = 0;
  private target = '';
  private externalJump?: string;
  private laidOut = false;

  constructor(private readonly key: string, private readonly self: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => emptySnapshot;

  connect(root: HTMLDivElement, content: HTMLDivElement) {
    this.root = root; this.content = content; this.connected = true;
    try { this.position = parseReadingPosition(sessionStorage.getItem(this.key)) ?? this.position; } catch { /* In-memory reading still works. */ }
    root.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('focus', this.scheduleVisible);
    window.addEventListener('blur', this.hideVisible);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.obscured = Boolean(document.querySelector('dialog:modal'));
    this.modals = new MutationObserver(this.onModals);
    this.modals.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    this.resize = new ResizeObserver(() => this.reconcile());
    this.resize.observe(root); this.resize.observe(content);
    return () => {
      this.persist(); this.stopGlide(); this.connected = false; this.active = false; this.revision++;
      this.resize?.disconnect(); this.modals?.disconnect(); clearTimeout(this.timer); this.hideVisible();
      root.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('focus', this.scheduleVisible);
      window.removeEventListener('blur', this.hideVisible);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.root = undefined; this.content = undefined;
    };
  }

  setReporter(reporter?: VisibleReporter) { this.hideVisible(); this.reporter = reporter; this.reported = ''; this.scheduleVisible(); }

  update(messages: Message[], active: boolean, jumpId?: string) {
    this.onModals();
    const wasActive = this.active;
    this.messages = messages; this.arrivals.update(messages, this.self);
    if (this.active && !active) { this.stopGlide(); this.persist(); this.hideVisible(); this.revision++; }
    this.active = active;
    if (!jumpId) this.externalJump = undefined;
    if (active && jumpId && (jumpId !== this.externalJump || !wasActive)) {
      if (!this.laidOut) this.reconcile();
      if (this.jump(jumpId)) { this.externalJump = jumpId; return; }
    }
    if (active) this.reconcile(); else this.publish();
  }

  private rows() {
    if (!this.content) return [];
    const inset = this.content.offsetTop;
    return [...this.content.querySelectorAll<HTMLElement>('[data-message-id]')].map(el => ({ id: el.dataset.messageId!, top: inset + el.offsetTop, height: el.offsetHeight }));
  }

  private max() { return Math.max(0, (this.root?.scrollHeight ?? 0) - (this.root?.clientHeight ?? 0)); }

  private writeTop(top: number) {
    if (!this.root) return;
    this.root.scrollTop = top; this.programmedTop = this.root.scrollTop;
    this.height = this.root.clientHeight; this.scrollHeight = this.root.scrollHeight;
  }

  private remember() {
    if (!this.root || !this.active || !this.root.clientHeight) return;
    this.position = captureReadingPosition(this.rows(), this.root.scrollTop, this.root.clientHeight, this.position.latest);
    this.persist();
  }

  private persist() {
    const value = JSON.stringify(this.position);
    if (value === this.persisted) return;
    try { sessionStorage.setItem(this.key, value); this.persisted = value; } catch { /* Private/storage-disabled windows keep in-memory state. */ }
  }

  private reconcile() {
    if (!this.connected || !this.active || !this.root?.clientHeight) return;
    // A glide owns the scroll position until it lands; it reconciles itself at the end.
    if (this.glideFrame) { this.publish(); return; }
    if (!this.messages.length) { this.position.latest = true; this.trail = []; this.target = ''; }
    this.writeTop(readingTop(this.position, this.rows(), this.max()));
    this.laidOut = true;
    if (this.position.latest && !this.obscured) this.arrivals.clear();
    this.remember(); this.publish(); this.scheduleVisible();
  }

  private onScroll = () => {
    if (!this.active || !this.root?.clientHeight) return;
    if (this.programmedTop !== undefined && Math.abs(this.root.scrollTop - this.programmedTop) < 1) { this.programmedTop = undefined; return; }
    this.programmedTop = undefined;
    // The reader took over: a running glide stops where it is and does not land.
    this.stopGlide();
    // Resize/DOM clamping is not a request to leave or rejoin the live tail.
    if (this.height !== this.root.clientHeight || this.scrollHeight !== this.root.scrollHeight) { this.reconcile(); return; }
    this.revision++;
    this.position.latest = this.max() - this.root.scrollTop <= latestTolerance;
    if (this.position.latest && !this.obscured) this.arrivals.clear();
    this.remember(); this.publish(); this.scheduleVisible();
  };

  latest = () => {
    if (!this.active || !this.connected) return;
    this.stopGlide();
    this.revision++; this.trail = []; this.target = '';
    this.position.latest = true; if (!this.obscured) this.arrivals.clear(); this.reconcile();
  };

  /** Centres a message and records the current place as a return stop; a repeated jump to the same message only lands again. */
  jump = (id: string) => {
    if (!this.active || !this.root?.clientHeight) return false;
    const row = this.rows().find(item => item.id === id);
    if (!row) return false;
    if (id !== this.target) this.trail.push({ position: { ...this.position, latest: false }, target: this.target });
    this.revision++; this.target = id;
    this.position = { latest: false, top: Math.max(0, row.top - (this.root.clientHeight - Math.min(row.height, this.root.clientHeight)) / 2), anchors: [] };
    this.glide(true); return true;
  };

  /** Returns to one stop of the trail, dropping it and every stop after it. */
  returnTo = (index: number) => {
    const stop = this.trail[index];
    if (!stop || !this.active) return;
    this.trail = this.trail.slice(0, index); this.position = stop.position; this.target = stop.target; this.revision++;
    this.glide(false);
  };

  /** An async send may finish after navigation, a team switch or a fresh user scroll. */
  sendIntent = () => {
    const revision = this.revision;
    return () => { if (this.connected && this.active && this.revision === revision) { this.latest(); return true; } return false; };
  };

  /** Real scrolling toward the current position: far targets are approached from within reach, then eased in. */
  private glide(lands: boolean) {
    this.stopGlide();
    const root = this.root;
    if (!root || !this.connected) return;
    const to = readingTop(this.position, this.rows(), this.max());
    const plan = glidePlan(root.scrollTop, to);
    const land = () => { this.glideFrame = 0; this.reconcile(); if (lands) { this.landing++; this.publish(); } };
    if (reducedMotion() || !plan.duration || typeof requestAnimationFrame !== 'function') { land(); return; }
    this.writeTop(plan.start);
    const started = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - started) / plan.duration);
      this.writeTop(plan.start + plan.path * glideEase(t));
      if (t < 1) this.glideFrame = requestAnimationFrame(step); else land();
    };
    this.glideFrame = requestAnimationFrame(step);
    this.publish();
  }

  private stopGlide() { if (this.glideFrame) cancelAnimationFrame(this.glideFrame); this.glideFrame = 0; }

  private publish() {
    const next: Snapshot = { away: Boolean(this.active && this.root && this.max() - this.root.scrollTop > latestTolerance), newCount: this.arrivals.pending.size, canReturn: this.trail.length > 0, target: this.target, trail: this.trail.map(stop => stop.target).join('\n'), landing: this.landing };
    if (Object.keys(next).every(key => next[key as keyof Snapshot] === this.snapshot[key as keyof Snapshot])) return;
    this.snapshot = next; for (const listener of this.listeners) listener();
  }

  private sendVisible(ids: string[]) {
    const signature = JSON.stringify(ids);
    if (signature === this.reported) return;
    this.reported = signature;
    void this.reporter?.(ids).catch(() => { if (this.reported === signature) this.reported = ''; });
  }

  private hideVisible = () => { clearTimeout(this.timer); this.timer = undefined; this.sendVisible([]); };
  private onModals = () => {
    const obscured = Boolean(document.querySelector('dialog:modal'));
    if (obscured === this.obscured) return;
    this.obscured = obscured;
    if (obscured) this.hideVisible(); else this.scheduleVisible();
  };
  private onVisibility = () => { if (document.visibilityState === 'visible') this.scheduleVisible(); else this.hideVisible(); };
  private scheduleVisible = () => {
    if (document.querySelector('dialog:modal')) { this.hideVisible(); return; }
    if (!this.active || !this.connected) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const root = this.root;
      if (!root || !this.active || !root.clientHeight || !document.hasFocus() || document.visibilityState !== 'visible' || document.querySelector('dialog:modal')) { this.hideVisible(); return; }
      const rect = root.getBoundingClientRect();
      // Navigation sits over the reserved lower strip, which isn't readable content.
      const inset = this.snapshot.away || this.snapshot.canReturn ? 52 : 0;
      const viewport = { top: Math.max(0, rect.top), bottom: Math.min(innerHeight, rect.bottom - inset), left: Math.max(0, rect.left), right: Math.min(innerWidth, rect.right) };
      const sent = new Set(this.messages.filter(m => m.status === 'sent' && !m.recalled).map(m => m.id));
      const ids = [...root.querySelectorAll<HTMLElement>('[data-message-id]')].filter(el => sent.has(el.dataset.messageId!) && isMessageVisible(el.getBoundingClientRect(), viewport)).map(el => el.dataset.messageId!);
      this.arrivals.acknowledge(ids); this.publish(); this.sendVisible(ids);
    }, 300);
  };
}
