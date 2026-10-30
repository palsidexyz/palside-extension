import { IntegrationIntl } from './intl';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideApp } from './preview-app';
import { palsideFixtures, demoSites } from './fixtures';
import type { Message } from '../src/domain/chat/model';
import type { LivePort } from '../src/features/palside/app/live-port';
import type { RuntimeState } from '../src/runtime/composition/runtime-state';
import { verifyChatArrival } from './verify-chat-arrival';
import { autoRun, reviewStatus } from './review-harness';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Exercises real product components with synthetic messages and no network commands.
const host = document.getElementById('root')!;
const root = createRoot(host);
const output = document.getElementById('result')!;
const checks: string[] = [];
const reports: string[][] = [];
let historyRequests = 0;
let serial = 0;
let finishSend: ((value: unknown) => void) | undefined;
let dark = false;
const wait = (ms = 420) => new Promise(resolve => setTimeout(resolve, ms));
const initialTime = Date.now() - 60_000;
const message = (id: string, patch: Partial<Message> = {}): Message => ({ id, teamId: 'night', author: 'mia', text: `历史记录 ${id.replace('m', '')} — 保持正在阅读的内容，不跳动。`, timestamp: initialTime + Number(id.replace(/^\D+/, '')) * 1000, time: '12:00', status: 'sent', ...patch });
const data = structuredClone(palsideFixtures);
data.self = `reading-review-${crypto.randomUUID()}`;
data.people = [...data.people.map(p => ({ ...p, viewing: undefined })), { id: data.self, name: '阅读验收', color: '#ddd' }];
data.teams = data.teams.slice(0, 2).map(t => ({ ...t, memberIds: [...t.memberIds, data.self], unread: 3 }));
data.messages = [...Array.from({ length: 30 }, (_, i) => message(`m${i}`, i === 18 ? { replyTo: 'm3' } : i === 3 ? { replyTo: 'm1' } : {})), ...Array.from({ length: 15 }, (_, i) => message(`other${i}`, { teamId: 'weekend' }))];
let state: RuntimeState = {
  revision: 0, ready: true, rooms: { summaries: {}, blocked: [], invites: [], acceptInvites: true, avatars: {} }, authenticated: true, connection: { networkOnline: true, service: 'ready', messaging: 'ready', retrying: false },
  account: { bio: '', tags: [], id: data.self, nickname: '阅读验收', avatarId: null, matrixId: '@reading:example.test', revision: 0, acceptTeamInvites: true }, data, toggles: { share: false, interact: false },
  drafts: {}, preferences: { web: { share: true, interact: true }, current: 'night', notifications: 'off' },
  remoteTeams: [], config: { websiteUrl: '', signupDifficulty: 0 }, invitations: {}, items: { stickies: [] }, history: { night: { missingKeys: 0, loaded: false, loading: false }, weekend: { missingKeys: 0, loaded: true, loading: false } },
};
const command: LivePort['command'] = async <T,>(name: string, payload?: Record<string, unknown>) => {
  if (name === 'visible') { reports.push(payload?.ids as string[]); return undefined as T; }
  if (name === 'history') {
    historyRequests += 1;
    state = { ...state, history: { ...state.history, night: { ...(state.history?.night ?? { missingKeys: 0, loaded: false, loading: false }), loading: true } } };
    render(); await wait(30); history();
    state = { ...state, history: { ...state.history, night: { ...(state.history?.night ?? { missingKeys: 0, loaded: false, loading: false }), loading: false } } };
    render(); return {} as T;
  }
  if (name === 'preferences') { state = { ...state, preferences: { ...state.preferences, ...payload } }; render(); }
  if (name === 'draft') { const teamId = String(payload?.teamId); state = { ...state, drafts: { ...state.drafts, [teamId]: { revision: Number(payload?.revision) + 1, updatedAt: Date.now(), value: { ...state.drafts[teamId]?.value, ...payload?.patch as object, text: String((payload?.patch as { text?: string })?.text ?? '') } } } }; render(); }
  if (name === 'send') {
    const sending = payload?.message as Message;
    updateMessages([...state.data.messages, sending]);
    return new Promise<T>(resolve => { finishSend = value => { updateMessages(state.data.messages.map(m => m.id === sending.id ? { ...m, status: 'sent' } : m)); resolve(value as T); }; });
  }
  return {} as T;
};
function render() { root.render(<IntegrationIntl><PalsideApp data={state.data} sites={demoSites} live={{ state, command, openPage: async () => {} }} deliver={async () => {}} /></IntegrationIntl>); }
function updateMessages(messages: Message[]) { state = { ...state, data: { ...state.data, messages } }; render(); }
function incoming() { updateMessages([...state.data.messages, ...Array.from({ length: 3 }, () => message(`live${++serial}`, { text: `刚刚收到的消息 ${serial}`, timestamp: Date.now() + serial, liveArrival: true }))]); }
function history() {
  const earliest = Math.min(...state.data.messages.filter(m => m.teamId === 'night').map(m => m.timestamp!));
  updateMessages([...Array.from({ length: 6 }, (_, i) => message(`history${++serial}`, { timestamp: earliest - (6 - i) * 1000 })), ...state.data.messages]);
}
function list() { const el = host.querySelector<HTMLDivElement>('[aria-label="聊天消息"]'); if (!el) throw Error('聊天列表缺失'); return el; }
function row(id: string) { const el = list().querySelector<HTMLElement>(`[data-message-id="${id}"]`); if (!el) throw Error(`消息 ${id} 缺失`); return el; }
function nav() { return host.querySelector<HTMLElement>('[aria-label="聊天阅读导航"]'); }
function button(label: string) { const el = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label); if (!el) throw Error(`按钮 ${label} 缺失`); return el; }
function top(id: string) { return row(id).getBoundingClientRect().top - list().getBoundingClientRect().top; }
function visibleRow() { return [...list().querySelectorAll<HTMLElement>('[data-message-id]')].find(el => el.getBoundingClientRect().bottom > list().getBoundingClientRect().top + 3)!.dataset.messageId!; }
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); checks.push(label); output.textContent = JSON.stringify({ status: 'running', checks }, null, 2); }
function close(a: number, b: number) { return Math.abs(a - b) < 2; }
async function scroll(top: number) { list().scrollTop = top; await wait(); }
// Slow machines may still be scrolling after the fixed wait: without a condition this waits until the position holds.
async function settled(ready?: () => boolean, ms = 3000) { const end = Date.now() + ms; let last = NaN; while (Date.now() < end && (ready ? !ready() : list().scrollTop !== last)) { last = list().scrollTop; await wait(100); } return ready?.() ?? true; }
function size(width: number, height: number) { host.style.width = `${width}px`; host.style.height = `${height}px`; }

async function run() {
  checks.length = 0;
  list().focus();
  historyRequests = 0;
  await verifyChatArrival(check);
  await wait();
  check(!nav() && close(list().scrollTop + list().clientHeight, list().scrollHeight), '首次进入位于最新；旧未读数 3 不产生新消息提示');
  await scroll(0); await wait(500);
  check(historyRequests === 1, '滚到聊天顶部自动加载较早消息');
  await scroll(list().scrollHeight * .4);
  const height = list().clientHeight;
  check(nav()?.textContent === '回到最新', '仅上翻显示回到最新，不伪报新消息');
  const anchor = visibleRow(), offset = top(anchor);
  incoming(); await wait();
  check(nav()?.textContent === '3 条新消息' && close(top(anchor), offset), '实时新增准确计数 3，阅读位置保持');
  check(list().clientHeight === height, '提示出现不挤压聊天区域');
  updateMessages(state.data.messages.map(m => m.id.startsWith('live') ? { ...m, edited: true, text: m.text + '（编辑）' } : m)); await wait();
  check(nav()?.textContent === '3 条新消息', '编辑及重复快照不重复计数');
  state = { ...state, data: { ...state.data, teams: state.data.teams.map(t => ({ ...t, unread: 0 })) } }; render(); await wait();
  check(nav()?.textContent === '3 条新消息', '其他窗口已读同步不清除本窗口到达提示');
  history(); await wait();
  check(nav()?.textContent === '3 条新消息' && close(top(anchor), offset), '补载历史不增加计数，同一消息锚点保持');
  updateMessages(state.data.messages.map(m => m.id === 'm1' ? { ...m, attachment: { kind: 'image', src: '', name: '验收图片' } } : m)); await wait();
  const imageOffset = top(anchor);
  updateMessages(state.data.messages.map(m => m.id === 'm1' ? { ...m, attachment: { kind: 'image', src: '/avatars/avatar-frog.webp', name: '验收图片' } } : m)); await wait(700);
  check(close(top(anchor), imageOffset), '阅读位置上方图片加载变高后锚点保持');
  button('3 条新消息，回到最新').click(); await wait();
  check(!nav() && close(list().scrollTop + list().clientHeight, list().scrollHeight), '主动回到最新清除本窗口提示');
  await scroll(list().scrollHeight * .5);
  check(nav()?.textContent === '回到最新', '再次上翻不重复显示先前到达的消息');
  const beforeQuote = list().scrollTop;
  reports.length = 0;
  const quote = [...row('m18').querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('历史记录 3 —'))!;
  // Jumps glide, then visible messages are reported after a 300 ms dwell.
  quote.click(); await wait(1500);
  check(nav()?.querySelector('[aria-label="跳转路径"]') && list().scrollTop < beforeQuote, '引用跳转显示跳转路径，可返回原位置');
  check(reports.some(ids => ids.includes('m3')) && !reports.some(ids => ids.includes('m10')), '跳转只报告实际可见消息，不顺带已读中间消息');
  const nestedQuote = [...row('m3').querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('历史记录 1 —'))!;
  nestedQuote.click(); await wait(1500);
  button('回到 原处').click(); await wait(1500);
  check(close(list().scrollTop, beforeQuote), '连续引用跳转仍返回最初阅读位置');
  const searchOrigin = list().scrollTop;
  button('搜索消息').click();
  // Panels loads lazily; wait for its visible back control instead of timing the module download.
  const searchDeadline = Date.now() + 10_000;
  let back: HTMLButtonElement | null = null;
  while (Date.now() < searchDeadline) {
    back = host.querySelector<HTMLButtonElement>('section[aria-label="搜索消息"] button[aria-label="返回"]');
    if (back?.checkVisibility()) break;
    await wait(50);
  }
  if (!back?.checkVisibility()) throw Error('搜索返回按钮缺失');
  await Promise.all(back.closest('section')!.getAnimations().map(animation => animation.finished));
  incoming(); await wait();
  // Return through the product's back control; chat stays mounted while hidden.
  back.click(); await wait();
  check(close(list().scrollTop, searchOrigin) && nav()?.textContent?.includes('3 条新消息'), '隐藏聊天期间新增消息，返回后保持阅读位置并提示');
  const resizeAnchor = visibleRow(), resizeOffset = top(resizeAnchor);
  size(320, 480); await wait();
  check(close(top(resizeAnchor), resizeOffset), '窄栏重排保持消息锚点');
  button('3 条新消息，回到最新').click(); await wait();
  size(600, 800); await wait();
  check(close(list().scrollTop + list().clientHeight, list().scrollHeight), '位于最新时尺寸变化仍保持底部');
  for (const theme of ['light', 'dark']) for (const width of [320, 360, 400, 440, 480, 600]) for (const h of [480, 640, 800]) {
    host.querySelector('[data-palside-app]')!.setAttribute('data-appearance', theme);
    size(width, h); await wait(30); await scroll(Math.max(0, list().scrollHeight * .4));
    check(host.scrollWidth <= host.clientWidth + 1 && list().scrollWidth <= list().clientWidth + 1, `${theme} ${width}×${h} 无横向溢出`);
  }
  size(400, 640); await wait();
  const teamPosition = list().scrollTop;
  state = { ...state, drafts: { ...state.drafts, night: { revision: 1, updatedAt: Date.now(), value: { text: '延迟发送验收' } } } }; render(); await wait();
  button('发送消息').click(); await wait();
  // The send flight follows the new bubble to the latest position as it starts.
  check(Boolean(finishSend) && list().scrollTop > teamPosition && close(list().scrollTop + list().clientHeight, list().scrollHeight), '发送动效开始时定位到本人新消息');
  await settled(); const sentPosition = list().scrollTop;
  state = { ...state, preferences: { ...state.preferences, current: 'weekend' } }; render(); await wait();
  await scroll(list().scrollHeight * .3); const otherTop = list().scrollTop;
  finishSend?.({ eventId: 'synthetic-send' }); finishSend = undefined; await wait();
  check(close(list().scrollTop, otherTop), '旧小队发送完成不操作新小队的滚动位置');
  state = { ...state, preferences: { ...state.preferences, current: 'night' } }; render(); await wait();
  check(await settled(() => close(list().scrollTop, sentPosition)), '切回小队恢复原来的消息阅读位置');
  const savedMessages = state.data.messages;
  // An emptied team has no older history to load; removed rows dissolve before they unmount.
  state = { ...state, history: { ...state.history, night: { missingKeys: 0, loaded: true, loading: false } } };
  updateMessages([]); await wait(2000);
  const emptyTitle = host.querySelector('#new-team-name');
  check(!nav() && emptyTitle && emptyTitle.getBoundingClientRect().top >= list().getBoundingClientRect().top && emptyTitle.getBoundingClientRect().bottom <= list().getBoundingClientRect().bottom, '消息清空后空状态完整显示，无残留阅读导航');
  incoming(); await wait();
  check(!nav() && close(list().scrollTop + list().clientHeight, list().scrollHeight), '空聊天收到首批消息正常跟随最新');
  updateMessages(savedMessages); await wait();
  reviewStatus('passed');
  output.textContent = JSON.stringify({ status: 'passed', checks, count: checks.length, scope: '真实产品组件、浏览器布局、模拟消息适配器；不代表真实 Matrix/原生侧栏验收' }, null, 2);
}
document.getElementById('run')!.onclick = () => { const button = document.getElementById('run') as HTMLButtonElement; button.disabled = true; void run().catch(error => { reviewStatus('failed'); output.textContent = JSON.stringify({ status: 'failed', error: String(error), checks }, null, 2); }).finally(() => { button.disabled = false; }); };
document.getElementById('incoming')!.onclick = incoming;
document.getElementById('history')!.onclick = history;
document.getElementById('theme')!.onclick = () => { dark = !dark; host.querySelector('[data-palside-app]')?.setAttribute('data-appearance', dark ? 'dark' : 'light'); };
document.getElementById('small')!.onclick = () => size(320, 480);
document.getElementById('normal')!.onclick = () => size(400, 640);
document.getElementById('large')!.onclick = () => size(600, 800);
render();
// React renders after this module finishes; start once the chat list exists.
if (autoRun) { const start = () => host.querySelector('[aria-label="聊天消息"]') ? document.getElementById('run')!.click() : requestAnimationFrame(start); start(); }
