import type { Person as PersonIdentity } from '@palside/shared/models/account';
import type { ProfileTag } from '@palside/shared/contracts/profiles';
import type { DeviceState } from '@palside/shared/contracts/presence';

export type Person = PersonIdentity & { bio?: string; tags?: ProfileTag[]; presence?: DeviceState; walletAddress?: string; walletVerified?: boolean };
/** `null` identifies a deleted account: retained chain records have no account association. */
export function personFor(people: Person[], id: string | null, fallback: string, deleted = fallback): Person {
  if (id === null) return { id: '', name: deleted, color: '#e9edf0', deleted: true };
  return people.find(person => person.id === id) ?? { id, name: fallback, color: '#e9edf0' };
}
