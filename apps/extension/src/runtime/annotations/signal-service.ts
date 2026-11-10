import { MINUTE_MS } from '@palside/shared/units';
import { message as uiMessage,MessageError } from '@palside/i18n';
import type { MatrixEvent } from 'matrix-js-sdk';
import { SIGNAL_CLOCK_SKEW,SIGNAL_EVENT,SIGNAL_RECORD_EVENT,SIGNAL_RECORD_LIMIT,SIGNAL_RECORDS_PER_MINUTE,SIGNAL_TTL,readSignal,type SignalPayload,type SignalRecord } from './signals';
import { CHART_LASER_MS,CHART_MARK_EVENT,addChartMark,chartMarkAlive,readChartMark,type ChartMarkPayload,type ReceivedChartMark } from './chart-marks.ts';
import { ChartDrawingStore } from './chart-drawing-store.ts';
import type { ChartDrawing } from './chart-drawings.ts';
import { sharingWork } from '../viewing/sharing-work';
import { trustedDeviceMessages } from '../viewing/viewing-targets';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import type { RuntimeDevice } from '../account/device';
import type { PalsideService } from '../composition/core';
import { liveMembers } from '../../domain/teams/model.ts';

const SEEN_LIMIT = 512;
const DISPLAY_LIMIT = 128;
const RECORD_KEY = 'signal:';

/**
 * Short-lived Olm signals. A relay receipt counts queued devices, never viewers; a send that can reach no device fails with the reason.
 * A signal also leaves a record in the squad's room, which is what the chat shows and replays: the relay plays it now, the record keeps it.
 */
export class SignalService {
  readonly runtime: PalsideService;
  /** 共享画线's drawings, which keep their own list and lifetime. */
  readonly drawings: ChartDrawingStore;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly seen = new Map<string, number>();
  private sendTimes: number[] = [];
  private markTimes: number[] = [];
  private recordTimes: number[] = [];
  private generation = 0;
  /** Service time minus this device's clock. Signals carry service time, so members' clocks need not agree. */
  private clockOffset = 0;
  constructor(runtime: PalsideService) { this.runtime = runtime; this.drawings = new ChartDrawingStore(runtime); }

  reset() {
    this.drawings.reset();
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.seen.clear();
    this.sendTimes = [];
    this.markTimes = [];
    this.recordTimes = [];
    this.runtime.state.signals = [];
    this.runtime.state.chartMarks = [];
    this.runtime.state.signalRecords = [];
  }

  /** The service's clock now, as learned from the last snapshot; members' devices agree on it even when their own clocks do not. */
  serviceNow() { return Date.now() + this.clockOffset; }
  /** A service time on this device's clock, for local timers. */
  toLocal(serviceTime: number) { return serviceTime - this.clockOffset; }

  /** A service reply's time, against this device's clock around the request. */
  syncClock(serverTime: number, requestedAt: number, answeredAt: number) {
    this.clockOffset = Math.round(serverTime - (requestedAt + answeredAt) / 2);
  }

  async send(teamId: string, payload: Record<string, unknown>, hostCurrent: () => Promise<boolean> = async () => false) {
    let signal: SignalPayload | undefined, settle!: (sent: boolean) => void;
    const relayed = new Promise<boolean>(resolve => { settle = resolve; });
    // The chat line shows at once as pending and its room keys get ready alongside the relay; it is written only once the relay is
    // accepted, so a signal that never went out leaves no line.
    try {
      const result = await this.relay(teamId, SIGNAL_EVENT, sentAt => (signal = readSignal({ ...payload, id: crypto.randomUUID(), teamId, sentAt }, sentAt)), this.sendTimes, 3, hostCurrent,
        () => { if (signal) this.record(signal, relayed); });
      settle(true);
      return result;
    } catch (error) { settle(false); throw error; }
  }

  /**
   * The chat line for a signal or emote this device sends: pending at once, replaced by its room event. It goes when the relay
   * fails; its own failure costs the line, not the signal.
   */
  private record(signal: SignalPayload, relayed: Promise<boolean>) {
    const runtime = this.runtime, session = runtime.auth.session, now = Date.now();
    const team = runtime.state.remoteTeams.find(item => item.id === signal.teamId && item.joined);
    if (!session || !team?.roomId) return;
    this.recordTimes = this.recordTimes.filter(at => now - at < MINUTE_MS);
    if (this.recordTimes.length >= SIGNAL_RECORDS_PER_MINUTE) return;
    this.recordTimes.push(now);
    const { id, teamId, url, kind, target, emote, asset } = signal;
    this.setRecords([...(runtime.state.signalRecords ?? []), { id, teamId, personId: session.account.id, url, kind, target, ...(emote ? { emote } : {}), ...(asset ? { asset } : {}), timestamp: now, expiresAt: now + MINUTE_MS, pending: true }]);
    runtime.emit();
    void this.writeRecord(signal, team.roomId, liveMembers(team), relayed).catch(() => {
      if (runtime.auth.session !== session) return;
      const records = runtime.state.signalRecords ?? [];
      if (!records.some(record => record.pending && record.id === id)) return;
      runtime.state.signalRecords = records.filter(record => !(record.pending && record.id === id));
      runtime.emit();
    });
  }

  /** The signal as an encrypted room event, like a message: the same room, the same keys, the same lifetime. */
  private async writeRecord(signal: SignalPayload, roomId: string, members: ReturnType<typeof liveMembers>, relayed: Promise<boolean>) {
    const runtime = this.runtime, scope = runtime.auth.scope(), client = runtime.auth.client;
    if (!client) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
    const { check } = teamSendGuard(runtime, signal.teamId);
    await scope.wait(requireEncryptedSend(client, roomId, members, check));
    if (!await scope.wait(relayed)) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    check();
    const { id, teamId, url, sentAt, kind, target, emote, asset } = signal;
    try { await scope.wait(client.sendEvent(roomId, SIGNAL_RECORD_EVENT as never, { id, teamId, url, sentAt, kind, target, ...(emote ? { emote } : {}), ...(asset ? { asset } : {}) } as never, id)); }
    catch (error) {
      // A failed send would otherwise wait in the room's pending list for a retry nothing asks for.
      const room = client.getRoom(roomId), pending = room?.getEventForTxnId(id);
      if (pending) client.cancelPendingEvent(pending);
      throw error;
    }
  }

  /** A record from the squad's room (`timeline`), its sender already found there. Reading it again changes nothing. */
  async keepRecord(event: MatrixEvent, teamId: string, personId: string, expiresAt: number, session: RuntimeDevice) {
    const runtime = this.runtime, id = event.getId(), timestamp = event.getTs(), content = event.getContent() as Record<string, unknown>;
    if (runtime.auth.session !== session || !id || (runtime.state.signalRecords ?? []).some(record => record.id === id)) return;
    // The send time only proves the sender's own clock; the event's time is the service's, whenever this device reads it.
    const signal = readSignal(content, typeof content.sentAt === 'number' ? content.sentAt : Date.now());
    if (!signal || signal.teamId !== teamId) return;
    const record: SignalRecord = { id, teamId, personId, url: signal.url, kind: signal.kind, target: signal.target, ...(signal.emote ? { emote: signal.emote } : {}), ...(signal.asset ? { asset: signal.asset } : {}), timestamp, expiresAt };
    // This device's own line was showing as pending under the signal's id: the room event takes its place.
    this.setRecords([...(runtime.state.signalRecords ?? []).filter(item => !(item.pending && item.id === signal.id && personId === session.account.id)), record]);
    runtime.emit();
    const evicted = await runtime.auth.scope().wait(runtime.storage.cache(session.account.id, `${RECORD_KEY}${id}`, { signalRecord: record, timestamp }, expiresAt));
    if (runtime.auth.session === session) runtime.cache.evictCachedContent(evicted);
  }

  /** Records read back from this device's cache at start. */
  restoreRecords(records: SignalRecord[], drawings: ChartDrawing[] = []) {
    this.setRecords([...(this.runtime.state.signalRecords ?? []), ...records]);
    this.drawings.restore(drawings);
  }

  /** Sorted by time, one per event, the newest `SIGNAL_RECORD_LIMIT` of each squad. */
  private setRecords(records: SignalRecord[]) {
    const kept = new Map<string, number>(), ids = new Set<string>(), result: SignalRecord[] = [];
    for (const record of [...records].sort((a, b) => b.timestamp - a.timestamp)) {
      const count = kept.get(record.teamId) ?? 0;
      if (ids.has(record.id) || count >= SIGNAL_RECORD_LIMIT) continue;
      ids.add(record.id); kept.set(record.teamId, count + 1); result.push(record);
    }
    this.runtime.state.signalRecords = result.reverse();
  }

  /** Records past their squad's retention or outside this account's time in the squad leave this device, as messages do. */
  async pruneRecords(allowed: (record: { teamId: string; timestamp: number; expiresAt: number }) => boolean) {
    const runtime = this.runtime, session = runtime.auth.session, records = runtime.state.signalRecords ?? [];
    const gone = records.filter(record => !allowed(record));
    const drawings = await this.drawings.prune(allowed);
    if (!gone.length || !session) return drawings;
    runtime.state.signalRecords = records.filter(record => allowed(record));
    await runtime.auth.scope().wait(Promise.all(gone.map(record => runtime.storage.remove(`${session.account.id}:cache:${RECORD_KEY}${record.id}`))));
    return true;
  }

  /** The storage budget dropped these cached records. */
  evicted(id: string) {
    if (this.drawings.evicted(id)) return true;
    if (!id.startsWith(RECORD_KEY)) return false;
    const eventId = id.slice(RECORD_KEY.length);
    this.runtime.state.signalRecords = (this.runtime.state.signalRecords ?? []).filter(record => record.id !== eventId);
    return true;
  }

  /** 共享画线's 激光笔: one finished stroke to the squad. It also joins this device's own list, so its other tabs draw it. */
  async sendMark(teamId: string, payload: Record<string, unknown>, hostCurrent: () => Promise<boolean> = async () => false) {
    let mark: ChartMarkPayload | undefined;
    const result = await this.relay(teamId, CHART_MARK_EVENT, sentAt => (mark = readChartMark({ ...payload, id: crypto.randomUUID(), teamId, sentAt }, sentAt)), this.markTimes, 6, hostCurrent);
    const self = this.runtime.auth.session?.account.id;
    if (mark && self) this.keepMark({ ...mark, sentAt: mark.sentAt - this.clockOffset, personId: self, at: Date.now() });
    return result;
  }

  /** Laser strokes this device holds (`CHART_LASER_MS`), oldest first. */
  private keepMark(mark: ReceivedChartMark) {
    const state = this.runtime.state, now = Date.now();
    state.chartMarks = addChartMark((state.chartMarks ?? []).filter(item => chartMarkAlive(item, now)), mark);
    const session = this.runtime.auth.session;
    if (session) this.schedule(session);
    this.runtime.emit();
  }

  /** Olm to every trusted device of the squad's other members, through the service's short-lived relay. */
  private async relay<T extends { sentAt: number }>(teamId: string, type: string, build: (sentAt: number) => T | undefined, times: number[], perTwoSeconds: number, hostCurrent: () => Promise<boolean>, ready?: () => void) {
    const runtime = this.runtime, scope = runtime.auth.scope();
    const session = runtime.auth.session, client = runtime.auth.client, generation = this.generation;
    const currentTeam = () => {
      scope.check();
      if (generation !== this.generation || !session || runtime.auth.session !== session || runtime.auth.client !== client) throw new MessageError(uiMessage('extension.runtime.loginChanged'));
      runtime.auth.requireConnection();
      const team = runtime.state.remoteTeams.find(item => item.id === teamId && item.joined);
      if (!client || !team || runtime.state.preferences.current !== teamId || !team.memberIds.includes(session.account.id) || runtime.state.data.teams.find(item => item.id === teamId)?.readonly) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      return team;
    };
    const team = currentTeam();
    const startedAt = Date.now(), sentAt = startedAt + this.clockOffset;
    const signal = build(sentAt);
    if (!signal) throw new MessageError(uiMessage('common.error'));
    const cryptoApi = client!.getCrypto();
    if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    const recent = times.filter(at => startedAt - at < 2_000);
    times.splice(0, times.length, ...recent);
    if (times.length >= perTwoSeconds) throw new MessageError(uiMessage('extension.runtime.signalRateLimited'));
    times.push(startedAt);
    const recipients = (value: typeof team) => liveMembers(value).filter(person => person.id !== session!.account.id && person.matrixId !== session!.matrix.userId).map(person => person.matrixId).sort();
    const others = recipients(team), membership = JSON.stringify(others);
    const check = () => {
      const latest = currentTeam();
      if (latest.roomId !== team.roomId || JSON.stringify(recipients(latest)) !== membership) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      if (Date.now() >= startedAt + SIGNAL_TTL) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    };
    const checkHost = async () => {
      const allowed = await scope.wait(sharingWork(hostCurrent(), Math.max(1, startedAt + SIGNAL_TTL - Date.now())));
      check();
      if (!allowed) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
    };
    // A receipt that reached no device says why, instead of looking sent.
    if (!others.length) throw new MessageError(uiMessage('extension.runtime.signalAlone'));
    // The page check comes before any encryption: a refused signal claims no teammate keys.
    await checkHost();
    ready?.();
    const prepare = async <T>(work: Promise<T>) => {
      try { const value = await scope.wait(sharingWork(work, Math.max(1, startedAt + SIGNAL_TTL - Date.now()))); await checkHost(); return value; }
      catch (error) {
        check();
        // A changed identity is a reason the sender can act on; anything else is encryption still getting ready.
        if ((error as { code?: unknown }).code === 'IDENTITY_CHANGED') throw error;
        throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
      }
    };
    const messages = await prepare(trustedDeviceMessages(cryptoApi, others, session!.matrix, type, signal, check));
    if (!Object.keys(messages).length) throw new MessageError(uiMessage('extension.runtime.signalUnverified'));
    const receipt = await scope.wait(runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check();
    return { queued: receipt.delivered };
  }

  consumeMark(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime, now = Date.now();
    if (runtime.auth.session !== session || !event.isEncrypted() || event.getType() !== CHART_MARK_EVENT) return;
    const wire = readChartMark(event.getContent(), now + this.clockOffset);
    const person = wire && this.sender(wire.teamId, event, session);
    if (!wire || !person) return;
    this.prune(now);
    const key = `mark\0${wire.teamId}\0${person.id}\0${wire.id}`;
    if (this.seen.has(key) || this.seen.size >= SEEN_LIMIT) return;
    this.seen.set(key, wire.sentAt - this.clockOffset + SIGNAL_CLOCK_SKEW);
    this.keepMark({ ...wire, sentAt: wire.sentAt - this.clockOffset, personId: person.id, at: now });
  }

  /** The squad member who sent this to-device event, never this account. */
  private sender(teamId: string, event: MatrixEvent, session: RuntimeDevice) {
    const team = this.runtime.state.remoteTeams.find(item => item.id === teamId && item.joined && item.memberIds.includes(session.account.id));
    return team?.people.find(item => !item.deleted && item.matrixId === event.getSender() && team.memberIds.includes(item.id) && item.id !== session.account.id && item.matrixId !== session.matrix.userId);
  }

  consume(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime, now = Date.now();
    if (runtime.auth.session !== session || !event.isEncrypted() || event.getType() !== SIGNAL_EVENT) return;
    const wire = readSignal(event.getContent(), now + this.clockOffset);
    if (!wire) return;
    // From here on every time reads on this device's clock.
    const signal = { ...wire, sentAt: wire.sentAt - this.clockOffset };
    const person = this.sender(signal.teamId, event, session);
    if (!person) return;
    this.prune(now);
    const key = `${signal.teamId}\0${person.id}\0${signal.id}`;
    // Fail closed at capacity so an evicted id cannot immediately be replayed.
    if (this.seen.has(key) || this.seen.size >= SEEN_LIMIT) return;
    // Kept for as long as readSignal would still accept this send time, so a replay cannot slip in.
    this.seen.set(key, signal.sentAt + SIGNAL_CLOCK_SKEW);
    runtime.diagnosticLatency?.record('signal', signal.sentAt, now);
    const received = { ...signal, personId: person.id, at: now };
    runtime.state.signals = [...(runtime.state.signals ?? []), received].slice(-DISPLAY_LIMIT);
    this.schedule(session);
    runtime.emit();
  }

  private prune(now: number) {
    for (const [key, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(key);
    this.runtime.state.signals = (this.runtime.state.signals ?? []).filter(signal => signal.at + SIGNAL_TTL > now);
    const marks = this.runtime.state.chartMarks ?? [];
    if (marks.some(mark => !chartMarkAlive(mark, now))) this.runtime.state.chartMarks = marks.filter(mark => chartMarkAlive(mark, now));
  }

  private schedule(session: RuntimeDevice) {
    clearTimeout(this.timer);
    const next = Math.min(...this.seen.values(), ...(this.runtime.state.signals ?? []).map(signal => signal.at + SIGNAL_TTL), ...(this.runtime.state.chartMarks ?? []).map(mark => mark.at + CHART_LASER_MS));
    if (!Number.isFinite(next)) { this.timer = undefined; return; }
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.runtime.auth.session !== session || this.generation !== generation) return;
      this.prune(Date.now());
      this.schedule(session);
      this.runtime.emit();
    }, Math.max(1, next - Date.now()));
  }
}
