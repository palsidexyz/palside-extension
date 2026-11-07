import { VIEWING_TTL_MS, VIEWING_CLOCK_SKEW_MS, VIEWING_RENEW_MS, VIEWING_MESSAGE_LENGTH } from '@palside/shared/rules/interactions';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { connectionStatus } from '../transport/connection';
import type { MatrixEvent } from 'matrix-js-sdk';
import { sharingWork } from './sharing-work';
import { trustedDeviceMessages } from './viewing-targets';
import { teamSendGuard } from '../account/crypto-identity';
import { resolveTokenMetadata,type TokenIdentity } from './token-name';
import { pageView,readView } from './view-snapshot';
import { assetKey } from '../../domain/annotations/interaction.ts';
import type { Viewing } from '../../domain/assets/model';
import { identifyPage,publicShareUrl,websiteIdentity } from '@palside/shared/navigation';
import { pageName } from './page-title';
import type { Preferences } from '../../domain/account/preferences';
import type { RuntimeDevice } from '../account/device';
import { pageFavicon } from './viewing';
import { tokenPage,type LookupPage } from './page-resolver.ts';
import type { PalsideService } from '../composition/core';

/** How long 共享在看 and link cards wait for the token directory before using the short address. */
export const TOKEN_NAME_WAIT_MS = 3000;

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
  /** The token's display name: waits up to `TOKEN_NAME_WAIT_MS` for the directory, then the best name known. */
  /** A pool or chainless contract page's token, waiting up to `TOKEN_NAME_WAIT_MS` for the server; undefined when it has none or is late. */
  async pageToken(page: LookupPage, signal?: AbortSignal) {
    const runtime = this.runtime;
    let asset = runtime.pages.get(page.url);
    if (asset === undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      asset = await runtime.auth.scope().wait(Promise.race([
        runtime.pages.resolve(page),
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), TOKEN_NAME_WAIT_MS); signal?.addEventListener('abort', () => resolve(undefined), { once: true }); }),
      ])).finally(() => clearTimeout(timer));
    }
    return asset ? tokenPage(page, asset) : undefined;
  }
  async tokenView(identity: TokenIdentity, signal?: AbortSignal, via?: Viewing['via']) {
    const runtime = this.runtime, asset = assetKey(identity.chain, identity.address)!;
    if (!runtime.tokens.answered(asset)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await runtime.auth.scope().wait(Promise.race([
        runtime.directory.ensure(asset),
        new Promise<void>(resolve => { timer = setTimeout(resolve, TOKEN_NAME_WAIT_MS); signal?.addEventListener('abort', () => resolve(), { once: true }); }),
      ])).finally(() => clearTimeout(timer));
    }
    return pageView(identity, resolveTokenMetadata(identity, runtime.tokens.get(asset)), via);
  }

  async prepareView(
    url: string,
    signal?: AbortSignal,
    title?: unknown,
    favicon?: unknown,
  ): Promise<Viewing | undefined> {
    const parsedUrl = publicShareUrl(url);
    if (!parsedUrl) return;
    const host = new URL(parsedUrl).hostname;
    const identity = identifyPage(parsedUrl, undefined, 'page');
    if (!identity) return;
    const logo = pageFavicon(favicon);
    const token = identity.kind === 'pool' || identity.kind === 'address' ? await this.pageToken(identity, signal) : identity.kind === 'asset' ? identity : undefined;
    if (signal?.aborted) return;
    if (!token) {
      const website = identity.kind === 'website' ? identity : websiteIdentity(parsedUrl, 'page');
      if (!website) return;
      return { ...pageView(website, { name: pageName(title, host) ?? host, logo }), source: host };
    }
    return await this.tokenView(token, signal, identity.kind === 'pool' || identity.kind === 'address' ? identity.kind : undefined);
  }
  clearRemoteViewing() {
    const runtime = this.runtime;
    return runtime.api.request('viewing.update', { body: { clear: true, order: this.viewingOrder, sequence: ++this.viewingSequence } });
  }
  invalidatePage() {
    const runtime = this.runtime;
    this.pageRequest?.abort(); this.pageRequest = undefined; this.pageObservation++;
    clearTimeout(this.viewingTimer); this.page = undefined; this.ownViewing = undefined; runtime.state.tokenPending = undefined;
    runtime.state.viewingId = undefined; this.publishedView = '';
  }
  /** 共享在看 is on, and the current team is joined and reachable. Every public page qualifies. */
  mayObserve() {
    const runtime = this.runtime;
    const prefs = runtime.state.preferences;
    return runtime.state.authenticated && prefs.share && connectionStatus(runtime.state.connection) === 'connected' &&
      runtime.state.remoteTeams.some(team => team.id === prefs.current && team.joined);
  }
  async consumeViewing(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime;
    if (runtime.auth.session !== session || !event.isEncrypted() || event.isDecryptionFailure() || event.getType() !== 'com.palside.viewing') return;
    const scope = runtime.auth.scope();
    const content = event.getContent(); const team = runtime.state.remoteTeams.find(t => t.id === content.teamId && t.joined && t.id === runtime.state.preferences.current);
    const person = team?.people.find(p => p.matrixId === event.getSender() && team.memberIds.includes(p.id));
    if (!person || !team || typeof content.expiresAt !== 'number' || content.expiresAt <= Date.now() || content.expiresAt > Date.now() + VIEWING_TTL_MS + VIEWING_CLOCK_SKEW_MS) return;
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
    const input = JSON.stringify([this.ownViewing, this.page, [...this.peerViewing].map(([id, entry]) => [id, entry.view]), runtime.state.viewingId, runtime.state.preferences.current, runtime.state.preferences.share, this.selectedDevice]);
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
    // The name is still being read: the page command publishes once it settles.
    if (this.page?.kind === 'asset' && runtime.state.tokenPending && runtime.state.tokenPending === assetKey(this.page.chain, this.page.address)) return;
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
    if (signature === this.publishedView && Date.now() - this.publishedAt < VIEWING_RENEW_MS) return;
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
    void runtime.auth.preloadHistory().catch(() => {});
  }
}
