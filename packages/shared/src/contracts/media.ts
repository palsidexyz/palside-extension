import Type from 'typebox';
import { contractString, strictObject } from './validation.ts';
import { id, eventId } from './common.ts';
export const mediaParams = strictObject({ id: contractString({ pattern: /^[a-f0-9-]{36}$/ }) });
export const uploadQuery = Type.Union([strictObject({ kind: Type.Literal('avatar'), teamId: Type.Optional(id) }), strictObject({ kind: Type.Literal('report'), eventId, teamId: Type.Optional(id) }), strictObject({ kind: Type.Optional(Type.Literal('encrypted')), teamId: id })]);
export const readQuery = strictObject({ eventId: Type.Optional(eventId) });
