import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { activity } from '../presence.ts';
export const presenceEndpoints = [
  endpoint({ id: 'presence.update', method: 'POST', path: '/me', body: jsonBody(activity), response: jsonResponse(activity) }),
] as const;
