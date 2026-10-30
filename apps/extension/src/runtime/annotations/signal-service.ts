import { message as uiMessage,MessageError } from '@palside/i18n';
import type { MatrixEvent } from 'matrix-js-sdk';
import { SIGNAL_EVENT,SIGNAL_TTL,readSignal } from './signals';
import { sharingWork } from '../viewing/sharing-work';
import { trustedDeviceMessages } from '../viewing/viewing-targets';
import type { RuntimeDevice } from '../account/device';
import type { PalsideService } from '../composition/core';

const SEEN_LIMIT = 512;
const DISPLAY_LIMIT = 128;

/** Short-lived Olm signals. A relay receipt counts queued devices, never viewers. */
export class SignalService {
  readonly runtime: PalsideService;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly seen = new Map<string, number>();
  private sendTimes: number[] = [];
  private generation = 0;
  constructor(runtime: PalsideService) { this.runtime = runtime; }

  reset() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.seen.clear();
    this.sendTimes = [];
    this.runtime.state.signals = [];
  }

  async send(teamId: string, payload: Record<string, unknown>, hostCurrent: () => Promise<boolean> = async () => false) {
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
    const sentAt = Date.now();
    const signal = readSignal({ ...payload, id: crypto.randomUUID(), teamId, sentAt }, sentAt);
    if (!signal) throw new MessageError(uiMessage('common.error'));
    const cryptoApi = client!.getCrypto();
    if (!cryptoApi) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    this.sendTimes = this.sendTimes.filter(at => sentAt - at < 2_000);
    if (this.sendTimes.length >= 3) throw new MessageError(uiMessage('extension.runtime.signalRateLimited'));
    this.sendTimes.push(sentAt);
    const recipients = (value: typeof team) => value.people.filter(person => !person.deleted && value.memberIds.includes(person.id) && person.id !== session!.account.id && person.matrixId !== session!.matrix.userId).map(person => person.matrixId).sort();
    const others = recipients(team), membership = JSON.stringify(others);
    const check = () => {
      const latest = currentTeam();
      if (latest.roomId !== team.roomId || JSON.stringify(recipients(latest)) !== membership) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
      if (Date.now() >= signal.sentAt + SIGNAL_TTL) throw new MessageError(uiMessage('extension.runtime.reactionNotReady'));
    };
    const checkHost = async () => {
      const allowed = await scope.wait(sharingWork(hostCurrent(), Math.max(1, signal.sentAt + SIGNAL_TTL - Date.now())));
      check();
      if (!allowed) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
    };
    await checkHost();
    if (!others.length) return { queued: 0 };
    const prepare = async <T>(work: Promise<T>) => {
      try { const value = await scope.wait(sharingWork(work, Math.max(1, signal.sentAt + SIGNAL_TTL - Date.now()))); await checkHost(); return value; }
      catch { check(); throw new MessageError(uiMessage('extension.runtime.reactionNotReady')); }
    };
    const messages = await prepare(trustedDeviceMessages(cryptoApi, others, session!.matrix, SIGNAL_EVENT, signal, check));
    await checkHost();
    if (!Object.keys(messages).length) return { queued: 0 };
    const receipt = await scope.wait(runtime.api.request('viewing.react', { body: { teamId, messages } }));
    check();
    return { queued: receipt.delivered };
  }

  consume(event: MatrixEvent, session: RuntimeDevice) {
    const runtime = this.runtime, now = Date.now();
    if (runtime.auth.session !== session || !event.isEncrypted() || event.getType() !== SIGNAL_EVENT) return;
    const signal = readSignal(event.getContent(), now);
    if (!signal || signal.sentAt + SIGNAL_TTL <= now) return;
    const team = runtime.state.remoteTeams.find(item => item.id === signal.teamId && item.joined && item.memberIds.includes(session.account.id));
    const person = team?.people.find(item => !item.deleted && item.matrixId === event.getSender() && team.memberIds.includes(item.id) && item.id !== session.account.id && item.matrixId !== session.matrix.userId);
    if (!person) return;
    this.prune(now);
    const key = `${signal.teamId}\0${person.id}\0${signal.id}`;
    // Fail closed at capacity so an evicted id cannot immediately be replayed.
    if (this.seen.has(key) || this.seen.size >= SEEN_LIMIT) return;
    this.seen.set(key, signal.sentAt + SIGNAL_TTL);
    runtime.state.signals = [...(runtime.state.signals ?? []), { ...signal, personId: person.id, at: now }].slice(-DISPLAY_LIMIT);
    this.schedule(session);
    runtime.emit();
  }

  private prune(now: number) {
    for (const [key, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(key);
    this.runtime.state.signals = (this.runtime.state.signals ?? []).filter(signal => signal.sentAt + SIGNAL_TTL > now);
  }

  private schedule(session: RuntimeDevice) {
    clearTimeout(this.timer);
    const next = Math.min(...this.seen.values());
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
