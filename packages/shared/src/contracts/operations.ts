import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from './validation.ts';
import { teamResult } from './common.ts';
import { inviteState, sentInvite } from './invites.ts';
import { roomSendResult } from './rooms.ts';
import { reportResult } from './reports.ts';
export const operationResult = Type.Union([teamResult, inviteState, sentInvite, roomSendResult, reportResult]);
export const operation = Type.Union([strictObject({ status: Type.Literal('not-submitted') }), strictObject({ status: Type.Enum(['pending', 'cancelled']), result: Type.Union([operationResult, Type.Null()]) }), strictObject({ status: Type.Literal('complete'), result: operationResult })]);
export type Operation = Static<typeof operation>;
