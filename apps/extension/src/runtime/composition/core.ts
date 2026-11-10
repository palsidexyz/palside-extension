import { parseCommand } from '../transport/command-map';
import { Api } from '../transport/api';
import { ClientStorage } from '../storage/storage';
import { API_URL } from './config';
import type { RuntimeState } from './runtime-state';
import { emptyState } from './state';
import { AUTH_CANCEL_COMMANDS,AUTH_SETUP_COMMANDS,SERIAL_COMMANDS,commandError } from './commands';
import { DiagnosticErrors,DiagnosticLatency } from '../diagnostics/diagnostics';
import { SessionRuntime } from '../account/session-lifecycle';
import { LocalDataRuntime } from '../media/cache';
import { SharingRuntime } from '../viewing/sharing';
import { TokenProfiles } from '../viewing/token-profiles.ts';
import { TokenDirectoryClient } from '../viewing/token-directory.ts';
import { PageResolver } from '../viewing/page-resolver.ts';
import { viewAsset } from '../../domain/annotations/interaction.ts';
import { TimelineRuntime } from '../chat/timeline';
import { SendingRuntime } from '../chat/sending';
import { TeamInteractions } from '../annotations/interactions';
import { RuntimeCommands } from './dispatch';
import { RoomService } from '../rooms/rooms';
import { WalletRuntime } from '../wallet/runtime';
import { SignalService } from '../annotations/signal-service';
import { signalAsset } from '../annotations/signals';
import { createPatchSliceCache,diffState } from '../transport/state-diff';
import { teamUnreadCounts } from '../../domain/chat/unread-mentions';

/** 最近看过 keeps this many 弹幕. */
const RECENT_ROOMS_SHOWN = 3;

/** One offscreen runtime coordinates the account-scoped services for all panels. */
export class PalsideService {
  readonly storage: ClientStorage;
  readonly notify: (payload: Record<string, unknown>) => Promise<void>;
  readonly foreground: (url: string) => Promise<boolean>;
  constructor(notify: (payload: Record<string, unknown>) => Promise<void> = async () => {}, foreground: (url: string) => Promise<boolean> = async () => true, storage = new ClientStorage()) {
    this.notify = notify; this.foreground = foreground; this.storage = storage;
    // Once the service refuses this version, every surface says 需要更新 until the newer one is installed (docs/engineering/release.md).
    this.api.onOutdated = () => { if (this.state.connection.outdated) return; this.state.connection.outdated = true; this.emit(); };
  }
  readonly api = new Api(API_URL);
  state = emptyState();
  readonly tokens = new TokenProfiles(() => this.nameViews(), undefined, new URL(API_URL).origin);
  /** Names and icons for every token the panel shows come from the server token directory, asked once per asset while signed in. */
  readonly directory = new TokenDirectoryClient(
    async items => { const token = this.auth.session?.token; if (!token) return undefined; return (await this.api.request('tokens.resolve', { body: { items }, token })).items; },
    answers => { let changed = false; for (const [asset, entry] of answers) changed = this.tokens.putDirectory(asset, entry) || changed; if (changed) this.emit(); },
    asset => this.tokens.answered(asset),
    undefined,
    assets => { let changed = false; for (const asset of assets) changed = this.tokens.markUnknown(asset) || changed; if (changed) this.emit(); },
    () => this.auth.liveOpen,
  );
  /** Pool pages and chainless contract pages: the server finds the token, whose name and icon join the token records. */
  readonly pages = new PageResolver(
    async item => { const token = this.auth.session?.token; if (!token) return undefined; return (await this.api.request('tokens.resolve', { body: { items: [item] }, token })).items[0]; },
    (asset, entry) => { this.tokens.putDirectory(asset, entry); },
    () => this.emit(),
  );
  /** A name learned later also replaces the address placeholder in views already shown, such as a teammate's 在看. */
  private nameViews() {
    let changed = false;
    const views = this.state.data.views.map(view => { const named = this.tokens.apply(view); if (named !== view) changed = true; return named; });
    if (changed) this.state.data = { ...this.state.data, views };
  }
  listeners = new Set<(state: RuntimeState) => void>();
  diagnosticErrors = new DiagnosticErrors();
  diagnosticLatency = new DiagnosticLatency();
  subscribe(listener: (state: RuntimeState) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private unreadInput = '';
  private unreadDeadline = Infinity;
  private emissionCache = createPatchSliceCache();
  private emitted?: RuntimeState;
  private publishedInput = '';
  private countUnread(): void {
    const self = this.state.account?.id;
    const input = () => JSON.stringify([self,
      this.state.data.messages.map(m => [m.id, m.teamId, m.author, m.status, m.recalled, m.removedByOwner, m.mentionIds, m.expiresAt]),
      this.state.remoteTeams.map(t => [t.id, t.joined, t.preferences.readIds]),
      this.state.data.teams.map(t => [t.id, t.unread, t.mentions]),
    ]);
    const now = Date.now(), key = input();
    if (key === this.unreadInput && now < this.unreadDeadline) return;
    this.unreadInput = key;
    if (!self) { this.unreadDeadline = Infinity; return; }
    const read = new Map(this.state.remoteTeams.filter(team => team.joined).map(team => [team.id, new Set(team.preferences.readIds)]));
    const counts = teamUnreadCounts(this.state.data.messages, self, read, now);
    this.unreadDeadline = Infinity;
    for (const message of this.state.data.messages) if (message.expiresAt && message.expiresAt > now) this.unreadDeadline = Math.min(this.unreadDeadline, message.expiresAt);
    let changed = false;
    const teams = this.state.data.teams.map(team => {
      const { unread, mentions } = counts.get(team.id) ?? { unread: 0, mentions: 0 };
      if (team.unread === unread && (team.mentions ?? 0) === mentions) return team;
      changed = true; return { ...team, unread, mentions };
    });
    if (changed) this.state.data = { ...this.state.data, teams };
    this.unreadInput = input();
  }
  emit() {
    this.rooms.pruneIfChanged();
    this.countUnread();
    this.diagnosticErrors?.observe('error', this.state.error);
    this.diagnosticErrors?.observe('notice', this.state.notice);
    // Only this device's acknowledged, current lease can select the sharing control.
    const own = this.sharing.ownViewing;
    const active = Boolean(own && own.expiresAt > Date.now()), allowed = this.sharing.mayObserve();
    const input = JSON.stringify([own?.view.id, own?.teamId, own?.expiresAt, this.sharing.page?.id, this.state.preferences.current, this.sharing.selectedDevice, active, allowed]);
    if (input !== this.publishedInput) {
      this.publishedInput = input;
      this.state.publishedViewing = own && active && own.view.id === this.sharing.page?.id &&
        own.teamId === this.state.preferences.current && this.sharing.selectedDevice && allowed
        ? { viewId: own.view.id, teamId: own.teamId, expiresAt: own.expiresAt } : undefined;
    }
    this.projectTokens();
    const patch = diffState(this.emitted, this.state, this.emissionCache);
    if (this.emitted && !Object.keys(patch.set).length && !patch.unset?.length && !patch.entities) return;
    this.state = { ...this.state, revision: this.state.revision + 1 };
    this.emitted = this.state;
    for (const listener of this.listeners) listener(this.state);
  }
  private tokenInput = '';
  private pagesVersion = -1;
  private recentAccount?: string;
  /** Remembers each 弹幕 once it has opened, for 最近看过 where there is no token. */
  private noteRecentRoom() {
    const state = this.state, account = state.account?.id;
    if (account !== this.recentAccount) { this.recentAccount = account; state.recentRooms = undefined; state.searchAssets = undefined; state.cardAssets = undefined; }
    const key = state.rooms.current && !state.rooms.current.loading ? state.rooms.current.key : undefined;
    if (!account || !key || state.recentRooms?.[0] === key) return;
    state.recentRooms = [key, ...(state.recentRooms ?? []).filter(item => item !== key)].slice(0, RECENT_ROOMS_SHOWN);
  }
  /** The token records the panel needs: every token it currently shows, so card, 详情, 弹幕, 热门 and 在看 read one record. */
  private projectTokens() {
    const state = this.state, assets: string[] = [];
    const add = (view: { kind?: string; chain?: string; address?: string } | undefined) => { const asset = viewAsset(view); if (asset) assets.push(asset); };
    const addKey = (key: string | undefined) => { if (key?.startsWith('token:')) assets.push(key.slice('token:'.length)); };
    addKey(state.rooms.current?.key); addKey(state.rooms.pinned); addKey(this.rooms.tabKey);
    for (const view of state.data.views) add(view);
    for (const message of state.data.messages) { add(message.attachment?.kind === 'asset' ? message.attachment.view : undefined); }
    for (const record of [...state.signalRecords ?? [], ...(state.chartDrawings ?? []).filter(record => record.shape)]) { const asset = signalAsset(record); if (asset) assets.push(asset); }
    for (const poke of state.pokes ?? []) add(poke.view);
    for (const draft of Object.values(state.drafts)) { add(draft.value.attachment?.kind === 'asset' ? draft.value.attachment.view : undefined); }
    for (const row of state.rooms.hot?.rows ?? []) addKey(row.key);
    for (const key of Object.keys(state.rooms.summaries)) addKey(key);
    this.noteRecentRoom();
    for (const key of state.recentRooms ?? []) addKey(key);
    assets.push(...state.searchAssets ?? [], ...state.cardAssets ?? []);
    if (this.pages.version !== this.pagesVersion) { this.pagesVersion = this.pages.version; state.pages = this.pages.pick(); state.pageChoices = this.pages.choices(); }
    // 切换链 names every chain the address is a token on, not only the one shown.
    for (const candidates of Object.values(state.pageChoices ?? {})) assets.push(...candidates);
    const input = `${this.tokens.version}:${this.auth.session ? 1 : 0}:${assets.join(',')}`;
    if (input === this.tokenInput) return;
    this.tokenInput = input; this.directory.show(assets); state.tokens = this.tokens.pick(assets); state.tokenUnknown = this.tokens.unknownOf(assets);
  }
  private authCommandEpoch = 0;
  async command(input: unknown): Promise<unknown> {
    try {
      const command = parseCommand(input);
      const cancelling = AUTH_CANCEL_COMMANDS.has(command.name);
      if (cancelling) { this.authCommandEpoch++; this.auth.cancelAuthentication(); }
      if (SERIAL_COMMANDS.has(command.name)) {
        const epoch = this.authCommandEpoch;
        const next = this.auth.authQueue.then(() => {
          if (!cancelling && epoch !== this.authCommandEpoch) throw commandError('LOGIN_CHANGED', 'extension.runtime.loginChanged');
          if (AUTH_SETUP_COMMANDS.has(command.name)) this.auth.beginAuthentication();
          return this.dispatch.execute(command);
        });
        this.auth.authQueue = next.then(() => {}, error => { this.diagnosticErrors.record(error); });
        return next;
      }
      return await this.dispatch.execute(command);
    } catch (error) {
      this.diagnosticErrors.record(error);
      throw error;
    }
  }
  readonly auth = new SessionRuntime(this);
  readonly cache = new LocalDataRuntime(this);
  readonly sharing = new SharingRuntime(this);
  readonly timeline = new TimelineRuntime(this);
  readonly sending = new SendingRuntime(this);
  readonly interactions = new TeamInteractions(this);
  readonly rooms = new RoomService(this);
  readonly wallet = new WalletRuntime(this);
  readonly signals = new SignalService(this);
  readonly dispatch = new RuntimeCommands(this);
  initialise(): Promise<void> { return this.auth.initialise(); }
  networkChanged(online: boolean) { return this.auth.networkChanged(online); }
  refresh(): Promise<void> { return this.auth.refresh(); }
}
