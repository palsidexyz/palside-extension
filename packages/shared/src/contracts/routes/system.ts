import Type from 'typebox';
import { strictObject, contractString } from '../validation.ts';
import { endpoint, jsonResponse } from '../endpoint.ts';
export const systemEndpoints = [
  endpoint({ id: 'system.health', method: 'GET', path: '/health', auth: 'public', response: jsonResponse(strictObject({ ok: Type.Literal(true), service: Type.Literal('palside') })) }),
  endpoint({ id: 'system.ready', method: 'GET', path: '/ready', auth: 'public', rateLimits: ['publicLobby'], response: jsonResponse(strictObject({ ok: Type.Boolean(), service: Type.Literal('palside') }), [200, 503]) }),
  endpoint({ id: 'system.config', method: 'GET', path: '/config', auth: 'public', response: jsonResponse(strictObject({ websiteUrl: contractString({ min: 1 }), signupDifficulty: Type.Integer({ minimum: 0, maximum: 32 }) })) }),
] as const;
