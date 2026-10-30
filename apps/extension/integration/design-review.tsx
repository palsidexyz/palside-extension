import { IntegrationIntl } from './intl';
import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { setSocialUi, type ReadKey } from '../src/features/palside/annotations/social-state';
import { palsideFixtures, demoSites } from './fixtures';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RoomStance, Stance } from '@palside/shared/contracts/rooms';
import { pageCapabilities } from '../src/runtime/browser/page-capabilities';
import { defaultDanmakuSettings, normalizeDanmakuSettings, type DanmakuSettings, type PageStatus } from '../src/runtime/browser/page-protocol';
import { defaultSignalSettings, normalizeSignalSettings } from '../src/runtime/annotations/signals';
import { defaultInteraction, interactionAllows } from '../src/domain/annotations/interaction';
import '@palside/design/fonts.css';
import '../src/styles.css';

/** Isolated design review of context bars, composer tools, page cards, access sheets and the capture editor. */
const params = new URLSearchParams(location.search);
// Chrome's permission API, granting every request (deny=1 refuses), so 共享在看, 网页互动 and 已授权网站 can be walked through outside
// the extension. grant=0 leaves gmgn.ai out (未授权), broad=1 adds 所有网站 as if allowed in Chrome's menu, tabs=1 has 读取您的浏览记录;
// the page follows these grants live.
const grants = { origins: new Set<string>([...params.get('grant') === '0' ? [] : ['https://gmgn.ai/*'], 'https://axiom.trade/*', ...params.get('broad') === '1' ? ['<all_urls>'] : []]), permissions: new Set<string>([...params.get('notify') === 'denied' ? [] : ['notifications'], ...params.get('tabs') === '1' ? ['tabs'] : []]) }, added = new Set<() => void>(), removed = new Set<() => void>();
const chromeHost = globalThis as unknown as { chrome?: Record<string, unknown> };
if (chromeHost.chrome && !chromeHost.chrome.permissions) chromeHost.chrome.permissions = {
  getAll: async () => ({ origins: [...grants.origins], permissions: [...grants.permissions] }),
  contains: async (query: { origins?: string[]; permissions?: string[] }) => (query.origins ?? []).every(origin => grants.origins.has(origin)) && (query.permissions ?? []).every(name => grants.permissions.has(name)),
  request: async (query: { origins?: string[]; permissions?: string[] }) => { if (params.get('deny') === '1') return false; query.origins?.forEach(origin => grants.origins.add(origin)); query.permissions?.forEach(name => grants.permissions.add(name)); added.forEach(listener => listener()); return true; },
  remove: async (query: { origins?: string[]; permissions?: string[] }) => { query.origins?.forEach(origin => grants.origins.delete(origin)); query.permissions?.forEach(name => grants.permissions.delete(name)); removed.forEach(listener => listener()); return true; },
  onAdded: { addListener: (listener: () => void) => added.add(listener), removeListener: (listener: () => void) => added.delete(listener) },
  onRemoved: { addListener: (listener: () => void) => removed.add(listener), removeListener: (listener: () => void) => removed.delete(listener) },
};
const scene = params.get('scene') ?? 'chat';
// 设置 › 网页: share=0 / interact=0 禁用 the feature. Composer switches: on=share,interact turns them on; active=1 shows the tab's
// address as activeTab would without the site; notify=off|denied.
const web = { share: params.get('share') !== '0', interact: params.get('interact') !== '0' };
const on = (params.get('on') ?? '').split(',');
const data = structuredClone(palsideFixtures);
// Security views require a public-key-shaped ID; this synthetic key never authenticates.
if (scene === 'security') {
  const before = data.self;
  const after = '01'.repeat(32);
  data.self = after;
  data.people = data.people.map(person => person.id === before ? { ...person, id: after } : person);
  data.teams = data.teams.map(team => ({ ...team, owner: team.owner === before ? after : team.owner, memberIds: team.memberIds.map(id => id === before ? after : id) }));
  data.messages = data.messages.map(message => message.author === before ? { ...message, author: after } : message);
}
const now = Date.now();
data.views.push({ id: 'page-github', name: 'palsidexyz/palside-extension: Watch tokens alongside friends', kind: 'website', disclosure: 'page', source: 'github.com', url: 'https://github.com/palsidexyz/palside-extension', color: '#e9edf0', glyph: 'G' });
data.messages.push({ id: 'n6', teamId: 'night', author: 'leo', text: '这个仓库看看', attachment: { kind: 'asset', assetId: 'page-github', view: data.views.at(-1)! }, time: '14:33', status: 'sent' });
data.messages.push({ id: 'n7', teamId: 'night', author: 'robin', text: '', attachment: { kind: 'asset', assetId: 'cashcat', view: data.views[0]! }, time: '14:34', status: 'sent' });
const gmgnPage = 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4';
// Top slot states: back=1 has the tab on a token opened from the panel (回到 in the 本页条), away=1 opens the team with unread tokens
// (你不在时 divider), offline=1 drops the network (the connection card takes the slot).
if (params.get('away') === '1') data.teams.find(team => team.id === 'night')!.unread = 4;
// 添加网站: `select=a.com,b.com` preselects tiles. grant: the sheet for an unauthorized site.
// 添加小队: two recruiting teams, one pending and one declined join request.
const lobbyTeam = (id: string, name: string, extra: Partial<RuntimeState['data']['teams'][number]>) => ({ id, name, description: '', owner: `owner-${id}`, ownerName: '安师大', memberIds: [], memberCount: 2, joined: false, published: true, muted: false, unread: 0, publishedAt: now, recruitmentExpiresAt: now + 86_400_000, ...extra });
const lobbyTeams = scene === 'lobby' ? [
  lobbyTeam('l1', '啊啊', { description: '一起看新币，晚上活跃' }),
  lobbyTeam('l2', '币圈夜话', { ownerName: '老王', memberCount: 12, requested: true, applicationStatus: 'pending', applicationExpiresAt: now + 86_400_000 }),
  lobbyTeam('l3', '链上侦探', { published: false, applicationStatus: 'rejected', applicationExpiresAt: now + 86_400_000 }),
] : [];
if (scene === 'start') {
  data.messages = data.messages.filter(message => message.teamId !== 'night');
  const night = data.teams.find(team => team.id === 'night')!;
  night.owner = data.self;
  night.memberIds = [data.self];
}
if (scene === 'shared-tokens') data.messages.forEach((message, index) => { message.timestamp = now - index * 3_600_000; });
const pageAsset = 'Robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4';
// 便利贴 of the open token: the user's own, a teammate's pinned to a spot, an asset-level one, one whose spot is gone, one hidden.
const stickies = scene === 'stickies' ? [
  { id: 'k1', teamId: 'night', author: data.self, asset: pageAsset, text: '这里是前高，突破再看', url: 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4', site: 'gmgn.ai', target: { kind: 'quote', exact: '持有人 3,412', prefix: '', suffix: '' }, caption: '“持有人 3,412”', timestamp: now - 90_000, expiresAt: now + 86_400_000 },
  { id: 'k2', teamId: 'night', author: 'mia', asset: pageAsset, text: '同意，等放量。开发者钱包昨晚转出了一部分，盯一下。', url: 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4', site: 'gmgn.ai', target: { kind: 'quote', exact: '1,237', prefix: '', suffix: '' }, caption: '“1,237”', timestamp: now - 12 * 60_000, editedAt: now - 60_000, expiresAt: now + 86_400_000 },
  { id: 'k3', teamId: 'night', author: 'kai', asset: pageAsset, text: '社区在推特很活跃', timestamp: now - 3 * 3_600_000, expiresAt: now + 86_400_000 },
  { id: 'k4', teamId: 'night', author: 'leo', asset: pageAsset, text: '这个池子之前被抽过', url: 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4', site: 'gmgn.ai', target: { kind: 'quote', exact: '流动性 $88K', prefix: '', suffix: '' }, caption: '“流动性 $88K”', timestamp: now - 26 * 3_600_000, expiresAt: now + 86_400_000 },
  { id: 'k5', teamId: 'night', author: 'robin', asset: pageAsset, text: '冲', timestamp: now - 40 * 60_000, expiresAt: now + 86_400_000 },
] : [];
// 弹幕: scene=room opens CASHCAT's 弹幕 (room-slow: just spoke; room-empty: nobody has spoken); hot = 热门; invites = two received
// team invites in 添加小队; invite = the invite sheet for Kenji; detail = 代币详情 with 在看 and 看法; blocked = 已屏蔽; rooms=off switches 参与弹幕 off.
const roomKey = `token:${pageAsset}`;
const otherKey = 'token:Robinhood:0x39dbed3a2bd333467115de45665cc57f813c4571';
const stranger = (id: string, nickname: string) => ({ id, nickname, avatarId: null });
const roomPeople = [stranger('kenji-0x91c4', 'Kenji'), stranger('zed-0x3c2a', 'Zed'), stranger('nova-0x7e10', 'Nova'), { id: 'robin', nickname: 'Robin', avatarId: null }, { id: data.self, nickname: '测试成员', avatarId: null }];
const roomLine = (id: string, author: (typeof roomPeople)[number], text: string, ago: number, extra = {}) => ({ id, key: roomKey, author, text, folded: false, reported: false, createdAt: now - ago * 60_000, ...extra });
const roomStance: RoomStance = { bull: 14, hold: 6, bear: 3, mine: scene === 'detail' ? 'bull' : null };
const roomFaces = roomPeople.slice(0, 3);
const roomMessages = scene === 'room-empty' ? [] : [roomLine('r1', roomPeople[0]!, '池子刚加了一倍', 9), roomLine('r2', roomPeople[3]!, '跟上了，看 5 分钟线', 7), roomLine('r3', roomPeople[1]!, 'dev 钱包刚卖了一部分，注意', 5), roomLine('r4', roomPeople[2]!, '这币要拉 10 倍，私聊带你', 4, { folded: true }), roomLine('r5', roomPeople[4]!, '哪个钱包', 1)];
const roomFor = (key: string) => key === roomKey
  ? { key, profile: { name: 'CASHCAT', logo: null, site: 'gmgn' }, count: 23, stance: roomStance, faces: roomFaces, messages: roomMessages, hasMore: false, loading: false, slowUntil: scene === 'room-slow' ? now + 4_000 : 0 }
  : { key, profile: null, count: 1, stance: { bull: 0, hold: 0, bear: 0, mine: null }, faces: [], messages: [], hasMore: false, loading: false, slowUntil: 0 };
const hotRow = (key: string, name: string, count: number, stance: [number, number, number], faces = roomFaces) => ({ key, profile: { name, logo: null, site: 'gmgn' }, count, stance: { bull: stance[0], hold: stance[1], bear: stance[2] }, faces });
const hot = {
  rising: [{ ...hotRow(roomKey, 'CASHCAT', 23, [14, 6, 3]), rise: 15 }, { ...hotRow(otherKey, data.views[1]!.name, 41, [9, 9, 12]), rise: 12 }],
  top: [hotRow('token:Solana:So11111111111111111111111111111111111111112', 'WIF', 186, [80, 30, 40]), hotRow(otherKey, data.views[1]!.name, 41, [9, 9, 12]), hotRow(roomKey, 'CASHCAT', 23, [14, 6, 3]), hotRow('token:Base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', 'DEGEN', 4, [1, 1, 1], [])],
  at: now,
};
const invites = scene === 'invites' ? [
  { id: 'i1', invitationReward: null, team: { id: 'whale', name: '鲸鱼观察', avatarId: null, memberCount: 12 }, from: roomPeople[0]!, createdAt: now - 3_600_000, expiresAt: now + 6 * 86_400_000 },
  { id: 'i2', invitationReward: null, team: { id: 'meme', name: 'Meme 研究所', avatarId: null, memberCount: 48 }, from: roomPeople[1]!, createdAt: now - 2 * 86_400_000, expiresAt: now + 86_400_000 },
] : [];
const rooms = {
  summaries: { [roomKey]: { key: roomKey, profile: { name: 'CASHCAT', logo: null, site: 'gmgn' }, count: 23, stance: roomStance, faces: roomFaces, at: now } },
  blocked: scene === 'blocked' ? [stranger('toshi-0x52aa', 'Toshi'), stranger('ivy-0xa8f0', 'Ivy')] : [], invites, acceptInvites: params.get('accept') !== '0', avatars: {},
} satisfies RuntimeState['rooms'];
const defaultClicks: Record<string, string> = { room: '弹幕 23', 'room-slow': '弹幕 23', 'room-empty': '弹幕 23', hot: '团队菜单,热门', invite: '弹幕 23,Kenji,邀请进小队' };
/** Clicks through the UI by visible text or aria-label: `clicks=设置,隐私与权限`. */
const clicks = (params.get('clicks') ?? defaultClicks[scene] ?? '').split(',').filter(Boolean);
async function clickThrough() {
  for (const label of clicks) {
    await new Promise(resolve => setTimeout(resolve, 400));
    const nodes = [...document.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="tab"]')];
    (nodes.find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label) ?? nodes.find(node => node.querySelector('strong')?.textContent?.trim() === label))?.click();
  }
}
if (clicks.length) void clickThrough();

function Review() {
  const cache = useRef({ bytes: 12_345_678, reads: 0, clears: 0 });
  const signalConfig = useRef(defaultSignalSettings);
  const [state, setState] = useState<RuntimeState>({
    revision: 0, ready: true, authenticated: true, connection: { networkOnline: params.get('offline') !== '1', service: 'ready', messaging: 'ready', retrying: false },
    account: { id: data.self, nickname: '测试成员', bio: '', tags: data.people.find(person => person.id === data.self)?.tags ?? [], avatarId: null, matrixId: '@review:example.test', revision: 0, acceptTeamInvites: params.get('accept') !== '0' }, data,
    toggles: { share: web.share && on.includes('share'), interact: web.interact && on.includes('interact') },
    drafts: scene === 'ref' ? { night: { value: { text: '这里量很大', ref: { target: { kind: 'quote', exact: '24h 成交额 $1.2M，持有人 3,412', prefix: '', suffix: '' }, caption: '24h 成交额 $1.2M，持有人 3,412', view: data.views[0]! } }, revision: 1 } } as never : scene === 'draft' ? { night: { value: { text: '看这个', attachment: { kind: 'asset', assetId: 'page-github', view: data.views.at(-1)! } }, revision: 1 } } as never : {},
    rooms,
    preferences: { rooms: { off: params.get('rooms') === 'off' }, web, current: 'night', notifications: params.get('notify') === 'off' ? 'off' : 'all', notificationPreview: true, interaction: defaultInteraction, hiddenStickies: scene === 'stickies' ? ['k5'] : [] },
    remoteTeams: [], lobbyTeams, config: { websiteUrl: 'https://example.test', signupDifficulty: 0 },
    items: { stickies } as never, invitations: {},
    pokes: scene === 'chat' || scene === 'pokes' ? [{ id: 'p1', teamId: 'night', from: 'mia', view: data.views[0]!, at: now, count: 2 }, { id: 'p2', teamId: 'night', from: 'kai', view: data.views[1]!, at: now - 5000, count: 1 }] : [],
  } as RuntimeState);
  // 切换在看: the user hops between the shared pages so the strip reorders and faces move between cards.
  React.useEffect(() => {
    if (scene !== 'switch') return;
    const order = ['cashcat', 'x', 'pons']; let step = 0;
    const timer = setInterval(() => { const next = order[step++ % order.length]!; setState(old => ({ ...old, data: { ...old.data, people: old.data.people.map(person => person.id === old.data.self || person.id === 'mia' && step % 2 ? { ...person, viewing: next } : person) } })); }, 1400);
    return () => clearInterval(timer);
  }, []);
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(defaultDanmakuSettings);
  const command: LivePort['command'] = useCallback(async <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => {
    if (name === 'signal-settings-get') return signalConfig.current as T;
    if (name === 'signal-sites-get') return {} as T;
    if (name === 'signal-settings') { signalConfig.current = normalizeSignalSettings({ ...signalConfig.current, ...(payload?.settings as object) }); return signalConfig.current as T; }
    if (name === 'devices') return { devices: [{ id: 'review-current', label: 'Chrome · This device', createdAt: now, current: true }, { id: 'review-other', label: 'A second device with a deliberately long descriptive name', createdAt: now - 86_400_000, current: false }] } as T;
    if (name === 'cache-usage') {
      if (scene === 'cache-read-error' && cache.current.reads++ === 0) throw new Error('Synthetic cache read failure');
      return { bytes: cache.current.bytes } as T;
    }
    if (name === 'clear-cache') {
      if (scene === 'cache-clear-error' && cache.current.clears++ === 0) throw new Error('Synthetic cache clear failure');
      cache.current.bytes = 0;
      return { bytes: 0 } as T;
    }
    if (name === 'toggle') setState(old => ({ ...old, toggles: { share: old.preferences.web.share && (typeof payload?.share === 'boolean' ? payload.share : old.toggles.share), interact: old.preferences.web.interact && (typeof payload?.interact === 'boolean' ? payload.interact : old.toggles.interact) } }));
    if (name === 'profile') setState(old => ({ ...old, account: { ...old.account!, nickname: String(payload?.name), bio: String(payload?.bio ?? ''), tags: payload?.tags as NonNullable<RuntimeState['account']>['tags'] }, data: { ...old.data, people: old.data.people.map(person => person.id === data.self ? { ...person, name: String(payload?.name), bio: String(payload?.bio ?? ''), tags: payload?.tags as NonNullable<RuntimeState['account']>['tags'] } : person) } }));
    if (name === 'preferences') setState(old => { const preferences = { ...old.preferences, ...payload }; return { ...old, preferences, toggles: { share: old.toggles.share && preferences.web.share, interact: old.toggles.interact && preferences.web.interact } }; });
    const key = String(payload?.key ?? '');
    const setRooms = (update: (rooms: RuntimeState['rooms']) => Partial<RuntimeState['rooms']>) => setState(old => ({ ...old, rooms: { ...old.rooms, ...update(old.rooms) } }));
    if (name === 'room-settings') { setState(old => ({ ...old, preferences: { ...old.preferences, rooms: { off: payload?.off === true } } })); setRooms(rooms => payload?.off ? { pinned: undefined, leased: undefined, current: undefined } : rooms); }
    if (name === 'room-open') setRooms(rooms => ({ pinned: key, leased: key, current: rooms.current?.key === key ? rooms.current : roomFor(key) }));
    if (name === 'room-close') setRooms(() => ({ pinned: undefined }));
    if (name === 'room-send') { const message = roomLine(`r${Date.now()}`, roomPeople[4]!, String(payload?.text), 0); setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: [...rooms.current.messages, message], slowUntil: Date.now() + 5_000 } } : {}); return { message } as T; }
    if (name === 'room-retract') setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: rooms.current.messages.filter(message => message.id !== payload?.id) } } : {});
    if (name === 'room-report') { setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: rooms.current.messages.map(message => message.id === payload?.id ? { ...message, reported: true } : message) } } : {}); return {} as T; }
    if (name === 'room-stance') {
      const value = payload?.value as Stance | null;
      const vote = (stance: RoomStance) => { const next = { ...stance }; if (next.mine) next[next.mine] -= 1; if (value) next[value] += 1; next.mine = value; return next; };
      setRooms(rooms => ({ current: rooms.current?.key === key ? { ...rooms.current, stance: vote(rooms.current.stance) } : rooms.current, summaries: rooms.summaries[key] ? { ...rooms.summaries, [key]: { ...rooms.summaries[key]!, stance: vote(rooms.summaries[key]!.stance) } } : rooms.summaries }));
    }
    if (name === 'room-summary') setRooms(rooms => rooms.summaries[key] ? {} : { summaries: { ...rooms.summaries, [key]: { ...roomFor(key), at: Date.now() } } });
    if (name === 'room-people') setRooms(() => ({ people: { key, count: 23, people: roomPeople.slice(0, 4) } }));
    if (name === 'room-hot' && payload?.chain !== undefined) { const chain = (payload?.chain as string | null) ?? ''; setRooms(rooms => ({ hot: { ...rooms.hot, [chain]: { ...hot, rising: chain && chain !== 'Robinhood' ? [] : hot.rising, top: hot.top.filter(row => !chain || row.key.startsWith(`token:${chain}:`)) } } })); }
    if (name === 'room-block') { const id = String(payload?.accountId); setRooms(rooms => ({ blocked: payload?.blocked ? [...rooms.blocked, roomPeople.find(person => person.id === id) ?? stranger(id, id)] : rooms.blocked.filter(person => person.id !== id) })); return {} as T; }
    if (name === 'invite-options') return { accepts: params.get('refuse') !== '1', teams: [{ teamId: 'night', state: 'can' }, { teamId: 'weekend', state: 'invited' }] } as T;
    if (name === 'invite-send') return {} as T;
    if (name === 'invite-accept' || name === 'invite-ignore') { setRooms(rooms => ({ invites: rooms.invites.filter(invite => invite.id !== payload?.id) })); return {} as T; }
    if (name === 'invite-settings') { setRooms(() => ({ acceptInvites: payload?.accept === true })); return {} as T; }
    if (name === 'danmaku-settings') setDanmakuSettings(old => normalizeDanmakuSettings({ ...old, ...(payload?.settings as object) }));
    return undefined as T;
  }, []);
  const [, setGrantTick] = useState(0);
  React.useEffect(() => { const tick = () => setGrantTick(n => n + 1); added.add(tick); removed.add(tick); return () => { added.delete(tick); removed.delete(tick); }; }, []);
  const site = grants.origins.has('https://gmgn.ai/*') || grants.origins.has('<all_urls>');
  // Derived the way the background derives it: the page runs 互动 when the site is granted and 网页互动 is 启用 and switched on.
  const interactive = site && state.preferences.web.interact && state.toggles.interact && interactionAllows(state.preferences.interaction);
  // Chrome gives the tab's address with 读取您的浏览记录, for an allowed site, or for the activeTab tab.
  const active = params.get('active') === '1';
  const known = active || site || grants.permissions.has('tabs');
  const page = { tabId: 1, signalEnabled: interactive && interactionAllows(state.preferences.interaction, 'signal'), stickyEnabled: interactive && interactionAllows(state.preferences.interaction, 'sticky'), missingStickies: scene === 'stickies' ? ['k4'] : [], windowId: 1, url: known ? gmgnPage : undefined, host: known ? 'gmgn.ai' : undefined, asset: known ? 'Robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4' : undefined, granted: site, interactive, tokenProfile: true, connected: interactive && params.get('layer') !== '0', access: { site, active: active && !site }, capabilities: pageCapabilities({ id: 1, url: known ? gmgnPage : undefined, status: 'complete' }, { site, active: active && !site }) } satisfies PageStatus;
  const initialPage = useRef(page);
  React.useEffect(() => {
    const page = initialPage.current;
    if (scene === 'chat') setSocialUi({ follow: { teamId: 'night', personId: 'robin' }, returnTo: { id: 1, origin: { ...page, url: 'https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571', host: 'fomo.family', asset: 'Robinhood:0x39dbed3a2bd333467115de45665cc57f813c4571' }, arrived: true, target: gmgnPage } });
    if (scene === 'follow-off') setSocialUi({ follow: { teamId: 'night', personId: 'lin' } });
    if (params.get('back') === '1') setSocialUi({ returnTo: { id: 1, origin: { ...page, url: 'https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571', host: 'fomo.family', asset: 'Robinhood:0x39dbed3a2bd333467115de45665cc57f813c4571' }, arrived: true, target: gmgnPage } });
    if (scene === 'add-site') setSocialUi({ site: { select: params.get('select')?.split(',').filter(Boolean) } });
    if (scene === 'grant') setSocialUi({ grant: params.get('target') === 'danmaku' ? 'danmaku' : 'interact' });
    if (scene === 'read') setSocialUi({ read: (params.get('read') ?? 'share') as ReadKey });
    if (scene === 'stickies' && params.get('sheet') !== '0') setSocialUi({ stickies: { asset: pageAsset, focus: params.get('focus') ?? undefined } });
  }, []);
  return <div style={{ height: '100dvh', width: `${params.get('w') ?? 380}px`, boxShadow: '1px 0 0 #ddd', transform: 'translateZ(0)', overflow: 'hidden' }}><PalsideApp data={state.data} sites={demoSites} live={{ state, command, openPage: async () => {}, page, danmaku: danmakuSettings } as LivePort} deliver={async () => {}} /></div>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
