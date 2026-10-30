import Type from 'typebox';
import { denseArray, strictObject } from '../validation.ts';
import { id, idParams, teamResult, password, joinPassword } from '../common.ts';
import { endpoint, jsonBody, jsonResponse, binaryResponse } from '../endpoint.ts';
import { joinErrors, ownerErrors, operationErrors } from '../errors.ts';
import { inviteState, invitePreview, teamInvite, sentInvite, inviteOptions } from '../invites.ts';
export const inviteEndpoints = [
  endpoint({ id: 'invites.preview', method: 'GET', path: '/invites/:id', params: idParams, auth: 'optional-bearer', rateLimits: ['invitePreview'], response: jsonResponse(invitePreview), errors: ['INVITE_INVALID', 'TEAM_NOT_FOUND', 'JOIN_BLOCKED'] }),
  endpoint({ id: 'invites.avatar', method: 'GET', path: '/invites/:id/avatar', params: idParams, auth: 'public', rateLimits: ['publicAvatar'], response: binaryResponse, errors: ['INVITE_INVALID', 'TEAM_NOT_FOUND', 'MEDIA_UNAVAILABLE'] }),
  endpoint({ id: 'invites.join', method: 'POST', path: '/join', idempotency: 'required', rateLimits: [{ name: 'teamJoin', enforcement: 'operation' }], body: jsonBody(strictObject({ invite: id, password: Type.Optional(joinPassword) })), response: jsonResponse(teamResult), errors: [...joinErrors, 'INVITE_INVALID', 'INVITE_PASSWORD_LOCKED', 'INVITE_PASSWORD_REQUIRED', 'INVITE_PASSWORD_WRONG'] }),
  endpoint({ id: 'invites.link', method: 'GET', path: '/teams/:id/invite', params: idParams, authorization: 'owner', response: jsonResponse(inviteState), errors: ownerErrors }),
  endpoint({ id: 'invites.password', method: 'PUT', path: '/teams/:id/invite/password', params: idParams, authorization: 'owner', rateLimits: ['profileEdit'], body: jsonBody(strictObject({ password: Type.Optional(Type.Union([password, Type.Null()])) })), response: jsonResponse(inviteState), errors: [...ownerErrors, 'INVALID_INVITE_PASSWORD'] }),
  endpoint({ id: 'invites.linkAction', method: 'POST', path: '/teams/:id/invite', params: idParams, authorization: 'owner', idempotency: 'required', rateLimits: [{ name: 'inviteRegenerate', when: 'regenerate' }], body: jsonBody(strictObject({ action: Type.Enum(['regenerate', 'revoke']) })), response: jsonResponse(inviteState), errors: [...ownerErrors, ...operationErrors, 'INVALID_ACTION'] }),
  endpoint({ id: 'invites.list', method: 'GET', path: '/team-invites', rateLimits: ['teamInviteRead'], response: jsonResponse(strictObject({ invites: denseArray(teamInvite) })), errors: ['TEAM_NOT_FOUND', 'ACCOUNT_UNAVAILABLE'] }),
  endpoint({ id: 'invites.options', method: 'GET', path: '/team-invites/options', rateLimits: ['teamInviteOptions'], query: strictObject({ accountId: id }), response: jsonResponse(inviteOptions) }),
  endpoint({ id: 'invites.send', method: 'POST', path: '/team-invites', idempotency: 'required', rateLimits: ['teamInviteSend'], body: jsonBody(strictObject({ teamId: id, accountId: id })), response: jsonResponse(sentInvite), errors: [...operationErrors, 'ACCOUNT_UNAVAILABLE', 'INVITE_FORBIDDEN', 'INVITE_MEMBER', 'INVITE_AWAITING_REPLY', 'TEAM_FULL', 'INVITE_ACCOUNT_UNAVAILABLE', 'INVITE_LIMIT'] }),
  endpoint({ id: 'invites.accept', method: 'POST', path: '/team-invites/:id/accept', params: idParams, idempotency: 'required', rateLimits: ['teamInviteAccept'], body: jsonBody(strictObject({})), response: jsonResponse(teamResult), errors: [...joinErrors, 'INVITE_EXPIRED', 'INVITE_JOIN_PENDING', 'INVITE_TEAM_UNAVAILABLE'] }),
  endpoint({ id: 'invites.ignore', method: 'POST', path: '/team-invites/:id/ignore', params: idParams, rateLimits: ['teamInviteIgnore'], body: jsonBody(strictObject({})), response: jsonResponse(strictObject({ ignored: Type.Literal(true) })), errors: ['INVITE_EXPIRED', 'TEAM_NOT_FOUND', 'INVITE_JOIN_PENDING'] }),
  endpoint({ id: 'invites.directAvatar', method: 'GET', path: '/team-invites/:id/avatar', params: idParams, rateLimits: ['teamInviteAvatar'], response: binaryResponse, errors: ['INVITE_EXPIRED', 'TEAM_NOT_FOUND', 'MEDIA_UNAVAILABLE'] }),
] as const;
