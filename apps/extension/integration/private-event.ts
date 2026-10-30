import { MatrixEvent, type IEvent } from 'matrix-js-sdk';

/** A team-room event as it arrives after SDK decryption; the receiver ignores private events that were never encrypted. */
export async function decryptedEvent(event: Partial<IEvent>) {
  const clear = { type: event.type, content: event.content, room_id: event.room_id, sender: event.sender };
  const wire = new MatrixEvent({ ...event, type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
  await wire.attemptDecryption({ decryptEvent: async () => ({ clearEvent: clear }) } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);
  return wire;
}
