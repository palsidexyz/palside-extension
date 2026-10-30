import { VIEWING_TTL_MS,VIEWING_MESSAGE_LENGTH } from '@palside/shared/contracts/limits';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionStatus } from '../transport/connection';
import type { MatrixEvent } from 'matrix-js-sdk';
import { sharingWork } from './sharing-work';
import { trustedDeviceMessages } from './viewing-targets';
import { teamSendGuard } from '../account/crypto-identity';
import { resolveTokenMetadata,tokenName,type TokenIdentity,type TokenPageMetadata,type TokenPageContext } from './token-page';
import { pageView,readView } from './view-snapshot';
import type { Viewing } from '../../domain/assets/model';
import { identifyPage,publicShareUrl,websiteIdentity } from '@palside/shared/navigation';
import { pageName } from './page-title';
import type { Preferences } from '../../domain/account/preferences';
import type { RuntimeDevice } from '../account/device';
import { pageFavicon } from './viewing';
import type { PalsideService } from '../composition/core';

export class SharingRuntime {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  page?: Viewing;
  pageObservation = 0;
  pageRequest?: AbortController;
  pageSince = 0;
  pagePreview = false;
  persistedPreferences?: Preferences;
  preferencesQueue: Promise<unknown> = Promise.resolve();
  viewingSequence = Date.now();
  viewingOrder = 0;
  activeViewing = new Map<string, { teamId: string; order: number; sequence: number; expiresAt: number }>();
  selectedDevice = false;
  publishing = false;
  viewingExpiryTimer?: ReturnType<typeof setTimeout>;
  viewingTimer?: ReturnType<typeof setTimeout>;
  publishedAt = 0;
  publishedView = '';
  ownViewing?: { view: Viewing; teamId: string; expiresAt: number };
  peerViewing = new Map<string, { view: Viewing; teamId: string; expiresAt: number }>();
  peerViewingVersions = new Map<string, number>();
  async localTokenMetadata(identity: TokenIdentity, context: unknown, purpose: 'viewing' | 'share', signal?: AbortSignal): Promise<TokenPageMetadata | undefined> {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; const teamId = runtime.state.preferences.current;
    const target = context as TokenPageContext | undefined;
    if (!session || signal?.aborted || !target || !Number.isInteger(target.tabId) || !Number.isInteger(target.windowId)) return;
    const preferences = runtime.state.preferences;
    const eligible = () => !signal?.aborted && runtime.auth.session === session && runtime.state.preferences.current === teamId &&
      runtime.state.preferences === preferences && !preferences.tokenOff?.includes(identity.host);
    for (let attempt = 0; attempt < 3 && eligible(); attempt++) {
      // The background owns the document-bound cache and read budget; late headers get two bounded retries.
      if (attempt) await scope.wait(new Promise(resolve => setTimeout(resolve, 300)));
      if (!eligible()) return;
      let timer: ReturnType<typeof setTimeout> | undefined; let cancel: (() => void) | undefined;
      try {
        const result = await scope.wait(Promise.race([
          runtime.tokenPage({ identity, context: target, accountId: session.account.id, teamId, purpose }).catch(() => undefined),
          new Promise<undefined>(resolve => { cancel = () => resolve(undefined); timer = setTimeout(cancel, 400); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel(); }),
        ]));
        if (!eligible()) return;
        if (!result || !tokenName(result.name)) continue;
        const checked = await scope.wait(readView(pageView(identity, resolveTokenMetadata(identity, result))));
        if (!checked || !eligible()) return;
        return { name: checked.name, logo: checked.logo };
      } finally { clearTimeout(timer); if (cancel) signal?.removeEventListener('abort', cancel); }
    }
  }
  async refreshTokenMetadata(identity: TokenIdentity, context: unknown) {
    const runtime = this.runtime;
    const page = this.page; const observation = this.pageObservation;
    if (!page || page.kind !== 'asset' || page.url !== identity.url || !this.mayObserve()) return;
    const local = await this.localTokenMetadata(identity, context, 'viewing', this.pageRequest?.signal);
    if (!local || this.page !== page || observation !== this.pageObservation || !this.mayObserve()) return;
    const view = pageView(identity, resolveTokenMetadata(identity, local));
    if (view.name === page.name && view.logo === page.logo) return;
    this.page = view; runtime.cache.upsertView(view); runtime.emit();
    void this.publishViewing().catch(() => {});
  }

  async prepareView(
    url: string,
    signal?: AbortSignal,
    context?: unknown,
    title?: unknown,
    favicon?: unknown,
  ): Promise<Viewing | undefined> {
    const parsedUrl = publicShareUrl(url);
    if (!parsedUrl) return;
    const host = new URL(parsedUrl).hostname;
    const identity = identifyPage(parsedUrl, undefined, 'page');
    if (!identity) return;
    const logo = pageFavicon(favicon);
    if (identity.kind !== 'asset') {
      const website = identity.kind === 'pool' ? websiteIdentity(parsedUrl, 'page') : identity;
      if (!website) return;
      return { ...pageView(website, { name: pageName(title, host) ?? host, logo }), source: host };
    }
    if (signal?.aborted) return;
    const local = await this.localTokenMetadata(identity, context, 'share', signal);
    return pageView(identity, resolveTokenMetadata(identity, local));
  }
  clearRemoteViewing() {
    const runtime = this.runtime;
    return runtime.api.request('viewing.update', { body: { clear: true, order: this.viewingOrder, sequence: ++this.viewingSequence } });
  }
  invalidatePage() {
    const runtime = this.runtime;
    this.pageRequest?.abort(); this.pageRequest = undefined; this.pageObservation++;
    clearTimeout(this.viewingTimer); this.page = undefined; this.ownViewing = undefined;
    runtime.state.viewingId = undefined; this.publishedView = '';
  }
  /** 共享在看 is 启用 and switched on, and the current team is joined and reachable. Every public page qualifies. */
  mayObserve() {
    const runtime = this.runtime;
    const prefs = runtime.state.preferences;
    return runtime.state.authenticated && prefs.web.share && runtime.state.toggles.share && connectionStatus(runtime.state.connection) === 'connected' &&
      runtime.state.remoteTeams.some(team => team.id === prefs.current && team.joined);
  }
  async consumeViewing(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime;
    if (runtime.auth.session !== session || !event.isEncrypted() || event.isDecryptionFailure() || event.getType() !== 'com.palside.viewing') return;
    const scope = runtime.auth.scope();
    const content = event.getContent(); const team = runtime.state.remoteTeams.find(t => t.id === content.teamId && t.joined && t.id === runtime.state.preferences.current);
    const person = team?.people.find(p => p.matrixId === event.getSender() && team.memberIds.includes(p.id));
    if (!person || !team || typeof content.expiresAt !== 'number' || content.expiresAt <= Date.now() || content.expiresAt > Date.now() + 45_000) return;
    const version = (this.peerViewingVersions.get(person.id) ?? 0) + 1; this.peerViewingVersions.set(person.id, version);
    const view = await scope.wait(readView(content.view));
    const lease = this.activeViewing.get(person.id);
    if (!lease || lease.teamId !== team.id || lease.order !== content.order || lease.sequence !== content.sequence || lease.expiresAt <= Date.now()) return;
    if (runtime.auth.session !== session || this.peerViewingVersions.get(person.id) !== version || runtime.state.preferences.current !== team.id || content.expiresAt <= Date.now() || !runtime.state.remoteTeams.some(t => t.id === team.id && t.joined && t.memberIds.includes(person.id))) return;
    if (view) { view.id = `${view.id}:member:${person.id}`; this.peerViewing.set(person.id, { view, teamId: team.id, expiresAt: Math.min(content.expiresAt, lease.expiresAt) }); runtime.cache.upsertView(view); this.expireViewing(); }
  }
  private viewingInput = '';
  expireViewing() {
    const runtime = this.runtime;
    clearTimeout(this.viewingExpiryTimer);
    for (const [id, entry] of this.peerViewing) if (entry.expiresAt <= Date.now() || entry.teamId !== runtime.state.preferences.current) this.peerViewing.delete(id);
    if (this.ownViewing && (this.ownViewing.expiresAt <= Date.now() || this.ownViewing.teamId !== runtime.state.preferences.current || !this.page)) this.ownViewing = undefined;
    const deadlines = [...this.peerViewing.values(), ...(this.ownViewing ? [this.ownViewing] : [])].map(entry => entry.expiresAt);
    if (deadlines.length) this.viewingExpiryTimer = setTimeout(() => this.expireViewing(), Math.max(1, Math.min(...deadlines) - Date.now()));
    const input = JSON.stringify([this.ownViewing, this.page, [...this.peerViewing].map(([id, entry]) => [id, entry.view]), runtime.state.viewingId, runtime.state.preferences.current, runtime.state.toggles.share, this.selectedDevice]);
    let changed = this.viewingInput !== input;
    this.viewingInput = input;
    let peopleChanged = false;
    const people = runtime.state.data.people.map(person => {
      const viewing = person.id === runtime.auth.session?.account.id
        ? this.ownViewing?.view.id ?? this.page?.id
        : this.peerViewing.get(person.id)?.view.id;
      if (person.viewing === viewing) return person;
      peopleChanged = true; return { ...person, viewing };
    });
    if (peopleChanged) { runtime.state.data.people = people; changed = true; }
    if (runtime.cache.pruneViews()) changed = true;
    if (changed || runtime.state.publishedViewing && !this.ownViewing) runtime.emit();
  }
  async publishViewing() {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    if (!runtime.auth.session || !runtime.auth.client || this.publishing) return;
    if (this.pagePreview) return;
    const prefs = runtime.state.preferences; const team = runtime.state.remoteTeams.find(t => t.id === prefs.current && t.joined);
    const page = this.page;
    const allowed = page && this.mayObserve() && this.selectedDevice && Date.now() >= this.pageSince && team;
    if (!allowed) {
      if (this.ownViewing) {
        this.ownViewing = undefined;
        this.expireViewing();
        void this.clearRemoteViewing().catch(() => {});
      }
      return;
    }
    const signature = JSON.stringify([team.id, page]);
    if (signature === this.publishedView && Date.now() - this.publishedAt < 10_000) return;
    const session = runtime.auth.session; const order = this.viewingOrder; const sequence = ++this.viewingSequence;
    const current = () => runtime.auth.session === session && this.page === page && this.viewingOrder === order && this.mayObserve() && runtime.state.preferences.current === team.id;
    this.publishing = true;
    try {
      if (!await scope.wait(runtime.foreground(page.url)) || !current()) return;
      const eligibility = teamSendGuard(runtime, team.id, true);
      const check = () => { eligibility.check(); if (!current() || !this.selectedDevice) throw new MessageError(uiMessage('extension.runtime.sharingNotReady')); };
      const cryptoApi = eligibility.client.getCrypto(); if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.sharingNotReady'));
      const expiresAt = Date.now() + VIEWING_TTL_MS;
      const encrypt = (view: Viewing) => scope.wait(sharingWork(trustedDeviceMessages(cryptoApi, eligibility.users, session.matrix, 'com.palside.viewing', { teamId: team.id, order, sequence, view, expiresAt }, check)));
      let sent = page; let messages = await scope.wait(encrypt(sent));
      if (JSON.stringify(messages).length > VIEWING_MESSAGE_LENGTH && sent.logo) { sent = { ...page, logo: undefined }; messages = await scope.wait(encrypt(sent)); }
      if (JSON.stringify(messages).length > VIEWING_MESSAGE_LENGTH) throw new MessageError(uiMessage('extension.runtime.sharingIncomplete'));
      if (!current() || !await scope.wait(runtime.foreground(page.url)) || !current()) return;
      check();
      const result = await scope.wait(runtime.api.request('viewing.update', { body: { teamId: team.id, order, sequence, messages } }));
      if (!current()) return;
      check();
      this.selectedDevice = result.selected; this.publishedView = signature; this.publishedAt = Date.now();
      this.ownViewing = result.selected && 'expiresAt' in result && result.expiresAt ? { view: sent, teamId: team.id, expiresAt: result.expiresAt } : undefined; this.expireViewing();
    } catch { scope.check();
    } finally { if (scope.current()) {
      this.publishing = false;
      if (this.page && (this.page !== page || this.viewingOrder !== order) && runtime.auth.session === session) void this.publishViewing().catch(() => {});
    } }
  }
  private persistedInteract = false;
  private togglesQueue: Promise<unknown> = Promise.resolve();
  async restoreToggles() {
    const runtime = this.runtime, scope = runtime.auth.scope(), session = runtime.auth.session; if (!session) return;
    const saved = await scope.wait(runtime.storage.get<{ interact?: boolean }>(`${session.account.id}:toggles`));
    this.persistedInteract = saved?.interact === true;
    runtime.state.toggles = { ...runtime.state.toggles, interact: this.persistedInteract };
  }
  async saveToggles() {
    const runtime = this.runtime, scope = runtime.auth.scope(), session = runtime.auth.session, submitted = runtime.state.toggles;
    const work = this.togglesQueue.catch(() => {}).then(async () => {
      scope.check(); if (!session) return;
      await scope.wait(runtime.storage.put(`${session.account.id}:toggles`, session.account.id, 'preferences', { interact: submitted.interact }));
      this.persistedInteract = submitted.interact;
    });
    this.togglesQueue = work;
    try { await scope.wait(work); }
    catch (error) { if (scope.current() && runtime.state.toggles === submitted) { runtime.state.toggles = { ...submitted, interact: this.persistedInteract }; runtime.emit(); } throw error; }
  }
  async savePreferences() {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    const session = runtime.auth.session; const preferences = runtime.state.preferences;
    runtime.emit();
    const write = this.preferencesQueue.catch(() => {}).then(async () => {
      if (!session || runtime.auth.session !== session) return;
      scope.check();
      await scope.wait(runtime.storage.put(`${session.account.id}:preferences`, session.account.id, 'preferences', preferences));
      if (runtime.auth.session === session) this.persistedPreferences = preferences;
    });
    this.preferencesQueue = write; await scope.wait(write);
  }
}
