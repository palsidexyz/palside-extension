import { strictObject } from '../validation.ts';
import { id, count } from '../common.ts';
import { REACTION_MESSAGE_LENGTH } from '../limits.ts';
import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { boundedMessages, viewingInput, viewingResult } from '../viewing.ts';
export const viewingEndpoints = [
  endpoint({ id: 'viewing.update', method: 'POST', path: '/viewing', rateLimits: ['viewing'], body: jsonBody(viewingInput), response: jsonResponse(viewingResult), errors: ['INVALID_SEQUENCE', 'STALE_VIEWING', 'NOT_MEMBER', 'INVALID_VIEWING', 'VIEWING_TOO_LARGE', 'INVALID_RECIPIENT', 'INVALID_ENCRYPTION'] }),
  endpoint({ id: 'viewing.react', method: 'POST', path: '/reactions', authorization: 'member', rateLimits: ['reaction'], body: jsonBody(strictObject({ teamId: id, messages: boundedMessages(REACTION_MESSAGE_LENGTH) })), response: jsonResponse(strictObject({ delivered: count })), errors: ['NOT_MEMBER', 'INVALID_REACTION', 'REACTION_TOO_LARGE', 'REACTION_RECIPIENT'] }),
] as const;
