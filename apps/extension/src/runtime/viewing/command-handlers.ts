import { message as uiMessage,MessageError } from '@palside/i18n';
import { pageView } from './view-snapshot';
import { type Viewing } from '../../domain/assets/model';
import { identifyPage,websiteIdentity,type PageIdentity } from '@palside/shared/navigation';
import { resolveTokenMetadata } from './token-page';
import type { Command } from '../transport/command-map';
import { readPreferencePatch } from '../composition/state';
import { startedTeams } from '../teams/onboarding';
import { interactionAllows } from '../../domain/annotations/interaction';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function pageCommand(this: RuntimeCommands, command: Extract<Command, { name: "page" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      if (!runtime.auth.session) return;
      if (p.failed) return;
      if (p.clear) {
        runtime.sharing.invalidatePage();
        runtime.sharing.page = undefined;
        runtime.sharing.pagePreview = false;
        runtime.sharing.expireViewing();
        void runtime.sharing.clearRemoteViewing().catch(() => {});
        return;
      }
      if (p.activity) {
        const session = runtime.auth.session; const sequence = ++runtime.sharing.viewingSequence;
        const result = await runtime.api.request('viewing.update', { body: { activity: true, sequence } });
        if (session !== runtime.auth.session || sequence !== runtime.sharing.viewingSequence) return;
        runtime.sharing.selectedDevice = result.selected; if ('order' in result) runtime.sharing.viewingOrder = result.order; runtime.sharing.publishedView = '';
        if (runtime.sharing.page) void runtime.sharing.publishViewing().catch(() => {});
      }
      const input = p.identity as PageIdentity | undefined;
      const prefs = runtime.state.preferences;
      const identity = input?.url && typeof p.host === 'string' ? identifyPage(input.url, [p.host]) : null;
      if (!identity || !runtime.sharing.mayObserve()) return;
      if (p.metadata && identity.kind === 'asset') { await runtime.sharing.refreshTokenMetadata(identity, p.context); return; }
      const preview = p.preview === true;
      runtime.sharing.pagePreview = preview;
      const previousPage = runtime.sharing.page;
      runtime.sharing.invalidatePage();
      const observation = runtime.sharing.pageObservation;
      const session = runtime.auth.session;
      const teamId = prefs.current;
      const controller = new AbortController();
      runtime.sharing.pageRequest = controller;
      const current = () => !controller.signal.aborted && runtime.auth.session === session && runtime.sharing.pageObservation === observation && runtime.state.preferences.current === teamId && runtime.sharing.mayObserve();
      if (!preview && (!await runtime.foreground(identity.url) || !current())) return;
      runtime.sharing.pageSince = Date.now();
      const accept = async (view: Viewing | undefined) => {
        if (!view || !current()) return;
        if (!preview && (!await runtime.foreground(identity.url) || !current())) return;
        runtime.sharing.page = view;
        runtime.cache.upsertView(view);
        runtime.state.viewingId = view.id;
        runtime.state.data.people = runtime.state.data.people.map(person => person.id === session.account.id ? { ...person, viewing: view.id } : person);
        runtime.emit();
        if (!preview && p.stable === true) {
          clearTimeout(runtime.sharing.viewingTimer);
          runtime.sharing.viewingTimer = setTimeout(() => { void runtime.sharing.publishViewing().catch(() => {}); }, 5);
        }
      };
      const fallback = identity.kind === 'pool' ? websiteIdentity(identity.url)! : identity;
      const previewView = previousPage?.url === fallback.url && previousPage.kind === fallback.kind
        ? previousPage
        : pageView(fallback, identity.kind === 'asset'
          ? resolveTokenMetadata(identity)
          : undefined);
      await accept(previewView);
      if (preview || identity.kind !== 'asset') return;
      void (async () => {
        const local = await runtime.sharing.localTokenMetadata(identity, p.context, 'viewing', controller.signal);
        if (!current()) return;
        if (local) await accept(pageView(identity, resolveTokenMetadata(identity, local)));
      })().catch(() => {});
      return;
}

export async function preferencesCommand(this: RuntimeCommands, command: Extract<Command, { name: "preferences" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; 
      if (p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.retryAccountChanged'));
      const previous = runtime.state.preferences, previousInteract = runtime.state.toggles.interact;
      const patch = readPreferencePatch(p);
      if (!patch) throw new MessageError(uiMessage('common.error'));
      runtime.sharing.persistedPreferences ??= previous;
      runtime.state.preferences = { ...previous, ...patch, ...(patch.rooms ? { rooms: { ...previous.rooms, ...patch.rooms } } : {}) };
      // 禁用 also switches the composer button off; so does turning every 互动选项 off.
      const web = runtime.state.preferences.web;
      runtime.state.toggles = { share: runtime.state.toggles.share && web.share, interact: runtime.state.toggles.interact && web.interact && interactionAllows(runtime.state.preferences.interaction) };
      if (patch.current !== undefined && patch.current !== previous.current) runtime.signals?.reset();
      const clearViewing = 'current' in p && p.current !== previous.current || Boolean(runtime.sharing.page && !runtime.sharing.mayObserve());
      const submitted = runtime.state.preferences, rooms = patch.rooms ? runtime.rooms.preferencesChanged() : Promise.resolve(); void rooms.catch(() => {});
      if (clearViewing) { runtime.sharing.invalidatePage(); runtime.sharing.expireViewing(); void runtime.sharing.clearRemoteViewing().catch(() => {}); }
      try { await scope.wait(runtime.sharing.savePreferences()); }
      catch (error) { scope.check(); if (runtime.state.preferences === submitted) { runtime.state.preferences = { ...(runtime.sharing.persistedPreferences ?? previous), startedTeams: startedTeams(runtime.state.preferences.startedTeams) }; if (patch.rooms) void runtime.rooms.preferencesChanged().catch(() => {}); runtime.emit(); } throw error; }
      if (previousInteract !== runtime.state.toggles.interact) await scope.wait(runtime.sharing.saveToggles());
      await scope.wait(rooms);
      return;
}

export async function toggleCommand(this: RuntimeCommands, command: Extract<Command, { name: "toggle" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();

      // Composer switches follow background commands; gesture-bound permission prompts run in the panel.
      // `revoked` reports Chrome's removal of the sharing permission.
      const previousInteract = runtime.state.toggles.interact, next = { ...runtime.state.toggles };
      for (const key of ['share', 'interact'] as const) {
        if (p[key] === undefined) continue;
        if (typeof p[key] !== 'boolean') throw new MessageError(uiMessage('common.error'));
        next[key] = p[key] && runtime.state.preferences.web[key] && (key === 'share' || interactionAllows(runtime.state.preferences.interaction));
      }
      if (p.revoked === true && runtime.state.toggles.share && !next.share) runtime.state.notice = uiMessage('extension.share.revoked');
      runtime.state.toggles = next;
      if (!next.share && runtime.sharing.page) { runtime.sharing.invalidatePage(); runtime.sharing.expireViewing(); void runtime.sharing.clearRemoteViewing().catch(() => {}); }
      else runtime.emit();
      if (previousInteract !== next.interact) await scope.wait(runtime.sharing.saveToggles());
      return runtime.state.toggles;
}

export const viewingHandlers = {
  'page': pageCommand,
  'preferences': preferencesCommand,
  'toggle': toggleCommand,
} satisfies HandlerRegistry;
