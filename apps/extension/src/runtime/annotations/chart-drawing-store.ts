import { MINUTE_MS } from '@palside/shared/units';
import { message as uiMessage,MessageError } from '@palside/i18n';
import type { MatrixEvent } from 'matrix-js-sdk';
import { requireEncryptedSend,teamSendGuard } from '../account/crypto-identity';
import type { RuntimeDevice } from '../account/device';
import type { PalsideService } from '../composition/core';
import { liveMembers } from '../../domain/teams/model.ts';
import { CHART_DRAWING_EVENT,CHART_DRAWINGS_PER_MINUTE,addChartDrawing,readChartDrawing,type ChartDrawing } from './chart-drawings.ts';

const CACHE_KEY = 'chart-drawing:';

/** 共享画线's records: room events like messages, in their own list so unread, search and notifications stay about messages. */
export class ChartDrawingStore {
  readonly runtime: PalsideService;
  private sendTimes: number[] = [];
  constructor(runtime: PalsideService) { this.runtime = runtime; }

  reset() { this.sendTimes = []; this.runtime.state.chartDrawings = []; }

  /** One drawing, its edit or its deletion, as an encrypted room event. It joins the list when the room gives it back, so what shows has been accepted. */
  async send(teamId: string, payload: Record<string, unknown>, hostCurrent: () => Promise<boolean>) {
    const runtime = this.runtime, scope = runtime.auth.scope(), client = runtime.auth.client, now = Date.now();
    const team = runtime.state.remoteTeams.find(item => item.id === teamId && item.joined);
    const { url, id, shape, points, props, axis, asset } = payload;
    const drawing = readChartDrawing({ url, id, shape, points, props, axis, asset, teamId, sentAt: now });
    if (!drawing) throw new MessageError(uiMessage('common.error'));
    if (!client || !team?.roomId || runtime.state.preferences.current !== teamId || runtime.state.data.teams.find(item => item.id === teamId)?.readonly) throw new MessageError(uiMessage('extension.runtime.teamUnavailable'));
    this.sendTimes = this.sendTimes.filter(at => now - at < MINUTE_MS);
    if (this.sendTimes.length >= CHART_DRAWINGS_PER_MINUTE) throw new MessageError(uiMessage('extension.runtime.signalRateLimited'));
    this.sendTimes.push(now);
    const { check } = teamSendGuard(runtime, teamId);
    await scope.wait(requireEncryptedSend(client, team.roomId, liveMembers(team), check));
    check();
    if (!await scope.wait(hostCurrent())) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
    check();
    const transaction = crypto.randomUUID();
    try { return { eventId: (await scope.wait(client.sendEvent(team.roomId, CHART_DRAWING_EVENT as never, drawing as never, transaction))).event_id }; }
    catch (error) {
      // A failed send would otherwise wait in the room's pending list for a retry nothing asks for.
      const pending = client.getRoom(team.roomId)?.getEventForTxnId(transaction);
      if (pending) client.cancelPendingEvent(pending);
      throw error;
    }
  }

  /** An event from the squad's room (`timeline`), its sender already found there. Reading it again changes nothing. */
  async keep(event: MatrixEvent, teamId: string, personId: string, expiresAt: number, session: RuntimeDevice) {
    const runtime = this.runtime, eventId = event.getId(), timestamp = event.getTs();
    if (runtime.auth.session !== session || !eventId) return;
    const drawing = readChartDrawing(event.getContent());
    if (!drawing || drawing.teamId !== teamId) return;
    const list = runtime.state.chartDrawings ?? [], record: ChartDrawing = { ...drawing, eventId, personId, timestamp, expiresAt };
    const next = addChartDrawing(list, record);
    // The record that stands for this drawing now: this event, or the newer one with an earlier time of making.
    const kept = next.find(item => item.teamId === record.teamId && item.personId === personId && item.id === record.id);
    if (!kept || list.includes(kept)) return;
    runtime.state.chartDrawings = next;
    runtime.emit();
    const key = this.key(kept);
    const evicted = await runtime.auth.scope().wait(runtime.storage.cache(session.account.id, key, { chartDrawing: kept, timestamp: kept.timestamp }, kept.expiresAt));
    if (runtime.auth.session === session) runtime.cache.evictCachedContent(evicted);
  }

  /** Records read back from this device's cache at start. */
  restore(records: ChartDrawing[]) {
    let list = this.runtime.state.chartDrawings ?? [];
    for (const record of records) list = addChartDrawing(list, record);
    this.runtime.state.chartDrawings = list;
  }

  /** Records past their squad's retention or outside this account's time in the squad leave this device, as messages do. */
  async prune(allowed: (record: ChartDrawing) => boolean) {
    const runtime = this.runtime, session = runtime.auth.session, records = runtime.state.chartDrawings ?? [];
    const gone = records.filter(record => !allowed(record));
    if (!gone.length || !session) return false;
    runtime.state.chartDrawings = records.filter(record => allowed(record));
    await runtime.auth.scope().wait(Promise.all(gone.map(record => runtime.storage.remove(`${session.account.id}:cache:${this.key(record)}`))));
    return true;
  }

  /** The storage budget dropped this cached record. */
  evicted(id: string) {
    if (!id.startsWith(CACHE_KEY)) return false;
    this.runtime.state.chartDrawings = (this.runtime.state.chartDrawings ?? []).filter(record => this.key(record) !== id);
    return true;
  }

  private key(record: ChartDrawing) { return `${CACHE_KEY}${record.teamId}:${record.personId}:${record.id}`; }
}
