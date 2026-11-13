import type { HotRooms,RoomKey,RoomMessage,RoomPeople,RoomPerson,RoomSummary,TeamInvite } from './contract-types';
/** The live room of `RoomState.leased`: kept fresh by events while a panel is open. */
export type RoomView = { key: RoomKey; /** The registry site most participants have the token open on. */ site: string | null; count: number; faces: RoomPerson[]; messages: RoomMessage[]; /** 点赞 by line ID, as the service answers, `likes` events and my own 点赞 change it; absent is not yet known. */ likes?: Partial<Record<string, { count: number; liked: boolean }>>; hasMore: boolean; loading: boolean; /** The last snapshot read failed; it retries itself and offers 重试. */ failed?: boolean; slowUntil: number; slowMs: number };
export type RoomState = {
  /** The 弹幕 view's token while it is open (`room-open` … `room-close`). */
  pinned?: RoomKey;
  /** The token the followed panel window's active tab shows (an added site only); the 弹幕 tab shows it when nothing is pinned. */
  tab?: RoomKey;
  /** The panel window `tab` follows: the one the user last worked in. Other windows' panels show 「在另一个窗口中」. */
  window?: number;
  /** Set for this panel only (`stateForPanel`): `tab` follows another window. */
  elsewhere?: boolean;
  /** The token this device holds a lease on: `pinned`, else the active tab's token; none while 弹幕 is off or no panel is open. */
  leased?: RoomKey;
  current?: RoomView;
  /** `room-summary` results for 代币详情, by key. */
  summaries: Record<RoomKey, RoomSummary & { at: number }>;
  /** One live ranking; chain filters are local. */
  hot?: HotRooms & { loaded: boolean };
  /** The last `room-people` result. */
  people?: RoomPeople & { key: RoomKey };
  blocked: RoomPerson[];
  /** Pending direct team invites to this account. */
  invites: TeamInvite[];
  /** 接受小队邀请, stored on the service. */
  acceptInvites: boolean;
  /** Object URLs for room people's avatars, by account id, loaded through GET /rooms/avatar. */
  avatars: Record<string, string>;
};
