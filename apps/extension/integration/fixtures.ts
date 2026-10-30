import { siteCatalog } from '../src/features/palside/settings/site-catalog';
import type { Dataset } from '../src/runtime/composition/dataset';
import type { TeamSnapshot } from '@palside/shared/contracts/team-model';

const fixtureNow = Date.now();
const day = 24 * 60 * 60 * 1000;

/** Local, fictional review data. No account, market, network or encryption assertion. */
export const palsideFixtures: Dataset = {
  self: 'you',
  views: [
    { id: 'cashcat', name: 'CASHCAT', kind: 'asset', chain: 'Robinhood', source: 'GMGN', address: '0x020bfc650a365f8bb26819deaabf3e21291018b4', url: 'https://gmgn.ai/robinhood/token/0x020bfc650a365f8bb26819deaabf3e21291018b4', color: '#ffe3a0', glyph: 'cat' },
    { id: 'pons', name: 'PONS', kind: 'asset', chain: 'Robinhood', source: 'FOMO', address: '0x39dbed3a2bd333467115de45665cc57f813c4571', url: 'https://fomo.family/tokens/robinhood/0x39dbed3a2bd333467115de45665cc57f813c4571', color: '#f7bed0', glyph: 'P' },
    { id: 'x', name: 'X', kind: 'website', source: 'x.com', url: 'https://x.com', color: '#29292d', glyph: 'X' },
  ],
  people: [
    { id: 'you', name: '你', tags: [{ preset: 'short-term' }], color: '#e5e6e9', viewing: 'pons' },
    { id: 'robin', name: 'Robin', bio: '只看 Base 新币', tags: [{ preset: 'short-term' }, { preset: 'base' }], color: '#d5e6e0', viewing: 'cashcat', presence: 'away' },
    { id: 'mia', name: 'Mia', tags: [{ preset: 'meme' }, { preset: 'on-chain' }, { preset: 'long-term' }], color: '#efddd3', viewing: 'pons', presence: 'active' },
    { id: 'leo', name: 'Leo', color: '#dae4f1', viewing: 'x' },
    { id: 'kai', name: 'Kai', color: '#e5ddf1', viewing: 'cashcat', presence: 'active' },
    { id: 'luna', name: 'Luna', color: '#efdec0', viewing: 'cashcat' },
    { id: 'lin', name: 'Lin', color: '#d4e9e7' },
    { id: 'max', name: 'Max', color: '#e7e1d8' },
    { id: 'alice', name: 'Alice', color: '#f1dce5' },
    { id: 'ben', name: 'Ben', color: '#dce6f1' },
  ],
  teams: [
    { id: 'night', name: '夜猫看币小队', description: '一起看币，交换一点新发现。', owner: 'you', memberIds: ['you', 'robin', 'mia', 'leo', 'kai', 'luna', 'lin', 'max'], joined: true, published: false, muted: false, unread: 0 },
    { id: 'weekend', name: '周末研究小组', description: '慢慢看，一起聊。', owner: 'mia', memberIds: ['you', 'mia', 'leo'], joined: true, published: false, muted: false, unread: 2 },
    { id: 'lab', publishedAt: fixtureNow - day, recruitmentExpiresAt: fixtureNow + 6 * day, name: '链上观察室', description: '分享公开资料，理性讨论。', owner: 'robin', memberIds: ['robin', 'kai', 'luna'], joined: false, published: true, muted: false, unread: 0 },
    { id: 'garden', publishedAt: fixtureNow - 4 * day, recruitmentExpiresAt: fixtureNow + 3 * day, name: '链上花园', description: '新项目，也可以慢慢研究。', owner: 'mia', memberIds: ['mia', 'leo'], joined: false, published: true, muted: false, unread: 0 },
    { id: 'sol-watch', name: 'Solana 观察小队', description: '一起发现链上新动态，交流公开资料。', owner: 'leo', memberIds: ['leo', 'max', 'lin'], joined: false, published: true, publishedAt: fixtureNow - 2 * day, recruitmentExpiresAt: fixtureNow + 5 * day, muted: false, unread: 0 },
    { id: 'base-club', name: 'Base 研究小组', description: '分享项目资料和阅读笔记。', owner: 'kai', memberIds: ['kai', 'lin'], joined: false, published: true, publishedAt: fixtureNow - 3 * day, recruitmentExpiresAt: fixtureNow + 4 * day, muted: false, unread: 0 },
  ],
  messages: [
    { id: 'n1', teamId: 'night', author: 'robin', text: '我在 GMGN 看 CASHCAT。', time: '14:28', status: 'sent' },
    { id: 'n2', teamId: 'night', author: 'mia', text: '我在看 PONS，发给你们看看。', attachment: { kind: 'asset', assetId: 'pons' }, time: '14:29', status: 'sent' },
    { id: 'n3', teamId: 'night', author: 'leo', text: '我去看看社区消息。', time: '14:30', status: 'sent' },
    { id: 'n4', teamId: 'night', author: 'robin', text: '@Mia 我打开了，聊聊你看到的。', replyTo: 'n2', time: '14:31', status: 'sent' },
    { id: 'n5', teamId: 'night', author: 'you', text: '我也在看这个。', time: '14:32', status: 'sent' },
    { id: 'w1', teamId: 'weekend', author: 'mia', text: '这个周末一起看看新项目？', time: '13:10', status: 'sent' },
    { id: 'w2', teamId: 'weekend', author: 'leo', text: '好呀，资料可以先发在这里。', time: '13:12', status: 'sent' },
  ],
  requests: [{ createdAt: fixtureNow, expiresAt: fixtureNow + 7 * day, id: 'a1', personId: 'alice', teamId: 'night', text: '想和大家一起交流新项目。' }, { createdAt: fixtureNow, expiresAt: fixtureNow + 7 * day, id: 'a2', personId: 'ben', teamId: 'night', text: '一起看币，分享资料。' }],
};
// Like real messages, every sample carries its send time, a minute apart and oldest first.
palsideFixtures.messages.forEach((message, index, all) => { message.timestamp ??= fixtureNow - (all.length - index) * 60_000; });
for (const message of palsideFixtures.messages) if (message.attachment?.kind === 'asset') { const view = palsideFixtures.views.find(view => message.attachment?.kind === 'asset' && view.id === message.attachment.assetId); if (view) message.attachment.view = { ...view }; }
export const demoSites = siteCatalog;

/** A complete server team record; reviews override only the fields their scenario is about. */
export function remoteTeam(fields: Partial<TeamSnapshot> & Pick<TeamSnapshot, 'id' | 'roomId'>): TeamSnapshot {
  return { reason: null, revision: 0, inviteSuspended: false, membersCanInvite: true, name: '', description: '', ownerId: 'you', avatarId: null, memberCount: null, joined: true, publishedAt: null, recruitmentExpiresAt: null, retentionDays: 30, memberIds: [], people: [], periods: [{ joinedAt: 0, leftAt: null }], preferences: { muted: false, readIds: [], revision: 0 }, requests: [], bans: [], transfer: null, ...fields };
}
