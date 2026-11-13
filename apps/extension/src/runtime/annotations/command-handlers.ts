import { message as uiMessage, MessageError } from '@palside/i18n';
import { POKE_DISPLAY } from '../../domain/annotations/social.ts';
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

export async function pokeCommand(this: RuntimeCommands, command: Extract<Command, { name: "poke" }>) {
  const { runtime } = signedIn(this);
  const p = command.payload ?? {};
  const teamId = text('teamId' in p ? p.teamId : undefined);
  return runtime.interactions.poke(teamId, p.accountId === undefined ? undefined : text(p.accountId));
}

/** A 喊你来看 desktop notification was clicked: the panel opens that squad, the call is answered, and the host opens the page. */
export async function pokeOpenCommand(this: RuntimeCommands, command: Extract<Command, { name: "poke-open" }>) {
  const { runtime, accountId, scope } = signedIn(this);
  const p = command.payload;
  const poke = runtime.state.pokes?.find(item => item.id === p.pokeId && item.at + POKE_DISPLAY > Date.now());
  if (p.accountId !== accountId || !poke || !runtime.state.remoteTeams.some(team => team.id === poke.teamId && team.joined)) throw new MessageError(uiMessage('extension.member.pokeGone'));
  runtime.state.pokes = runtime.state.pokes!.filter(item => item !== poke);
  runtime.state.preferences.current = poke.teamId;
  await scope.wait(runtime.sharing.savePreferences());
  runtime.emit();
  return { url: poke.view.url };
}

export async function dismissPokeCommand(this: RuntimeCommands, command: Extract<Command, { name: "dismiss-poke" }>) {
  const { runtime } = signedIn(this);
  const p = command.payload ?? {};
  runtime.state.pokes = (runtime.state.pokes ?? []).filter(x => x.id !== p.id); runtime.emit();
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
  'poke': pokeCommand,
  'dismiss-poke': dismissPokeCommand,
  'poke-open': pokeOpenCommand,
  'react': reactCommand,
} satisfies HandlerRegistry;
