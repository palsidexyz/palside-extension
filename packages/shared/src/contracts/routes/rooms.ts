import Type from 'typebox';
import { denseArray, strictObject, contractString } from '../validation.ts';
import { id } from '../common.ts';
import { person } from '../profiles.ts';
import { ROOM_TEXT_MAX } from '../../rules/rooms.ts';
import { endpoint, jsonBody, jsonResponse, binaryResponse } from '../endpoint.ts';
import { roomKey, roomSite, roomSendResult, roomPage, hotRooms, roomLease, roomSummary, roomPeople, keyQuery, messageInput, roomLike, roomLikesInput, roomLikes } from '../rooms.ts';
export const roomEndpoints = [
  endpoint({ id: 'rooms.lease', method: 'POST', path: '/rooms/lease', rateLimits: ['roomLease'], body: jsonBody(strictObject({ key: Type.Union([roomKey, Type.Null()]), site: Type.Optional(roomSite) })), response: jsonResponse(roomLease) }),
  endpoint({ id: 'rooms.summary', method: 'GET', path: '/rooms/summary', rateLimits: ['roomSummary'], query: keyQuery, response: jsonResponse(roomSummary) }),
  endpoint({ id: 'rooms.people', method: 'GET', path: '/rooms/people', rateLimits: ['roomPeople'], query: keyQuery, response: jsonResponse(roomPeople) }),
  endpoint({ id: 'rooms.hot', method: 'GET', path: '/rooms/hot', rateLimits: ['roomHot'], response: jsonResponse(hotRooms) }),
  endpoint({ id: 'rooms.hotSubscription', method: 'POST', path: '/rooms/hot/subscription', rateLimits: ['roomHot'], body: jsonBody(strictObject({ open: Type.Boolean() })), response: jsonResponse(strictObject({ subscribed: Type.Boolean() })) }),
  endpoint({ id: 'rooms.like', method: 'POST', path: '/rooms/like', rateLimits: ['roomLike'], body: jsonBody(strictObject({ key: roomKey, id, liked: Type.Boolean() })), response: jsonResponse(roomLike), errors: ['ROOM_MESSAGE_NOT_FOUND', 'ROOM_FORBIDDEN'] }),
  endpoint({ id: 'rooms.likes', method: 'POST', path: '/rooms/likes', rateLimits: ['roomRead'], body: jsonBody(roomLikesInput), response: jsonResponse(roomLikes) }),
  endpoint({ id: 'rooms.retract', method: 'POST', path: '/rooms/retract', rateLimits: ['roomRetract'], body: jsonBody(messageInput), response: jsonResponse(strictObject({ retracted: Type.Literal(true) })), errors: ['ROOM_MESSAGE_NOT_FOUND', 'ROOM_FORBIDDEN'] }),
  endpoint({ id: 'rooms.messages', method: 'GET', path: '/rooms/messages', rateLimits: ['roomRead'], query: strictObject({ key: roomKey, before: Type.Optional(id) }), response: jsonResponse(roomPage), errors: ['ROOM_MESSAGE_NOT_FOUND'] }),
  endpoint({ id: 'rooms.send', method: 'POST', path: '/rooms/messages', idempotency: 'required', rateLimits: ['roomMessages'], body: jsonBody(strictObject({ key: roomKey, text: contractString({ min: 1, max: ROOM_TEXT_MAX, unit: 'grapheme', trim: true }) })), response: jsonResponse(roomSendResult), errors: ['ROOM_NOT_LEASED', 'OPERATION_ID_REQUIRED', 'OPERATION_CONFLICT', 'ROOM_MESSAGE_NOT_FOUND', 'ROOM_SLOW', 'TEXT_NOT_ALLOWED'] }),
  endpoint({ id: 'rooms.report', method: 'POST', path: '/rooms/report', rateLimits: ['roomReport'], body: jsonBody(messageInput), response: jsonResponse(strictObject({ folded: Type.Boolean() })), errors: ['ROOM_MESSAGE_NOT_FOUND'] }),
  endpoint({ id: 'rooms.blocks', method: 'GET', path: '/rooms/blocks', rateLimits: ['roomRead'], response: jsonResponse(strictObject({ people: denseArray(person) })) }),
  endpoint({ id: 'rooms.block', method: 'POST', path: '/rooms/blocks', rateLimits: ['roomBlocks'], body: jsonBody(strictObject({ accountId: id, blocked: Type.Boolean() })), response: jsonResponse(strictObject({ people: denseArray(person) })), errors: ['ACCOUNT_NOT_FOUND'] }),
  endpoint({ id: 'rooms.avatar', method: 'GET', path: '/rooms/avatar', rateLimits: ['roomAvatar'], query: strictObject({ key: roomKey, accountId: id }), response: binaryResponse, errors: ['MEDIA_UNAVAILABLE'] }),
] as const;
