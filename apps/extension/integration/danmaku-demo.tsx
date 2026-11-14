import { MINUTE_MS } from '@palside/shared/units';
import React, { useRef, useState } from 'react';
import type { PageStatus } from '../src/runtime/browser/page-protocol';
import type { pageCapabilities as Capabilities } from '../src/runtime/browser/page-capabilities';
import type { RoomView } from '../src/runtime/rooms/state';

/** scene=danmaku-modes: a browser window around the real panel, so 弹幕 in the chat area can be tried while switching tabs. */
export type DemoTab = 'cashcat' | 'pons' | 'github';
const CASHCAT = '0x020bfc650a365f8bb26819deaabf3e21291018b4', PONS = '0x39dbed3a2bd333467115de45665cc57f813c4571';
export const demoTabs: Record<DemoTab, { key?: 'cashcat' | 'pons'; title: string; url: string; host: string; asset?: string; mark: string; color: string }> = {
  cashcat: { key: 'cashcat', title: 'CASHCAT · GMGN', url: `https://gmgn.ai/robinhood/token/${CASHCAT}`, host: 'gmgn.ai', asset: `Robinhood:${CASHCAT}`, mark: 'G', color: '#111' },
  pons: { key: 'pons', title: 'PONS · GMGN', url: `https://gmgn.ai/robinhood/token/${PONS}`, host: 'gmgn.ai', asset: `Robinhood:${PONS}`, mark: 'G', color: '#111' },
  github: { title: 'palside-extension · GitHub', url: 'https://github.com/palsidexyz/palside-extension', host: 'github.com', mark: 'GH', color: '#24292f' },
};

export function demoPage(tab: DemoTab, site: boolean, interactive: boolean, pageCapabilities: typeof Capabilities): PageStatus {
  const info = demoTabs[tab], token = Boolean(info.asset);
  return { tabId: 1, windowId: 1, signalEnabled: token && site, url: info.url, host: info.host, asset: info.asset, granted: token && site, interactive: token && interactive, connected: token && interactive,
    access: { site: token && site, active: false }, capabilities: pageCapabilities({ id: 1, url: info.url, status: 'complete' }, { site: token && site, active: false }) } as PageStatus;
}

type Person = RoomView['messages'][number]['author'];
const ponsLines = ['PONS 量起来了', '这个盘子稳', '刚上车 0.2', '5 分钟线走得漂亮', 'dev 还没动'];
const cashcatLines = ['又一根大阳线', '持有人破 3500 了', '先止盈一半', '池子还在加', '有人看过合约吗', '这波能到哪', '刚刚有大户进'];
let talk = 0;
/** A fresh 弹幕 from someone in the room, every few seconds. */
export function demoTalk(cashcat: boolean, people: Person[], key: string) {
  const lines = cashcat ? cashcatLines : ponsLines, n = talk++;
  return { id: `live-${n}-${Date.now()}`, key, author: people[n % 4]!, text: lines[n % lines.length]!, folded: false, reported: false, createdAt: Date.now() };
}

/** Each token's room, kept across tab switches so what arrived stays. */
export function demoRooms(roomFor: (key: string) => RoomView, cashcatKey: string, ponsKey: string, people: Person[], now: number): Record<string, RoomView> {
  const pons = roomFor(ponsKey);
  return {
    [cashcatKey]: roomFor(cashcatKey),
    [ponsKey]: { ...pons, site: 'gmgn', count: 41, faces: people.slice(1, 4), messages: ponsLines.slice(0, 3).map((text, index) => ({ id: `p${index}`, key: ponsKey, author: people[(index + 1) % 4]!, text, folded: false, reported: false, createdAt: now - (8 - index * 3) * MINUTE_MS })) } as RoomView,
  };
}

/** The window: what to try above, then tabs, the address bar, the page and the side panel. */
export function DanmakuShell() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [tab, setTab] = useState<DemoTab>('cashcat');
  const post = (demo: string, value: unknown) => frame.current?.contentWindow?.postMessage({ demo, value }, '*');
  const onTab = (next: DemoTab) => { setTab(next); post('tab', next); };
  const onEvent = (event: 'packet' | 'burst' | 'squad') => post('event', event);
  const info = demoTabs[tab];
  // A fresh frame starts at its defaults: send it the tab the window shows.
  React.useEffect(() => {
    const listen = (event: MessageEvent) => { if ((event.data as { demoReady?: boolean })?.demoReady) frame.current?.contentWindow?.postMessage({ demo: 'tab', value: tab }, '*'); };
    window.addEventListener('message', listen); return () => window.removeEventListener('message', listen);
  }, [tab]);
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 22px 22px', background: '#e4e6ea', boxSizing: 'border-box', font: '13px/1.5 system-ui, -apple-system, sans-serif', color: '#1d1f23' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
      <span style={{ color: '#4a4e55' }}>按输入框里的「弹幕」，聊天区换成这个代币的弹幕；再按一次（或 Esc）回到小队。</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4a4e55', whiteSpace: 'nowrap' }}>模拟</span>
        {([['packet', 'Zed 发一个红包'], ['burst', '三人连发红包'], ['squad', '小队来一条新消息']] as const).map(([id, name]) => <button key={id} type="button" onClick={() => onEvent(id)} style={{ whiteSpace: 'nowrap', border: '1px solid #c3c7cd', borderRadius: 8, padding: '5px 11px', font: 'inherit', fontWeight: 600, cursor: 'pointer', background: '#fff' }}>{name}</button>)}
      </span>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #c9ccd2' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '8px 10px 0', background: '#dfe1e5' }}>
        {(Object.keys(demoTabs) as DemoTab[]).map(id => <button key={id} type="button" onClick={() => onTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: 220, height: 34, padding: '0 12px', border: 0, borderRadius: '9px 9px 0 0', font: 'inherit', cursor: 'pointer', background: id === tab ? '#fff' : 'transparent', color: '#1d1f23' }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: demoTabs[id].color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'grid', placeItems: 'center', flex: 'none' }}>{demoTabs[id].mark}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{demoTabs[id].title}</span>
        </button>)}
        <span style={{ marginLeft: 'auto', alignSelf: 'center', color: '#5f6368', paddingBottom: 6 }}>点上面的标签页切换网页</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 12px', borderBottom: '1px solid #e3e5e8' }}>
        <span style={{ flex: 1, height: 28, borderRadius: 14, background: '#f1f3f4', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#3c4043' }}>{info.url.replace('https://', '')}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}><Page tab={tab} /></div>
        <iframe ref={frame} title="Palside" src={`design-review.html?scene=danmaku-panel&on=share`} style={{ width: 380, flex: 'none', border: 0, borderLeft: '1px solid #dadce0' }} />
      </div>
    </div>
  </div>;
}

/** A stand-in page: a token's price chart, or a repository. Only the side panel is the real product. */
function Page({ tab }: { tab: DemoTab }) {
  if (tab === 'github') return <div style={{ padding: '32px 40px', color: '#24292f' }}>
    <div style={{ fontSize: 20, fontWeight: 600 }}>palsidexyz / palside-extension</div>
    <div style={{ marginTop: 6, color: '#59636e' }}>Watch tokens alongside friends</div>
    {[0, 1, 2, 3, 4, 5].map(row => <div key={row} style={{ marginTop: row ? 0 : 24, height: 40, borderBottom: '1px solid #e5e8eb', display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 16, height: 14, background: '#d0d7de', borderRadius: 2 }} /><span style={{ width: 120 + row * 23 % 90, height: 8, background: '#e5e8eb', borderRadius: 4 }} /></div>)}
  </div>;
  const cashcat = tab === 'cashcat';
  const candles = chartCandles(cashcat);
  const max = Math.max(...candles.map(item => item.high)), min = Math.min(...candles.map(item => item.low)), y = (value: number) => 20 + (max - value) / (max - min) * 300;
  return <div style={{ height: '100%', background: '#0f1115', color: '#e8eaed', padding: '22px 28px', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}><b style={{ fontSize: 22 }}>{cashcat ? 'CASHCAT' : 'PONS'}</b><span style={{ color: '#9aa0a6' }}>Robinhood Chain</span><b style={{ marginLeft: 'auto', fontSize: 20, color: '#3fcf8e' }}>${cashcat ? '0.00412' : '0.0187'}</b></div>
    <svg viewBox="0 0 600 340" style={{ width: '100%', marginTop: 18 }}>
      {candles.map((item, index) => { const x = 8 + index * 12.2, up = item.close >= item.open, color = up ? '#3fcf8e' : '#f6465d';
        return <g key={index}><line x1={x + 4} x2={x + 4} y1={y(item.high)} y2={y(item.low)} stroke={color} /><rect x={x} width={8} y={y(Math.max(item.open, item.close))} height={Math.max(1, Math.abs(y(item.open) - y(item.close)))} fill={color} /></g>; })}
    </svg>
  </div>;
}

/** A still chart: 48 candles from a seeded walk, one shape per token. */
function chartCandles(cashcat: boolean) {
  const closes = Array.from({ length: 48 }, (_, index) => Array.from({ length: index + 1 }, (_, step) => Math.sin(step * (cashcat ? .7 : .45)) * 6 + (cashcat ? 1.6 : .9)).reduce((sum, value) => sum + value, 100));
  return closes.map((close, index) => { const open = index ? closes[index - 1]! : 100; return { open, close, high: Math.max(open, close) + 3, low: Math.min(open, close) - 3 }; });
}
