import Type from 'typebox';
import { strictObject } from '../validation.ts';
import { account, profileUpdate } from '../profiles.ts';
import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { registration, deviceRegistration, snapshot } from '../accounts.ts';
export const accountEndpoints = [
  endpoint({ id: 'accounts.create', method: 'POST', path: '/accounts', auth: 'signed', rateLimits: ['accountCreate'], body: jsonBody(deviceRegistration), response: jsonResponse(registration), errors: ['POW_REQUIRED', 'ACCOUNT_EXISTS', 'ACCOUNT_RESTRICTED', 'DEVICE_REVOKED', 'MATRIX_UNAVAILABLE', 'MATRIX_ERROR'] }),
  endpoint({ id: 'accounts.lookup', method: 'GET', path: '/accounts/me', auth: 'signed', rateLimits: ['deviceCreateIp'], response: jsonResponse(strictObject({ account })), errors: ['ACCOUNT_NOT_FOUND'] }),
  endpoint({ id: 'accounts.delete', method: 'DELETE', path: '/account', auth: 'signed', rateLimits: ['accountDelete'], response: jsonResponse(strictObject({ deleted: Type.Literal(true) })), errors: ['ACCOUNT_NOT_FOUND', 'OWNED_TEAMS'] }),
  endpoint({ id: 'accounts.logout', method: 'POST', path: '/logout', response: jsonResponse(strictObject({ loggedOut: Type.Literal(true) })) }),
  endpoint({ id: 'accounts.snapshot', method: 'GET', path: '/me', rateLimits: ['snapshot'], response: jsonResponse(snapshot), errors: ['ACCOUNT_UNAVAILABLE'] }),
  endpoint({ id: 'accounts.update', method: 'PATCH', path: '/me', rateLimits: ['profileEdit'], body: jsonBody(profileUpdate), response: jsonResponse(strictObject({ account })), errors: ['ACCOUNT_UNAVAILABLE', 'TEXT_NOT_ALLOWED'] }),
] as const;
