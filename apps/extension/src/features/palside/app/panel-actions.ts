import type { CommandName,CommandArgs,CommandPayload,CommandResult } from '../../../runtime/transport/command-map';
import { type Favorites,type InteractionPrefs,type WebFeature } from '../../../domain/annotations/interaction';
import { type Attachment,type Draft,type Message } from '../../../domain/chat/model';
import { type Screen } from './panel-model';
import { type Viewing } from '../../../domain/assets/model';
import type { TextMessage } from '@palside/i18n';

export type PanelActions = {
  saveInvitePassword: (password: string | null) => Promise<void>;
  updateDraft: (patch: Partial<Draft>, teamId?: string) => void;
  flushDraft: (teamId?: string) => Promise<number>;
  resolveDraftConflict: (keepLocal: boolean) => Promise<void>;
  run: <N extends CommandName>(...args: CommandArgs<N>) => Promise<CommandResult<N> | undefined>;
  guarded: <N extends CommandName>(name: N, payload: CommandPayload<N>, again: () => unknown) => Promise<CommandResult<N> | undefined>;
  setInteraction: (patch: Partial<InteractionPrefs>) => Promise<void>;
  setFavorites: (update: (old: Favorites) => Favorites) => Promise<void>;
  setWeb: (feature: WebFeature, on: boolean) => void;
  toggle: (feature: WebFeature, on: boolean) => Promise<void>;
  enableSites: (hosts: string[]) => Promise<boolean>;
  addedNotice: (hosts: string[]) => TextMessage;
  removeSite: (host: string | "all") => void;
  setTokenData: (host: string, on: boolean) => void;
  siteName: (host: string) => string;
  openSite: (host: string) => void;
  refreshLobby: () => Promise<void>;
  go: (to: Screen) => void;
  back: () => void;
  openNotification: () => void;
  openInvitation: () => void;
  chooseTeam: (id: string) => void;
  mention: (id: string) => void;
  selectAsset: (id: string, view?: Viewing) => void;
  attach: (attachment: Attachment, teamId?: string) => void;
  send: (prepare?: (message: Message) => void) => Promise<boolean>;
  retry: (message: Message) => void;
  edit: (message: Message) => void;
  saveEdit: () => void;
  recall: (message: Message) => void;
  createTeam: (name: string, description?: string, avatar?: string) => Promise<void>;
  setRecruitment: (active: boolean) => void;
  requestTeam: (id: string, text: string) => void;
  cancelApplication: (id: string) => void;
  joinTeam: (id: string) => void;
  leave: () => void;
  /** After this account leaves or dissolves a team: open the next joined team, else the 首页, and say what ended. */
  exitTeam: (teamId: string, notice: TextMessage) => void;
  /** Reopens a read-only team from 已离开的小队 and keeps it open. */
  openFormerTeam: (id: string) => void;
  /** 删除本机记录: hides a read-only team and its history on this device. */
  forgetTeam: (id: string) => void;
  approve: (id: string, accept: boolean) => void;
  startCreate: () => Promise<void>;
  previewInvite: (url: string) => Promise<CommandResult<'invite-preview'> | undefined>;
  copy: (value: string) => Promise<boolean>;
  createAccount: () => Promise<void>;
  restoreAccount: (words: string[]) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
};
