import type { CommandName,CommandArgs,CommandPayload,CommandResult } from '../../../runtime/transport/command-map';
import { type Favorites,type SiteInteraction } from '../../../domain/annotations/interaction';
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
  /** 网页互动 for one site: on or off there, and its 弹幕 and 信号. Chrome is asked by the caller, in the click. */
  setSite: (host: string, patch: Partial<SiteInteraction>) => Promise<void>;
  setFavorites: (update: (old: Favorites) => Favorites) => Promise<void>;
  /** 共享在看's key, kept until pressed again. */
  toggle: (feature: 'share', on: boolean) => Promise<void>;
  removeSite: (host: string | "all") => void;
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
  /** Resolves true once saved. */
  setRecruitment: (active: boolean) => Promise<boolean>;
  requestTeam: (id: string, text: string) => void;
  cancelApplication: (id: string) => void;
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
  importAccount: (words: string[]) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  /** 取消 while signup is still preparing: back to the PIN step with the same phrase. */
  cancelSignup: () => void;
};
