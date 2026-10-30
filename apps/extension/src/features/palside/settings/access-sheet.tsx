'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Button, IconButton } from '@palside/ui/button';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Coins, Globe2, KeyRound, Layers, Plus, Scissors, Search, X } from 'lucide-react';
import { Input } from '@palside/ui/field';
import { interactionFeatures } from '../../../domain/annotations/interaction';
import { requestAllSites, requestSitesAccess } from '../../../runtime/browser/permissions';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { CountText } from '../ui/motion-details';
import { addSite, siteRequestId } from './access';
import { DanmakuIcon, featureIcons } from '../ui/icons';
import { captureSocialUi, useSocialUi } from '../annotations/social-state';
import { Sheet } from '@palside/ui/sheet';
import { SiteLogo } from '../assets/site-logo';
import { siteCategories, siteCategory, type Site, type SiteCategory } from './site-catalog';
import { siteAllowed, useGrants } from './use-grants';
import type { PalsideController } from '../app/use-palside';
import s from './access-sheet.module.css';

/** The host a search reads as an address, if it is one: a pasted link counts by its host. */
function typedHost(query: string) {
  const value = query.trim().toLowerCase();
  if (!value.includes('.')) return;
  try {
    const host = normalizeSiteHost(/^https?:\/\//.test(value) ? new URL(value).hostname : value.replace(/\/.*$/, ''));
    return host && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : undefined;
  } catch { return; }
}

/** One fact row of a sheet: an icon, then the label above its answer (or the answer alone). */
function Fact({ icon, label, children }: { icon: ReactNode; label?: string; children: ReactNode }) {
  return <div>{icon}{label && <dt>{label}</dt>}<dd>{children}</dd></div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className={s.group}><h3 className={s.groupHead}>{title}</h3><dl className={s.facts}>{children}</dl></section>;
}

/**
 * 添加网站: search, 全选 for what is shown, categories, a two-column grid of tiles, then one 添加 for every selected site — a
 * single Chrome prompt. Sites Chrome already allows are grey and cannot be picked.
 */
export function SitePicker({ c }: { c: PalsideController }) {
  const request = useSocialUi().site;
  const session = captureSocialUi();
  const close = () => { if (session.snapshot()?.site === request) session.set({ site: undefined }); };
  return <Sheet open={Boolean(request)} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="site-picker-title" className={`${s.sheet} ${s.picker}`}>
    {request && <Picker key={siteRequestId(request)} c={c} request={request} onClose={close} />}
  </Sheet>;
}

type Request = NonNullable<ReturnType<typeof useSocialUi>['site']>;
type Filter = SiteCategory | 'all';

function Picker({ c, request, onClose }: { c: PalsideController; request: Request; onClose: () => void }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>(() => request.select ?? []);
  // Hosts typed into the search join the grid as their own tiles for as long as the sheet is open.
  const [typed, setTyped] = useState<string[]>(() => (request.select ?? []).filter(host => !c.sites.some(site => site.domain === host)));
  const [busy, setBusy] = useState(false);
  const [session] = useState(captureSocialUi);
  const active = useRef(false);
  const accountId = c.data.self, teamId = c.current, tabId = c.live?.page?.tabId, url = c.live?.page?.url;
  const [context] = useState({ accountId, teamId, tabId, url });
  useLayoutEffect(() => {
    active.current = context.accountId === accountId && context.teamId === teamId && context.tabId === tabId && context.url === url;
    if (!active.current && session.snapshot()?.site === request) session.set({ site: undefined });
    return () => { active.current = false; };
  }, [request, session, context, accountId, teamId, tabId, url]);
  const current = () => active.current && session.current() && session.snapshot()?.site === request && c.ownsAccess()
    && (!request.accountId || request.accountId === c.data.self) && (!request.teamId || request.teamId === c.current)
    && (request.tabId === undefined || request.tabId === c.live?.page?.tabId);

  const all: Site[] = [...c.sites, ...typed.filter(host => !c.sites.some(site => site.domain === host)).map(host => ({ id: host, name: host, domain: host }))];
  const on = (host: string) => siteAllowed(c, grants, host);
  const q = query.trim().toLowerCase();
  const host = typedHost(query);
  const shown = q ? all.filter(site => `${site.name} ${site.domain}`.toLowerCase().includes(q) || site.domain === host)
    : filter === 'all' ? all : all.filter(site => siteCategory(site.domain) === filter);
  const custom = host && !all.some(site => site.domain === host) ? host : undefined;
  const open = shown.filter(site => !on(site.domain)).map(site => site.domain);
  const every = open.length > 0 && open.every(domain => selected.includes(domain));
  const filters = (['all', ...siteCategories] as const).filter(id => id === 'all' || all.some(site => siteCategory(site.domain) === id));

  const toggle = (domain: string) => setSelected(list => list.includes(domain) ? list.filter(item => item !== domain) : [...list, domain]);
  function addTyped(domain: string) {
    if (!c.sites.some(site => site.domain === domain)) setTyped(list => list.includes(domain) ? list : [...list, domain]);
    if (!on(domain)) setSelected(list => list.includes(domain) ? list : [...list, domain]);
    setQuery('');
  }
  function selectShown() {
    setSelected(list => every ? list.filter(domain => !open.includes(domain)) : [...new Set([...list, ...open])]);
  }
  function add() {
    if (busy || !selected.length || !current()) return;
    const hosts = selected.filter(domain => !on(domain));
    if (!hosts.length) { onClose(); return; }
    setBusy(true);
    // Chrome's prompt must open synchronously from this click; a refusal keeps the sheet and its selection.
    const asking = c.live ? requestSitesAccess(hosts) : c.enableSites(hosts);
    void asking.then(added => {
      if (!current()) return;
      if (!added) { c.setNotice(uiMessage('extension.sites.denied')); return; }
      if (c.live) c.setNotice(hosts.length === 1 ? uiMessage('extension.sites.added', { name: all.find(site => site.domain === hosts[0])?.name ?? hosts[0]! }) : uiMessage('extension.sites.addedMany', { count: hosts.length }));
      onClose();
      request.then?.();
    }, () => { if (current()) c.setNotice(uiMessage('extension.sites.denied')); }).finally(() => { if (current()) setBusy(false); });
  }
  const one = selected.length === 1 ? all.find(site => site.domain === selected[0]) : undefined;

  return <>
    {grants.error && <InlineFeedback tone="error" action={{ label: t('common.retry'), onClick: grants.retry }}>{t('common.error')}</InlineFeedback>}
    <div className={s.top}>
    <header className={s.head}>
      <h2 id="site-picker-title" className={s.title}>{t('extension.sites.add')}</h2>
      <IconButton size="sm" variant="quiet" className={s.close} label={t('common.close')} onClick={onClose}><X size={16} /></IconButton>
    </header>
    <div className={s.searchRow}>
      <Input type="search" enterKeyHint="done" aria-label={t('extension.sites.search')} leadingIcon={<Search size={16} />} placeholder={t('extension.sites.search')} value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && host) { event.preventDefault(); addTyped(host); } }} />
      <Button size="sm" disabled={!open.length} onClick={selectShown}>{t(every ? 'extension.sites.clearAll' : 'extension.sites.selectAll')}</Button>
    </div>
    {!q && <div className={s.chips} role="radiogroup" aria-label={t('extension.web.category')}>
      {filters.map(id => <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}>{t(`extension.web.category_${id}`)}</button>)}
    </div>}
    </div>
    <div className={s.grid}>
      {custom && <button type="button" className={s.tile} data-custom onClick={() => addTyped(custom)}>
        <span className={s.customMark} aria-hidden="true"><Plus size={16} /></span>
        <span className={s.tileText}><span className={s.tileName}>{t('extension.sites.addCustom', { host: custom })}</span></span>
      </button>}
      {shown.map(site => {
        const done = on(site.domain), picked = !done && selected.includes(site.domain);
        return <button key={site.domain} type="button" className={s.tile} disabled={done} data-done={done || undefined} aria-pressed={picked} onClick={() => toggle(site.domain)}>
          <SiteLogo site={site} off={done} />
          <span className={s.tileText}><span className={s.tileName}>{site.name}</span>{site.name !== site.domain && <span className={s.tileHost}>{site.domain}</span>}</span>
          <span className={s.mark} aria-hidden="true">{(done || picked) && <Check size={11} strokeWidth={3} />}</span>
        </button>;
      })}
    </div>
    {q && !shown.length && !custom && <p className={s.empty}>{t('extension.web.noMatch')}</p>}
    <footer className={s.foot}>
      <Button variant="surface" size="lg" className={s.primary} disabled={!selected.length || busy} aria-busy={busy || undefined} onClick={add}>
        {!selected.length ? t('extension.sites.choose') : one ? t('extension.sites.addOne', { name: one.name }) : <CountText text={t('extension.sites.addMany', { count: selected.length })} value={selected.length} />}
      </Button>
    </footer>
  </>;
}

/**
 * 网页互动 is on but Chrome does not allow this site: what it would draw here and the permission it needs, then 关闭网页互动
 * or 授权 — Chrome asks in the same click. When Chrome hides which site the tab is, the sheet points at the toolbar icon, which hands
 * the tab to Palside; the same sheet then names the site and offers 授权. 添加网站 stays for typing the address instead.
 */
export function GrantSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const target = useSocialUi().grant;
  const open = Boolean(target);
  const session = captureSocialUi();
  const opening = useRef<object | undefined>(undefined);
  useLayoutEffect(() => () => { opening.current = undefined; }, []);
  const snapshot = session.snapshot();
  const close = () => { if (session.snapshot() === snapshot) session.set({ grant: undefined }); };
  const host = c.pageHost;
  const site = host ? c.sites.find(item => item.domain === host) ?? { id: host, name: host, domain: host } : undefined;
  const name = site?.name ?? t('extension.web.thisSite');
  function allow() {
    if (!host) { close(); addSite(c, { tabId: c.live?.page?.tabId }); return; }
    // Chrome's prompt must open synchronously from this click.
    close();
    const id = {}; opening.current = id;
    const completion = session.snapshot();
    const current = () => session.current() && c.ownsAccess() && opening.current === id && session.snapshot() === completion;
    void requestSitesAccess([host]).then(allowed => { if (!current()) return; if (!allowed) c.setNotice(uiMessage('extension.sites.denied')); }, () => { if (current()) { c.setNotice(uiMessage('extension.sites.denied')); } });
  }
  return <Sheet open={open} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="grant-sheet-title" className={s.sheet}>
    {open && <div key={host ?? ''} className={s.swap}>
      <header className={s.head}>
        <SiteLogo site={site} />
        <h2 id="grant-sheet-title" className={s.title}>{name}<small>{host && host !== name ? t('extension.grant.hostUnauthorized', { host }) : t('extension.grant.unauthorized')}</small></h2>
        <IconButton size="sm" variant="quiet" className={s.close} label={t('common.close')} onClick={close}><X size={16} /></IconButton>
      </header>
      <Group title={target === 'danmaku' ? t('extension.room.pageDanmaku') : t('extension.settings.interaction')}>
        {target === 'danmaku' ? <Fact icon={<DanmakuIcon size={16} />} label={t('extension.room.name')}>{t('extension.grant.danmaku')}</Fact>
          : interactionFeatures.filter(feature => c.interaction[feature]).map(feature => <Fact key={feature} icon={featureIcons[feature]()} label={t(`extension.web.${feature}`)}>{t(`extension.grant.${feature}`)}</Fact>)}
      </Group>
      <Group title={t('extension.access.chrome')}>
        {host ? <Fact icon={<KeyRound size={16} />}>{t('extension.grant.access', { host })}</Fact>
          : <Fact icon={<img className={s.toolbarMark} src="/brand/palside.svg" width={16} height={16} alt="" draggable={false} />}>{t('extension.grant.toolbar')}</Fact>}
      </Group>
      <div className={s.actions}>
        <Button size="lg" className={s.soft} onClick={() => { close(); if (target === 'danmaku') void c.live?.command('danmaku-settings', { settings: { enabled: false } }).catch(() => {}); else void c.toggle('interact', false); }}>{target === 'danmaku' ? t('extension.grant.turnOffDanmaku') : t('extension.grant.turnOff')}</Button>
        <Button variant="surface" size="lg" className={s.primary} onClick={allow}>{host ? t('extension.grant.allow') : t('extension.sites.add')}</Button>
      </div>
    </div>}
  </Sheet>;
}

/**
 * 允许所有网站, from the bottom of 网站: what every site gains and Chrome's own words, then 授权 — Chrome asks in the same click.
 * The sites added one by one stay granted underneath.
 */
export function AllSitesSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const open = Boolean(useSocialUi().allSites);
  const session = captureSocialUi();
  const opening = useRef<object | undefined>(undefined);
  useLayoutEffect(() => () => { opening.current = undefined; }, []);
  const snapshot = session.snapshot();
  const close = () => { if (session.snapshot() === snapshot) session.set({ allSites: undefined }); };
  function allow() {
    // Chrome's prompt must open synchronously from this click.
    close();
    const id = {}; opening.current = id;
    const completion = session.snapshot();
    const current = () => session.current() && c.ownsAccess() && opening.current === id && session.snapshot() === completion;
    void requestAllSites().then(allowed => { if (current()) { c.setNotice(uiMessage(allowed ? 'extension.sites.allowedAll' : 'extension.sites.denied')); } }, () => { if (current()) { c.setNotice(uiMessage('extension.sites.denied')); } });
  }
  return <Sheet open={open} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="all-sites-title" className={s.sheet}>
    {open && <>
      <header className={s.head}>
        <span className={s.target} aria-hidden="true"><Globe2 size={16} /></span>
        <h2 id="all-sites-title" className={s.title}>{t('extension.sites.allSites')}</h2>
        <IconButton size="sm" variant="quiet" className={s.close} label={t('common.close')} onClick={close}><X size={16} /></IconButton>
      </header>
      <Group title={t('extension.sites.allowAllAnywhere')}>
        <Fact icon={<Layers size={16} />}>{t('extension.settings.interaction')}</Fact>
        <Fact icon={<DanmakuIcon size={16} />}>{t('extension.room.pageDanmaku')}</Fact>
        <Fact icon={<Coins size={16} />}>{t('extension.sites.tokenData')}</Fact>
        <Fact icon={<Scissors size={16} />}>{t('extension.sites.allowAllShot')}</Fact>
      </Group>
      <Group title={t('extension.access.chrome')}>
        <Fact icon={<KeyRound size={16} />}>{t('extension.sites.allowAllAccess')}</Fact>
      </Group>
      <div className={s.actions}>
        <Button size="lg" className={s.soft} onClick={close}>{t('common.cancel')}</Button>
        <Button variant="surface" size="lg" className={s.primary} onClick={allow}>{t('extension.grant.allow')}</Button>
      </div>
    </>}
  </Sheet>;
}
