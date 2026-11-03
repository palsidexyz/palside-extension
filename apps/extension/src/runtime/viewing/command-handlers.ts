import { message as uiMessage,MessageError } from '@palside/i18n';
import { pageView } from './view-snapshot';
import { type Viewing } from '../../domain/assets/model';
import { identifyPage,websiteIdentity,type PageIdentity } from '@palside/shared/navigation';
import { resolveTokenMetadata } from './token-page';
import { tokenNamed } from './token-profiles.ts';
import { assetKey } from '../../domain/annotations/interaction.ts';
import type { Command } from '../transport/command-map';
import { readPreferencePatch } from '../composition/state';
import { startedTeams } from '../teams/onboarding';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function pageCommand(this: RuntimeCommands, command: Extract<Command, { name: "page" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;

      if (!runtime.auth.session) return;
      if (p.failed) { if (runtime.state.tokenPending) { runtime.state.tokenPending = undefined; runtime.emit(); } return; }
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
      // Publishing waits for the token's name, so teammates never see the address placeholder first.
      const accept = async (view: Viewing | undefined, publish = true) => {
        if (!view || !current()) return;
        if (!preview && (!await runtime.foreground(identity.url) || !current())) return;
        runtime.sharing.page = view;
        runtime.cache.upsertView(view);
        runtime.state.viewingId = view.id;
        runtime.state.data.people = runtime.state.data.people.map(person => person.id === session.account.id ? { ...person, viewing: view.id } : person);
        runtime.emit();
        if (publish && !preview && p.stable === true) {
          clearTimeout(runtime.sharing.viewingTimer);
          runtime.sharing.viewingTimer = setTimeout(() => { void runtime.sharing.publishViewing().catch(() => {}); }, 5);
        }
      };
      const fallback = identity.kind === 'pool' ? websiteIdentity(identity.url)! : identity;
      const asset = identity.kind === 'asset' ? assetKey(identity.chain, identity.address) : undefined;
      // The token cache is keyed by asset, so a page seen earlier shows its name at once.
      const cached = identity.kind === 'asset' ? runtime.sharing.cachedToken(identity) : undefined;
      const reused = previousPage?.url === fallback.url && previousPage.kind === fallback.kind ? previousPage : undefined;
      const previewView = reused && (tokenNamed(reused) || !cached) ? reused
        : pageView(fallback, identity.kind === 'asset' ? resolveTokenMetadata(identity, cached) : undefined);
      const named = tokenNamed(previewView);
      if (asset && !named) runtime.state.tokenPending = asset;
      await accept(previewView, named || identity.kind !== 'asset');
      if (preview || identity.kind !== 'asset') return;
      void (async () => {
        // A cached name needs one confirming read, not the late-header retries.
        const local = await runtime.sharing.localTokenMetadata(identity, p.context, 'viewing', controller.signal, named ? 1 : 3);
        if (!current()) return;
        if (runtime.state.tokenPending === asset) runtime.state.tokenPending = undefined;
        if (local) await accept(pageView(identity, resolveTokenMetadata(identity, local)));
        // No name on the page: publish what is known, once.
        else if (!named) await accept(previewView);
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
      const previous = runtime.state.preferences;
      const patch = readPreferencePatch(p);
      if (!patch) throw new MessageError(uiMessage('common.error'));
      runtime.sharing.persistedPreferences ??= previous;
      runtime.state.preferences = { ...previous, ...patch, ...(patch.rooms ? { rooms: { ...previous.rooms, ...patch.rooms } } : {}) };
      if (patch.current !== undefined && patch.current !== previous.current) runtime.signals?.reset();
      const clearViewing = 'current' in p && p.current !== previous.current || Boolean(runtime.sharing.page && !runtime.sharing.mayObserve());
      const submitted = runtime.state.preferences, rooms = patch.rooms ? runtime.rooms.preferencesChanged() : Promise.resolve(); void rooms.catch(() => {});
      if (clearViewing) { runtime.sharing.invalidatePage(); runtime.sharing.expireViewing(); void runtime.sharing.clearRemoteViewing().catch(() => {}); }
      try { await scope.wait(runtime.sharing.savePreferences()); }
      catch (error) { scope.check(); if (runtime.state.preferences === submitted) { runtime.state.preferences = { ...(runtime.sharing.persistedPreferences ?? previous), startedTeams: startedTeams(runtime.state.preferences.startedTeams) }; if (patch.rooms) void runtime.rooms.preferencesChanged().catch(() => {}); runtime.emit(); } throw error; }
      await scope.wait(rooms);
      return;
}

export async function toggleCommand(this: RuntimeCommands, command: Extract<Command, { name: "toggle" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));

      // 共享在看's header key follows background commands and is kept with the account's preferences, so it survives a browser restart.
      // Its permission prompt runs in the panel; `revoked` reports Chrome's removal of the sharing permission.
      if (Object.keys(p).some(key => key !== 'share' && key !== 'revoked')) throw new MessageError(uiMessage('common.error'));
      if (p.share !== undefined && typeof p.share !== 'boolean') throw new MessageError(uiMessage('common.error'));
      const scope = runtime.auth.scope();
      const previous = runtime.state.preferences;
      const share = p.share ?? Boolean(previous.share);
      if (p.revoked === true && previous.share && !share) runtime.state.notice = uiMessage('extension.share.revoked');
      if (share !== Boolean(previous.share)) {
        runtime.sharing.persistedPreferences ??= previous;
        runtime.state.preferences = { ...previous, share };
        if (!share && runtime.sharing.page) { runtime.sharing.invalidatePage(); runtime.sharing.expireViewing(); void runtime.sharing.clearRemoteViewing().catch(() => {}); }
        else runtime.emit();
        const submitted = runtime.state.preferences;
        try { await scope.wait(runtime.sharing.savePreferences()); }
        catch (error) { scope.check(); if (runtime.state.preferences === submitted) { runtime.state.preferences = { ...runtime.state.preferences, share: Boolean(previous.share) }; runtime.emit(); } throw error; }
      } else runtime.emit();
      return { share: Boolean(runtime.state.preferences.share) };
}

export const viewingHandlers = {
  'page': pageCommand,
  'preferences': preferencesCommand,
  'toggle': toggleCommand,
} satisfies HandlerRegistry;
