import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from './validation.ts';
import { id, text, saved } from './common.ts';
import { TEAM_NAME_LENGTH, TEAM_DESCRIPTION_LENGTH } from './limits.ts';
export const teamInput = strictObject({ name: text(TEAM_NAME_LENGTH, 1), description: Type.Optional(text(TEAM_DESCRIPTION_LENGTH)) });
export const transferInput = Type.Union([strictObject({ action: Type.Literal('request'), accountId: id }), strictObject({ action: Type.Enum(['accept', 'reject', 'cancel']), accountId: Type.Optional(id) })]);
export const transferResult = Type.Union([saved, strictObject({ accepted: Type.Literal(false), ended: Type.Literal(true), reason: Type.Literal('OWNER_LIMIT') })]);
export type TeamInput = Static<typeof teamInput>;
