import { accountEndpoints } from './routes/accounts.ts';
import { systemEndpoints } from './routes/system.ts';
import { deviceEndpoints } from './routes/devices.ts';
import { teamEndpoints } from './routes/teams.ts';
import { inviteEndpoints } from './routes/invites.ts';
import { roomEndpoints } from './routes/rooms.ts';
import { mediaEndpoints } from './routes/media.ts';
import { reportEndpoints } from './routes/reports.ts';
import { presenceEndpoints } from './routes/presence.ts';
import { viewingEndpoints } from './routes/viewing.ts';
import { operationEndpoints } from './routes/operations.ts';
import { chainEndpoints } from './routes/chain.ts';
/** OPTIONS is transport preflight. /_matrix/*, including anonymous versions, belongs to the gateway allowlist. */
export const endpoints = [...systemEndpoints, ...accountEndpoints, ...deviceEndpoints, ...teamEndpoints, ...inviteEndpoints, ...roomEndpoints, ...mediaEndpoints, ...reportEndpoints, ...presenceEndpoints, ...viewingEndpoints, ...operationEndpoints, ...chainEndpoints] as const;
export { pathFor } from './endpoint.ts';
export type EndpointId = typeof endpoints[number]['id'];
export type EndpointById<I extends EndpointId> = Extract<typeof endpoints[number], { id: I }>;
export const endpointsById = Object.fromEntries(endpoints.map(endpoint => [endpoint.id, endpoint])) as { [I in EndpointId]: EndpointById<I> };
