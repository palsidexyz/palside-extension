import { parseCommand } from '../transport/command-map';
import { Api } from '../transport/api';
import { ClientStorage } from '../storage/storage';
import type { TokenPageReader } from '../viewing/token-page';
import { API_URL } from './config';
import type { RuntimeState } from './runtime-state';
import { emptyState } from './state';
import { AUTH_CANCEL_COMMANDS,AUTH_SETUP_COMMANDS,SERIAL_COMMANDS,commandError } from './commands';
import { DiagnosticErrors } from '../diagnostics/diagnostics';
import { SessionRuntime } from '../account/session-lifecycle';
import { LocalDataRuntime } from '../media/cache';
import { SharingRuntime } from '../viewing/sharing';
import { TimelineRuntime } from '../chat/timeline';
import { SendingRuntime } from '../chat/sending';
import { TeamInteractions } from '../annotations/interactions';
import { RuntimeCommands } from './dispatch';
import { RoomService } from '../rooms/rooms';
import { WalletRuntime } from '../wallet/runtime';
import { SignalService } from '../annotations/signal-service';
import { createPatchSliceCache,diffState } from '../transport/state-diff';
import { teamUnreadCounts } from '../../domain/chat/unread-mentions';

/** One offscreen runtime coordinates the account-scoped services for all panels. */
export class PalsideService {
  readonly storage: ClientStorage;
  readonly notify: (payload: Record<string, unknown>) => Promise<void>;
  readonly foreground: (url: string) => Promise<boolean>;
  readonly tokenPage: TokenPageReader;
  constructor(notify: (payload: Record<string, unknown>) => Promise<void> = async () => {}, foreground: (url: string) => Promise<boolean> = async () => true, storage = new ClientStorage(), tokenPage: TokenPageReader = async () => undefined) {
    this.notify = notify; this.foreground = foreground; this.storage = storage; this.tokenPage = tokenPage;
  }
  readonly api = new Api(API_URL);
  state = emptyState();
  listeners = new Set<(state: RuntimeState) => void>();
  diagnosticErrors = new DiagnosticErrors();
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
    for (const message of this.state.data.messages) if (message.expiresAt !== undefined && message.expiresAt > now) this.unreadDeadline = Math.min(this.unreadDeadline, message.expiresAt);
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
    const patch = diffState(this.emitted, this.state, this.emissionCache);
    if (this.emitted && !Object.keys(patch.set).length && !patch.unset?.length && !patch.entities) return;
    this.state = { ...this.state, revision: this.state.revision + 1 };
    this.emitted = this.state;
    for (const listener of this.listeners) listener(this.state);
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
