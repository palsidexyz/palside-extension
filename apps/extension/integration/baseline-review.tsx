import React, { useLayoutEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTranslator } from 'use-intl';
import { messagesFor } from '@palside/i18n';
import { IntegrationIntl } from './intl';
import { palsideFixtures, demoSites, remoteTeam } from './fixtures';
import { autoRun, reviewStatus } from './review-harness';
import { verifyRuntimeBoundaries } from './baseline-runtime';
import { MessageRef } from '../src/features/palside/annotations/message-ref';
import { PalsideApp } from './preview-app';
import { usePalside, type PalsideController } from '../src/features/palside/app/use-palside';
import { ChatHeader } from '../src/features/palside/chat/chat-header';
import { Chat } from '../src/features/palside/chat/chat';
import { ProfileForm } from '../src/features/palside/account/profile-form';
import { Members } from '../src/features/palside/teams/member-list';
import { PersonCard } from '../src/features/palside/account/person-card';
import { AssetCard } from '../src/features/palside/assets/asset-card';
import { HistoryMore } from '../src/features/palside/chat/history-scope';
import { AwayDivider, useAway } from '../src/features/palside/chat/away-divider';
import { WatchStrip } from '../src/features/palside/viewing/watch-strip';
import { useTopCard } from '../src/features/palside/annotations/reminders';
import { PageStrip } from '../src/features/palside/viewing/page-strip';
import { ReactionStage } from '../src/features/palside/annotations/reaction-picker';
import { StancePoll } from '../src/features/palside/rooms/stance-poll';
import { DanmakuView, RoomPersonSheet } from '../src/features/palside/rooms/danmaku-view';
import { Settings, NotificationSettings } from '../src/features/palside/settings/settings';
import { Privacy, ReadSheet } from '../src/features/palside/settings/privacy';
import { AppearanceSetting, useAppearance } from '../src/features/palside/settings/appearance';
import { InvitationPanel } from '../src/features/palside/teams/invitation-panel';
import { About } from '../src/features/palside/settings/about';
import { Onboarding } from '../src/features/palside/account/onboarding';
import { SocialSession, setSocialUi, useSocialUi, type ReadKey } from '../src/features/palside/annotations/social-state';
import { pageScopeUrl, viewAsset } from '../src/domain/annotations/social';
import { viewingKey } from '../src/domain/assets/model';
import { type Message } from '../src/domain/chat/model';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import type { RoomStance } from '@palside/shared/contracts/rooms';
import '@palside/design/fonts.css';
import '../src/styles.css';

const host = document.getElementById('root')!;
const output = document.getElementById('result')!;
const root = createRoot(host);
const t = createTranslator({ locale: 'zh-CN', messages: messagesFor('zh-CN') }) as (key: string, values?: Record<string, string | number>) => string;
const checks: string[] = [];
const failures: string[] = [];
const calls: { name: string; payload?: Record<string, unknown> }[] = [];
const opened: string[] = [];
let c: PalsideController;
let social: ReturnType<typeof useSocialUi>;
let mode = 'header';
let generation = 0;
let state: RuntimeState;
let page: LivePort['page'];
let stance: RoomStance = { bull: 2, hold: 1, bear: 1, mine: null };
let openPending: (() => void) | undefined;
let delayOpen = false;
let phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');
const grants = { origins: ['https://gmgn.ai/*', 'https://axiom.trade/*'], permissions: ['tabs', 'notifications'] };
const permissionListeners = new Set<() => void>();
const chromeHost = globalThis as unknown as { chrome: Record<string, unknown> };
chromeHost.chrome ??= {};
chromeHost.chrome.permissions = {
  getAll: async () => structuredClone(grants),
  contains: async (query: { permissions?: string[]; origins?: string[] }) => (query.permissions ?? []).every(p => grants.permissions.includes(p)) && (query.origins ?? []).every(p => grants.origins.includes(p)),
  request: async (query: { permissions?: string[] }) => { grants.permissions = [...new Set([...grants.permissions, ...query.permissions ?? []])]; permissionListeners.forEach(fn => fn()); return true; },
  remove: async (query: { permissions?: string[] }) => { grants.permissions = grants.permissions.filter(p => !query.permissions?.includes(p)); permissionListeners.forEach(fn => fn()); return true; },
  onAdded: { addListener: (fn: () => void) => permissionListeners.add(fn), removeListener: (fn: () => void) => permissionListeners.delete(fn) },
  onRemoved: { addListener: (fn: () => void) => permissionListeners.add(fn), removeListener: (fn: () => void) => permissionListeners.delete(fn) },
};
/** The background's permission commands, answered from the same grants. */
chromeHost.chrome.runtime = {
  sendMessage: async ({ command }: { command: { name: string; payload?: { kind?: string } } }) => {
    if (command.name === 'permissions-get') return { ok: true, value: { origins: [...grants.origins], tabs: grants.permissions.includes('tabs'), notifications: grants.permissions.includes('notifications'), site: false } };
    if (command.name === 'permissions-sync') return { ok: true };
    if (command.name === 'permissions-remove' && (command.payload?.kind === 'tabs' || command.payload?.kind === 'notifications')) {
      const removing = command.payload.kind === 'tabs' ? ['tabs', 'favicon'] : ['notifications'];
      grants.permissions = grants.permissions.filter(p => !removing.includes(p)); permissionListeners.forEach(fn => fn());
      return { ok: true, value: { removed: true, origins: [] } };
    }
    return { ok: false, code: 'UNSUPPORTED' };
  },
  onMessage: { addListener() {}, removeListener() {} },
};
const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
/** Polls until `ready` holds or the deadline passes; animated mounts settle at their own pace. */
async function settled(ready: () => boolean, ms = 2000) { const end = Date.now() + ms; while (!ready() && Date.now() < end) await wait(50); return ready(); }
function assert(value: unknown, name: string): void { if (!value) throw Error(name); checks.push(name); output.textContent = JSON.stringify({ status: 'running', checks, error: null }, null, 2); }
function query<T extends Element = HTMLElement>(selector: string, within: ParentNode = host): T { const found = within.querySelector<T>(selector); if (!found) throw Error(`Missing element: ${selector}`); return found; }
function buttons(within: ParentNode = document) { return [...within.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.checkVisibility()); }
function button(label: string, within: ParentNode = document) { const found = buttons(within).find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label || b.querySelector('strong')?.textContent === label); if (!found) throw Error(`Missing button: ${label}; available: ${buttons(within).map(b => b.getAttribute('aria-label') || b.textContent?.trim()).join(' | ')}`); return found; }
async function click(label: string, within: ParentNode = document) { button(label, within).click(); await wait(); }
async function clickKey(key: string) { await click(t(key)); }
async function input(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await wait(30); }
async function key(el: HTMLElement, key: string) { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await wait(30); }
function recorded(name: string) { return calls.filter(call => call.name === name); }
function text() { return host.textContent ?? ''; }
const command: LivePort['command'] = async <T,>(name: string, payload?: Record<string, unknown>) => {
  calls.push({ name, payload });
  let result: unknown = {};
  if (name === 'preferences') { state = { ...state, preferences: { ...state.preferences, ...payload } }; render(); }
  if (name === 'draft') { const teamId = String(payload?.teamId); state = { ...state, drafts: { ...state.drafts, [teamId]: { revision: Number(payload?.revision) + 1, updatedAt: Date.now(), value: { text: '', ...state.drafts[teamId]?.value, ...payload?.patch as object } } } }; render(); }
  if (name === 'room-open') { state = { ...state, rooms: { ...state.rooms, pinned: String(payload?.key) } }; render(); }
  if (name === 'account-generate') result = { words: phrase };
  if (name === 'account-create' || name === 'account-login') { state = { ...state, setup: 'password' }; render(); }
  if (name === 'password-set') { state = { ...state, setup: undefined, authenticated: true }; render(); }
  if (name === 'profile') { state = { ...state, account: { ...state.account!, nickname: String(payload?.name) } }; render(); }
  if (name === 'dismiss-poke') { state = { ...state, pokes: state.pokes?.filter(poke => poke.id !== payload?.id) }; render(); }
  if (name === 'cache-usage') result = { bytes: 2048 };
  if (name === 'clear-cache') result = { bytes: 0 };
  if (name === 'diagnostics') result = { text: 'Synthetic diagnostics' };
  if (name === 'capture-shortcut') result = 'Alt+Shift+S';
  if (name === 'room-find') result = { found: Boolean(state.rooms.current?.messages.some(message => message.id === payload?.id)) };
  return result as T;
};
const openPage: LivePort['openPage'] = async url => { opened.push(url); if (delayOpen) await new Promise<void>(resolve => { openPending = resolve; }); };
function Away({ controller }: { controller: PalsideController }) { const away = useAway(controller); return <div data-first={away.first}>{away.first && <AwayDivider c={controller} views={away.views} />}</div>; }
function Top({ controller }: { controller: PalsideController }) { const top = useTopCard(controller); return <div data-top={top?.key}><WatchStrip c={controller} top={top} /></div>; }
function Theme() { const value = useAppearance(); return <div data-theme={value}><AppearanceSetting /></div>; }
function observe(controller: PalsideController, shared: ReturnType<typeof useSocialUi>) { c = controller; social = shared; }
function Surface() {
  const c = usePalside({ data: state.data, sites: demoSites, live: { state, page, command, openPage }, deliver: async () => {} });
  const shared = useSocialUi();
  useLayoutEffect(() => { observe(c, shared); });
  let content: ReactNode;
  switch (mode) {
    case 'header': content = <ChatHeader c={c} onTeam={c.chooseTeam} />; break;
    case 'profile': content = <ProfileForm c={c} />; break;
    case 'members': content = <Members c={c} />; break;
    case 'chat': content = <Chat c={c} clearJump={() => {}} />; break;
    case 'asset': content = <><textarea value={c.draft.text} readOnly />{c.draft.attachment?.kind === 'asset' && <AssetCard view={c.draft.attachment.view!} onOpen={() => c.selectAsset(c.draft.attachment?.kind === 'asset' ? c.draft.attachment.assetId : '')} onRemove={() => c.updateDraft({ attachment: undefined })} />}</>; break;
    case 'history': content = <HistoryMore c={c} />; break;
    case 'away': content = <Away controller={c} />; break;
    case 'watch': content = <WatchStrip c={c} />; break;
    case 'top': content = <Top controller={c} />; break;
    case 'page': content = <PageStrip c={c} />; break;
    case 'rain': content = <ReactionStage c={c}><span>Conversation</span></ReactionStage>; break;
    case 'poll': content = <StancePoll c={c} roomKey="token:Robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4" stance={stance} />; break;
    case 'room': content = <>{c.screen === 'chat' && state.data.messages.filter(message => message.ref).map(message => <MessageRef key={message.id} c={c} message={message as Message & { ref: NonNullable<Message['ref']> }} />)}<DanmakuView c={c} /></>; break;
    case 'settings': content = <Settings c={c} />; break;
    case 'notifications': content = <NotificationSettings c={c} />; break;
    case 'privacy': content = <><Privacy c={c} /><ReadSheet c={c} /></>; break;
    case 'theme': content = <Theme />; break;
    case 'invite': content = <InvitationPanel c={c} />; break;
    case 'about': content = <About c={c} />; break;
    case 'onboarding': content = <Onboarding c={c} />; break;
    default: throw Error(`Unknown surface ${mode}`);
  }
  return <div data-palside-app style={{ height: '100%', containerType: 'inline-size' }}>{content}{c.personId && <PersonCard key={c.personId} c={c} />}<RoomPersonSheet c={c} /></div>;
}
function render() { root.render(<IntegrationIntl>{mode === 'app' ? <PalsideApp key={generation} data={state.data} sites={demoSites} live={{ state, page, command, openPage }} deliver={async () => {}} /> : <SocialSession key={`${generation}:${state.data.self}`} accountId={state.data.self}><Surface /></SocialSession>}</IntegrationIntl>); }
async function reset(next: string, configure?: () => void) {
  root.render(null); await wait(20);
  mode = next; generation++; calls.length = 0; opened.length = 0; delayOpen = false; page = undefined;
  host.style.width = '400px'; host.style.height = '760px';
  state = {
    revision: 0, ready: true, authenticated: true,
    connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
    account: { bio: '', id: 'you', nickname: '你', avatarId: null, matrixId: '@fixture:example.test', revision: 0, acceptTeamInvites: true, tags: [] },
    data: structuredClone(palsideFixtures), toggles: { share: false, interact: false }, drafts: {},
    preferences: { current: 'night', web: { share: true, interact: true }, notifications: 'all', notificationPreview: true },
    rooms: { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} },
    remoteTeams: [], config: { websiteUrl: 'https://example.test', signupDifficulty: 0 }, invitations: {}, items: { stickies: [] },
    history: { night: { loaded: true, loading: false, missingKeys: 0 } },
  };
  configure?.(); render(); await wait(180);
}
async function refresh() { render(); await wait(120); }
async function test(name: string, run: () => Promise<void>) { try { await run(); } catch (error) { failures.push(`${name}: ${String(error)}`); } }

async function headerChecks() {
  for (const count of [0, 1, 2, 3, 4]) {
    await reset('header', () => { state.data.people.forEach((p, i) => { p.presence = i <= count ? i === 1 ? 'away' : 'active' : undefined; }); });
    const member = buttons(host).find(b => b.getAttribute('aria-label')?.includes(`${count}`) && b.querySelector('span,svg') && b.title);
    assert(member, `The header exposes ${count} online teammates excluding the current user`);
    if (!member) throw Error('Online member control missing');
    assert(await settled(() => member.querySelectorAll('img').length === (count > 3 ? 2 : count)), `The header draws the correct number of faces for ${count} teammates`);
    if (count >= 2) assert(member.querySelector('[data-person-avatar]')?.getAttribute('title')?.startsWith('Mia'), 'Active teammates appear before away teammates');
    if (count === 4) assert(member.textContent?.includes('+2'), 'Four online teammates show two faces and a plus two count');
    member.click(); await wait(); assert(c.screen === 'members' && c.memberFilter === undefined, 'The header opens the unfiltered member list');
  }
  await reset('header', () => { state.data.teams[0]!.memberIds = ['you']; });
  await clickKey('extension.copy.inviteShort'); assert(c.screen === 'team', 'A solo team opens its invitation settings from the header');
}

async function emptyChecks() {
  await reset('app', () => { state.data.teams = []; state.data.messages = []; });
  assert(!host.querySelector('[data-message-input]'), 'An account without teams has no message composer');
  for (const label of ['extension.copy.createTeam', 'extension.copy.joinInvitation', 'extension.copy.visitLobby', 'extension.copy.settings']) assert(button(t(label)), `An account without teams exposes ${t(label)}`);
  await clickKey('extension.copy.settings');
  const opened = await settled(() => Boolean(host.querySelector('#appearance')), 5000);
  assert(opened, opened ? 'Settings opens from the empty team screen' : `Settings opens from the empty team screen (screen ${c.screen})`);
  await reset('app', () => { state.data.teams = []; state.connection.service = 'unavailable'; });
  assert(host.querySelector('h1[role="status"]')?.textContent && !host.querySelector('svg.lucide-cloud-off') && !host.querySelector('h1 + p'), 'The disconnected empty screen states only its status, without an icon or explanation');
  assert(!host.querySelector('[data-message-input]'), 'The disconnected empty screen has no composer');
  await clickKey('extension.copy.reconnect'); assert(recorded('reconnect').length === 1, 'Retry on the disconnected empty screen requests reconnection');
  await clickKey('extension.copy.settings'); assert(host.querySelector('#appearance'), 'The disconnected empty screen retains its settings entrance');
}

async function copyChecks() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const exec = document.execCommand;
  let fallback = 0; let copied = '';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Clipboard denied'); } } });
  document.execCommand = ((name: string) => { fallback++; return name === 'copy'; }) as typeof document.execCommand;
  try {
    await reset('onboarding', () => { state.authenticated = false; });
    await clickKey('extension.copy.createAccount'); await clickKey('extension.copy.revealPhrase'); await clickKey('extension.copy.copyPhrase');
    assert(c.notice === t('extension.copy.copyManual') && fallback === 0, 'Text copy failure currently asks for manual copying without a document copy fallback');
    document.execCommand = (() => false) as typeof document.execCommand;
    await reset('invite', () => { state.invitations.night = {suspended: false,  active: true, url: 'https://example.test/invite/fixture', expiresAt: Date.now() + 86400000, password: 'ABC2' }; });
    await clickKey('extension.copy.copyInvite');
    const link = query<HTMLInputElement>('input[readonly]'); link.focus();
    assert(link.value === 'https://example.test/invite/fixture' && link.selectionStart === 0 && link.selectionEnd === link.value.length, 'A failed invitation copy exposes and selects the complete invitation URL');
    await clickKey('extension.copy.copyInvitePassword');
    const password = query<HTMLInputElement>(`input[aria-label="${t('extension.copy.manualInvitePasswordCopy')}"]`); password.focus();
    assert(password.value === 'ABC2' && password.selectionEnd === 4, 'A failed password copy exposes and selects the complete join password');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    await reset('about'); await clickKey('extension.center.diagnostics');
    assert(copied === 'Synthetic diagnostics' && button(t('extension.copy.copied')), 'Copying diagnostics shows success only after copying the returned text');
    assert(await settled(() => buttons().some(b => b.textContent?.trim() === t('extension.center.diagnostics'))), 'Diagnostic copy success clears after sixteen hundred milliseconds');
  } finally { document.execCommand = exec; if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else Reflect.deleteProperty(navigator, 'clipboard'); }
}

async function onboardingChecks() {
  await reset('onboarding', () => { state.authenticated = false; });
  assert(text().includes('CASHCAT') && text().includes('PONS') && host.querySelectorAll('h1 [aria-hidden="true"] > span').length > 3, 'Welcome shows example viewing cards and a character by character heading');
  await clickKey('extension.copy.haveAccount');
  assert(c.screen === 'restore' && host.querySelectorAll('ol li[data-state]').length === 2, 'Recovery begins with two steps and the phrase step is current');
  await clickKey('common.back'); await clickKey('extension.copy.createAccount');
  assert(c.screen === 'new-account' && host.querySelectorAll('ol li[data-state]').length === 4 && host.querySelector('[aria-current="step"]')?.textContent === t('extension.copy.stepPhrase'), 'Creation exposes four steps with backup first');
  assert(query('ol[aria-hidden="true"]').children.length === 12 && button(t('extension.copy.phraseBackedUp')).disabled && !buttons().some(b => b.textContent === t('extension.copy.copyPhrase')), 'The unrevealed phrase is hidden from accessibility and cannot be copied or confirmed');
  assert(getComputedStyle(query('ol[aria-hidden="true"]')).filter === 'blur(7px)', 'The unrevealed phrase is visually blurred');
  assert(text().includes(t('extension.copy.phraseWarningLost')), 'The phrase page exposes the lost phrase warning');
  button(t('extension.copy.phraseSafety')).focus(); await wait(900);
  assert(document.body.textContent?.includes(t('extension.copy.phraseWarningWallet')) && document.body.textContent?.includes(t('extension.copy.phraseWarningNeverAsk')), 'The safety tooltip exposes wallet and never ask warnings on focus');
  await clickKey('extension.copy.revealPhrase');
  assert(!host.querySelector('ol[aria-hidden="true"]') && !button(t('extension.copy.phraseBackedUp')).disabled && button(t('extension.copy.copyPhrase')), 'Revealing the phrase enables backup confirmation and copy');
  await clickKey('extension.copy.phraseBackedUp');
  const positions: number[] = [];
  for (let round = 0; round < 2; round++) {
    const group = query('[role="group"]');
    const position = Number(group.getAttribute('aria-label')!.match(/\d+/)![0]) - 1; positions.push(position);
    const choices = buttons(group).map(b => b.textContent!);
    assert(choices.length === 4 && new Set(choices).size === 4 && choices.every(word => phrase.includes(word)), 'Phrase verification offers four distinct words from the phrase');
    if (round === 0) {
      await click(choices.find(word => word !== phrase[position])!, group);
      assert(query('[data-state="wrong"]') && c.screen === 'confirm-phrase', 'An incorrect word keeps verification open with error feedback');
      await wait(350); assert(host.querySelector('[data-state="wrong"]'), 'Incorrect word feedback remains before seven hundred milliseconds');
      await wait(400); assert(!host.querySelector('[data-state="wrong"]'), 'Incorrect word feedback clears after seven hundred milliseconds');
    }
    // The product advances after 420 ms; checking early keeps a slow timer from landing after it.
    button(phrase[position]!, group).click(); await wait(50);
    assert(query('[role="group"]').getAttribute('aria-label') === group.getAttribute('aria-label'), 'A correct answer waits before advancing');
    await wait(450);
  }
  assert(positions[0] !== positions[1] && recorded('account-create').length === 1 && c.screen === 'password', 'Two distinct correct positions advance to password setup');
  assert(host.querySelector('[aria-current="step"]')?.textContent === t('extension.copy.stepPassword'), 'Password setup marks the third creation step current');
  // Distinct candidates can be fewer than four when the phrase repeats words.
  phrase = [...Array<string>(11).fill('abandon'), 'about'];
  await reset('onboarding', () => { state.authenticated = false; });
  await clickKey('extension.copy.createAccount'); await clickKey('extension.copy.revealPhrase'); await clickKey('extension.copy.phraseBackedUp');
  assert(buttons(query('[role="group"]')).length === 2, 'A phrase containing two distinct words offers exactly two candidates');
  phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');
  await reset('onboarding', () => { state.authenticated = false; });
  await clickKey('extension.copy.haveAccount');
  const transfer = new DataTransfer(); transfer.setData('text/plain', `${'abandon '.repeat(11)}about`);
  query('input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); await wait(); await clickKey('extension.copy.signIn');
  assert(c.screen === 'password' && host.querySelectorAll('ol li[data-state]').length === 2, 'A valid recovery phrase advances to the second recovery step');
  state = { ...state, setup: undefined, authenticated: true, account: { ...state.account!, nickname: '' } }; await refresh();
  assert(c.screen === 'nickname' && host.querySelectorAll('ol li[data-state]').length === 3, 'Recovery adds a third name step only when the account has no nickname');
  state = { ...state, account: { ...state.account!, nickname: 'Restored name' } }; c.go('chat'); await refresh();
  assert(c.screen === 'chat', 'A restored account with a nickname skips nickname setup');
}

async function profileChecks() {
  await reset('profile');
  const field = () => query<HTMLInputElement>(`input[placeholder="${t('extension.member.tagInput')}"]`);
  await input(field(), 'Alpha'); await key(field(), 'Enter');
  assert(button(t('extension.member.removeTag', { tag: 'Alpha' })), 'Enter commits a profile tag');
  await input(field(), 'Beta'); await key(field(), ',');
  assert(button(t('extension.member.removeTag', { tag: 'Beta' })), 'Comma commits a profile tag');
  await key(field(), 'Backspace'); assert(!buttons().some(b => b.getAttribute('aria-label') === t('extension.member.removeTag', { tag: 'Beta' })), 'Backspace in an empty tag input removes the last tag');
  await input(field(), 'ALPHA'); await key(field(), 'Enter');
  assert(host.querySelector('[aria-label="1/5"]') && field().value === '' && field().getAttribute('aria-invalid') !== 'true', 'Duplicate tags are silently deduplicated without adding another chip');
  await input(field(), '1234567890123');
  assert(text().includes(t('extension.member.tagLimit', { count: 12 })) && button(t('extension.copy.save')).disabled, 'Thirteen character tags show validation and disable saving');
  await input(field(), '123456789012'); assert(!button(t('extension.copy.save')).disabled, 'Twelve character tags can be saved');
  await clickKey('extension.copy.save');
  assert(JSON.stringify(recorded('profile')[0]?.payload?.tags) === JSON.stringify([{ text: 'Alpha' }, { text: '123456789012' }]), 'Saving includes the uncommitted tag input');
}

async function memberChecks() {
  await reset('members');
  assert(text().includes(t('extension.copy.owner')) && text().includes('只看 Base 新币') && text().includes('短线'), 'Members show captain labels, introductions and tags');
  const membership = JSON.stringify(c.team.memberIds);
  c.setMemberFilter(viewingKey(state.data.views[0]!)); await wait();
  assert(text().includes('Robin') && text().includes('Kai') && !buttons(host).some(b => b.textContent === 'Mia') && JSON.stringify(c.team.memberIds) === membership, 'Filtering members by viewing object changes only the displayed list');
  await click('Robin'); const dialog = query<HTMLDialogElement>('dialog[open]');
  assert(dialog.textContent?.includes('Robin') && dialog.textContent?.includes('robin') && dialog.textContent?.includes('只看 Base 新币') && dialog.querySelector('[data-presence="away"]'), 'A member name opens a card with name, short ID, biography, tags and presence');
  for (const label of ['extension.web.mention', 'extension.web.bringOver', 'extension.web.followShort']) assert(button(t(label), dialog), `A teammate card exposes ${t(label)}`);
  await clickKey('extension.web.mention'); assert(c.draft.text.includes('@Robin') && c.screen === 'chat', 'Mentioning a member returns to chat and inserts the mention');
  state.viewingId = 'cashcat'; state.publishedViewing = { viewId: 'cashcat', teamId: 'night', expiresAt: Date.now() + 30000 }; state.data.people.find(person => person.id === 'robin')!.presence = 'active'; await refresh();
  await click('Robin'); await clickKey('extension.web.bringOver');
  assert(recorded('poke')[0]?.payload?.teamId === 'night' && recorded('poke')[0]?.payload?.accountId === 'robin', 'Inviting an active teammate to a shared token targets that teammate in the current team');
  c.setMemberFilter(undefined); await wait(); await click(t('extension.dynamic.viewProfile', { name: '你' }));
  assert(text().includes(t('extension.copy.owner')) && button(t('extension.copy.editProfile')), 'The current user card identifies the captain and offers profile editing');
  await clickKey('extension.copy.editProfile'); assert(c.screen === 'profile', 'Editing the current user card opens the profile form');
  c.setSelectingOwner(true); await wait();
  assert(host.querySelectorAll('[data-person-avatar]').length === c.team.memberIds.length - 1 && !host.querySelector('[data-person-avatar][title="你"]'), 'Ownership transfer excludes the current user');
  c.setSelectingOwner(false); await wait();
  const ownActions = buttons(host).find(b => b.getAttribute('aria-label') === t('extension.dynamic.memberActions', { name: '你' }));
  if (ownActions) { ownActions.click(); await wait(); assert(!buttons().some(b => [t('extension.copy.removeMember'), t('extension.copy.transferTeam')].includes(b.textContent ?? '')), 'The current user menu has no remove or ownership transfer action'); }
  await reset('chat', () => { state.data.messages = [{ id: 'mention', teamId: 'night', author: 'mia', text: '@Robin look here', mentionIds: ['robin'], time: '12:00', status: 'sent' }]; });
  await click('@Robin'); assert(query('dialog[open]').textContent?.includes('Robin'), 'A valid message mention opens the mentioned member card');
  await clickKey('extension.copy.closeProfile');
  await click(t('extension.dynamic.viewProfile', { name: 'Mia' }), query('[data-message-id="mention"]'));
  assert(query('dialog[open]').textContent?.includes('Mia'), 'A chat avatar opens its author card');
}

async function chatChecks() {
  const day = new Date(2026, 5, 1, 12).getTime();
  const msg = (id: string, timestamp: number, extra: Partial<Message> = {}): Message => ({ id, teamId: 'night', author: 'mia', text: id, time: '12:00', timestamp, status: 'sent', ...extra });
  await reset('chat', () => { state.data.messages = [msg('first', day), msg('within', day + 299999), msg('boundary', day + 599999), msg('recalled', day + 600000, { author: 'leo', recalled: true }), msg('continuous', day + 600001), msg('self', day + 600002, { author: 'you' }), msg('midnight-before', new Date(2026, 5, 1, 23, 59).getTime()), msg('midnight-after', new Date(2026, 5, 2, 0, 0).getTime())]; });
  const row = (id: string) => query(`[data-message-id="${id}"]`);
  assert(row('first').querySelector('[data-person-avatar]') && !row('within').querySelector('[data-person-avatar]'), 'Messages from the same author group below five minutes');
  assert(row('boundary').querySelector('[data-person-avatar]'), 'Messages exactly five minutes apart start a group');
  assert(!row('continuous').querySelector('[data-person-avatar]'), 'A recalled message does not split a continuous author group');
  assert(row('midnight-after').querySelector('[data-person-avatar]') && host.querySelectorAll('[data-day-label]').length === 2, 'Midnight starts a date separator and a fresh author group');
  assert(getComputedStyle(row('self')).flexDirection === 'row-reverse' && !row('self').querySelector('strong'), 'The current user message aligns right without a nickname');
  const menu = query<HTMLButtonElement>('button[aria-haspopup]', row('first'));
  const aside = query('time', row('first')).parentElement!;
  // Hoverless pointers show the actions permanently; a pointer resting over the row legitimately reveals them.
  (document.activeElement as HTMLElement | null)?.blur();
  const hoverless = matchMedia('(hover: none)').matches;
  const hidden = await settled(() => hoverless ? getComputedStyle(aside).opacity === '1' : getComputedStyle(aside).opacity === '0' || row('first').matches(':hover'));
  const detail = `opacity ${getComputedStyle(aside).opacity}, hover:none ${hoverless}, active ${document.activeElement?.tagName}`;
  assert(hidden, hidden ? 'Message time and actions stay hidden before interaction' : `Message time and actions stay hidden before interaction (${detail})`);
  menu.focus();
  assert(await settled(() => getComputedStyle(aside).opacity === '1'), 'Focusing message actions reveals both time and menu');
}

async function assetChecks() {
  await reset('asset', () => { state.drafts.night = { revision: 1, updatedAt: Date.now(), value: { text: 'Keep this text', attachment: { kind: 'asset', assetId: 'cashcat', view: state.data.views[0]! } } }; });
  const view = state.data.views[0]!;
  assert(text().includes('Robinhood') && query(`[title="${view.address}"]`).textContent !== view.address && query(`[title="${view.address}"]`).textContent!.includes('…'), 'Token cards currently show the chain and an abbreviated contract with the full contract on hover');
  assert(query<HTMLAnchorElement>('[data-palside-source]').href === view.url, 'The token card name links to its original source');
  await click(t('extension.dynamic.viewToken', { name: view.name })); assert(c.selectedAsset === view.id && c.screen === 'asset', 'The token details button opens its discussion summary');
  await clickKey('extension.copy.removeCard'); assert(!host.querySelector('[data-asset-card]') && query<HTMLTextAreaElement>('textarea').value === 'Keep this text', 'Removing a draft token card preserves the draft text');
  await reset('asset', () => { state.drafts.night = { revision: 1, updatedAt: Date.now(), value: { text: '', attachment: { kind: 'asset', assetId: 'x', view: state.data.views[2]! } } }; });
  assert(text().includes('x.com') && !buttons(host).some(b => b.textContent === t('extension.copy.details')), 'Ordinary page cards show their host without token details');
}

async function readingChecks() {
  for (const [unread, mentions] of [[0, 0], [2, 0], [0, 1]]) {
    await reset('header', () => { state.data.teams[0]!.unread = unread!; state.data.teams[0]!.mentions = mentions; state.data.messages.push({ id: 'pending', teamId: 'night', author: 'you', text: 'pending', status: 'sending', time: '12:00' }); });
    await clickKey('extension.copy.teamMenu');
    const action = buttons().find(b => b.textContent?.startsWith(t('extension.copy.markAllRead')));
    assert(Boolean(action) === Boolean(unread || mentions), `Mark all read is ${unread || mentions ? 'visible' : 'hidden'} with ${unread} unread messages and ${mentions} mentions`);
    if (action) { if (unread) assert(action.textContent?.includes('2'), 'Mark all read displays the unread count'); action.click(); await wait(); const payload = recorded('team-preferences')[0]?.payload; assert(payload?.teamId === 'night' && JSON.stringify(payload.readIds) === JSON.stringify(state.data.messages.filter(m => m.teamId === 'night' && m.status === 'sent').map(m => m.id)), 'Mark all read submits only sent messages loaded for the current team'); }
  }
  await reset('away', () => {
    state.data.teams[0]!.unread = 5;
    state.data.views = Array.from({ length: 5 }, (_, i) => ({ ...state.data.views[0]!, id: `coin${i}`, name: `Coin ${i}`, address: `0x${String(i).padStart(40, '0')}` }));
    state.data.messages = state.data.views.map((view, i) => ({ id: `unread${i}`, teamId: 'night', author: 'mia', text: `Coin ${i}`, status: 'sent', time: '12:00', attachment: { kind: 'asset', assetId: view.id, view } }));
    state.remoteTeams = [remoteTeam({ id: 'night', roomId: '!night:example.test', preferences: { muted: false, readIds: ["unread0"], revision: 0 } })];
  });
  assert(query('[data-first]').getAttribute('data-first') === 'unread1' && host.querySelectorAll('[role="separator"] button').length === 3 && text().includes('+1'), 'The unread divider starts at the first unread message and caps token icons at three plus the remainder');
  state.data.messages = [...state.data.messages, { ...state.data.messages[0]!, id: 'arrival' }]; state.data.teams[0]!.unread = 6; await refresh();
  assert(query('[data-first]').getAttribute('data-first') === 'unread1' && text().includes('+1'), 'Arriving messages do not move or recompute the unread snapshot');
  state.preferences.current = 'weekend'; await refresh(); assert(!host.querySelector('[role="separator"]'), 'Switching teams establishes that team’s unread divider');
  state.preferences.current = 'night'; state.remoteTeams[0] = { ...state.remoteTeams[0]!, preferences: { ...state.remoteTeams[0]!.preferences, readIds: ['unread0', 'unread1'] } }; await refresh();
  assert(query('[data-first]').getAttribute('data-first') === 'unread2', 'Returning to a team computes its first unread message again');
  await reset('history', () => { state.history!.night = { loaded: false, loading: false, missingKeys: 0 }; });
  await clickKey('extension.copy.loadEarlier'); assert(recorded('history')[0]?.payload?.teamId === 'night', 'Loading earlier history requests the current team');
  state.connection.networkOnline = false; await refresh(); assert(button(t('extension.copy.loadEarlier')).disabled, 'Earlier history cannot load while offline');
  state.connection.networkOnline = true; state.history!.night!.loading = true; await refresh(); assert(query<HTMLButtonElement>('button').disabled && query('button').getAttribute('aria-busy') === 'true', 'Earlier history cannot load twice while loading');
  state.history!.night = { loaded: true, loading: false, missingKeys: 3 }; await refresh(); assert(text().includes(t('extension.copy.historyUnavailable')) && !host.querySelector('button'), 'Missing decryption keys show an explanation after readable history ends');
  state.history!.night = { loaded: true, loading: false, missingKeys: 0 }; await refresh(); assert(!host.querySelector('button,[role="status"]'), 'Fully readable exhausted history has neither a load control nor a missing key warning');
}

async function watchChecks() {
  await reset('watch');
  const strip = query('[data-watch-strip]');
  const cards = [...strip.querySelectorAll<HTMLElement>(':scope > [data-watch-key]')];
  assert(cards.length === 2 && Math.abs(cards[0]!.getBoundingClientRect().width - cards[1]!.getBoundingClientRect().width) < 1, 'The viewing strip currently shows two equal width cards');
  assert(strip.scrollWidth <= strip.clientWidth && !['scroll', 'auto'].includes(getComputedStyle(strip).overflowX), 'The viewing strip has no horizontal scrolling track');
  const own = query('[data-watch-key]:has([data-self])');
  assert(own.querySelectorAll('[data-person-avatar]').length === 2 && own.querySelector('[data-self]') === own.querySelector('[data-person-avatar]')?.parentElement, 'A viewing group caps faces at two and places the current user first');
  assert(cards.some(card => card.textContent?.includes('+1')), 'Three viewers show two faces and a remaining count');
  await click(t('extension.top.more', { count: 1 }));
  assert(document.querySelectorAll('[data-watch-key]').length === 3, 'The plus count expands the remaining viewing group');
  await click(t('extension.dynamic.viewingPeople', { name: 'CASHCAT', count: 3 }));
  assert(c.screen === 'members' && c.memberFilter === viewingKey(state.data.views[0]!), 'The viewing count opens members filtered to that viewing object');
  await reset('watch', () => {
    state.data.views.push({ ...state.data.views[0]!, id: 'other-source', source: 'FOMO', url: 'https://fomo.family/token/fixture' });
    state.data.people.find(p => p.id === 'kai')!.viewing = 'other-source';
  });
  await click(t('extension.dynamic.openSource', { name: 'CASHCAT' }));
  const menu = query('[popover]:popover-open');
  assert(menu.textContent?.includes('GMGN') && menu.textContent?.includes('FOMO') && menu.textContent?.includes('2 人') && menu.textContent?.includes('1 人'), 'A token source menu lists current viewer counts for each source');
}

function pageFixture(index = 0): NonNullable<LivePort['page']> {
  const view = state.data.views[index]!;
  return { windowId: 1, tabId: 1, url: view.url, asset: viewAsset(view), title: view.name, host: new URL(view.url).hostname, access: { site: true }, granted: true, interactive: true, stickyEnabled: true, signalEnabled: true, connected: true, tokenProfile: true, capabilities: { capture: { state: 'ready' }, pick: { state: 'ready' }, danmaku: { state: 'ready' }, signal: { state: 'ready' }, share: { state: 'ready' } } };
}
async function reminderChecks() {
  await reset('top', () => { page = pageFixture(2); });
  c.setPersonId('mia'); await wait(); await clickKey('extension.web.followShort');
  assert(social.follow?.personId === 'mia' && opened.length === 0 && !recorded('poke').length, 'Following a teammate stays local and does not open a page or notify them');
  state.data.people.find(p => p.id === 'mia')!.viewing = 'cashcat'; await refresh();
  assert(query('[data-top]').getAttribute('data-top')?.includes('follow-mia-cashcat') && opened.length === 0 && button(t('extension.top.go')), 'A followed teammate changing tokens shows a suggestion without navigation');
  await clickKey('extension.top.go'); assert(opened[0] === state.data.views[0]!.url, 'Following navigates only after the user chooses go');
  page = pageFixture(); await refresh(); assert(!buttons().some(b => b.textContent === t('extension.top.go')), 'Following the current page suppresses the go suggestion');
  c.setPersonId('robin'); await wait(); await clickKey('extension.web.followShort'); assert(social.follow?.personId === 'robin', 'Choosing another teammate replaces the single follow target');
  state.pokes = [{ id: 'older', teamId: 'night', from: 'mia', view: state.data.views[1]!, at: Date.now() - 1000, count: 1 }, { id: 'newest', teamId: 'night', from: 'kai', view: state.data.views[1]!, at: Date.now(), count: 1 }]; await refresh();
  assert(query('[data-top]').getAttribute('data-top')?.startsWith('follow'), 'Following takes priority over invitations to view a token');
  state.connection.networkOnline = false; await refresh(); assert(query('[data-top]').getAttribute('data-top') === 'connection-network-offline', 'Offline status takes priority over following');
  state.connection.networkOnline = true; state.data.teams[0]!.readonly = true; await refresh(); assert(query('[data-top]').getAttribute('data-top') === 'readonly', 'Read only team status takes priority over following');
  assert(social.follow?.personId === 'robin', 'A read only team currently suppresses the follow card while retaining its local target');
  state.data.teams[0]!.readonly = false; await refresh(); await clickKey('extension.top.end');
  assert(!social.follow && query('[data-top]').getAttribute('data-top') === 'poke-newest', 'Ending following reveals the latest invitation to view');
  const before = JSON.stringify({ messages: state.data.messages, unread: state.data.teams.map(team => team.unread) });
  await clickKey('extension.top.ignore'); assert(recorded('dismiss-poke').at(-1)?.payload?.id === 'newest' && query('[data-top]').getAttribute('data-top') === 'poke-older', 'Ignoring an invitation reveals the next waiting invitation');
  delayOpen = true; await clickKey('extension.top.open'); assert(!recorded('dismiss-poke').some(call => call.payload?.id === 'older'), 'Opening an invitation waits for the page open command to finish before dismissing');
  openPending?.(); await wait(); assert(recorded('dismiss-poke').some(call => call.payload?.id === 'older'), 'A resolved page open command dismisses its invitation');
  assert(JSON.stringify({ messages: state.data.messages, unread: state.data.teams.map(team => team.unread) }) === before, 'Viewing invitations do not change chat messages or unread counts');
  state.pokes = [{ id: 'arrived', teamId: 'night', from: 'mia', view: state.data.views[0]!, at: Date.now(), count: 1 }]; await refresh();
  assert(recorded('dismiss-poke').some(call => call.payload?.id === 'arrived') && !host.querySelector('[data-top]'), 'An invitation disappears when the current page already matches its token');
  setSocialUi({ follow: { teamId: 'night', personId: 'mia' } }); state.data.teams[0]!.memberIds = state.data.teams[0]!.memberIds.filter(id => id !== 'mia'); await refresh(); assert(!social.follow, 'Following clears when the teammate leaves the team');
  setSocialUi({ follow: { teamId: 'night', personId: 'robin' } }); state.preferences.current = 'weekend'; await refresh(); assert(!social.follow, 'Following clears when the current team changes');
}

async function pageChecks() {
  await reset('page', () => { page = pageFixture(); for (const id of ['robin', 'mia', 'leo', 'kai']) state.data.people.find(p => p.id === id)!.viewing = 'cashcat'; });
  const faces = query('[role="img"][tabindex="0"]'); assert(faces.querySelectorAll('[data-person-avatar]').length === 3, 'The current page strip caps teammate faces at three');
  host.style.width = '350px'; await wait(); assert(getComputedStyle(faces).display === 'none', 'Current page teammate faces hide at three hundred fifty pixels');
  host.style.width = '351px'; await wait(); assert(getComputedStyle(faces).display !== 'none', 'Current page teammate faces show above three hundred fifty pixels');
  await click(t('extension.current.detail', { name: 'CASHCAT' })); assert(c.screen === 'asset', 'The current page identity opens its details');
  await click(t('extension.room.chip', { name: 'CASHCAT', count: 0 })); assert(recorded('room-open').length === 1, 'A token page offers entry to its public room');
  await clickKey('extension.web.sticky'); assert(document.querySelector('[popover]:popover-open')?.textContent?.includes(t('extension.web.stickyStep1')), 'The sticky note entrance exposes its page interaction guide');
  await clickKey('extension.web.notesNone'); assert(social.stickies?.url === page!.url, 'The sticky note guide opens notes for the current URL');
  await reset('page', () => { page = pageFixture(2); }); assert(!buttons(host).some(b => b.getAttribute('aria-label')?.includes('弹幕')), 'An ordinary page has no token room entrance');
  page!.interactive = false; setSocialUi({ returnTo: { id: 1, origin: pageFixture(), target: pageScopeUrl(page!.url)!, arrived: true } }); await refresh();
  await click(t('extension.top.back', { name: 'CASHCAT' })); assert(opened[0] === state.data.views[0]!.url && !social.returnTo, 'Returning to the previous token remains available when page interaction is off');
}

async function roomChecks() {
  await reset('room', () => {
    const key = `token:${viewAsset(state.data.views[0]!)}`;
    state.data.teams[1]!.memberIds.push('alice');
    state.rooms.current = { key, profile: { name: 'CASHCAT', logo: null, site: 'gmgn' }, count: 3, stance: { bull: 0, hold: 0, bear: 0, mine: null }, faces: [], loading: true, hasMore: true, slowUntil: 0, messages: Array.from({ length: 50 }, (_, i) => ({ id: `line${i + 1}`, key, text: `Message ${i + 1}`, author: { id: i === 0 ? 'alice' : i === 1 ? 'stranger' : i === 2 ? 'you' : 'mia', nickname: i === 0 ? 'Alice' : i === 1 ? 'Stranger' : i === 2 ? '你' : 'Mia', avatarId: null }, folded: false, reported: false, createdAt: Date.now() - (50 - i) * 1000 })) };
  });
  state.data.messages = [{ id: 'room-reference', teamId: 'night', author: 'mia', text: '', time: '12:00', status: 'sent', ref: { view: state.data.views[0]!, caption: 'Quoted room text', target: { kind: 'danmaku', id: 'line0', author: 'mia', name: 'Mia', at: Date.now() } } }]; await refresh();
  await click(t('extension.composer.findRef', { caption: 'Quoted room text' }));
  assert(recorded('room-open').length === 1 && c.screen === 'room', 'Clicking a chat room reference opens the referenced token room');
  assert(social.roomLine === 'line0', 'A quoted room target waits until the room finishes loading');
  state.rooms.current!.loading = false; await refresh();
  assert(recorded('room-find').length === 1 && recorded('room-find')[0]!.payload?.id === 'line0' && !social.roomLine && !host.querySelector('[data-focus="true"]') && c.notice !== '', 'A quoted room line outside the loaded rows is looked up in retained history and reports when it is gone');
  state.rooms.current!.hasMore = false; await refresh(); setSocialUi({ roomLine: 'line20' }); await wait(180);
  assert(query('[data-room-line="line20"]').getAttribute('data-focus') === 'true' && !social.roomLine, 'A loaded quoted room line receives focus and consumes its target');
  assert(query('[data-room-line="line1"]').getAttribute('data-mate') === 'true' && !query('[data-room-line="line2"]').hasAttribute('data-mate'), 'Room authors in any joined team are marked as teammates');
  const ring = query('[data-room-line="line1"] > button'); assert(getComputedStyle(ring).boxShadow !== 'none', 'Room teammates have a visible avatar ring');
  ring.dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(); assert(query('dialog[open]').textContent?.includes('Alice'), 'A teammate from another joined team opens the member card');
  await clickKey('extension.copy.closeProfile');
  query<HTMLButtonElement>('[data-room-line="line2"] > button').click(); await wait(250);
  for (const label of ['extension.invite.action', 'extension.room.block', 'extension.copy.report']) assert(button(t(label)), `A stranger card offers ${t(label)}`);
  await clickKey('extension.room.block'); assert(recorded('room-block')[0]?.payload?.accountId === 'stranger', 'Blocking from a stranger card identifies the selected account');
  assert(await settled(() => !document.querySelector('dialog[open]')), 'Blocking closes the stranger card before returning to room actions');
  const ownLine = query('[data-room-line="line3"]');
  ownLine.scrollIntoView({ block: 'center', behavior: 'instant' }); await wait();
  await click(t('extension.dynamic.messageActions', { content: 'Message 3' }), ownLine);
  assert(!buttons(query('[popover]:popover-open', ownLine)).some(b => b.textContent === t('extension.copy.report')) && button(t('extension.copy.recall'), ownLine), 'A room author can retract their own line but cannot report it');
}

async function pollChecks() {
  await reset('poll');
  for (const [votes, expected] of [[{ bull: 2, hold: 1, bear: 1, mine: null }, null], [{ bull: 2, hold: 2, bear: 1, mine: null }, [40, 40, 20]], [{ bull: 2, hold: 2, bear: 2, mine: 'bull' }, [34, 33, 33]]] as const) {
    stance = { ...votes }; await refresh();
    const poll = query('[role="radiogroup"]'); const labels = [...poll.querySelectorAll('button b')].map(b => b.textContent);
    if (!expected) assert(labels.every(label => label === '—') && !poll.hasAttribute('data-shares'), 'Four votes hide all percentages');
    else assert(labels.join(',') === expected.map(n => `${n}%`).join(',') && expected.reduce((a, b) => a + b, 0) === 100, 'Five or more votes show integer percentages totaling one hundred');
    assert(poll.querySelectorAll(':scope > span > span').length === 3 && poll.hasAttribute('data-voted') === Boolean(votes.mine), 'The proportion bar persists and only a cast vote enables selected colors');
    const target = query<HTMLButtonElement>('button[data-stance="bull"]'); target.focus(); await wait(800);
    assert(document.body.textContent?.includes(t('extension.stance.votes', { count: votes.bull + votes.hold + votes.bear })), 'The stance tooltip exposes the total number of votes');
  }
  query<HTMLButtonElement>('button[data-stance="bull"]').click(); await wait(); assert(recorded('room-stance').at(-1)?.payload?.value === null, 'Selecting the chosen stance withdraws that vote');
}

async function reactionChecks() {
  for (const [count, expected] of [[1, 8], [2, 8], [3, 9], [12, 18], [30, 18]]) {
    await reset('rain', () => { state.reactions = []; });
    state.reactions = [{ id: `reaction${count}`, teamId: 'night', personId: 'mia', emoji: '🔥', count: count!, at: Date.now() }]; await refresh();
    const stage = query('[aria-hidden="true"]');
    assert(stage.children.length === expected, `A received count of ${count} produces ${expected} emoji drops`);
    assert(!stage.querySelector('[data-person-avatar]') && query('[role="status"]').textContent?.includes('Mia'), 'Received reactions contain only emoji while announcing the sender to screen readers');
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await reset('rain', () => { state.reactions = []; });
    state.reactions = [{ id: 'falling', teamId: 'night', personId: 'mia', emoji: '🔥', count: 1, at: Date.now() }]; await refresh();
    const drop = query<HTMLElement>('[aria-hidden="true"] > span');
    const before = drop.getBoundingClientRect().top;
    await wait(300);
    assert(drop.getBoundingClientRect().top > before && drop.querySelector('span')?.textContent === '🔥', 'Received emoji fall toward the panel bottom with ordinary motion');
  }
  // The driver selects reduced motion before this document starts, so Motion also reads it on its first mount.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await reset('rain', () => { state.reactions = []; });
    state.reactions = [{ id: 'gentle', teamId: 'night', personId: 'mia', emoji: '🔥', count: 1, at: Date.now() }]; await refresh();
    const drop = query<HTMLElement>('[aria-hidden="true"] > span'); const top = drop.style.top; const began = performance.now();
    await wait(600); assert(drop.style.top === top && top.endsWith('%') && getComputedStyle(drop).transform === 'none' && Number(getComputedStyle(drop).opacity) > 0, 'Reduced motion fades received emoji in place without falling');
    await wait(650); assert(drop.isConnected, 'Reduced motion emoji remain before their sixteen hundred millisecond duration');
    await wait(500); assert(!drop.isConnected && performance.now() - began < 2100, 'Reduced motion emoji finish their sixteen hundred millisecond fade');
  }
}

async function settingsChecks() {
  await reset('settings');
  assert(button(t('extension.copy.editPersonalProfile')) && host.querySelectorAll('input[type="checkbox"]').length === 2, 'Settings currently begins with a profile card and direct sharing and interaction switches');
  const expected = ['extension.settings.sites', 'extension.settings.interactionOptions', 'extension.settings.notifications', 'extension.shot.shortcut', 'extension.settings.privacy', 'extension.copy.security', 'extension.copy.aboutPalside', 'extension.copy.signOut'];
  const rendered = buttons(host).map(b => b.textContent ?? '');
  let previous = -1;
  for (const label of expected) { const index = rendered.findIndex(value => value.startsWith(t(label))); assert(index > previous, `Settings places ${t(label)} in its current flat order`); previous = index; }
  assert(host.querySelector('#appearance') && host.querySelector('#language') && buttons(host).at(-1)?.textContent === t('extension.copy.signOut'), 'Settings includes appearance and language selectors and ends with sign out');
  for (const [label, screen] of [['extension.settings.sites', 'sites'], ['extension.settings.interactionOptions', 'interaction'], ['extension.settings.notifications', 'notifications'], ['extension.settings.privacy', 'privacy'], ['extension.copy.security', 'security'], ['extension.copy.aboutPalside', 'about']]) {
    const target = buttons(host).find(b => b.textContent?.startsWith(t(label!)))!; target.click(); await wait(); assert(c.screen === screen, `The ${t(label!)} setting opens its screen`);
  }
  await reset('notifications');
  await clickKey('extension.settings.notifyOff');
  assert(!host.querySelector('input[type="checkbox"]') && state.preferences.notificationPreview === true, 'Notification preview is hidden while notifications are off without erasing its preference');
  await clickKey('extension.settings.notifyAll'); assert(query<HTMLInputElement>('input[type="checkbox"]').checked && state.preferences.notificationPreview === true, 'Enabling notifications restores the saved preview preference');
}

async function appearanceChecks() {
  localStorage.removeItem('palside:appearance');
  await reset('theme');
  assert(query<HTMLSelectElement>('select').value === 'system' && query('select').children.length === 3, 'Appearance defaults to system and offers system, light and dark');
  for (const value of ['light', 'dark', 'system']) { await input(query<HTMLSelectElement>('select'), value); assert(query('[data-theme]').getAttribute('data-theme') === value && localStorage.getItem('palside:appearance') === value, `Choosing ${value} updates appearance and browser profile storage`); }
  const frame = document.createElement('iframe'); frame.src = 'about:blank'; await new Promise<void>(resolve => { frame.onload = () => resolve(); document.body.append(frame); });
  try { frame.contentWindow!.localStorage.setItem('palside:appearance', 'dark'); await wait(); assert(query('[data-theme]').getAttribute('data-theme') === 'dark', 'A storage change in another same origin window synchronizes appearance'); } finally { frame.remove(); }
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
  try {
    Storage.prototype.getItem = function (key) { if (key === 'palside:appearance') throw Error('Storage unavailable'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === 'palside:appearance') throw Error('Storage unavailable'); set.call(this, key, value); };
    await input(query<HTMLSelectElement>('select'), 'light'); assert(query('[data-theme]').getAttribute('data-theme') === 'light', 'Appearance remains usable in memory when browser storage is unavailable');
  } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set; }
  await reset('app'); await clickKey('extension.copy.teamMenu'); await clickKey('extension.copy.settings');
  await input(query<HTMLSelectElement>('#appearance'), 'dark'); await clickKey('extension.copy.signOut');
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(b => b.textContent === t('extension.copy.signOut'))!; confirm.click(); await wait();
  assert(recorded('logout').length === 1 && localStorage.getItem('palside:appearance') === 'dark', 'Signing out does not reset the browser appearance preference');
}

async function privacyChecks() {
  await reset('privacy');
  assert(text().includes(t('extension.web.siteCount', { count: 2 })), 'Privacy displays the current granted website count');
  for (const feature of ['share', 'token', 'quote', 'signal', 'sticky', 'room', 'shot', 'notify'] as ReadKey[]) {
    await click(t(`extension.privacy.feature_${feature}`)); await wait(200);
    const drawer = query('dialog[open], [role="dialog"][aria-modal="true"]', document);
    if (feature === 'share') assert(drawer.textContent?.includes('不保存，30 秒后失效'), 'The sharing disclosure currently says viewing expires after thirty seconds');
    for (const part of ['line', 'who', 'keep', 'no']) assert(drawer.textContent?.includes(t(`extension.privacy.read.${feature}.${part}`)), `The ${feature} disclosure shows its ${part} explanation`);
    assert(buttons(drawer).length === 1 && button(t('common.close'), drawer), 'Feature disclosures contain only a close button and no permission management actions');
    if (feature === 'room') assert(drawer.textContent?.includes(t('extension.privacy.perm_sites')) && !drawer.textContent.includes(t('extension.privacy.perm_tabs')) && !drawer.textContent.includes(t('extension.privacy.perm_active')), 'Room disclosure names only site access');
    await clickKey('common.close'); await wait(200);
  }
  const cache = buttons(host).filter(b => b.textContent === t('extension.center.clear'));
  assert(cache.length === 2 && !cache[0]!.disabled && cache[1]!.disabled, 'Privacy offers a usable cache clear control and disables clearing empty favorites');
  cache[0]!.click(); await wait(); await c.confirmation!.confirm(); await wait(); assert(recorded('clear-cache').length === 1 && text().includes('0 B'), 'Confirming cache clearing updates the displayed local cache size');
  state.preferences.favorites = { sites: ['gmgn.ai'], pages: [] }; await refresh();
  const clearFavorites = buttons(host).filter(b => b.textContent === t('extension.center.clear'))[1]!; assert(!clearFavorites.disabled, 'Saved favorites enable their clear control');
  clearFavorites.click(); await wait(); await c.confirmation!.confirm(); await wait(); assert(recorded('preferences').some(call => JSON.stringify(call.payload?.favorites) === '{"sites":[],"pages":[]}'), 'Confirming favorite clearing writes empty saved favorites');
  grants.origins = ['<all_urls>']; permissionListeners.forEach(fn => fn()); await wait(); assert(text().includes(t('extension.sites.allSites')), 'Broad website authorization is displayed as all websites');
  grants.origins = ['https://gmgn.ai/*', 'https://axiom.trade/*'];
}

async function runtimeChecks() {
  await reset('top');
  await verifyRuntimeBoundaries(state, assert, async snapshot => { state = snapshot; await refresh(); assert(Boolean(host.querySelector('[data-top]')) === Boolean(snapshot.pokes?.length), 'The reminder card follows the runtime invitation lifetime'); });
}

async function run() {
  const cases: [string, () => Promise<void>][] = [
    ['Online teammate header', headerChecks], ['Empty teams and disconnected screen', emptyChecks], ['Copy recovery and diagnostics', copyChecks],
    ['Account onboarding and phrase verification', onboardingChecks], ['Profile tag editing', profileChecks], ['Member cards and filtering', memberChecks],
    ['Message author grouping', chatChecks], ['Current token card presentation', assetChecks], ['Unread and history controls', readingChecks],
    ['Current viewing strip layout', watchChecks], ['Following and viewing invitations', reminderChecks], ['Current page strip', pageChecks],
    ['Room references and member cards', roomChecks], ['Vote threshold and proportions', pollChecks], ['Received emoji reactions', reactionChecks],
    ['Current settings hierarchy and notification preview', settingsChecks], ['Browser appearance preferences', appearanceChecks], ['Privacy disclosures and local data', privacyChecks], ['Runtime history and invitation boundaries', runtimeChecks],
  ];
  for (const [name, execute] of cases) await test(name, execute);
  const status = failures.length ? 'failed' : 'passed';
  output.textContent = JSON.stringify({ status, checks, error: failures.length ? failures : null }, null, 2);
  reviewStatus(status);
}
void reset('header').then(() => { if (autoRun) return run(); reviewStatus('ready'); }).catch(error => { output.textContent = JSON.stringify({ status: 'failed', checks, error: String(error) }, null, 2); reviewStatus('failed'); });
