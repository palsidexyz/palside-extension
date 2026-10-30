import type { HotRooms,RoomKey,RoomMessage,RoomPeople,RoomPerson,RoomProfile,RoomStance,RoomSummary,TeamInvite } from './contract-types';
/** The live room of `RoomState.leased`: kept fresh by events while a panel is open. */
export type RoomView = { key: RoomKey; profile: RoomProfile | null; count: number; stance: RoomStance; faces: RoomPerson[]; messages: RoomMessage[]; hasMore: boolean; loading: boolean; slowUntil: number };
export type RoomState = {
  /** The 弹幕 view's token while it is open (`room-open` … `room-close`). */
  pinned?: RoomKey;
  /** The token this device holds a lease on: `pinned`, else the active tab's token; none while 参与弹幕 is off or no panel is open. */
  leased?: RoomKey;
  current?: RoomView;
  /** `room-summary` results for 代币详情, by key. */
  summaries: Record<RoomKey, RoomSummary & { at: number }>;
  /** `room-hot` results by chain; the empty key includes all chains. */
  hot?: Record<string, HotRooms>;
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
