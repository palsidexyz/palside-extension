import Type from 'typebox';
import { denseArray, strictObject } from '../validation.ts';
import { idParams } from '../common.ts';
import { deviceRegistration, registration } from '../accounts.ts';
import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { device } from '../devices.ts';
export const deviceEndpoints = [
  endpoint({ id: 'devices.create', method: 'POST', path: '/devices', auth: 'signed', rateLimits: ['deviceCreateIp', { name: 'deviceCreateAccount', enforcement: 'success' }], body: jsonBody(deviceRegistration), response: jsonResponse(registration), errors: ['ACCOUNT_NOT_FOUND', 'ACCOUNT_RESTRICTED', 'DEVICE_REVOKED', 'MATRIX_UNAVAILABLE', 'MATRIX_ERROR'] }),
  endpoint({ id: 'devices.list', method: 'GET', path: '/devices', response: jsonResponse(strictObject({ devices: denseArray(device) })) }),
  endpoint({ id: 'devices.remove', method: 'DELETE', path: '/devices/:id', params: idParams, auth: 'signed', rateLimits: ['deviceRemove'], response: jsonResponse(strictObject({ removed: Type.Literal(true) })), errors: ['ACCOUNT_NOT_FOUND', 'DEVICE_NOT_FOUND'] }),
] as const;
