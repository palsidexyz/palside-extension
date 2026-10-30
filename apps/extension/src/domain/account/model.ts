import type { Person as PersonIdentity } from '@palside/shared/models/account';
import type { ProfileTag } from '@palside/shared/contracts/profiles';
import type { DeviceState } from '@palside/shared/contracts/presence';

export type Person = PersonIdentity & { bio?: string; tags?: ProfileTag[]; presence?: DeviceState; walletAddress?: string; walletVerified?: boolean };
export function personFor(people: Person[], id: string, fallback: string): Person { return people.find(person => person.id === id) ?? { id, name: fallback, color: '#e9edf0' }; }
