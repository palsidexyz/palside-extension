import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { browser } from 'wxt/browser';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';
import { signedIn } from '../composition/signed-in';

/** A page-layer action counts only while its host token still names the page in front. */
async function hostTokenCurrent(token: unknown) {
  if (typeof token !== 'string') return false;
  try { return (await browser.runtime.sendMessage({ type: 'palside/signal-current', token }))?.ok === true; } catch { return false; }
}

export async function signalSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "signal-send" }>) {
  const p = command.payload ?? {};
  return this.runtime.signals.send(String(p.teamId ?? ''), p, () => hostTokenCurrent(p.hostToken));
}

export async function markSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "mark-send" }>) {
  const p = command.payload;
  return this.runtime.signals.sendMark(p.teamId, p, () => hostTokenCurrent(p.hostToken));
}

export async function drawingSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "drawing-send" }>) {
  const p = command.payload;
  return this.runtime.signals.drawings.send(p.teamId, p, () => hostTokenCurrent(p.hostToken));
}

export async function followWatchCommand(this: RuntimeCommands, command: Extract<Command, { name: "follow-watch" }>) {
  const p = command.payload;
  return await this.runtime.interactions.followWatch(p.teamId, p.leader, p.on);
}

/** From the background only, for the page in front that this account shares: checked again through its host token. */
export async function followScrollCommand(this: RuntimeCommands, command: Extract<Command, { name: "follow-scroll" }>) {
  const p = command.payload;
  if (!await hostTokenCurrent(p.hostToken)) return { delivered: 0 };
  return await this.runtime.interactions.leadScroll(p.teamId, p.url, p.y);
}

/** From the background only: the tabs of this account that came to the front while it is followed. */
export async function followTabsCommand(this: RuntimeCommands, command: Extract<Command, { name: "follow-tabs" }>) {
  const p = command.payload;
  if (!await hostTokenCurrent(p.hostToken)) return { delivered: 0 };
  return await this.runtime.interactions.leadTabs(p.teamId, p.gen, p.open, p.front);
}

export async function reactCommand(this: RuntimeCommands, command: Extract<Command, { name: "react" }>) {
  const { runtime } = signedIn(this);
  const p = command.payload ?? {};
  const teamId = text('teamId' in p ? p.teamId : undefined);
  return runtime.interactions.react(teamId, p.emoji, Number(p.count));
}

export const annotationsHandlers = {
  'signal-send': signalSendCommand,
  'mark-send': markSendCommand,
  'drawing-send': drawingSendCommand,
  'follow-watch': followWatchCommand,
  'follow-scroll': followScrollCommand,
  'follow-tabs': followTabsCommand,
  'react': reactCommand,
} satisfies HandlerRegistry;
