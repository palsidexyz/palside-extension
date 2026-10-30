import Type from 'typebox';
import { binaryBody, strictObject } from '../validation.ts';
import { id, eventId } from '../common.ts';
import { AVATAR_BYTES, UPLOAD_BYTES } from '../limits.ts';
import { endpoint, jsonBody, jsonResponse, binaryResponse } from '../endpoint.ts';
import { ownerErrors, memberErrors } from '../errors.ts';
import { mediaParams, uploadQuery, readQuery } from '../media.ts';
const readErrors = ['MEDIA_UNAVAILABLE', 'MEDIA_FORBIDDEN', 'TEAM_NOT_FOUND', 'M_FORBIDDEN', 'M_UNAVAILABLE'] as const;
const removeErrors = [...ownerErrors, 'MEDIA_UNAVAILABLE', 'MEDIA_FORBIDDEN', 'MESSAGE_RECALL_REQUIRED'] as const;
export const mediaEndpoints = [
  endpoint({ id: 'media.upload', method: 'POST', path: '/uploads', authorization: 'resource', rateLimits: [{ name: 'avatarUpload', when: 'avatar' }, { name: 'imageUpload', when: 'non-avatar' }], query: uploadQuery,
    body: { kind: 'binary', maxBytes: UPLOAD_BYTES, caps: { avatar: AVATAR_BYTES, report: UPLOAD_BYTES, encrypted: UPLOAD_BYTES }, schema: binaryBody(UPLOAD_BYTES, 1) },
    response: jsonResponse(strictObject({ id })), errors: [...ownerErrors, 'TEAM_REQUIRED', 'EMPTY_UPLOAD', 'UNSUPPORTED_IMAGE', 'REPORT_UNAVAILABLE', 'UPLOAD_QUOTA'] }),
  endpoint({ id: 'media.read', method: 'GET', path: '/media/:id', params: mediaParams, query: readQuery, authorization: 'resource', rateLimits: ['mediaRead'], response: binaryResponse, errors: readErrors }),
  endpoint({ id: 'media.readAttachment', method: 'GET', path: '/media/:id/attach', params: mediaParams, query: readQuery, authorization: 'resource', rateLimits: ['mediaRead'], response: binaryResponse, errors: readErrors }),
  endpoint({ id: 'media.attach', method: 'POST', path: '/media/:id/attach', params: mediaParams, authorization: 'resource', body: jsonBody(strictObject({ eventId })), response: jsonResponse(strictObject({ attached: Type.Literal(true) })), errors: [...memberErrors, 'MEDIA_UNAVAILABLE', 'MEDIA_FORBIDDEN', 'M_UNAVAILABLE'] }),
  endpoint({ id: 'media.remove', method: 'DELETE', path: '/media/:id', params: mediaParams, authorization: 'resource', response: jsonResponse(strictObject({ removed: Type.Literal(true) })), errors: removeErrors }),
  endpoint({ id: 'media.removeAttachment', method: 'DELETE', path: '/media/:id/attach', params: mediaParams, authorization: 'resource', response: jsonResponse(strictObject({ removed: Type.Literal(true) })), errors: removeErrors }),
] as const;
