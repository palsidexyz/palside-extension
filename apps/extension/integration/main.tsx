import { IntegrationIntl } from './intl';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PalsideService } from '../src/runtime/composition/core';
import { PalsideApp } from './preview-app';
import { siteCatalog } from '../src/features/palside/settings/site-catalog';
import { API_URL } from '../src/runtime/composition/config';
import '@palside/design/fonts.css';
import '../src/styles.css';
const mediaUnavailable = new URLSearchParams(location.search).get('qa') === 'media-offline';
let apiUnavailable = new URLSearchParams(location.search).get('qa') === 'api-offline';
if (mediaUnavailable || apiUnavailable) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin === new URL(API_URL).origin && (apiUnavailable || (mediaUnavailable && url.pathname.startsWith('/media/')))) return Promise.reject(new TypeError('Service unavailable in this local recovery test'));
    return original(input, init);
  };
}
const service = new PalsideService();
export const command = <T,>(name: string, payload?: Record<string, unknown>) => service.command({ name, payload }) as Promise<T>;
function Integration() {
  const [state, setState] = useState(service.state);
  const [apiBlocked, setApiBlocked] = useState(apiUnavailable);
  const [probeError, setProbeError] = useState('');
  useEffect(() => { const unsubscribe = service.subscribe(setState); void service.initialise(); return () => { unsubscribe(); }; }, []);
  if (!state.ready) return <p>正在连接本机服务…</p>;
  const target = state.data.messages.find(message => message.status === 'sent' && message.author !== state.data.self && !message.recalled);
  const editTarget = state.data.messages.find(message => message.status === 'sent' && message.author === state.data.self && message.text.startsWith('Concurrent edit baseline') && !message.recalled);
  return <>{new URLSearchParams(location.search).get('qa') === 'api-offline' && <aside aria-label="断网启动联调" style={{ position: 'fixed', top: 8, left: 8, maxWidth: 240 }}><p>{apiBlocked ? '本机服务请求已阻断' : '本机服务请求已恢复'}</p><button disabled={!apiBlocked} onClick={() => { apiUnavailable = false; setApiBlocked(false); }}>恢复本机服务请求</button></aside>}{mediaUnavailable && <output aria-label="媒体缓存联调" style={{ position: 'fixed', top: 8, left: 8, maxWidth: 240 }}>媒体请求已阻断，仅验收本机缓存。</output>}<div style={{ maxWidth: 600, height: '100dvh', margin: 'auto', position: 'relative' }}><PalsideApp data={state.data} sites={siteCatalog} live={{ state, command, openPage: async url => { window.open(url, '_blank', 'noopener,noreferrer'); } }} deliver={async () => { throw new Error('请使用真实服务'); }} /></div>{new URLSearchParams(location.search).get('qa') === 'notification' && <aside style={{ position: 'fixed', top: 8, left: 8, maxWidth: 240, padding: 12, background: 'white', border: '1px solid #ddd', zIndex: 100 }} aria-label="通知定位联调">
    <p>仅测试客户端定位，不代表系统通知已点击。</p>
    <p>目标：{target?.text.slice(0, 60) ?? '等待真实消息'}</p>
    <button disabled={!target} onClick={() => { if (target) void command('notification-open', { accountId: state.account?.id, messageId: target.id, windowId: 1 }).catch(error => setProbeError(error.message)); }}>模拟通知点击</button>
    <output aria-label="通知定位状态">{probeError || (state.jumpMessageId ? '待消费' : '无待处理定位')}</output>
  </aside>}{new URLSearchParams(location.search).get('qa') === 'edit-conflict' && <aside aria-label="并发编辑联调" style={{ position: 'fixed', top: 8, left: 8, maxWidth: 220 }}>
    <p>通过同账号命令制造已提交版本，仅测试改稿冲突。</p>
    <button disabled={!editTarget} onClick={() => { if (editTarget) void command('edit', { teamId: editTarget.teamId, id: editTarget.id, text: 'Competing committed edit', baseEditedAt: editTarget.editedAt ?? 0 }).then(() => setProbeError('并发版本已提交')).catch(error => setProbeError(error.message)); }}>提交同账号并发修改</button>
    <output aria-label="并发修改结果">{probeError}</output>
  </aside>}</>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Integration /></IntegrationIntl>);
