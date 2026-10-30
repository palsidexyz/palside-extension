import type { Command } from '../transport/command-map';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function roomWatchCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-watch" }>) {
    const runtime = this.runtime;
return runtime.rooms.watch(command.payload.id, command.payload.view);
}

export async function roomPanelsCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-panels" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.panelChanged(p.connected === true);
}

export async function roomTabCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-tab" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.tabChanged(p);
}

export async function roomOpenCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-open" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.open(p);
}

export async function roomCloseCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return runtime.rooms.close();
}

export async function roomSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-send" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.send(p.text);
}

export async function roomMoreCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return runtime.rooms.more();
}

export async function roomFindCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-find" }>) {
  return this.runtime.rooms.find(command.payload.key, command.payload.id);
}

export async function roomRetractCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-retract" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.retract(p.id);
}

export async function roomStanceCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-stance" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.stance(p.key, p.value);
}

export async function roomSummaryCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-summary" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.summary(p.key);
}

export async function roomPeopleCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-people" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.people(p.key);
}

export async function roomHotCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-hot" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.watchHot(p);
}

export async function inviteListCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return runtime.rooms.invites();
}

export async function inviteOptionsCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-options" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.inviteOptions(p.accountId);
}

export async function inviteSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-send" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.inviteSend(p.teamId, p.accountId);
}

export async function inviteAcceptCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-accept" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.inviteAccept(p.id);
}

export async function inviteIgnoreCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-ignore" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.inviteIgnore(p.id);
}

export async function inviteSettingsCommand(this: RuntimeCommands, command: Extract<Command, { name: "invite-settings" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.inviteSettings(p.accept);
}

export async function teamInvitePermissionCommand(this: RuntimeCommands, command: Extract<Command, { name: "team-invite-permission" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.invitePermission(p.teamId, p.on);
}

export async function roomReportCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-report" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.report(p.id);
}

export async function roomBlockCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-block" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.block(p.accountId, p.blocked);
}

export async function roomBlocksCommand(this: RuntimeCommands) {
    const runtime = this.runtime;
return runtime.rooms.blocks();
}

export async function roomSettingsCommand(this: RuntimeCommands, command: Extract<Command, { name: "room-settings" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.rooms.settings(p);
}

export const roomsHandlers = {
  'room-watch': roomWatchCommand,
  'room-panels': roomPanelsCommand,
  'room-tab': roomTabCommand,
  'room-open': roomOpenCommand,
  'room-close': roomCloseCommand,
  'room-send': roomSendCommand,
  'room-more': roomMoreCommand,
  'room-find': roomFindCommand,
  'room-retract': roomRetractCommand,
  'room-stance': roomStanceCommand,
  'room-summary': roomSummaryCommand,
  'room-people': roomPeopleCommand,
  'room-hot': roomHotCommand,
  'invite-list': inviteListCommand,
  'invite-options': inviteOptionsCommand,
  'invite-send': inviteSendCommand,
  'invite-accept': inviteAcceptCommand,
  'invite-ignore': inviteIgnoreCommand,
  'invite-settings': inviteSettingsCommand,
  'team-invite-permission': teamInvitePermissionCommand,
  'room-report': roomReportCommand,
  'room-block': roomBlockCommand,
  'room-blocks': roomBlocksCommand,
  'room-settings': roomSettingsCommand,
} satisfies HandlerRegistry;
