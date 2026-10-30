import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { IntegrationIntl } from './intl';
import { createRoot } from 'react-dom/client';
import { Bell, ChevronRight, Copy, Ellipsis, Globe, Pin, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@palside/ui/button';
import { Input, Textarea, Field } from '@palside/ui/field';
import { Switch } from '@palside/ui/switch';
import { Checkbox } from '@palside/ui/checkbox';
import { Select } from '@palside/ui/select';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { AlertDialog } from '@palside/ui/dialog';
import { Tooltip } from '@palside/ui/tooltip';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@palside/ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '@palside/ui/popover';
import { Sheet } from '@palside/ui/sheet';
import '@palside/design/fonts.css';
import '../src/styles.css';
import s from './design-system-review.module.css';

const samples = { teamName: '夜猫看币小队' };

/** Local synthetic states using the shipped components. No account or service writes. */
function Review() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const t = useTranslations();
  const locale = useLocale();
  const [width, setWidth] = useState('320');
  const [choice, setChoice] = useState('compact');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [short, setShort] = useState(false);
  const [sheet, setSheet] = useState(false);
  function switchLanguage() {
    const url = new URL(location.href);
    url.searchParams.set('locale', locale === 'en' ? 'zh-CN' : 'en');
    location.href = url.href;
  }
  function reviewLink(path: string) {
    const url = new URL(path, location.origin);
    url.searchParams.set('locale', locale);
    return url.pathname + url.search;
  }
  return <div className={s.page} data-palside-app data-appearance={theme}>
    <header className={s.header}><a href="#top" className={s.brand}><span className={s.brandMark} aria-hidden="true" />Palside<span>DESIGN REVIEW</span></a>
      <div className={s.controls}><Button variant="quiet" aria-label={t('common.language')} onClick={switchLanguage}>{locale === 'en' ? '简体中文' : 'English'}</Button><Button variant="quiet" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{t(theme === 'light' ? 'extension.copy.dark' : 'extension.copy.light')}</Button><Select aria-label="预览宽度" value={width} onChange={e => setWidth(e.target.value)} options={['280','320','380','480'].map(value => ({value,label: value+' px'}))} /></div>
    </header>
    <main id="top" className={s.main}>
      <div className={s.intro}><span className={s.eyebrow}>同一套组件，每一种状态</span><h1>让细节有共同的规则。</h1><p>保留 Palside 的中性表面与荧光绿强调，统一可读性、操作反馈和窄屏行为。这里使用真实共享组件；示例数据与操作均在本页内。</p></div>
      <section className={s.section} aria-labelledby="density"><div className={s.sectionHead}><span>01 / 信息密度</span><h2 id="density">设置页面的信息密度</h2><p>紧凑与舒展两种密度均支持长文案自然换行。选择只更新本页预览，不修改产品设置。</p></div>
        <div className={s.comparison}>
          {(['compact','relaxed'] as const).map((density,index) => <article key={density} className={s.option} data-selected={choice === density}>
            <header><h3>{index === 0 ? '紧凑清晰' : '舒展留白'}</h3><span>{index === 0 ? '紧凑间距，清晰分组' : '更多滚动，更多留白'}</span></header>
            <div className={s.preview} style={{width: Number(width)}} data-density={density}>
              <h4>{t('extension.settings.privacy')}</h4><p className={s.groupTitle}>{t('extension.settings.groupWeb')}</p><div className={s.card}>
                <div className={s.row}><span className={s.icon}><Globe size={16} /></span><Switch label={t('extension.web.share')} help={{ label: t('extension.settings.aboutFeature', { name: t('extension.web.share') }), content: t('extension.settings.shareHint') }} defaultChecked /></div>
                <div className={s.row}><span className={s.icon}><Bell size={16} /></span><Switch label={t('extension.settings.preview')} /></div>
                <button className={s.row} onClick={() => setChoice(density)}><span className={s.icon}><ShieldCheck size={16} /></span><span className={s.rowText}><strong>{t('extension.copy.security')}</strong><small>{t('extension.copy.recoveryPhrase')}</small></span><ChevronRight size={16} /></button>
              </div>
            </div>
            <Button variant={choice === density ? 'primary' : 'surface'} aria-pressed={choice === density} onClick={() => setChoice(density)}>{choice === density ? '当前选择' : '预览此密度'}</Button>
          </article>)}
        </div><p className={s.selection} role="status">当前选择：{choice === 'compact' ? '紧凑清晰' : '舒展留白'}。切换只影响本页预览。</p>
      </section>
      <section className={s.section} aria-labelledby="states"><div className={s.sectionHead}><span>02 / 真实组件检查</span><h2 id="states">默认、焦点、等待与失败</h2><p>用 Tab 检查焦点；切换外观与语言，检查对比、换行和状态稳定性。</p></div>
        <div className={s.componentGrid}>
          <article className={s.sample}><h3>操作与反馈</h3><div className={s.actions}><Button variant="primary" loading={busy}>{t('extension.copy.saveChanges')}</Button><Button>{t('common.cancel')}</Button><Button variant="danger">{t('extension.sticky.delete')}</Button><Button variant="primary" disabled>{t('extension.invite.unavailable')}</Button><Tooltip content={t('extension.copy.searchMessageContent')}><IconButton label={t('extension.copy.searchMessages')} variant="quiet"><Search /></IconButton></Tooltip></div><Switch label="模拟等待" checked={busy} onChange={e => setBusy(e.target.checked)} /><Switch label="禁用开关" disabled defaultChecked /><Checkbox label={t('extension.settings.notifications')} /><InlineFeedback tone="success">{t('extension.web.saved')}</InlineFeedback><InlineFeedback tone="error" action={{label: t('common.retry'),onClick:()=>setError(false)}}>{t('common.saveFailed')}</InlineFeedback></article>
          <article className={s.sample}><h3>表单与状态</h3><Field label={t('extension.copy.teamName')} error={error ? t('extension.copy.teamNameLimit') : undefined}>{props => <Input {...props} defaultValue={samples.teamName} />}</Field><Field label={t('extension.copy.description')} hint={t('extension.copy.descriptionLimit')}>{props => <Textarea {...props} placeholder={t('extension.copy.teamIntroPlaceholder')} />}</Field><Switch label="模拟校验错误" checked={error} onChange={e => setError(e.target.checked)} /></article>
          <article className={s.sample}><h3>确认层与短窗口</h3><Switch label="模拟短窗口" checked={short} onChange={e=>setShort(e.target.checked)} /><div className={s.boundary} data-review-boundary style={{height:short ? 220 : 360}}><p>面板边界 · {short ? 220 : 360}px</p><Button onClick={()=>{setFailure(false);setOpen(true);}}>打开确认面板</Button><AlertDialog open={open} onOpenChange={setOpen} title={t('extension.center.clearTitle')} description={t('extension.center.clearDescription')} confirmLabel={t('extension.center.clear')} cancelLabel={t('common.cancel')} boundarySelector="[data-review-boundary]" placement="bottom" pending={pending} error={failure ? t('common.error') : undefined} onConfirm={()=>{setPending(true);setFailure(false);setTimeout(()=>{setPending(false);setFailure(true);},900);}} /></div></article>
          <article className={s.sample}><h3>菜单、浮层与底部面板</h3><div className={s.actions}>
            <Menu align="start"><MenuTrigger asChild><IconButton label={t('extension.web.more')} variant="quiet"><Ellipsis /></IconButton></MenuTrigger><MenuContent aria-label={t('extension.web.more')}><MenuItem icon={<Pin />}>置顶</MenuItem><MenuItem icon={<Copy />}>{t('extension.copy.copy')}</MenuItem><MenuItem icon={<Trash2 />} tone="danger">{t('extension.sticky.delete')}</MenuItem></MenuContent></Menu>
            <Popover align="start"><PopoverTrigger asChild><Button>{samples.teamName}</Button></PopoverTrigger><PopoverContent aria-label={samples.teamName} className={s.popover}><Switch label={t('extension.web.share')} defaultChecked /><Switch label={t('extension.settings.preview')} /></PopoverContent></Popover>
          </div><div className={s.boundary} data-sheet-boundary style={{height:280}}><p>面板边界 · 280px</p><Button onClick={() => setSheet(true)}>打开底部面板</Button>
            <Sheet open={sheet} onOpenChange={setSheet} aria-labelledby="review-sheet-title" boundarySelector="[data-sheet-boundary]" className={s.sheet}><h3 id="review-sheet-title">{t('extension.center.clearTitle')}</h3><p>{t('extension.center.clearDescription')}</p><div className={s.sheetActions}><Button onClick={() => setSheet(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => setSheet(false)}>{t('extension.center.clear')}</Button></div></Sheet>
          </div></article>
        </div>
      </section>
      <section className={s.section} aria-labelledby="screens"><div className={s.sectionHead}><span>03 / 产品场景</span><h2 id="screens">继续查看实际页面</h2></div><div className={s.links}><a href={reviewLink('/design-review.html?w=320')}>{t('extension.copy.chatMessages')} · 320px</a><a href={reviewLink(`/design-review.html?w=320&clicks=${encodeURIComponent([t('extension.copy.teamMenu'), t('extension.copy.settings'), t('extension.settings.privacy')].join(','))}`)}>{t('extension.settings.privacy')}</a><a href={reviewLink('/design-review.html?scene=access-site&w=320')}>{t('extension.privacy.chrome')}</a><a href={reviewLink('/design-review.html?scene=stickies&w=320')}>{t('extension.web.sticky')}</a><a href={reviewLink('/edge-review.html?scene=password')}>{t('extension.copy.password')}</a><a href={`http://localhost:3000/${locale}`}>{t('extension.copy.websiteHome')}</a></div></section>
    </main><footer className={s.footer}>Palside / 本地设计审查 · 浏览器样例不代表真实账号、权限或服务验收</footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<IntegrationIntl><Review /></IntegrationIntl>);
