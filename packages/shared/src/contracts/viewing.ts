import Type, { type StaticDecode as Static } from 'typebox';
import { contractString, strictObject, plainRecord } from './validation.ts';
import { id, count, timestamp } from './common.ts';
import { RELAY_DEVICES_PER_ACCOUNT, VIEWING_MESSAGE_LENGTH } from './limits.ts';
/** Olm envelopes retain Matrix's field spelling inside business requests. */
// matrix-js-sdk tags every to-device payload with a message id.
export const olmEnvelope = strictObject({ algorithm: Type.Literal('m.olm.v1.curve25519-aes-sha2'), sender_key: contractString({ min: 1 }), ciphertext: plainRecord(strictObject({ type: Type.Enum([0, 1]), body: contractString({ min: 1 }) })), 'org.matrix.msgid': Type.Optional(contractString({ min: 1, max: 255 })) });
const messages = plainRecord(plainRecord(olmEnvelope, { maxProperties: RELAY_DEVICES_PER_ACCOUNT }));
export const boundedMessages = (maximum: number) => Type.Refine(messages, value => JSON.stringify(value).length <= maximum, () => `expected messages of at most ${maximum} UTF-16 units`);
export const viewingInput = Type.Refine(strictObject({ sequence: count, activity: Type.Optional(Type.Boolean()), order: Type.Optional(count), clear: Type.Optional(Type.Boolean()), teamId: Type.Optional(id), messages: Type.Optional(boundedMessages(VIEWING_MESSAGE_LENGTH)) }), value => value.clear === true || (value.activity === true && value.teamId === undefined) || (value.teamId !== undefined && value.messages !== undefined), () => 'expected activity, clear, or teamId and messages');
export const viewingResult = Type.Union([strictObject({ selected: Type.Literal(false) }), strictObject({ selected: Type.Literal(true), cleared: Type.Literal(true), order: count }), strictObject({ selected: Type.Literal(true), changedDevice: Type.Boolean(), order: count }), strictObject({ selected: Type.Literal(true), expiresAt: timestamp, order: count })]);
export type ViewingInput = Static<typeof viewingInput>;
export type ViewingResult = Static<typeof viewingResult>;
