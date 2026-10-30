import { decryptedEvent } from './private-event';
import { PalsideService } from '../src/runtime/composition/core';
import { ClientStorage } from '../src/runtime/storage/storage';
import type { RuntimeDevice } from '../src/runtime/account/device';
import { remoteTeam } from './fixtures';
import type { Message } from '../src/domain/chat/model';

/** Actual receive/cache methods; isolated IndexedDB and synthetic Matrix events. */
export async function verifyChatArrival(check: (value: unknown, label: string) => void) {
  const databaseName = `palside-chat-arrival-${crypto.randomUUID()}`;
  const storage = new ClientStorage(databaseName);
  const service = new PalsideService(undefined, undefined, storage);
  const session = { account: { id: 'self' }, token: 'synthetic-only' } as RuntimeDevice;
  const team = remoteTeam({ id: 'team', roomId: '!reading:example.test', memberIds: ['self', 'friend'], periods: [{ joinedAt: Date.now() - 86400000, leftAt: null }], people: [{ bio: '', tags: [], deleted: false, id: 'friend', nickname: 'friend', avatarId: null, matrixId: '@friend:example.test' }] });
  service.auth.session = session;
  service.state.remoteTeams = [team]; service.state.account = session.account; service.state.data.self = 'self';
  const event = (id: string, content: Record<string, unknown> = { msgtype: 'm.text', body: id }) => decryptedEvent({ event_id: id, room_id: team.roomId, type: 'm.room.message', sender: '@friend:example.test', origin_server_ts: Date.now(), content });
  try {
    await service.timeline.consume(await event('$historical'), false);
    await service.timeline.consume(await event('$historical'), true);
    const historical = service.state.data.messages.find(m => m.id === '$historical');
    check(historical && !historical.liveArrival, '运行时：已存在历史消息重放不重新成为实时到达');
    await service.timeline.consume(await event('$live'), true);
    await service.timeline.consume(await event('$live'), false);
    check(service.state.data.messages.filter(m => m.id === '$live').length === 1 && service.state.data.messages.find(m => m.id === '$live')?.liveArrival, '运行时：实时消息去重，后续解密或重新读取保留原来源');
    await service.timeline.consume(await event('$edit', { msgtype: 'm.text', body: '* edited', 'm.relates_to': { rel_type: 'm.replace', event_id: '$live' }, 'm.new_content': { msgtype: 'm.text', body: 'edited' } }), true);
    check(service.state.data.messages.length === 2 && service.state.data.messages.find(m => m.id === '$live')?.text === 'edited', '运行时：编辑更新原消息，不生成第三条到达');
    const cached = await storage.get<{ message: Message }>('self:cache:$live');
    check(cached?.message && !('liveArrival' in cached.message), '运行时：实时到达来源不写入消息缓存，重启不复用旧标记');
  } finally {
    await storage.clearAccount('self', false);
    const db = await (storage as unknown as { database: Promise<IDBDatabase> }).database;
    db.close(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
}
