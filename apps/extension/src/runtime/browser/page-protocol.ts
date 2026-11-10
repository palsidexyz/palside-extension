import type { AccessStatus } from './permissions';
import type { ReceivedSignal,SignalKind,SignalTarget,SignalSettings } from '../annotations/signals';
import type { ChartPoint } from '../annotations/chart-marks';
import type { ChartAxis,ChartDrawingGeometry,ChartDrawingPoint,ChartProps } from '../annotations/chart-drawings';

export type AssetKey = string;
export type { RefTarget } from '../../domain/annotations/social.ts';

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
  /** The tab's own icon address, for this panel only (see `iconDataUrl`); never shared. */
  icon?: string;
  /** A joined team is current and this site's access is granted, so page actions run here. */
  granted: boolean;
  /** 网页互动 runs here: it is on for this site and `granted`. One-off actions never change it. */
  interactive: boolean;
  /** Signals send and show here: `interactive` ∧ this site's 信号 switch. */
  signalEnabled: boolean;
  signalSettings?: SignalSettings;
  /** The page script is running in the active tab, for 互动 or for a one-off action (signal replay, capture). */
  connected: boolean;
  /** What each page action can do on this tab right now; the panel disables or grants from this alone. */
  capabilities: PageCapabilities;
};

/**
 * Panel → background page commands (`palside/command`; the bridge adds `windowId`): `signal-replay`, `drawing-show`, `capture`, `link-card`, `signal-settings`/`signal-settings-get`, `danmaku-settings`.
 * 网页互动 runs through the offscreen `toggle` and `preferences`; a grant change re-registers it through `permissions.onAdded/onRemoved`.
 */
/** Page actions: screenshot, the page layer itself (site access; also locating a signal), danmaku, signals and sharing the page link. */
export type PageAction = 'capture' | 'interact' | 'danmaku' | 'signal' | 'share';
/** `ready`: works now. `access`: needs Chrome access for the action; capture requires all_urls or activeTab from the toolbar or shortcut. `pending`: the tab is still loading. `blocked`: can never work on this tab. */
export type CapabilityState = 'ready' | 'access' | 'pending' | 'blocked';
/** Why an action is blocked: a browser or extension page, the Chrome Web Store, a local file, a non-public address, or no tab at all. */
export type BlockReason = 'browser' | 'store' | 'file' | 'private' | 'none';
export type PageCapability = { state: CapabilityState; reason?: BlockReason };
export type PageCapabilities = Record<PageAction, PageCapability>;

/** Person shown next to page-layer content; the avatar is a data URL or absent (initials are drawn). */
export type PagePerson = { name: string; avatar?: string };
/** Share of the viewport height, measured from the top, that lines drift through. */
export type DanmakuArea = 25 | 50 | 75 | 100;
export const danmakuAreas: readonly DanmakuArea[] = [25, 50, 75, 100];
export type DanmakuSpeed = 110 | 144 | 190;
export type DanmakuSize = 'sm' | 'md' | 'lg';
export type DanmakuDensity = 'low' | 'mid' | 'high';
export const danmakuLimits = { low: 4, mid: 8, high: 14 };
export type DanmakuSettings = { density: DanmakuDensity; enabled: boolean; area: DanmakuArea; speed: DanmakuSpeed; size: DanmakuSize; opacity: number };
export const defaultDanmakuSettings: DanmakuSettings = { density: 'mid', enabled: true, area: 25, speed: 144, size: 'md', opacity: 90 };
export function normalizeDanmakuSettings(value: unknown): DanmakuSettings {
  if (!value || typeof value !== 'object') return { ...defaultDanmakuSettings };
  const input = value as Record<string, unknown>;
  const area: DanmakuArea = danmakuAreas.includes(input.area as DanmakuArea) ? input.area as DanmakuArea : defaultDanmakuSettings.area;
  const speed: DanmakuSpeed = input.speed === 110 || input.speed === 190 || input.speed === 144 ? input.speed : defaultDanmakuSettings.speed;
  const size: DanmakuSize = input.size === 'sm' || input.size === 'md' || input.size === 'lg' ? input.size : defaultDanmakuSettings.size;
  const opacity = typeof input.opacity === 'number' && Number.isFinite(input.opacity) ? Math.max(30, Math.min(100, Math.round(input.opacity))) : defaultDanmakuSettings.opacity;
  const density = input.density === 'low' || input.density === 'high' ? input.density : 'mid';
  return { enabled: input.enabled !== false, area, density, speed, size, opacity };
}
/** replay: sent before the page opened, replayed once and drawn lighter than live lines. */
/** `likes`: the line's 点赞 when it leaves, drawn after the text once someone has liked it. */
export type PageDanmaku = { id: string; key: string; text: string; author: PagePerson; self?: boolean; mate?: boolean; replay?: true; timestamp?: number; likes?: number };
/** Public display fields only; account IDs, wallet addresses and payment credentials stay in the extension. */
/** Opens the room in the side panel; claims and payment actions never run in the page. */
export type PageRoomPacket = { roomKey: string };
/**
 * Where a locate ended: `shown`; `missing` (the signal's record is gone); `loading` (the page did not finish loading); `blocked` (Palside cannot run on this page);
 * `moved` (the tab went to another page); `timeout` (the page did not answer); `unavailable` (the account, squad or tab changed meanwhile).
 */
/** `outside`: a drawing older than every candle the chart has, which it cannot scroll to at this period. */
export type LocateResult = 'shown' | 'missing' | 'loading' | 'blocked' | 'moved' | 'timeout' | 'unavailable' | 'outside';
export const locateResults: readonly LocateResult[] = ['shown', 'missing', 'loading', 'blocked', 'moved', 'timeout', 'unavailable', 'outside'];
/** Opening can succeed even when finding the signal's place fails. */
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
  you: string;
  packet?: string;
  member?: string;
  /** The tag on a teammate's 弹幕 card. */
  mate?: string;
  /** UI language, for relative times drawn on the page. */
  locale: string;
  capture?: CaptureLabels;
};
/** A laser stroke for this page: whose it is and the colour it draws in (0 is your own). */
export type PageChartMark = { id: string; points: ChartPoint[]; axis?: ChartAxis; at: number; author: PagePerson; tint: number };
/** A drawing that shows on this page: never a hidden person's, and its author only as an id and a colour. */
export type PageDrawing = ChartDrawingGeometry & { id: string; owner: string; mine: boolean; tint: number; at: number };
/** A teammate with drawings on this page, for the toolbar entry's list. */
export type PageDrawingPerson = PagePerson & { id: string; tint: number; count: number; hidden: boolean };

/** Page script → background over the `palside/page` port. */
export type PageUp =
  | { type: 'signal-send'; kind: SignalKind; target: SignalTarget; emote?: string; requestId: string }
  /** 看盘批注: a finished stroke, or 清除我的. */
  | { type: 'mark-send'; points: ChartPoint[]; axis?: ChartAxis; requestId: string }
  /** A drawing, its edit, or with no geometry its deletion. */
  | { type: 'drawing-send'; id: string; shape?: string; points?: ChartDrawingPoint[]; props?: ChartProps; axis?: ChartAxis; requestId: string }
  /** The toolbar entry's switches, kept per account on this device. 共享给小队 off also takes back what you shared. */
  | { type: 'chart-pref'; share?: boolean; hideAll?: boolean; hide?: { id: string; hidden: boolean }; intro?: true; opened?: true }
  /** The page shows a TradingView chart: the chart bridge may be loaded into its main world. */
  | { type: 'chart-found' }
  /** Your own click, wheel or key in the 跟看 tab: following pauses. */
  | { type: 'follow-touch' }
  /** 跟看: this leading page scrolled to `y` (0 top … 1 bottom). */
  | { type: 'lead-scroll'; y: number }
  | { type: 'url'; url: string }
  | { type: 'open-panel' }
  | { type: 'open-room'; key: string }
  | { type: 'captured'; src: string }
  | { type: 'capture-cancel' }
  | { type: 'located'; requestId: string; result: LocateResult };

/** Background → page script. */
export type PageDown =
  | { type: 'signal-config'; on: boolean; settings: SignalSettings; labels: Record<string, string> }
  | { type: 'signal'; item: ReceivedSignal; author: PagePerson }
  | { type: 'signal-result'; requestId: string; ok: boolean; error?: string }
  /** Every live squad mark for this page; the page replaces what it drew. */
  | { type: 'marks'; items: PageChartMark[] }
  /** This tab is the 跟看 tab and following runs: report your own input once. */
  | { type: 'follow-tab'; on: boolean }
  /** Someone follows this account and this is its shared page in front: report scrolling. */
  | { type: 'lead'; on: boolean }
  /** The followed teammate scrolled the same page: go there (approximate). */
  | { type: 'scroll-to'; y: number }
  /** Whether a sent mark reached the squad. */
  | { type: 'mark-result'; requestId: string; ok: boolean; error?: string }
  /** Whether 共享画线 runs on this page. */
  | { type: 'chart-config'; on: boolean; labels: Record<string, string> }
  | { type: 'drawings'; items: PageDrawing[]; people: PageDrawingPerson[]; share: boolean; hideAll: boolean; intro: boolean; opened: boolean }
  | { type: 'drawing-result'; requestId: string; ok: boolean; error?: string }
  | { type: 'config'; labels: PageLabels; danmaku: DanmakuSettings }
  | { type: 'danmaku'; items: PageDanmaku[] }
  | { type: 'danmaku-remove'; ids: string[] }
  /** Replaces the entire room payment projection. A null room and empty arrays clear it on disable/disposal. */
  | { type: 'room-payments'; roomKey: string | null; packets: PageRoomPacket[] }
  /** 信号 again, from its line in the chat; answers `located`. */
  | { type: 'signal-replay'; kind: SignalKind; target: SignalTarget; author: PagePerson; requestId: string }
  /** 共享画线: scroll the chart to one drawing, from its line in the chat; answers `located`. */
  | { type: 'drawing-show'; id: string; requestId: string }
  | { type: 'capture'; src: string; labels: CaptureLabels }
  | { type: 'clear' }
  | { type: 'off' };
