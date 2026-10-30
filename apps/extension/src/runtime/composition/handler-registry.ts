import type { Command,CommandName } from '../transport/command-map';
import type { RuntimeCommands } from './dispatch';
import { annotationsHandlers } from '../annotations/command-handlers';
import { mediaHandlers } from '../media/command-handlers';
import { compositionHandlers } from './command-handlers';
import { roomsHandlers } from '../rooms/command-handlers';
import { teamsHandlers } from '../teams/command-handlers';
import { chatHandlers } from '../chat/command-handlers';
import { viewingHandlers } from '../viewing/command-handlers';
import { accountHandlers } from '../account/command-handlers';
import { reportsHandlers } from '../storage/command-handlers';
import { walletHandlers } from '../wallet/command-handlers';

export type HandlerRegistry = { [N in CommandName]?: (this: RuntimeCommands, command: Extract<Command, { name: N }>) => Promise<unknown> };
export const handlers: HandlerRegistry = { ...annotationsHandlers, ...mediaHandlers, ...compositionHandlers, ...roomsHandlers, ...teamsHandlers, ...chatHandlers, ...viewingHandlers, ...accountHandlers, ...reportsHandlers, ...walletHandlers };

export function commandHandler<N extends CommandName>(name: N) {
  return (Object.hasOwn(handlers, name) ? handlers[name] : undefined) as ((this: RuntimeCommands, command: Extract<Command, { name: N }>) => Promise<unknown>) | undefined;
}
