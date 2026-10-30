import type { Account } from '@palside/shared/contracts/profiles';
import type { ApiResult } from '../transport/api';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';
import type { TextValue } from '@palside/i18n';
import type { Connection } from '../transport/connection';
import type { Dataset } from './dataset';
import type { Draft } from '../../domain/chat/model';
import type { Team } from '../../domain/teams/model';
import type { Reaction } from '../../domain/annotations/reactions';
import type { ReceivedSignal } from '../annotations/signals';
import type { RevisionedDraft } from '../storage/storage';
import type { Poke,TeamItems } from '../../domain/annotations/social';
import type { Preferences,Toggles } from '../../domain/account/preferences.ts';
import type { RoomState } from '../rooms/state.ts';
import type { Invitation } from '../teams/invitation.ts';
import type { WalletState } from '../wallet/controller';
export type RuntimeState = {
  wallet?: WalletState;
  chainRoom?: ApiResult<'chain.room'> & { key: string };
  chainTeam?: ApiResult<'chain.teamFeed'> & { teamId: string };
  chainRevision?: number;
  banned?: { expiresAt: number | null };
  teamLevelEvents?: { id: string; teamId: string; from: number; to: number; timestamp: number }[];
  rooms: RoomState;
  toggles: Toggles;
  /** Messages waiting for their pacing slot, per team: how many and when the next one goes out. */
  sendQueue?: Record<string, { count: number; nextAt: number; items: { id: string; at: number }[] }>;
  publishedViewing?: { viewId: string; teamId: string; expiresAt: number };
  /** Reactions received from teammates in the last few seconds, newest last. */
  reactions?: Reaction[];
  signals?: ReceivedSignal[];
  /** Stickies of joined teams: encrypted events, never chat messages. */
  items: Pick<TeamItems, 'stickies'>;
  /** Teammates who asked you to look at their page during the last minute. */
  pokes?: Poke[];
  history?: Record<string, { missingKeys: number; loaded: boolean; loading: boolean }>; notice?: TextValue; pendingShareTeamId?: string; jumpMessageId?: string; jumpWindowId?: number; pendingShare?: string; revision: number; ready: boolean; authenticated: boolean; account?: Account; connection: Connection; error?: TextValue; data: Dataset;
  drafts: Record<string, RevisionedDraft<Draft>>; preferences: Preferences; viewingId?: string; remoteTeams: TeamSnapshot[]; lobbyTeams?: Team[];
  config: ApiResult<'system.config'>; setup?: 'password'; invitations: Record<string, Invitation>;
};
