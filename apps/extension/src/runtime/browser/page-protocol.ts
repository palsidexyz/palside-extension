import type { RuntimeState } from '../composition/runtime-state';
import type { AccessStatus } from './permissions';
import type { ReceivedSignal,SignalKind,SignalTarget,SignalSettings } from '../annotations/signals';

export type AssetKey = string;
/** Page targets only: a quoted 弹幕 line never reaches a page. */
export type RefTarget = Exclude<NonNullable<RuntimeState['data']['messages'][number]['ref']>['target'], { kind: 'danmaku' }>;

/**
 * What the side panel knows about the active tab of its window, pushed by the background on the panel port as `{ type: 'page', status }`.
 * 网页互动 requires the account's switches, a current joined team, an open panel in this window and this site's Chrome grant.
 */
export type PageStatus = {
  windowId: number;
  tabId?: number;
  /** Supported token page of the active tab, if any. */
  asset?: AssetKey;
  host?: string;
  url?: string;
  access: AccessStatus;
  title?: string;
  favicon?: string;
  /** A joined team is current and this site's access is granted, so page actions run here. */
  granted: boolean;
  /** 网页互动 runs here: it is switched on and `granted`. One-off actions never change it. */
  interactive: boolean;
  /** 便利贴 show and can be added here: `interactive` ∧ the 便利贴 switch under 网页互动. */
  stickyEnabled: boolean;
  /** Signals send and show here: `interactive` ∧ the signal switch under 网页互动. */
  signalEnabled: boolean;
  signalSettings?: SignalSettings;
  /** The page script is running in the active tab, for 互动 or for a one-off action (quote, locate, capture). */
  connected: boolean;
  /** The registry can read the token's name and icon on this site. */
  tokenProfile: boolean;
  /** 便利贴 of this page whose target the page script could not find (已不在页面上). */
  missingStickies?: string[];
  /** What each page action can do on this tab right now; the panel disables or grants from this alone. */
  capabilities: PageCapabilities;
};

/**
 * Panel → background page commands (`palside/command`; the bridge adds `windowId`): `selection-enabled`,
 * `locate-ref`, `locate-sticky`, `quote-sticky`, `capture`, `link-card`, `signal-settings`/`signal-settings-get`, `danmaku-settings`.
 * 网页互动 runs through the offscreen `toggle` and `preferences`; a grant change re-registers it through `permissions.onAdded/onRemoved`.
 */
/** Page actions: screenshot, native text selection for references and sticky notes, danmaku, and sharing the page link. */
export type PageAction = 'capture' | 'pick' | 'danmaku' | 'signal' | 'share';
/** `ready`: works now. `access`: needs Chrome access for the action; capture requires all_urls or activeTab from the toolbar or shortcut. `pending`: the tab is still loading. `blocked`: can never work on this tab. */
export type CapabilityState = 'ready' | 'access' | 'pending' | 'blocked';
/** Why an action is blocked: a browser or extension page, the Chrome Web Store, a local file, a non-public address, or no tab at all. */
export type BlockReason = 'browser' | 'store' | 'file' | 'private' | 'none';
export type PageCapability = { state: CapabilityState; reason?: BlockReason };
export type PageCapabilities = Record<PageAction, PageCapability>;

/** Person shown next to page-layer content; the avatar is a data URL or absent (initials are drawn). */
export type PagePerson = { name: string; avatar?: string };
export type DanmakuArea = 'top' | 'chart' | 'full';
export type DanmakuSpeed = 110 | 144 | 190;
export type DanmakuSize = 'sm' | 'md' | 'lg';
export type DanmakuDensity = 'low' | 'mid' | 'high';
export const danmakuLimits = { low: 4, mid: 8, high: 14 };
export type DanmakuSettings = { density: DanmakuDensity; enabled: boolean; area: DanmakuArea; speed: DanmakuSpeed; size: DanmakuSize; opacity: number };
export const defaultDanmakuSettings: DanmakuSettings = { density: 'mid', enabled: true, area: 'chart', speed: 144, size: 'md', opacity: 90 };
export function normalizeDanmakuSettings(value: unknown): DanmakuSettings {
  if (!value || typeof value !== 'object') return { ...defaultDanmakuSettings };
  const input = value as Record<string, unknown>;
  const area: DanmakuArea = input.area === 'top' || input.area === 'full' || input.area === 'chart' ? input.area : defaultDanmakuSettings.area;
  const speed: DanmakuSpeed = input.speed === 110 || input.speed === 190 || input.speed === 144 ? input.speed : defaultDanmakuSettings.speed;
  const size: DanmakuSize = input.size === 'sm' || input.size === 'md' || input.size === 'lg' ? input.size : defaultDanmakuSettings.size;
  const opacity = typeof input.opacity === 'number' && Number.isFinite(input.opacity) ? Math.max(30, Math.min(100, Math.round(input.opacity))) : defaultDanmakuSettings.opacity;
  const density = input.density === 'low' || input.density === 'high' ? input.density : 'mid';
  return { enabled: input.enabled !== false, area, density, speed, size, opacity };
}
export type PageDanmaku = { id: string; key: string; text: string; author: PagePerson; self?: boolean; mate?: boolean; timestamp?: number };
/** Public display fields only; account IDs, wallet addresses and payment credentials stay in the extension. */
/** Opens the room in the side panel; claims and payment actions never run in the page. */
export type PageRoomPacket = { roomKey: string };
/** Persistent sticky-note projection for this exact page; overlapping pins merge without truncating the record set. */
export type PageSticky = { id: string; target: RefTarget; text: string; author: PagePerson; self?: boolean; timestamp: number };
export type LocateResult = 'shown' | 'missing' | 'hidden' | 'other-site' | 'unavailable';
/** Opening can succeed even when locating the quoted target fails. */
export type LocateReply = { result: LocateResult; opened: boolean };
export type CaptureLabels = {
  rectangle: string;
  arrow: string;
  pen: string;
  text: string;
  mosaic: string;
  undo: string;
  copy: string;
  cancel: string;
  done: string;
  copied: string;
};
export type PageLabels = {
  quote: string;
  /** Native selection action for saving a sticky note. */
  mark: string;
  saved: string;
  openMark: string;
  cancel: string;
  refEdge: string;
  above: string;
  below: string;
  you: string;
  packet?: string;
  member?: string;
  /** The tag on a teammate's 弹幕 card. */
  mate?: string;
  /** UI language, for relative times drawn on the page. */
  locale: string;
  capture?: CaptureLabels;
};

/** Page script → background over the `palside/page` port. */
export type PageUp =
  | { type: 'signal-send'; kind: SignalKind; target: SignalTarget; emote?: string; requestId: string }
  | { type: 'url'; url: string }
  | { type: 'picked'; requestId: string; contextId?: string; target: RefTarget; caption: string }
  | { type: 'pick-error'; contextId?: string; reason: 'too-long' | 'unavailable' }
  | { type: 'open-panel' }
  | { type: 'open-room'; key: string }
  /** Native selection submits a sticky note with an empty note body. */
  | { type: 'marked'; requestId: string; contextId?: string; action: 'sticky'; target: RefTarget; caption: string; text?: string }
  /** A pin was clicked: the panel opens the 便利贴 list on this note. */
  | { type: 'open-sticky'; id: string }
  /** After every `stickies` update: notes whose target is not on the page. */
  | { type: 'stickies-located'; missing: string[] }
  | { type: 'captured'; src: string }
  | { type: 'capture-cancel' }
  | { type: 'located'; requestId: string; result: LocateResult };

/** Background → page script. */
export type PageDown =
  | { type: 'signal-config'; on: boolean; settings: SignalSettings; labels: Record<string, string> }
  | { type: 'signal'; item: ReceivedSignal; author: PagePerson }
  | { type: 'signal-result'; requestId: string; ok: boolean; error?: string }
  | { type: 'config'; labels: PageLabels; danmaku: DanmakuSettings }
  | { type: 'danmaku'; items: PageDanmaku[] }
  | { type: 'danmaku-remove'; ids: string[] }
  /** Replaces the entire room payment projection. A null room and empty arrays clear it on disable/disposal. */
  | { type: 'room-payments'; roomKey: string | null; packets: PageRoomPacket[] }
  /** The full set of pins for this page, replacing the previous one. */
  | { type: 'stickies'; items: PageSticky[] }
  | { type: 'flash'; target: RefTarget; author: PagePerson; requestId?: string; focus?: boolean }
  | { type: 'pick'; on: boolean; canSticky?: boolean; contextId?: string }
  | { type: 'selection-enabled'; on: boolean }
  | { type: 'pick-result'; requestId: string; ok: boolean; error?: string; stickyId?: string; revision?: string; existing?: boolean }
  | { type: 'capture'; src: string; labels: CaptureLabels }
  | { type: 'clear' }
  | { type: 'off' };
