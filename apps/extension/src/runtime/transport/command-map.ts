import { denseArray, decodeContract, ContractDecodeError, Type, type Infer as Static, contractString, safeInteger, strictObject, plainRecord } from '@palside/shared/contracts/validation';
import { retentionDays } from '@palside/shared/contracts/team-model';
import { LOBBY_SEARCH_LENGTH } from '@palside/shared/contracts/limits';
import { teamDiscoverySort } from '@palside/shared/team-activity';
import { activity } from '@palside/shared/contracts/presence';
import { MessageError,message as uiMessage } from '@palside/i18n';
import { profileTags } from '@palside/shared/contracts/profiles';
import { roomKey,roomProfileInput,stance } from '@palside/shared/contracts/rooms';
import { chainOrderInput, chainAmount } from '@palside/shared/contracts/chain';
import type { WalletState, WalletRecords } from '../wallet/controller';
import type { WalletPayment } from '../../domain/wallet/model';
import { readFavorites,readHosts,readInteraction,readWebFeatures } from '../../domain/annotations/interaction.ts';
import { readMessageRefTarget } from '../../domain/annotations/social.ts';
import type { ApiResult } from './api';
import type { RuntimeState } from '../composition/runtime-state';
import type { Draft,Message,Attachment } from '../../domain/chat/model';
import type { Viewing } from '../../domain/assets/model';
import type { RevisionedDraft } from '../storage/storage';
import type { LanguageState } from './language';
import type { LocateReply } from '../browser/page-protocol';
import { documentCopy,type ImageSessionSnapshot } from '../media/image-sessions.ts';
import { signalKinds,signalEmotes,wheelEntries,normalizeSignalKey,readSignalElementTarget,type SignalSettings } from '../annotations/signals.ts';

const text = contractString(), bool = Type.Boolean(), integer = safeInteger({ minimum: 0 });
const optionalText = Type.Optional(text), optionalBool = Type.Optional(bool), optionalInt = Type.Optional(integer);
const roomQuery = strictObject({ key: roomKey });
const team = { teamId: text }, accountTeam = { accountId: text, ...team }, empty = strictObject({});
const object = plainRecord(Type.Unknown());
function validated<T>(read: (value: unknown) => T | undefined) {
  return Type.Decode(Type.Refine(Type.Unknown(), value => read(value) !== undefined, () => 'invalid command value'), value => read(value) as T);
}
const imageDocument = Type.Decode(Type.Unknown(), documentCopy);
const size = Type.Enum(['sm', 'md', 'lg']);
const number = Type.Number();
const signalSettings = strictObject({ size: Type.Optional(size), emoteSize: Type.Optional(size), wheelSize: Type.Optional(size), sound: optionalBool, volume: Type.Optional(number), key: Type.Optional(validated(normalizeSignalKey)), wheel: Type.Optional(denseArray(Type.Enum(wheelEntries))) });
const danmakuSettings = strictObject({ density: Type.Optional(Type.Enum(['low', 'mid', 'high'])), enabled: optionalBool, area: Type.Optional(Type.Enum(['top', 'chart', 'full'])), speed: Type.Optional(Type.Enum([110, 144, 190])), size: Type.Optional(size), opacity: Type.Optional(number) });
const refTarget = Type.Decode(Type.Unknown(), value => { const target = readMessageRefTarget(value); if (!target) throw new MessageError(uiMessage('extension.runtime.tokenIdentityUnknown')); return target; });
const attachment = Type.Decode(object, (input): Attachment => {
  const path: (string | number)[] = [];
  if (input.kind === 'image') { decodeContract(text, input.src, path); decodeContract(text, input.name, path); }
  else if (input.kind === 'asset') decodeContract(text, input.assetId, path);
  else throw new ContractDecodeError(path, 'invalid attachment');
  return input as Attachment;
});
const draft = strictObject({ automaticCard: Type.Optional(Type.Union([strictObject({ url: text, assetId: text }), Type.Null()])), dismissedUrls: Type.Optional(denseArray(text)), text: optionalText, attachment: Type.Optional(Type.Union([attachment, Type.Null()])), replyTo: Type.Optional(Type.Union([text, Type.Null()])), ref: Type.Optional(Type.Union([strictObject({ target: refTarget, caption: text, view: object }), Type.Null()])), replyRange: Type.Optional(Type.Union([strictObject({ start: integer, end: integer, base: integer }), Type.Null()])), mentions: Type.Optional(denseArray(strictObject({ id: text, label: text }))) });
const message = Type.Decode(object, (input): Message => {
  const path: (string | number)[] = [];
  for (const field of ['id', 'teamId', 'author', 'text']) decodeContract(text, input[field], [...path, field]);
  if (input.attachment !== undefined) decodeContract(attachment, input.attachment, [...path, 'attachment']);
  if (input.ref !== undefined) { const ref = decodeContract(object, input.ref); decodeContract(refTarget, ref.target); }
  return input as Message;
});
const preferences = strictObject({ accountId: text, current: optionalText, startedTeams: Type.Optional(denseArray(text)), hiddenStickies: Type.Optional(denseArray(text)), forgottenTeams: Type.Optional(denseArray(text)), notificationPreview: optionalBool, notifications: Type.Optional(Type.Enum(['off', 'mentions', 'all'])), web: Type.Optional(validated(readWebFeatures)), interaction: Type.Optional(validated(readInteraction)), favorites: Type.Optional(validated(readFavorites)), tokenOff: Type.Optional(validated(readHosts)), restoreSites: Type.Optional(validated(readHosts)), rooms: Type.Optional(strictObject({ off: optionalBool })) });
const windowTarget = { windowId: optionalInt, teamId: optionalText, accountId: optionalText };
const sticky = { ...team, accountId: optionalText, kind: Type.Literal('sticky'), asset: optionalText, text: text, site: optionalText, url: optionalText, target: Type.Optional(refTarget), edits: optionalText, baseRevision: optionalText, operationId: optionalText, caption: optionalText };

/** The same payload schemas guard panel, worker and offscreen messages. */
export const commandPayloads = {
  'wallet-team': strictObject({ teamId: text, cursor: optionalText }),
  'wallet-room': roomQuery, 'wallet-packet': strictObject({ id: text }),
  'wallet-person': strictObject({ accountId: text }),
  'wallet-claim': strictObject({ packetId: text }),
  'wallet-refresh': empty, 'wallet-unlock': strictObject({ password: text }),
  'wallet-records': strictObject({ direction: Type.Enum(['all', 'in', 'out']), more: optionalBool }),
  'wallet-recovery': strictObject({ more: optionalBool }),
  'wallet-recovery-check': strictObject({ orderId: text }), 'wallet-recovery-resume': strictObject({ orderId: text }),
  'wallet-review': strictObject({ input: chainOrderInput }), 'wallet-confirm': strictObject({ accountId: text, paymentId: text, password: optionalText }),
  'wallet-packet-review': strictObject({ kind: Type.Enum(['team', 'invitation', 'room']), scope: text, count: safeInteger({ minimum: 1, maximum: 100 }), distribution: Type.Enum(['equal', 'random']), total: chainAmount, blessing: optionalText }),
  'wallet-reconcile': empty, 'wallet-dismiss': strictObject({ accountId: text, paymentId: text }), 'wallet-opened-ack': empty,
  'wallet-preferences': strictObject({ smallPayments: optionalBool, hideAmounts: optionalBool, password: optionalText }),
  'wallet-receive': strictObject({ amount: Type.Optional(chainAmount) }),
  'wallet-export-private-key': strictObject({ password: text, owner: optionalText }),
  'wallet-hide-private-key': strictObject({ owner: optionalText }),
  'wallet-panel-drop': strictObject({ owner: text }),
  'image-session-open': strictObject({ mode: Type.Enum(['view', 'edit']), teamId: text, source: strictObject({ src: text, name: text }), document: Type.Optional(imageDocument) }),
  'image-session-read': strictObject({ id: text }), 'image-session-return': strictObject({ id: text }),
  'image-session-update': strictObject({ id: text, expectedRevision: integer, document: imageDocument }),
  'image-session-save': strictObject({ id: text, expectedRevision: integer, src: text }), 'image-session-cancel': strictObject({ id: text, expectedRevision: integer }),
  snapshot: empty, 'account-generate': empty, 'account-discard': empty, 'account-create': empty,
  'account-login': strictObject({ words: denseArray(text) }), 'password-set': strictObject({ password: text }),
  'mnemonic-reveal': strictObject({ password: text }), 'device-remove': strictObject({ id: text, password: text }),
  'delete-account': strictObject({ password: text }), 'identity-approve': strictObject(team), devices: empty, logout: empty, reconnect: empty,
  profile: strictObject({ name: optionalText, bio: optionalText, tags: Type.Optional(profileTags) }),
  create: strictObject({ name: text, description: text }), team: strictObject({ ...team, name: text, description: text }),
  join: strictObject({ invite: text, password: optionalText }), 'invite-preview': strictObject({ url: text }),
  invitation: strictObject({ ...team, action: Type.Optional(Type.Enum(['regenerate', 'revoke'])), password: Type.Optional(Type.Union([text, Type.Null()])) }),
  retention: strictObject({ ...team, retentionDays }), dissolve: strictObject(team), leave: strictObject(team),
  remove: strictObject({ ...team, accountId: text }), unban: strictObject({ ...team, accountId: text }),
  recruitment: strictObject({ ...team, active: bool }), apply: strictObject({ ...team, note: optionalText }), 'cancel-application': strictObject(team),
  decide: strictObject({ ...team, accountId: text, accept: bool }),
  transfer: strictObject({ ...team, action: Type.Enum(['request', 'accept', 'reject', 'cancel']), accountId: optionalText }),
  'team-preferences': strictObject({ ...team, muted: optionalBool, readIds: Type.Optional(denseArray(text)) }), lobby: strictObject({ q: Type.Optional(contractString({ max: LOBBY_SEARCH_LENGTH, pattern: /^[^\x00-\x1f\x7f]*$/ })), sort: Type.Optional(teamDiscoverySort) }),
  'invite-list': empty, 'invite-options': strictObject({ accountId: text }), 'invite-send': strictObject(accountTeam),
  'invite-accept': strictObject({ id: text }), 'invite-ignore': strictObject({ id: text }), 'invite-settings': strictObject({ accept: bool }),
  'team-invite-permission': strictObject({ ...team, on: bool }),
  'room-watch': strictObject({ id: text, view: Type.Optional(roomKey) }),
  'room-open': strictObject({ key: roomKey, profile: Type.Optional(roomProfileInput) }), 'room-close': empty,
  'room-tab': strictObject({ asset: Type.Union([text, Type.Null()]), profile: Type.Optional(roomProfileInput) }), 'room-panels': strictObject({ connected: bool }),
  'room-send': strictObject({ text }), 'room-more': empty, 'room-find': strictObject({ key: roomKey, id: text }), 'room-retract': strictObject({ id: text }), 'room-report': strictObject({ id: text }),
  'room-stance': strictObject({ key: roomKey, value: Type.Union([stance, Type.Null()]) }), 'room-summary': roomQuery,
  'room-people': roomQuery, 'room-hot': strictObject({ sourceId: optionalText, chain: Type.Optional(Type.Union([text, Type.Null()])) }), 'room-blocks': empty,
  'room-block': strictObject({ accountId: text, blocked: bool }), 'room-settings': strictObject({ off: bool }),
  preferences, toggle: strictObject({ share: optionalBool, interact: optionalBool, revoked: optionalBool }),
  'device-state': activity,
  'host-notice': strictObject({ message: strictObject({ key: text, values: Type.Optional(plainRecord(Type.Union([text, safeInteger()]))) }) }),
  'dismiss-notice': empty, 'dismiss-jump': strictObject({ messageId: optionalText, windowId: optionalInt }),
  'dismiss-invite': strictObject({ url: text }), 'dismiss-open-team': empty, 'dismiss-poke': strictObject({ id: text }),
  'external-team': strictObject({ id: text }), 'external-invite': strictObject({ code: text }),
  'external-share': strictObject({ text, teamId: optionalText, accountId: optionalText }),
  page: strictObject({ failed: optionalBool, clear: optionalBool, preparing: optionalBool, activity: optionalBool, identity: Type.Optional(object), host: optionalText, metadata: optionalBool, context: Type.Optional(object), preview: optionalBool, stable: optionalBool, title: optionalText, favicon: optionalText }),
  history: strictObject(team), visible: strictObject({ teamId: optionalText, sourceId: text, ids: denseArray(text) }), 'visible-drop': strictObject({ panel: text }),
  'notification-open': strictObject({ accountId: text, teamId: optionalText, messageId: text, windowId: integer, preview: optionalBool }),
  'image-draft-save': strictObject({ ...accountTeam, source: text, draftRevision: integer, src: text }),
  attach: strictObject({ ...accountTeam, attachment, replace: optionalBool, revision: optionalInt }),
  'attach-ref': strictObject({ ...team, accountId: optionalText, clear: optionalBool, target: Type.Optional(refTarget), caption: optionalText, url: optionalText }),
  draft: strictObject({ ...accountTeam, patch: draft, revision: integer }), 'clear-share': empty,
  'team-event': strictObject(sticky), 'team-event-remove': strictObject({ ...team, accountId: optionalText, kind: Type.Literal('sticky'), id: text, baseRevision: optionalText }),
  poke: strictObject({ ...team, accountId: text }), 'prepare-retry': strictObject({ accountId: text, id: text }),
  send: strictObject({ message, revision: safeInteger({ minimum: -1 }) }), react: strictObject({ ...team, emoji: text, count: integer }),
  'cancel-send': strictObject({ id: text }), edit: strictObject({ ...team, id: text, text, baseEditedAt: optionalInt }), recall: strictObject({ ...team, id: text }),
  avatar: strictObject({ accountId: text, teamId: optionalText, data: text }), 'remove-avatar': strictObject({ accountId: text, teamId: optionalText, id: text }), 'reload-image': strictObject({ id: text }),
  report: strictObject({ accountId: text, kind: text, targetId: text, reason: text, note: text, snapshot: text, image: optionalText, key: text }),
  'cache-usage': empty, 'clear-cache': empty, diagnostics: strictObject({ locale: optionalText }),
  language: strictObject({ preference: Type.Enum(['auto', 'en', 'zh-CN']) }),
  'permissions-get': strictObject({ url: optionalText }), 'permissions-sync': empty,
  'permissions-remove': Type.Decode(Type.Union([strictObject({ kind: Type.Literal('site'), url: text }), strictObject({ kind: Type.Enum(['sites', 'broad-sites', 'tabs', 'notifications']) })]), value => value),
  'selection-enabled': strictObject({ ...windowTarget, on: bool }), capture: strictObject(windowTarget), 'link-card': strictObject({ ...windowTarget, url: optionalText }),
  'quote-sticky': strictObject({ ...team, accountId: optionalText, stickyId: text }), 'locate-sticky': strictObject({ ...windowTarget, stickyId: text }), 'locate-ref': strictObject({ ...windowTarget, messageId: text }),
  'signal-settings-get': empty, 'signal-settings': strictObject({ settings: signalSettings, expectedAccountId: text }), 'danmaku-settings': strictObject({ settings: danmakuSettings }),
  'signal-send': strictObject({ ...team, id: optionalText, url: text, sentAt: optionalInt, kind: Type.Enum(signalKinds), target: Type.Union([strictObject({ kind: Type.Literal('page') }), strictObject({ kind: Type.Literal('quote'), exact: text, prefix: text, suffix: text }), validated(readSignalElementTarget)]), emote: Type.Optional(Type.Enum(signalEmotes)), hostToken: text }),
} as const;
export type CommandName = keyof typeof commandPayloads;
export type CommandPayload<N extends CommandName> = Static<typeof commandPayloads[N]>;
type Results = {
  'wallet-team': ApiResult<'chain.teamFeed'>;
  'wallet-room': ApiResult<'chain.room'>; 'wallet-packet': ApiResult<'chain.packet'>;
  'wallet-person': ApiResult<'chain.person'>; 'wallet-claim': ApiResult<'chain.claim'>;
  'wallet-refresh': WalletState; 'wallet-unlock': WalletState; 'wallet-records': WalletRecords;
  'wallet-recovery': ApiResult<'chain.recovery'>; 'wallet-recovery-check': ApiResult<'chain.recovery'>['items'][number]; 'wallet-recovery-resume': WalletPayment;
  'wallet-review': WalletPayment; 'wallet-packet-review': WalletPayment; 'wallet-confirm': WalletPayment;
  'wallet-reconcile': WalletPayment | undefined; 'wallet-receive': { uri: string };
  'wallet-export-private-key': { id: string; privateKey: string; expiresAt: number };
  'image-session-open': ImageSessionSnapshot & { windowOpen: boolean }; 'image-session-read': ImageSessionSnapshot & { windowOpen: boolean };
  'image-session-return': ImageSessionSnapshot & { windowOpen: boolean }; 'image-session-update': ImageSessionSnapshot & { windowOpen: boolean };
  'image-session-cancel': ImageSessionSnapshot & { windowOpen: boolean }; 'image-session-save': ImageSessionSnapshot & { windowOpen: boolean };
  send: { eventId: string }; 'signal-send': { queued: number }; 'quote-sticky': RevisionedDraft<Draft>;
  'password-set': { nicknameRequired: boolean };
  'room-panels': { connected: boolean }; 'room-settings': { off?: boolean }; 'invite-settings': { accept: boolean };
  'team-invite-permission': ApiResult<'teams.invitePermission'>;
  'team-event': { id: string; revision?: string; existing?: boolean }; 'team-event-remove': { id: string };
  react: ApiResult<'viewing.react'>; poke: ApiResult<'viewing.react'>;
  team: { done: true }; retention: { done: true }; dissolve: { done: true }; leave: { done: true }; remove: { done: true }; unban: { done: true }; recruitment: { done: true }; apply: { done: true }; 'cancel-application': { done: true }; decide: { done: true }; transfer: { done: true }; 'team-preferences': { done: true };
  edit: { done: true }; avatar: { done: true }; 'remove-avatar': { done: true }; recall: { done: true };
  lobby: ApiResult<'teams.lobby'> | undefined;
  snapshot: RuntimeState; 'account-generate': { words: string[] }; 'mnemonic-reveal': { words: string[] }; devices: ApiResult<'devices.list'>;
  create: ApiResult<'teams.create'>; join: ApiResult<'invites.join'>; invitation: RuntimeState['invitations'][string] | undefined;
  'invite-preview': ApiResult<'invites.preview'> & { invite: string }; 'invite-options': ApiResult<'invites.options'>; 'invite-send': ApiResult<'invites.send'>;
  'invite-accept': ApiResult<'invites.accept'>; 'invite-ignore': ApiResult<'invites.ignore'>; 'invite-list': ApiResult<'invites.list'>;
  'room-summary': ApiResult<'rooms.summary'>; 'room-people': ApiResult<'rooms.people'>; 'room-hot': void; 'room-blocks': ApiResult<'rooms.blocks'>;
  'room-stance': ApiResult<'rooms.stance'>; 'room-block': ApiResult<'rooms.block'>; 'room-report': ApiResult<'rooms.report'>; 'room-retract': ApiResult<'rooms.retract'>;
  'room-send': ApiResult<'rooms.send'>; 'room-more': ApiResult<'rooms.messages'>; 'room-find': { found: boolean };
  'cache-usage': { bytes: number }; 'clear-cache': { bytes: number }; diagnostics: { text: string };
  'prepare-retry': { message: Message }; attach: { requiresReplace?: boolean; revision?: number; attached?: true };
  draft: RevisionedDraft<Draft>; 'attach-ref': RevisionedDraft<Draft>; 'image-draft-save': { attached: true; draftRevision: number };
  report: { submitted?: true; pending?: true; recovered?: boolean }; logout: { remote: boolean };
  'link-card': { attachment?: Extract<Attachment, { kind: 'asset' }>; view?: Viewing }; capture: { started: true };
  'locate-sticky': LocateReply; 'locate-ref': LocateReply; 'signal-settings': SignalSettings; 'signal-settings-get': SignalSettings;
  language: LanguageState; toggle: RuntimeState['toggles'];
  'permissions-get': { origins: string[]; tabs: boolean; notifications: boolean; site: boolean };
  'permissions-remove': { removed: boolean; origins: string[] };
};
export type CommandResult<N extends CommandName> = N extends keyof Results ? Results[N] : void;
export type Command = { [N in CommandName]: { name: N } & (Record<string, never> extends CommandPayload<N> ? { payload?: CommandPayload<N> } : { payload: CommandPayload<N> }) }[CommandName];
export type CommandArgs<N extends CommandName> = Record<string, never> extends CommandPayload<N> ? [name: N, payload?: CommandPayload<N>] : [name: N, payload: CommandPayload<N>];
export type CommandFunction = <N extends CommandName>(...args: CommandArgs<N>) => Promise<CommandResult<N>>;
export function parseCommand(input: unknown): Command {
  const envelope = decodeContract(strictObject({ name: text, payload: Type.Optional(object) }), input);
  if (!Object.hasOwn(commandPayloads, envelope.name)) throw new MessageError(uiMessage('extension.runtime.operationUnavailable'));
  const name = envelope.name as CommandName;
  return { name, payload: decodeContract(commandPayloads[name], envelope.payload ?? {}) } as Command;
}
