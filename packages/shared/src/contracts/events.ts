import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from './validation.ts';
import { count, id, presenceState } from './common.ts';
import { roomKey, roomMessage, stanceCounts } from './rooms.ts';
import { chainEvent, chainConfigEvent } from './chain.ts';
export const roomEvent = Type.Union([strictObject({ key: roomKey, type: Type.Literal('message'), message: roomMessage }), strictObject({ key: roomKey, type: Type.Literal('folded'), id }), strictObject({ key: roomKey, type: Type.Literal('retract'), id }), strictObject({ key: roomKey, type: Type.Literal('count'), count }), strictObject({ key: roomKey, type: Type.Literal('stance'), stance: stanceCounts })]);
/** SSE has no event IDs or replay cursor. A refresh invalidates /me; ping comments have no payload. */
export const events = {
  refresh: strictObject({ scope: Type.Literal('me') }),
  presence: strictObject({ account: id, state: presenceState }),
  'team-invites': strictObject({ pending: count }),
  room: roomEvent,
  chain: chainEvent,
  'chain-config': chainConfigEvent,
  'account-banned': strictObject({ expiresAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]) }),
} as const;
export type EventName = keyof typeof events;
export type EventPayload<N extends EventName> = Static<typeof events[N]>;
export const event = Type.Union([strictObject({ event: Type.Literal('refresh'), data: events.refresh }), strictObject({ event: Type.Literal('presence'), data: events.presence }), strictObject({ event: Type.Literal('team-invites'), data: events['team-invites'] }), strictObject({ event: Type.Literal('room'), data: roomEvent }), strictObject({ event: Type.Literal('chain'), data: chainEvent }), strictObject({ event: Type.Literal('chain-config'), data: chainConfigEvent }), strictObject({ event: Type.Literal('account-banned'), data: events['account-banned'] })]);
export type RoomEvent = Static<typeof roomEvent>;
