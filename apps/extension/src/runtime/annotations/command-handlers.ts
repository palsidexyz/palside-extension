import { message as uiMessage,MessageError } from '@palside/i18n';
import { pageView } from '../viewing/view-snapshot';
import { readMessageRefTarget,readRefCaption,viewAsset } from '../../domain/annotations/social';
import { emptyDraft,type Draft } from '../../domain/chat/model';
import { type Viewing } from '../../domain/assets/model';
import { identifyPage,publicShareUrl } from '@palside/shared/navigation';
import type { Command } from '../transport/command-map';
import { text } from '../composition/state';
import { browser } from 'wxt/browser';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function signalSendCommand(this: RuntimeCommands, command: Extract<Command, { name: "signal-send" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
return runtime.signals.send(String(p.teamId ?? ''), p, async () => {
      if (typeof p.hostToken !== 'string') return false;
      try { return (await browser.runtime.sendMessage({ type: 'palside/signal-current', token: p.hostToken }))?.ok === true; } catch { return false; }
    });
}

export async function teamEventCommand(this: RuntimeCommands, command: Extract<Command, { name: "team-event" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== undefined && p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.retryAccountChanged'));
      if (p.kind !== 'sticky') throw new MessageError(uiMessage('common.error'));
      return runtime.interactions.teamEvent(teamId, p.kind, { asset: p.asset, text: p.text, site: p.site, url: p.url, target: p.target, edits: p.edits, baseRevision: p.baseRevision, operationId: p.operationId, caption: p.caption });
}

export async function teamEventRemoveCommand(this: RuntimeCommands, command: Extract<Command, { name: "team-event-remove" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
 const teamId = text('teamId' in p ? p.teamId : undefined);

      runtime.auth.requireConnection();
      const team = runtime.state.remoteTeams.find(t => t.id === teamId && t.joined);
      if (!team || !runtime.auth.client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      if (p.kind === 'sticky') return runtime.interactions.removeSticky(teamId, p.id, p.baseRevision);
      throw new MessageError(uiMessage('common.error'));
}

export async function pokeCommand(this: RuntimeCommands, command: Extract<Command, { name: "poke" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
 const teamId = text('teamId' in p ? p.teamId : undefined);
return runtime.interactions.poke(teamId, text(p.accountId));
}

export async function dismissPokeCommand(this: RuntimeCommands, command: Extract<Command, { name: "dismiss-poke" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
 runtime.state.pokes = (runtime.state.pokes ?? []).filter(x => x.id !== p.id); runtime.emit(); return;
}

export async function attachRefCommand(this: RuntimeCommands, command: Extract<Command, { name: "attach-ref" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; const teamId = text('teamId' in p ? p.teamId : undefined);

      if (p.accountId !== undefined && p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.draftAccountChanged'));
      const team = runtime.state.remoteTeams.find(t => t.id === teamId && t.joined); if (!team) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      const saved = runtime.state.drafts[teamId] ?? { revision: 0, value: emptyDraft, updatedAt: 0 };
      if (p.clear) { const next = await scope.wait(runtime.storage.updateDraft<Draft>(id, teamId, { ref: undefined }, saved.revision, emptyDraft)); runtime.state.drafts[teamId] = next; runtime.emit(); return next; }
      const target = readMessageRefTarget(p.target); const caption = readRefCaption(p.caption, target); const url = publicShareUrl(text(p.url));
      if (!target || !caption || !url) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
      const host = new URL(url).hostname; const identity = identifyPage(url, [host]);
      if (!identity) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
      let view: Viewing | undefined;
      if (identity.kind === 'asset') {
        const known = runtime.state.data.views.filter(candidate => candidate.kind === 'asset' && viewAsset(candidate) === viewAsset(pageView(identity)));
        view = known.find(candidate => candidate.url === url) ?? known[0] ?? await scope.wait(runtime.sharing.prepareView(url));
      } else if (identity.kind === 'pool') {
        const candidates = [
          ...runtime.state.data.views,
          ...runtime.state.data.messages.flatMap(message => [message.ref?.view, message.attachment?.kind === 'asset' ? message.attachment.view : undefined]),
          ...Object.values(runtime.state.drafts).map(draft => draft.value.ref?.view),
        ].filter((candidate): candidate is Viewing => candidate?.kind === 'asset');
        const known = candidates.filter(candidate => { const source = identifyPage(candidate.url, [host]); return source?.kind === 'pool' && source.url === identity.url; });
        view = known.find(candidate => candidate.url === url) ?? known[0];
        if (!view) {
          const prepared = await scope.wait(runtime.sharing.prepareView(url));
          view = prepared?.kind === 'asset' ? { ...prepared, url } : undefined;
        }
      }
      if (!view) {
        view = await scope.wait(runtime.sharing.prepareView(url, undefined, undefined, undefined, undefined));
      }
      if (!view) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown'));
      view = { ...view, url };
      const next = await scope.wait(runtime.storage.updateDraft<Draft>(id, teamId, { ref: { target, caption, view } }, saved.revision, emptyDraft)); runtime.state.drafts[teamId] = next; runtime.emit(); return next;
}

export async function reactCommand(this: RuntimeCommands, command: Extract<Command, { name: "react" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
 const teamId = text('teamId' in p ? p.teamId : undefined);
return runtime.interactions.react(teamId, p.emoji, Number(p.count));
}

export const annotationsHandlers = {
  'signal-send': signalSendCommand,
  'team-event': teamEventCommand,
  'team-event-remove': teamEventRemoveCommand,
  'poke': pokeCommand,
  'dismiss-poke': dismissPokeCommand,
  'attach-ref': attachRefCommand,
  'react': reactCommand,
} satisfies HandlerRegistry;
