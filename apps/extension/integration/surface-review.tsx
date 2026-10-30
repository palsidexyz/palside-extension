import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Bold, Globe } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { Input, Textarea, PinInput } from '@palside/ui/field';
import { Select } from '@palside/ui/select';
import { Checkbox } from '@palside/ui/checkbox';
import { Switch } from '@palside/ui/switch';
import palside from '../src/features/palside/app/palside.module.css';
import s from './surface-review.module.css';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Review-only: real shared components and product classes in both themes.
function Themes({ title, render }: { title: string; render: () => ReactNode }) {
  return <section className={s.section}><h2>{title}</h2><div className={s.grid}>
    {(['light', 'dark'] as const).map(appearance => <div key={appearance} data-palside-app data-appearance={appearance} style={{ display: 'contents' }}><div className={s.stage}>{render()}</div></div>)}
  </div></section>;
}
function Controls() {
  const [pin, setPin] = useState('12');
  return <>
    <Input placeholder="小队名称" aria-label="小队名称" />
    <Select aria-label="通知" defaultValue="all" options={[{ value: 'all', label: '所有消息' }, { value: 'mention', label: '仅提及' }]} />
    <Textarea aria-label="简介" rows={2} placeholder="简介" />
    <PinInput aria-label="验证码" value={pin} onValueChange={setPin} length={4} />
    <div className={s.row}><Checkbox label="记住此设备" defaultChecked /><Checkbox label="未选" /><Switch label="通知" defaultChecked /><Switch label="关闭" /></div>
  </>;
}
function Review() {
  return <>
    <nav className={s.nav}><a href="/language-button-review.html">← 语言按钮</a><span>表面与层次验收 · 真实组件 · 浅色／深色</span></nav>
    <main className={s.page}>
      <Themes title="输入控件：无描边填充" render={() => <Controls />} />
      <Themes title="按钮：按下整面加深，选中为强调浅底" render={() => <div className={s.row}><Button>取消</Button><Button variant="primary">保存</Button><Button aria-pressed="true" leadingIcon={<Bold size={16} />}>已选中</Button><Button variant="quiet">更多</Button><Button disabled variant="primary">不可用</Button></div>} />
      <Themes title="幽灵 Select：语言" render={() => <div className={s.row} style={{ justifyContent: 'space-between' }}><Select variant="ghost" compact leading={<Globe size={18} />} aria-label="语言" defaultValue="zh-CN" options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} /><Select variant="ghost" aria-label="语言" defaultValue="zh-CN" options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} /></div>} />
      <Themes title="分段标签：选中块为填充" render={() => <div className={palside.sharedTabs} role="tablist"><button role="tab" aria-selected="true">网页</button><button role="tab" aria-selected="false">图片</button><button role="tab" aria-selected="false">弹幕</button></div>} />
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<Review />);
