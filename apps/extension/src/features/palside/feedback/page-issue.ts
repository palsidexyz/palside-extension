import type { ConnectionStatus } from '../../../runtime/transport/connection';
import type { PalsideController } from '../app/use-palside';

/**
 * Which connection a page depends on. Chat needs the message sync and local encryption as well; every other page that talks to the
 * server needs only the network and the business service, so a message-sync problem never shows there.
 */
export type ConnectionScope = 'chat' | 'service';
export function pageIssue(c: PalsideController, scope: ConnectionScope): ConnectionStatus | undefined {
  if (scope === 'chat' || c.connection === 'update-required') return c.connection === 'connected' ? undefined : c.connection;
  const { networkOnline, service } = c.live.state.connection;
  return !networkOnline ? 'network-offline' : service === 'unavailable' ? 'service-unavailable' : service === 'connecting' ? 'connecting' : undefined;
}
