import type { Command } from '../transport/command-map';
import { readTextMessage } from './commands';
import type { RuntimeDiagnostics } from '../diagnostics/diagnostics';
import type { RuntimeCommands } from './dispatch';
import type { HandlerRegistry } from './handler-registry';
import { signedIn } from './signed-in';

export async function diagnosticsCommand(this: RuntimeCommands) {
  const runtime = this.runtime;
  const { networkOnline, service, messaging, retrying } = runtime.state.connection;
  return {
    connection: { networkOnline, service, messaging, retrying },
    sync: runtime.auth.client?.getSyncState() ?? null,
    liveOpen: runtime.auth.liveOpen,
    teams: runtime.state.remoteTeams.filter(team => team.joined).length,
    errors: runtime.diagnosticErrors.snapshot(),
    latency: runtime.diagnosticLatency?.snapshot() ?? {},
  } satisfies RuntimeDiagnostics;
}

export async function snapshotCommand(this: RuntimeCommands) {
  const runtime = this.runtime;
  return runtime.state;
}

export async function hostNoticeCommand(this: RuntimeCommands, command: Extract<Command, { name: "host-notice" }>) {
  const runtime = this.runtime;
  const p = command.payload ?? {};
  runtime.state.notice = readTextMessage(p.message); runtime.emit();
}

export async function dismissNoticeCommand(this: RuntimeCommands) {
  const runtime = this.runtime;
  runtime.state.error = undefined; runtime.state.notice = undefined; runtime.emit();
}

export async function dismissJumpCommand(this: RuntimeCommands, command: Extract<Command, { name: "dismiss-jump" }>) {
  const runtime = this.runtime;
  const p = command.payload ?? {};
  if (p.messageId === runtime.state.jumpMessageId && p.windowId === runtime.state.jumpWindowId) { runtime.state.jumpMessageId = undefined; runtime.state.jumpWindowId = undefined; runtime.emit(); }
}

export async function clearShareCommand(this: RuntimeCommands) {
  const { runtime } = signedIn(this);
  runtime.state.pendingShare = undefined; runtime.state.pendingShareTeamId = undefined; runtime.emit();
}

export const compositionHandlers = {
  'diagnostics': diagnosticsCommand,
  'snapshot': snapshotCommand,
  'host-notice': hostNoticeCommand,
  'dismiss-notice': dismissNoticeCommand,
  'dismiss-jump': dismissJumpCommand,
  'clear-share': clearShareCommand,
} satisfies HandlerRegistry;
