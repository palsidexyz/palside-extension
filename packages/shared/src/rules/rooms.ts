import { DAY_MS, HOUR_MS, MINUTE_MS } from '../units.ts';
/** Milliseconds; expires danmaku presence; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_LEASE_MS = 40_000;
/** Milliseconds; renews danmaku presence; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_RENEW_MS = 20_000;
/** Messages per token; caps retained danmaku; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_MESSAGE_LIMIT = 10_000;
/** Graphemes per danmaku; caps public messages; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_TEXT_MAX = 60;
/** Milliseconds between sends; paces danmaku; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_SLOW_MS = 5_000;
/** Distinct eligible reporters; folds danmaku; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_FOLD_REPORTS = 5;
/** Messages per page; caps danmaku history responses; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_PAGE_SIZE = 50;
/** Milliseconds; selects recent danmaku speakers; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_SPEAKER_WINDOW_MS = DAY_MS;
/** People per token; caps recent speaker lists; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_SPEAKER_LIMIT = 50;
/** Avatars; caps danmaku presence faces; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_FACE_LIMIT = 3;
/** Milliseconds; selects recent danmaku for page replay; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_REPLAY_WINDOW_MS = HOUR_MS;
/** Messages; caps page replay; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_REPLAY_COUNT = 20;
/** Milliseconds between messages; paces page replay; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_REPLAY_GAP_MS = 600;
/** Milliseconds; samples hot-board viewers; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_HOT_SAMPLE_MS = 30_000;
/** Milliseconds; coalesces hot-board pushes; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_HOT_PUSH_MS = 2_000;
/** Milliseconds; measures hot-board viewer growth; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_RISE_WINDOW_MS = 5 * MINUTE_MS;
/** Additional viewers; shows the hot-board rise indicator; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_RISE_MIN = 3;
/** Viewers; qualifies tokens for the hot board; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_TOP_MIN = 3;
/** Tokens; caps hot-board rows; docs/product/danmaku.md#聊天区的弹幕. */
export const ROOM_TOP_LIMIT = 20;
