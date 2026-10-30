import type { Infer } from '@palside/shared/contracts/validation';
import { inviteState } from '@palside/shared/contracts/invites';
/** The owner's view of a team's invite: the link, its join password, and whether wrong guesses switched it off. */
export type Invitation = Infer<typeof inviteState>;
