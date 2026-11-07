import { message as uiMessage,MessageError } from '@palside/i18n';
import { pageView } from './view-snapshot';
import { type Viewing } from '../../domain/assets/model';
import { identifyPage,websiteIdentity,type PageIdentity } from '@palside/shared/navigation';
import { resolveTokenMetadata } from './token-name';
import { TOKEN_NAME_WAIT_MS } from './sharing';
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
      const parsed = input?.url && typeof p.host === 'string' ? identifyPage(input.url, [p.host]) : null;
      if (!parsed || !runtime.sharing.mayObserve()) return;
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
      if (!preview && (!await runtime.foreground(parsed.url) || !current())) return;
      // A pool or chainless contract page is its token once the server answers; a known answer is immediate.
      const lookup = parsed.kind === 'pool' || parsed.kind === 'address' ? parsed : undefined;
      const looked = lookup ? await runtime.sharing.pageToken(lookup, controller.signal) : undefined;
      if (!current()) return;
      const identity = looked ?? parsed, via = looked ? lookup!.kind : undefined;
      runtime.sharing.pageSince = Date.now();
      // Publishing waits up to TOKEN_NAME_WAIT_MS for the token directory, so teammates rarely see the address placeholder first.
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
      const fallback = identity.kind === 'asset' || identity.kind === 'website' ? identity : websiteIdentity(identity.url)!;
      const asset = identity.kind === 'asset' ? assetKey(identity.chain, identity.address) : undefined;
      // The token record is keyed by asset, so a token seen earlier shows its name at once.
      const known = asset ? runtime.tokens.get(asset) : undefined;
      const tokenPage = () => pageView(fallback, identity.kind === 'asset' ? resolveTokenMetadata(identity, runtime.tokens.get(asset)) : undefined, via);
      const reused = previousPage?.url === fallback.url && previousPage.kind === fallback.kind ? previousPage : undefined;
      const previewView = reused && (tokenNamed(reused) || !known) ? reused : tokenPage();
      const named = tokenNamed(previewView), answered = !asset || runtime.tokens.answered(asset);
      if (asset && !answered && !named) runtime.state.tokenPending = asset;
      await accept(previewView, answered || named);
      if (preview || !asset || answered) return;
      void (async () => {
        const settled = runtime.directory.ensure(asset);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = await Promise.race([settled.then(() => false), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), TOKEN_NAME_WAIT_MS); })]);
        clearTimeout(timer);
        if (!current()) return;
        if (runtime.state.tokenPending === asset) runtime.state.tokenPending = undefined;
        if (!late) { const next = tokenPage(); if (!named || next.name !== previewView.name) await accept(next); else runtime.emit(); return; }
        // No answer in time: publish what is known, then at most one correction when the directory answers.
        if (!named) await accept(previewView);
        await settled;
        if (!current()) return;
        const next = tokenPage();
        if (next.name !== runtime.sharing.page?.name) await accept(next);
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
