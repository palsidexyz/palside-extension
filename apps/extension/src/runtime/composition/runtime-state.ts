import type { Account } from '@palside/shared/contracts/profiles';
import type { ApiResult } from '../transport/api';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';
import type { TextValue } from '@palside/i18n';
import type { Connection } from '../transport/connection';
import type { Dataset } from './dataset';
import type { Draft } from '../../domain/chat/model';
import type { Team } from '../../domain/teams/model';
import type { Reaction } from '../../domain/annotations/reactions';
import type { ReceivedSignal,SignalRecord } from '../annotations/signals';
import type { ReceivedChartMark } from '../annotations/chart-marks';
import type { ChartDrawing } from '../annotations/chart-drawings';
import type { RevisionedDraft } from '../storage/storage';
import type { Poke } from '../../domain/annotations/social';
import type { Preferences } from '../../domain/account/preferences.ts';
import type { RoomState } from '../rooms/state.ts';
import type { Invitation } from '../teams/invitation.ts';
import type { WalletState } from '../wallet/controller';
import type { TokenProfile } from '../viewing/token-profiles.ts';
import type { Follower,LeadScroll,LeadTabs } from '../../domain/annotations/follow.ts';
export type RuntimeState = {
  wallet?: WalletState;
  chainRoom?: ApiResult<'chain.room'> & { key: string };
  chainTeam?: ApiResult<'chain.teamFeed'> & { teamId: string };
  chainRevision?: number;
  banned?: { expiresAt: number | null };
  teamLevelEvents?: { id: string; teamId: string; from: number; to: number; timestamp: number }[];
  rooms: RoomState;
  /** Recently used token names and icons by asset (`chain:address`), from this memory-only cache. */
  tokens?: Record<string, TokenProfile>;
  /** Pool and chainless-contract pages by URL: the token the server found, or `null` when there is none. */
  pages?: Record<string, string | null>;
  /** Pages whose address is a token on several chains: URL → candidate assets, the current one first. */
  pageChoices?: Record<string, string[]>;
  /** The last 弹幕 this account opened, newest first (room keys); memory only, gone on sign-out. */
  recentRooms?: string[];
  /** Assets of the latest token search, so their names and icons travel with panel state. */
  searchAssets?: string[];
  /** The chains a pasted address is a token on, for the composer card's 切换链. */
  cardAssets?: string[];
  /** The active page's token while its name is still being read; its name shows as a placeholder. */
  tokenPending?: string;
  /** Shown assets the directory answered are not tokens, or could not read: the only ones named 未识别代币. */
  tokenUnknown?: string[];
  /** Messages waiting for their pacing slot, per team: how many and when the next one goes out. */
  sendQueue?: Record<string, { count: number; nextAt: number; items: { id: string; at: number }[] }>;
  publishedViewing?: { viewId: string; teamId: string; expiresAt: number };
  /** Reactions received from teammates in the last few seconds, newest last. */
  reactions?: Reaction[];
  signals?: ReceivedSignal[];
  /** Signals the squad's chat keeps, as records of its room (newest kept per squad). */
  signalRecords?: SignalRecord[];
  /** 看盘批注 of the last ten minutes, this account's own included, oldest first. */
  chartMarks?: ReceivedChartMark[];
  /** 共享画线's drawings for the squads this account is in, deletions included. */
  chartDrawings?: ChartDrawing[];
  /** 跟看: teammates following this account (heartbeat), and where the followed teammates scrolled and what tabs they have. Memory only. */
  followers?: Follower[];
  leadScrolls?: LeadScroll[];
  leadTabs?: LeadTabs[];
  /** Teammates who asked you to look at their page during the last minute. */
  pokes?: Poke[];
  history?: Record<string, { missingKeys: number; loaded: boolean; loading: boolean }>; /** Signup proof of work has run past a minute. */ signupWaiting?: boolean; /** Which part of password-set is running, so the panel can name it. */ signupPhase?: SignupPhase; notice?: TextValue; pendingShareTeamId?: string; jumpMessageId?: string; jumpWindowId?: number; pendingShare?: string; revision: number; ready: boolean; authenticated: boolean; account?: Account; connection: Connection; error?: TextValue; data: Dataset;
  drafts: Record<string, RevisionedDraft<Draft>>; preferences: Preferences; viewingId?: string; remoteTeams: TeamSnapshot[]; lobbyTeams?: Team[];
  config: ApiResult<'system.config'>; setup?: 'password'; invitations: Record<string, Invitation>;
};
/** Ordered parts of password-set: seal the phrase, register or add the device, open encrypted chat, start the wallet. */
export type SignupPhase = 'seal' | 'register' | 'connect' | 'wallet';
