import { DAY_MS, HOUR_MS, MINUTE_MS } from '@palside/shared/units';
import { IntegrationIntl } from './intl';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from '../src/features/palside/app/palside-app';
import { setSocialUi, type ReadKey } from '../src/features/palside/annotations/social-state';
import { palsideFixtures } from './fixtures';
import { DanmakuShell, demoPage, demoRooms, demoTabs, demoTalk, type DemoTab } from './danmaku-demo';
import { demoPacket, demoWallet, demoWalletCommand } from './danmaku-wallet';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import type { LivePort } from '../src/features/palside/app/live-port';
import { pageCapabilities } from '../src/runtime/browser/page-capabilities';
import { defaultDanmakuSettings, normalizeDanmakuSettings, type DanmakuSettings, type PageStatus } from '../src/runtime/browser/page-protocol';
import { defaultSignalSettings, normalizeSignalSettings } from '../src/runtime/annotations/signals';
import { ALL_SITES, danmakuOn, defaultSiteInteraction, siteAllows, type SiteInteractions } from '../src/domain/annotations/interaction';
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
// The background's permission reads, answered from the same grants, so 已允许 shows as it would in the extension.
const chromeRuntime = chromeHost.chrome as { runtime?: { sendMessage?: unknown } } | undefined;
if (chromeRuntime && !chromeRuntime.runtime?.sendMessage) chromeRuntime.runtime = {
  ...chromeRuntime.runtime,
  sendMessage: async ({ command }: { command: { name: string } }) => command.name === 'permissions-get'
    ? { ok: true, value: { origins: [...grants.origins], tabs: grants.permissions.has('tabs'), notifications: grants.permissions.has('notifications'), tabGroups: false , site: false } }
    : command.name === 'permissions-sync' ? { ok: true } : undefined,
};
const scene = params.get('scene') ?? 'chat';
// tour=1 runs the first-run tour (every other scene starts as already toured).
// 设置 › 网页: share=0 / interact=0 禁用 the feature. Composer switch: on=share turns it on; active=1 shows the tab's
// address as activeTab would without the site; notify=off|denied.
/** `interact=0`: 网页互动 is off on gmgn.ai; `share=0` keeps the share key up. */
const siteInteraction: SiteInteractions = { ...(params.get('interact') === '0' ? { 'gmgn.ai': { ...defaultSiteInteraction, on: false } } : {}), ...(params.get('rooms') === 'off' ? { [ALL_SITES]: { ...defaultSiteInteraction, danmaku: false } } : {}) };
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
// scene=call: 喊来看 — Robin calls everyone to PONS, Kai calls you to X, and you call Mia to CASHCAT, beside a 转账, a page card and a 红包.
if (scene === 'call') {
  data.messages = data.messages.filter(message => message.id !== 'n7');
  data.messages.push({ id: 'c1', teamId: 'night', author: 'robin', text: '', call: 'all', mentionIds: ['robin', 'mia', 'leo', 'kai', 'luna', 'you'].filter(id => id !== 'robin'), timestamp: now - MINUTE_MS, attachment: { kind: 'asset', assetId: 'pons', view: data.views[1]! }, time: '14:35', status: 'sent' });
  data.messages.push({ id: 'c3', teamId: 'night', author: 'kai', text: '', call: 'one', mentionIds: [data.self], timestamp: now - 40_000, attachment: { kind: 'asset', assetId: 'x', view: data.views[2]! }, time: '14:35', status: 'sent' });
  data.messages.push({ id: 'c2', teamId: 'night', author: 'you', text: '', call: 'one', mentionIds: ['mia'], timestamp: now - 20_000, attachment: { kind: 'asset', assetId: 'cashcat', view: data.views[0]! }, time: '14:36', status: 'sent' });
}
// scene=site-faces: 共享在看 on sites outside the catalog, named by their domain — a coloured mark, a white mark and a full square icon.
if (scene === 'site-faces') {
  const svg = (body: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
  const site = (id: string, host: string, logo: string) => data.views.push({ id, name: host, kind: 'website', disclosure: 'site', source: host, url: `https://${host}`, color: '#e9edf0', glyph: host[0]!.toUpperCase(), logo });
  site('site-mark', 'drpc.org', svg('<path d="M6 6l20 10-20 10z" fill="#3ddc84"/>'));
  site('site-white', 'robin.etherscan.io', svg('<circle cx="16" cy="16" r="14" fill="#fff"/><path d="M10 20v-4M15 20v-8M20 20v-6" stroke="#9aa" stroke-width="3"/>'));
  site('site-full', 'tile.example', svg('<rect width="32" height="32" fill="#5b5bd6"/><path d="M8 22l8-12 8 12z" fill="#fff"/>'));
  const viewing: Record<string, string> = { robin: 'site-mark', mia: 'site-white', kai: 'site-full' };
  data.people = data.people.map(person => viewing[person.id] ? { ...person, viewing: viewing[person.id] } : person);
}
const gmgnPage = 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4';
// Top slot states: away=1 opens the team with unread tokens
// (你不在时 divider), offline=1 drops the network (the connection card takes the slot), outdated=1 is a version the service refuses
// (需要更新). update=0.1.4: Chrome has downloaded that version (the dot on ⋯ and 更新到 x).
if (params.get('away') === '1') data.teams.find(team => team.id === 'night')!.unread = 4;
// 添加网站: `select=a.com,b.com` preselects tiles. grant: the sheet for an unauthorized site.
// 添加小队: two recruiting teams, one pending and one declined join request.
const lobbyTeam = (id: string, name: string, extra: Partial<RuntimeState['data']['teams'][number]>) => ({ id, name, description: '', owner: `owner-${id}`, ownerName: '安师大', memberIds: [], memberCount: 2, joined: false, published: true, muted: false, unread: 0, publishedAt: now, recruitmentExpiresAt: now + DAY_MS, ...extra });
const lobbyTeams = scene === 'lobby' ? [
  lobbyTeam('l1', '啊啊', { description: '一起看新币，晚上活跃' }),
  lobbyTeam('l2', '币圈夜话', { ownerName: '老王', memberCount: 12, requested: true, applicationStatus: 'pending', applicationExpiresAt: now + DAY_MS }),
  lobbyTeam('l3', '链上侦探', { published: false, applicationStatus: 'rejected', applicationExpiresAt: now + DAY_MS }),
] : [];
if (scene === 'start') {
  data.messages = data.messages.filter(message => message.teamId !== 'night');
  const night = data.teams.find(team => team.id === 'night')!;
  night.owner = data.self;
  night.memberIds = [data.self];
}
if (scene === 'shared-tokens') data.messages.forEach((message, index) => { message.timestamp = now - index * HOUR_MS; });
const pageAsset = 'Robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4';
// 弹幕: scene=room opens CASHCAT's 弹幕 (room-slow: just spoke; room-empty: nobody has spoken); hot = 热门; invites = two received
// team invites in 添加小队; invite = the invite sheet for Kenji; detail = 代币详情 with 在看; blocked = 已屏蔽; rooms=off switches 参与弹幕 off.
const roomKey = `token:${pageAsset}`;
const otherKey = 'token:Robinhood:0x39dbed3a2bd333467115de45665cc57f813c4571';
// Strangers carry a synthetic 零钱 address, so their cards and rows show an account ID like everyone else's.
const stranger = (id: string, nickname: string) => ({ wallet: `0x${[...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(5)}`, id, nickname, avatarId: null });
const roomPeople = [stranger('kenji-0x91c4', 'Kenji'), stranger('zed-0x3c2a', 'Zed'), stranger('nova-0x7e10', 'Nova'), { wallet: null, id: 'robin', nickname: 'Robin', avatarId: null }, { wallet: null, id: data.self, nickname: '测试成员', avatarId: null }];
const roomLine = (id: string, author: (typeof roomPeople)[number], text: string, ago: number, extra = {}) => ({ id, key: roomKey, author, text, folded: false, reported: false, createdAt: now - ago * MINUTE_MS, ...extra });
const roomFaces = roomPeople.slice(0, 3);
// 打赏: Kenji's line tipped by you, Robin's by three people, Zed's by Nova.
const pals = (amount: number) => String(BigInt(amount) * 10n ** 18n);
const tipGroup = (id: string, messageId: string, accountIds: string[], amount: number) => ({ id, messageId, roomKey, recipientId: 'x', accountIds, amount: pals(amount), startedAt: now, updatedAt: now });
const roomMessages = scene === 'room-empty' ? [] : [roomLine('r1', roomPeople[0]!, '池子刚加了一倍', 9, { tips: [tipGroup('t1', 'r1', [data.self], 2)] }), roomLine('r2', roomPeople[3]!, '跟上了，看 5 分钟线', 7, { tips: [tipGroup('t2', 'r2', ['kenji-0x91c4', 'zed-0x3c2a', data.self], 30)] }), roomLine('r3', roomPeople[1]!, 'dev 钱包刚卖了一部分，注意', 5, { tips: [tipGroup('t3', 'r3', ['nova-0x7e10'], 5)] }), roomLine('r4', roomPeople[2]!, '这币要拉 10 倍，私聊带你', 4, { folded: true }), roomLine('r5', roomPeople[4]!, '哪个钱包', 1)];
// 点赞: two lines others liked, one of them by you, and your own line liked by one.
const roomLikes = scene === 'room-empty' ? {} : { r2: { count: 12, liked: true }, r3: { count: 3, liked: false }, r5: { count: 1, liked: false } };
const roomFor = (key: string) => key === roomKey
  ? { key, site: 'gmgn', count: 23, faces: roomFaces, messages: roomMessages, likes: roomLikes, hasMore: false, loading: false, slowUntil: scene === 'room-slow' ? now + 4_000 : 0, slowMs: 5_000 }
  : { key, site: null, count: 1, faces: [], messages: [], hasMore: false, loading: false, slowUntil: 0, slowMs: 5_000 };
/** Hot-board names come from the token directory, as in production. */
const hotNames: Record<string, { name: string }> = {};
const hotRow = (key: string, name: string, count: number, faces = roomFaces) => (hotNames[key.slice('token:'.length)] = { name }, { key, site: 'gmgn', count, faces });
// One live board: rows that climbed in the last minutes carry rise.
const hotRows = [hotRow('token:Solana:So11111111111111111111111111111111111111112', 'WIF', 186), { ...hotRow(otherKey, data.views[1]!.name, 41), rise: 12 }, { ...hotRow(roomKey, 'CASHCAT', 23), rise: 15 }, hotRow('token:Base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', 'DEGEN', 4, [])];
const invites = scene === 'invites' ? [
  { id: 'i1', team: { id: 'whale', name: '鲸鱼观察', avatarId: null, memberCount: 12 }, from: roomPeople[0]!, createdAt: now - HOUR_MS, expiresAt: now + 6 * DAY_MS },
  { id: 'i2', team: { id: 'meme', name: 'Meme 研究所', avatarId: null, memberCount: 48 }, from: roomPeople[1]!, createdAt: now - 2 * DAY_MS, expiresAt: now + DAY_MS },
] : [];
const rooms = {
  // The tab shows CASHCAT on gmgn.ai, an added site, so 弹幕 follows it — unless 弹幕 is off there (`interact=0`) or everywhere (`rooms=off`).
  ...(siteAllows(siteInteraction, 'gmgn.ai', 'danmaku') ? { tab: roomKey, leased: roomKey, current: roomFor(roomKey) } : {}),
  summaries: { [roomKey]: { key: roomKey, site: 'gmgn', count: 23, faces: roomFaces, at: now } },
  blocked: scene === 'blocked' ? [stranger('toshi-0x52aa', 'Toshi'), stranger('ivy-0xa8f0', 'Ivy')] : [], invites, acceptInvites: params.get('accept') !== '0', avatars: {},
} satisfies RuntimeState['rooms'];
// 弹幕 is reached the way a person does: 弹 opens the line in the composer, ⌃ the sheet, ↗ the full view.
const openDanmaku = '发弹幕,查看弹幕,打开弹幕页';
const defaultClicks: Record<string, string> = { room: openDanmaku, 'room-slow': openDanmaku, 'room-empty': openDanmaku, hot: '团队菜单,热门', interaction: '小队菜单,个人设置,网页互动', invite: `${openDanmaku},Kenji,邀请进小队` };
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
    revision: 0, ready: true, authenticated: true, connection: { networkOnline: params.get('offline') !== '1', service: params.get('service') === 'down' ? 'unavailable' : 'ready', messaging: params.get('messaging') === 'down' ? 'unavailable' : 'ready', retrying: false, outdated: params.get('outdated') === '1' },
    account: { wallet: null, id: data.self, nickname: '测试成员', bio: '', tags: data.people.find(person => person.id === data.self)?.tags ?? [], avatarId: null, matrixId: '@review:example.test', revision: 0, acceptTeamInvites: params.get('accept') !== '0' }, data,
    drafts: scene === 'ref' ? { night: { value: { text: '这里量很大', ref: { target: { kind: 'quote', exact: '24h 成交额 $1.2M，持有人 3,412', prefix: '', suffix: '' }, caption: '24h 成交额 $1.2M，持有人 3,412', view: data.views[0]! } }, revision: 1 } } as never : scene === 'draft' ? { night: { value: { text: '看这个', attachment: { kind: 'asset', assetId: 'page-github', view: data.views.at(-1)! } }, revision: 1 } } as never : {},
    rooms, tokens: hotNames,
    preferences: { toured: params.get('tour') !== '1', rooms: {}, share: params.get('share') !== '0' && on.includes('share'), siteInteraction, current: 'night', notifications: params.get('notify') === 'off' ? 'off' : 'all', notificationPreview: true, hiddenStickies: scene === 'stickies' ? ['k5'] : [] },
    ...(scene === 'danmaku-panel' ? { wallet: demoWallet(now) } : {}),
    remoteTeams: [], lobbyTeams, config: { websiteUrl: 'https://example.test', signupDifficulty: 0 },
    invitations: {},
    // scene=signals: chat hints for pages this window is not showing (the panel is on gmgn's token page).
    signalRecords: scene === 'signals' ? [
      { id: '$sig-kai', teamId: 'night', personId: 'kai', kind: 'question', url: 'https://x.com/robinhoodapp/status/1', timestamp: now - 40_000, expiresAt: now + DAY_MS, target: { kind: 'page' } },
      { id: '$sig-mia', teamId: 'night', personId: 'mia', kind: 'danger', url: 'https://dexscreener.com/solana/So11111111111111111111111111111111111111112', timestamp: now - 4000, expiresAt: now + DAY_MS, target: { kind: 'page' } },
    ] as RuntimeState['signalRecords'] : [],
    // call: a 红包 and a 转账 sit in the same chat, so every card's width can be compared.
    ...(scene === 'call' ? { chainTeam: { teamId: 'night', nextCursor: null, transfers: [{ id: 'call-transfer', accountId: 'mia', recipientId: data.self, amount: String(20n * 10n ** 18n), status: 'confirmed', createdAt: now - 4 * MINUTE_MS, submittedAt: now - 4 * MINUTE_MS, confirmedAt: now - 4 * MINUTE_MS }],
      packets: [{ packet: { id: '0x' + 'f'.repeat(64), accountId: 'kai', kind: 'team', scope: 'night', status: 'active', count: 5, amount: String(25n * 10n ** 18n), claimedCount: 2, claimedAmount: String(10n * 10n ** 18n), createdAt: now - 3 * MINUTE_MS, expiresAt: now + HOUR_MS }, distribution: 'random', blessing: '周五收盘红包', eligibility: 'eligible', eligibleAt: null, myClaim: null, claims: [] }] } } as never : {}),
  } as RuntimeState);
  // scene=chat follows Robin; a moment later Robin moves to PONS, so the chip's follow mark moves and the chat shows 去了.
  React.useEffect(() => {
    if (scene !== 'chat') return;
    const timer = setTimeout(() => setState(old => ({ ...old, data: { ...old.data, people: old.data.people.map(person => person.id === 'robin' ? { ...person, viewing: 'pons' } : person) } })), 800);
    return () => clearTimeout(timer);
  }, []);
  // 切换在看: the user hops between the shared pages so the strip reorders and faces move between cards.
  React.useEffect(() => {
    if (scene !== 'switch') return;
    const order = ['cashcat', 'x', 'pons']; let step = 0;
    const timer = setInterval(() => { const next = order[step++ % order.length]!; setState(old => ({ ...old, data: { ...old.data, people: old.data.people.map(person => person.id === old.data.self || person.id === 'mia' && step % 2 ? { ...person, viewing: next } : person) } })); }, 1400);
    return () => clearInterval(timer);
  }, []);
  // scene=danmaku-panel: the panel inside scene=danmaku-modes' browser window — tabs switch, 弹幕 and 红包 arrive live.
  const stateRef = useRef(state), commandRef = useRef<LivePort['command']>(undefined);
  useLayoutEffect(() => { stateRef.current = state; });
  const [tab, setTab] = useState<DemoTab>('cashcat');
  const demoCache = useRef(demoRooms(roomFor, roomKey, otherKey, roomPeople, now));
  const demoPackets = useRef(new Map(scene === 'danmaku-panel' ? [demoPacket(roomKey, 'kenji-0x91c4', '恭喜发财，CASHCAT 冲')].map(item => [item.packet.id, { ...item, packet: { ...item.packet, createdAt: now - 3 * MINUTE_MS } }]) : []));
  const demoEvent = useCallback((event: 'packet' | 'burst' | 'squad') => {
    if (event === 'squad') { setState(old => ({ ...old, data: { ...old.data, messages: [...old.data.messages, { id: `sq${Date.now()}`, teamId: 'night', author: 'mia', text: '你们看 CASHCAT 的弹幕了吗', time: '14:40', timestamp: Date.now(), status: 'sent' }] } })); return; }
    const key = stateRef.current.rooms.current?.key ?? roomKey;
    const sent = event === 'burst' ? [['nova-0x7e10', '新年快乐'], ['ivy-0xa8f0', '拿着买 CASHCAT'], ['toshi-0x52aa', '手慢无']] : [['zed-0x3c2a', '大家吃个红包']];
    sent.forEach(([who, wish], index) => { const packet = demoPacket(key, who!, wish!); demoPackets.current.set(packet.packet.id, { ...packet, packet: { ...packet.packet, createdAt: Date.now() + index } }); });
    void commandRef.current?.('wallet-room', { key });
  }, []);
  const goTab = useCallback((next: DemoTab) => { setTab(next); const key = demoTabs[next].key === 'cashcat' ? roomKey : demoTabs[next].key === 'pons' ? otherKey : undefined;
    setState(old => ({ ...old, rooms: { ...old.rooms, tab: key, leased: old.rooms.pinned ?? key, current: old.rooms.pinned ? old.rooms.current : key ? demoCache.current[key] : undefined } })); }, []);
  React.useEffect(() => {
    if (scene !== 'danmaku-panel') return;
    const first = setTimeout(() => setState(old => ({ ...old, rooms: { ...old.rooms, summaries: { ...old.rooms.summaries, [otherKey]: { key: otherKey, site: 'gmgn', count: 41, faces: roomFaces.slice(1), at: now } } } })));
    const timer = setInterval(() => setState(old => {
      const current = old.rooms.current; if (!current) return old;
      const message = demoTalk(current.key === roomKey, roomPeople, current.key);
      const next = { ...current, messages: [...current.messages, message] };
      demoCache.current[current.key] = next;
      return { ...old, rooms: { ...old.rooms, current: next } };
    }), 4200);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(defaultDanmakuSettings);
  const command: LivePort['command'] = useCallback(async <T,>(name: string, payload?: Record<string, unknown>): Promise<T> => {
    if (scene === 'danmaku-panel' && name.startsWith('wallet-')) return demoWalletCommand(name, payload, demoPackets.current as never, () => stateRef.current, setState, data.self) as T;
    if (name === 'signal-settings-get') return signalConfig.current as T;
    if (name === 'signal-sites-get') return {} as T;
    if (name === 'signal-settings') { signalConfig.current = normalizeSignalSettings({ ...signalConfig.current, ...(payload?.settings as object) }); return signalConfig.current as T; }
    if (name === 'devices') return { devices: [{ id: 'review-current', label: 'Chrome · This device', createdAt: now, current: true }, { id: 'review-other', label: 'A second device with a deliberately long descriptive name', createdAt: now - DAY_MS, current: false }] } as T;
    if (name === 'cache-usage') {
      if (scene === 'cache-read-error' && cache.current.reads++ === 0) throw new Error('Synthetic cache read failure');
      return { bytes: cache.current.bytes } as T;
    }
    if (name === 'clear-cache') {
      if (scene === 'cache-clear-error' && cache.current.clears++ === 0) throw new Error('Synthetic cache clear failure');
      cache.current.bytes = 0;
      return { bytes: 0 } as T;
    }
    if (name === 'toggle') { const share = payload?.share === true; setState(old => ({ ...old, preferences: { ...old.preferences, share } })); return { share } as T; }
    if (name === 'profile') setState(old => ({ ...old, account: { ...old.account!, nickname: String(payload?.name), bio: String(payload?.bio ?? ''), tags: payload?.tags as NonNullable<RuntimeState['account']>['tags'] }, data: { ...old.data, people: old.data.people.map(person => person.id === data.self ? { ...person, name: String(payload?.name), bio: String(payload?.bio ?? ''), tags: payload?.tags as NonNullable<RuntimeState['account']>['tags'] } : person) } }));
    if (name === 'preferences') setState(old => ({ ...old, preferences: { ...old.preferences, ...payload } }));
    const key = String(payload?.key ?? '');
    const setRooms = (update: (rooms: RuntimeState['rooms']) => Partial<RuntimeState['rooms']>) => setState(old => ({ ...old, rooms: { ...old.rooms, ...update(old.rooms) } }));
    // 弹幕 switched off in 网页互动 drops the room, as the runtime does.
    if (name === 'preferences' && payload?.siteInteraction && !danmakuOn(payload.siteInteraction as SiteInteractions)) setRooms(() => ({ pinned: undefined, leased: undefined, current: undefined }));
    if (name === 'room-open') setRooms(rooms => ({ pinned: key, leased: key, current: rooms.current?.key === key ? rooms.current : demoCache.current[key] ?? roomFor(key) }));
    if (name === 'room-close') setRooms(rooms => ({ pinned: undefined, leased: rooms.tab, current: rooms.tab ? demoCache.current[rooms.tab] ?? roomFor(rooms.tab) : undefined }));
    if (name === 'room-send') { const message = { ...roomLine(`r${Date.now()}`, roomPeople[4]!, String(payload?.text), 0), key: String(stateRef.current.rooms.current?.key ?? roomKey) }; setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: [...rooms.current.messages, message], slowUntil: Date.now() + 5_000 } } : {}); return { message } as T; }
    if (name === 'room-retract') setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: rooms.current.messages.filter(message => message.id !== payload?.id) } } : {});
    if (name === 'room-report') { setRooms(rooms => rooms.current ? { current: { ...rooms.current, messages: rooms.current.messages.map(message => message.id === payload?.id ? { ...message, reported: true } : message) } } : {}); return {} as T; }
    if (name === 'room-like') {
      const id = String(payload?.id), liked = payload?.liked === true;
      setRooms(rooms => { const current = rooms.current; if (current?.key !== key) return {}; const old = current.likes?.[id] ?? { count: 0, liked: false }; return { current: { ...current, likes: { ...current.likes, [id]: { liked, count: old.count + (liked === old.liked ? 0 : liked ? 1 : -1) } } } }; });
      return { id, liked } as T;
    }
    if (name === 'room-summary') setRooms(rooms => rooms.summaries[key] ? {} : { summaries: { ...rooms.summaries, [key]: { ...roomFor(key), at: Date.now() } } });
    if (name === 'room-people') setRooms(() => ({ people: { key, count: 23, people: roomPeople.slice(0, 4) } }));
    if (name === 'room-hot') setRooms(() => ({ hot: payload?.open ? { rows: hotRows, loaded: true } : undefined }));
    if (name === 'room-block') { const id = String(payload?.accountId); setRooms(rooms => ({ blocked: payload?.blocked ? [...rooms.blocked, roomPeople.find(person => person.id === id) ?? stranger(id, id)] : rooms.blocked.filter(person => person.id !== id) })); return {} as T; }
    if (name === 'invite-options') return { accepts: params.get('refuse') !== '1', teams: [{ teamId: 'night', state: 'can' }, { teamId: 'weekend', state: 'invited' }] } as T;
    if (name === 'invite-send') return {} as T;
    if (name === 'invite-accept' || name === 'invite-ignore') { setRooms(rooms => ({ invites: rooms.invites.filter(invite => invite.id !== payload?.id) })); return {} as T; }
    if (name === 'invite-settings') { setRooms(() => ({ acceptInvites: payload?.accept === true })); return {} as T; }
    if (name === 'danmaku-settings') setDanmakuSettings(old => normalizeDanmakuSettings({ ...old, ...(payload?.settings as object) }));
    return undefined as T;
  }, []);
  useLayoutEffect(() => { commandRef.current = command; });
  const [, setGrantTick] = useState(0);
  React.useEffect(() => { const tick = () => setGrantTick(n => n + 1); added.add(tick); removed.add(tick); return () => { added.delete(tick); removed.delete(tick); }; }, []);
  const site = grants.origins.has('https://gmgn.ai/*') || grants.origins.has('<all_urls>');
  // Derived the way the background derives it: the page runs 互动 when the site is granted and 网页互动 is on there.
  const interactive = site && siteAllows(state.preferences.siteInteraction ?? {}, 'gmgn.ai');
  // Chrome gives the tab's address with 读取您的浏览记录, for an allowed site, or for the activeTab tab.
  const active = params.get('active') === '1';
  const known = active || site || grants.permissions.has('tabs');
  const page = { tabId: 1, signalEnabled: site && siteAllows(state.preferences.siteInteraction ?? {}, 'gmgn.ai', 'signal'), windowId: 1, url: known ? gmgnPage : undefined, host: known ? 'gmgn.ai' : undefined, asset: known ? 'Robinhood:0x020bfc650a365f8bb26819deaabf3e21291018b4' : undefined, granted: site, interactive, connected: interactive && params.get('layer') !== '0', access: { site, active: active && !site }, capabilities: pageCapabilities({ id: 1, url: known ? gmgnPage : undefined, status: 'complete' }, { site, active: active && !site }) } satisfies PageStatus;
  React.useEffect(() => {
    if (scene === 'chat') setSocialUi({ follow: { teamId: 'night', personId: 'robin' } });
    if (scene === 'follow-off') setSocialUi({ follow: { teamId: 'night', personId: 'lin' } });
    if (scene === 'add-site') setSocialUi({ site: { select: params.get('select')?.split(',').filter(Boolean) } });
    if (scene === 'grant') setSocialUi({ grant: true });
    if (scene === 'read') setSocialUi({ read: (params.get('read') ?? 'share') as ReadKey });
  }, []);
  // The panel inside the demo's browser window (an iframe, so sheets, dialogs and toasts stay in the panel as in Chrome); the window drives it by messages.
  React.useEffect(() => {
    if (scene !== 'danmaku-panel') return;
    const listen = (event: MessageEvent) => {
      const message = event.data as { demo?: string; value?: unknown };
      if (message.demo === 'tab') goTab(message.value as DemoTab);
      if (message.demo === 'event') demoEvent(message.value as 'packet' | 'burst' | 'squad');
    };
    window.addEventListener('message', listen);
    window.parent.postMessage({ demoReady: true }, '*');
    return () => window.removeEventListener('message', listen);
  }, [goTab, demoEvent]);
  if (scene === 'danmaku-panel') return <div style={{ height: '100dvh', width: '100%', overflow: 'hidden' }}>
    <PalsideApp live={{ state, command, openPage: async () => {}, page: demoPage(tab, site, interactive, pageCapabilities), danmaku: danmakuSettings } as LivePort} />
  </div>;
  return <div style={{ height: '100dvh', width: `${params.get('w') ?? 380}px`, boxShadow: '1px 0 0 #ddd', transform: 'translateZ(0)', overflow: 'hidden' }}><PalsideApp live={{ state, command, openPage: async () => {}, page, danmaku: danmakuSettings, update: params.get('update') ? { ready: params.get('update')! } : undefined } as LivePort} /></div>;
}
createRoot(document.getElementById('root')!).render(scene === 'danmaku-modes' ? <DanmakuShell /> : <IntegrationIntl><Review /></IntegrationIntl>);
