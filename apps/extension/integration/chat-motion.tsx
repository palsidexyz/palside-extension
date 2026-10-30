import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@palside/ui/button';
import { PalsideApp } from './preview-app';
import type { Message } from '../src/domain/chat/model';
import type { Dataset } from '../src/runtime/composition/dataset';
import { IntegrationIntl } from './intl';
import { palsideFixtures, demoSites } from './fixtures';
import '@palside/design/fonts.css';
import '../src/styles.css';
import './chat-motion.css';

/** Review page for the chat's own motion: everything here is the production chat, fed local fixtures. */
type Scene = 'send' | 'reading';
const long = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 行：这是一条很长的消息，用来检查折叠、展开和收起后的位置。`).join('\n');
function fixture(scene: Scene): Dataset {
  const data = structuredClone(palsideFixtures), teamId = `motion-${scene}`;
  data.teams = [{ ...data.teams[0]!, id: teamId, name: '动效试验小队' }];
  const day = 86_400_000, now = Date.now();
  const message = (id: string, author: string, text: string, ago: number, replyTo?: string): Message => ({ id, teamId, author, text, replyTo, time: '14:32', timestamp: now - ago, status: 'sent' });
  data.messages = scene === 'send' ? [
    message('s0', 'mia', '昨天的记录在这里，翻看历史时顶部会短暂浮出日期。', day + 60_000),
    message('s1', 'robin', '试着发一句话，看看它怎样从输入框进入聊天。也可以先选中一段文字，再从菜单引用所选。', 180_000),
    message('s2', 'mia', long, 120_000),
    message('s3', 'robin', '🔥', 90_000),
    message('s4', 'you', '👀👀', 60_000),
    message('s5', 'you', '撤回中间这条：它消散后，上下两条仍算同一组。', 30_000),
    message('s6', 'you', '这是同一个人的第三条。', 15_000),
  ] : [
    message('q-origin', 'robin', '先看清楚来源，再讨论结论。\n这一句是最早的原消息。', day + 600_000),
    message('q-long', 'mia', long, day + 500_000),
    ...Array.from({ length: 18 }, (_, index) => message(`q-${index}`, index % 2 ? 'mia' : 'robin', ['我把相关资料放到一起了。', '这段内容还需要再核对一下。', '可以结合上下文一起看。', '先记下来，等会儿回来讨论。'][index % 4]!, day - index * 60_000)),
    message('q-mid', 'mia', '这条引用了最早那句。', 400_000, 'q-origin'),
    ...Array.from({ length: 10 }, (_, index) => message(`r-${index}`, index % 2 ? 'robin' : 'you', ['继续往下看。', '先别急着下结论。'][index % 2]!, 300_000 - index * 20_000)),
    message('q-fold', 'robin', '长消息被引用时，定位后会自动展开。', 60_000, 'q-long'),
    message('q-far-reply', 'you', '点这条的引用，再点那条的引用，路径会一层层记下来。', 30_000, 'q-mid'),
  ];
  return data;
}

function Stage({ scene, theme, fail }: { scene: Scene; theme: string; fail: boolean }) {
  const [data] = useState(() => fixture(scene));
  const host = useRef<HTMLDivElement>(null);
  const failing = useRef(fail);
  useEffect(() => { failing.current = fail; }, [fail]);
  useEffect(() => { host.current?.querySelector('[data-palside-app]')?.setAttribute('data-appearance', theme); }, [theme]);
  async function deliver() {
    await new Promise(resolve => setTimeout(resolve, 600));
    if (failing.current) throw new Error('Preview delivery failure');
  }
  return <div ref={host} className="cm-product" data-scene={scene}><PalsideApp data={data} sites={demoSites} deliver={deliver} /></div>;
}

function Preview() {
  const [scene, setScene] = useState<Scene>('send'), [theme, setTheme] = useState('light'), [fail, setFail] = useState(false), [reset, setReset] = useState(0), [width, setWidth] = useState(440);
  return <div className="chat-motion-preview" data-appearance={theme}>
    <nav className="cm-controls" aria-label="测试控制">
      <Button variant={scene === 'send' ? 'primary' : 'surface'} aria-pressed={scene === 'send'} onClick={() => setScene('send')}>发送与撤回</Button>
      <Button variant={scene === 'reading' ? 'primary' : 'surface'} aria-pressed={scene === 'reading'} onClick={() => setScene('reading')}>引用定位与路径</Button>
      <Button onClick={() => setReset(x => x + 1)}>重置</Button>
      {scene === 'send' && <Button aria-pressed={fail} onClick={() => setFail(x => !x)}>{fail ? '模拟失败' : '模拟成功'}</Button>}
      <Button onClick={() => setTheme(x => x === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '浅色' : '深色'}</Button>
      <Button onClick={() => setWidth(x => x === 360 ? 440 : x === 440 ? 600 : 360)}>{width} px</Button>
    </nav>
    <section style={{ '--preview-width': `${width}px` } as React.CSSProperties}><Stage key={`${scene}-${reset}`} scene={scene} theme={theme} fail={fail} /></section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Preview /></IntegrationIntl>);
