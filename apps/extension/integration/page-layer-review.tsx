import { translator } from '@palside/i18n';
import { startPageLayer } from '../src/page-layer';
import type { CaptureLabels, PageDown, PageUp } from '../src/runtime/browser/page-protocol';
import { reviewStatus } from './review-harness';

/** The page layer on a mock token page, driven by a fake background: `?scene=danmaku|capture|pick|stickies|hidden`. */
// Review only: open the layer's shadow root so the page can be inspected.
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }); };
const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'danmaku';
const t = translator('zh-CN');
const root = document.getElementById('root')!;
// `real=1`: like the live sites, the chart is drawn inside an iframe and every trade row is a link split over several nodes.
const real = params.get('real') === '1';
const row = (i: number) => {
  const cells = `<span style="color:${i % 3 ? '#3fbf8a' : '#e5484d'}">${i % 3 ? '买入' : '卖出'}</span><span>${(1200 + i * 37).toLocaleString()}</span>`;
  return real ? `<a href="#trade-${i}" style="display:flex;justify-content:space-between;padding:6px 10px;border-radius:6px;background:#12161b;color:inherit;text-decoration:none">${cells}</a>` : `<div style="display:flex;justify-content:space-between;padding:6px 10px;border-radius:6px;background:#12161b">${cells}</div>`;
};
root.innerHTML = `<header style="height:56px;display:flex;align-items:center;gap:16px;padding:0 20px;border-bottom:1px solid #1d2128"><b style="color:#fff;font-size:16px">CASHCAT</b><span>$0.004182</span><span style="color:#3fbf8a">+18.2%</span></header>
<main style="display:grid;grid-template-columns:1fr 280px;gap:12px;padding:12px"><div class="chart" style="position:relative;height:420px;border-radius:8px;background:#0f1216;border:1px solid #1d2128">${real ? '<iframe id="f" title="Chart" style="width:100%;height:100%;border:0;display:block"></iframe>' : '<canvas id="c" width="900" height="420" style="width:100%;height:100%"></canvas>'}</div>
<aside style="display:flex;flex-direction:column;gap:6px">${Array.from({ length: 14 }, (_, i) => row(i)).join('')}</aside></main>`;
const frame = document.getElementById('f') as HTMLIFrameElement | null;
if (frame) frame.contentDocument!.body.innerHTML = '<canvas id="c" width="900" height="420" style="width:100%;height:100%"></canvas>';
if (frame) frame.contentDocument!.body.style.margin = '0';
const canvas = (frame?.contentDocument ?? document).getElementById('c') as HTMLCanvasElement; const g = canvas.getContext('2d')!;
g.strokeStyle = '#3fbf8a'; g.lineWidth = 2; g.beginPath(); for (let x = 0; x <= 900; x += 30) g.lineTo(x, 330 - x * 0.25 - Math.sin(x / 40) * 30); g.stroke();
// Plain pages have no extension origin; packaged files are served from the review root.
const host = globalThis as unknown as { chrome: { runtime?: { getURL?: (path: string) => string } } };
host.chrome.runtime = { ...host.chrome.runtime, getURL: path => new URL(`/${path}`, location.origin).href };
const listeners: ((message: PageDown) => void)[] = [];
const down = (message: PageDown) => listeners.forEach(listener => listener(message));
(window as unknown as { down: typeof down }).down = down;
(window as unknown as { pageUp: PageUp[] }).pageUp = [];
startPageLayer({ postMessage: message => { (window as unknown as { pageUp: PageUp[] }).pageUp.push(message); }, onMessage: { addListener: listener => { listeners.push(listener); } } });
const labels = { quote: t('extension.sticky.quote'), mark: t('extension.sticky.add'), saved: t('extension.sticky.saved'), openMark: t('extension.sticky.viewMark'), cancel: t('common.cancel'), refEdge: t('extension.page.refEdge', { name: '{name}' }), above: t('extension.page.above'), below: t('extension.page.below'), you: t('extension.page.you'), locale: 'zh-CN' };
down({ type: 'config', labels, danmaku: { density: 'high', enabled: true, area: 'chart', speed: 144, size: 'md', opacity: 90 } });
const people = [{ name: 'Kai' }, { name: 'Robin' }, { name: 'Mia' }];
const lines = ['这根量有点猛', '我先上车了', '止盈设好没', '持有人涨得好快', '等回调', '看这个大单'];
if (scene === 'danmaku' || scene === 'hidden') {
  let n = 0;
  const emit = () => { const i = n++; down({ type: 'danmaku', items: [{ id: `d${i}`, key: 'token:solana:fixture', text: lines[i % lines.length]!, author: people[i % 3]!, self: i % 4 === 1, timestamp: Date.now() - i * 60_000 }] }); };
  for (let i = 0; i < 4; i++) setTimeout(emit, i * 300);
  setInterval(emit, 900);
}
if (scene === 'capture') {
  const shot = document.createElement('canvas'); shot.width = innerWidth * devicePixelRatio; shot.height = innerHeight * devicePixelRatio;
  const s = shot.getContext('2d')!; s.scale(devicePixelRatio, devicePixelRatio); s.fillStyle = '#0b0d10'; s.fillRect(0, 0, innerWidth, innerHeight); s.drawImage(canvas, 12, 69, innerWidth - 316, 420);
  const captureLabels: CaptureLabels = {
    ...Object.fromEntries((['rectangle', 'arrow', 'pen', 'text', 'mosaic', 'undo', 'cancel', 'done'] as const).map(key => [key, t(`extension.capture.${key}`)])),
    copy: t('extension.copy.copy'), copied: t('extension.copy.copied'),
  } as CaptureLabels;
  setTimeout(() => down({ type: 'capture', src: shot.toDataURL('image/png'), labels: captureLabels }), 300);
}
if (scene === 'pick') setTimeout(() => down({ type: 'pick', on: true, canSticky: true, contextId: 'review-pick' }), 300);
const quote = (exact: string) => ({ kind: 'quote' as const, exact, prefix: '', suffix: '' });
if (scene === 'stickies' || scene === 'hidden') setTimeout(() => {
  const now = Date.now();
  down({ type: 'stickies', items: [
    { id: 's1', target: quote('1,237'), text: '这笔卖单之后量就起来了，盯一下', author: { name: 'Mia' }, timestamp: now - 3 * 60_000 },
    { id: 's2', target: quote('1,348'), text: '这笔买单再观察一下', author: { name: 'Kai' }, timestamp: now - 40 * 60_000 },
    { id: 's3', target: quote('1,348'), text: '同意，等放量', author: { name: 'Robin' }, timestamp: now - 12 * 60_000 },
    { id: 's4', target: quote('不存在的文字'), text: '找不到的便利贴', author: { name: 'Kai' }, timestamp: now - 90 * 60_000 },
  ] });
}, 300);
setTimeout(() => reviewStatus('ready'), 600);
