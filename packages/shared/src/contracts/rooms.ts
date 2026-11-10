import { denseArray, contractString, strictObject, safeInteger } from './validation.ts';
import Type, { type StaticDecode as Static } from 'typebox';
import { siteById } from '../sites/index.ts';
import { ROOM_KEY_PATTERN, isRoomKey, roomKeyForAsset } from './rules.ts';
import { id, count, timestamp } from './common.ts';
import { person } from './profiles.ts';
import { chainTipGroup } from './chain.ts';
import { ROOM_TEXT_MAX, ROOM_PAGE_SIZE, ROOM_SPEAKER_LIMIT, ROOM_FACE_LIMIT, ROOM_TOP_LIMIT, ROOM_RISE_MIN } from '../rules/rooms.ts';
export const roomKey = contractString({ pattern: ROOM_KEY_PATTERN });
/** The registry site a leasing device has the token open on; the room reports the most recent vote. Names and icons come from the token directory. */
export const roomSite = Type.Refine(contractString(), value => Boolean(siteById(value)), () => 'unknown site');
export { isRoomKey, roomKeyForAsset };
export const roomMessage = strictObject({ id, key: roomKey, author: person, text: contractString({ min: 1, max: ROOM_TEXT_MAX, unit: 'grapheme' }), createdAt: timestamp, folded: Type.Boolean(), reported: Type.Boolean(), tips: Type.Optional(Type.Array(chainTipGroup)) });
export const roomSendResult = strictObject({ message: roomMessage, slowUntil: timestamp, slowMs: count });
export const roomPage = strictObject({ messages: denseArray(roomMessage, { maxItems: ROOM_PAGE_SIZE }), hasMore: Type.Boolean() });
const summaryFields = { key: roomKey, count, site: Type.Union([contractString(), Type.Null()]), faces: denseArray(person, { maxItems: ROOM_FACE_LIMIT }) };
export const hotRoom = strictObject({ ...summaryFields, rise: Type.Optional(safeInteger({ minimum: ROOM_RISE_MIN })) });
export const hotRooms = strictObject({ rows: denseArray(hotRoom, { maxItems: ROOM_TOP_LIMIT }) });
export const roomLease = strictObject({ key: Type.Union([roomKey, Type.Null()]), count, slowUntil: timestamp, slowMs: count });
export const roomSummary = strictObject(summaryFields);
/** 点赞 of 弹幕 lines, read in batches for the lines on screen: each line's count and whether this account liked it. */
export const roomLikesInput = strictObject({ key: roomKey, ids: denseArray(id, { minItems: 1, maxItems: ROOM_PAGE_SIZE, uniqueItems: true }) });
export const roomLike = strictObject({ id, count, liked: Type.Boolean() });
export const roomLikes = strictObject({ likes: denseArray(roomLike, { maxItems: ROOM_PAGE_SIZE }) });
export const roomPeople = strictObject({ count, people: denseArray(person, { maxItems: ROOM_SPEAKER_LIMIT }) });
export const keyQuery = strictObject({ key: roomKey });
export const messageInput = strictObject({ key: roomKey, id });
export type RoomMessage = Static<typeof roomMessage>;
export type HotRooms = Static<typeof hotRooms>;

export type { RoomKey } from './rules.ts';
export type RoomSummary = Static<typeof roomSummary>;
export type RoomPeople = Static<typeof roomPeople>;
export type HotRoom = Static<typeof hotRoom>;
