import Type from 'typebox';
import { strictObject, contractString } from '../validation.ts';
import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { empty } from '../common.ts';
import { siteVisit } from '../site.ts';
export const systemEndpoints = [
  endpoint({ id: 'system.health', method: 'GET', path: '/health', auth: 'public', response: jsonResponse(strictObject({ ok: Type.Literal(true), service: Type.Literal('palside') })) }),
  endpoint({ id: 'system.ready', method: 'GET', path: '/ready', auth: 'public', rateLimits: ['publicLobby'], response: jsonResponse(strictObject({ ok: Type.Boolean(), service: Type.Literal('palside') }), [200, 503]) }),
  endpoint({ id: 'system.config', method: 'GET', path: '/config', auth: 'public', response: jsonResponse(strictObject({ websiteUrl: contractString({ min: 1 }), signupDifficulty: Type.Integer({ minimum: 0, maximum: 32 }) })) }),
  // Website page views, forwarded by the site's own route with the visitor address; counted per day only.
  endpoint({ id: 'system.visit', method: 'POST', path: '/public/visit', auth: 'public', rateLimits: ['siteVisit'], body: jsonBody(siteVisit), response: jsonResponse(empty) }),
] as const;
