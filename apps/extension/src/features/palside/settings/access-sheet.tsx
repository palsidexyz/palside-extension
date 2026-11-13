'use client';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Button, IconButton } from '@palside/ui/button';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Globe2, KeyRound, Layers, Plus, Scissors, Search, X } from 'lucide-react';
import { Switch } from '@palside/ui/switch';
import { Input } from '@palside/ui/field';
import { siteRunning, turnSite } from './sites';
import { SiteFeatureTiles } from './site-feature-tiles';
import { requestAllSites, requestSitesAccess } from '../../../runtime/browser/permissions';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { CountText } from '../ui/motion-details';
import { siteRequestId } from './access';
import { askSiteAccess, pageSite, pageUnusable, useAsking } from '../viewing/page-key';
import { ChromeMark, DanmakuIcon } from '../ui/icons';
import { captureSocialUi, useSocialUi } from '../annotations/social-state';
import { Sheet } from '@palside/ui/sheet';
import { SiteFace, SiteLogo } from '../assets/site-logo';
import { siteCategories, siteCategory, siteOf, siteTags, type Site, type SiteCategory } from './site-catalog';
import { Tooltip } from '@palside/ui/tooltip';
import { siteAllowed, useGrants } from './use-grants';
import type { PalsideController } from '../app/use-palside';
import s from './access-sheet.module.css';

/** The host a search reads as an address, if it is one: a pasted link counts by its host. */
function typedHost(query: string) {
  const value = query.trim().toLowerCase();
  if (!value.includes('.')) return;
  try {
    return normalizeSiteHost(/^https?:\/\//.test(value) ? new URL(value).hostname : value.replace(/\/.*$/, ''));
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
  const accountId = c.data.self, teamId = c.current, tabId = c.live.page?.tabId, url = c.live.page?.url;
  const [context] = useState({ accountId, teamId, tabId, url });
  useLayoutEffect(() => {
    active.current = context.accountId === accountId && context.teamId === teamId && context.tabId === tabId && context.url === url;
    if (!active.current && session.snapshot()?.site === request) session.set({ site: undefined });
    return () => { active.current = false; };
  }, [request, session, context, accountId, teamId, tabId, url]);
  const current = () => active.current && session.current() && session.snapshot()?.site === request && c.ownsAccess()
    && (!request.accountId || request.accountId === c.data.self) && (!request.teamId || request.teamId === c.current)
    && (request.tabId === undefined || request.tabId === c.live.page?.tabId);

  const all: Site[] = [...c.sites, ...typed.filter(host => !c.sites.some(site => site.domain === host)).map(host => siteOf(c, host))];
  const on = (host: string) => siteAllowed(c, grants, host);
  const q = query.trim().toLowerCase();
  const host = typedHost(query);
  // Sites that recognize token pages lead every view, keeping their catalog order; the rest follow in theirs.
  const shown = (q ? all.filter(site => `${site.name} ${site.domain}`.toLowerCase().includes(q) || site.domain === host)
    : filter === 'all' ? all : all.filter(site => siteCategory(site.domain) === filter))
    .map(site => ({ site, token: siteTags(site.domain).token })).sort((a, b) => Number(b.token) - Number(a.token));
  const custom = host && !all.some(site => site.domain === host) ? host : undefined;
  const open = shown.filter(({ site }) => !on(site.domain)).map(({ site }) => site.domain);
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
    const asking = requestSitesAccess(hosts);
    void asking.then(added => {
      if (!current()) return;
      if (!added) { c.setNotice(uiMessage('extension.sites.denied')); return; }
      c.setNotice(hosts.length === 1 ? uiMessage('extension.sites.added', { name: all.find(site => site.domain === hosts[0])?.name ?? hosts[0]! }) : uiMessage('extension.sites.addedMany', { count: hosts.length }));
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
      {shown.map(({ site, token }) => {
        const done = on(site.domain), picked = !done && selected.includes(site.domain);
        const tile = <button key={site.domain} type="button" className={s.tile} disabled={done} data-done={done || undefined} aria-pressed={picked} onClick={() => toggle(site.domain)}>
          <SiteLogo site={site} off={done} />
          <span className={s.tileText}>
            <span className={s.tileLine}><span className={s.tileName}>{site.name}</span>{token && <span className={s.tag}>{t('extension.settings.tagToken')}</span>}</span>
            {site.name !== site.domain && <span className={s.tileHost}>{site.domain}</span>}
          </span>
          <span className={s.mark} aria-hidden="true">{(done || picked) && <Check size={11} strokeWidth={3} />}</span>
        </button>;
        return token ? <Tooltip key={site.domain} content={t('extension.sites.tokenTip')}>{tile}</Tooltip> : tile;
      })}
    </div>
    {q && !shown.length && !custom && <p className={s.empty}>{t('extension.web.noMatch')}</p>}
    <footer className={s.foot}>
      <Button variant="solid" size="lg" className={s.primary} disabled={!selected.length || busy} aria-busy={busy || undefined} onClick={add}>
        {!selected.length ? t('extension.sites.choose') : one ? t('extension.sites.addOne', { name: one.name }) : <CountText text={t('extension.sites.addMany', { count: selected.length })} value={selected.length} />}
      </Button>
    </footer>
  </>;
}

/**
 * The 网页互动 sheet, from the left half of the header capsule: the tab's site, Chrome's permission for it, then 网页互动 with the
 * site's 弹幕, 信号 and 共享画线. Switching 网页互动 on asks Chrome in the same click when the site is not allowed yet; off keeps Chrome's grant.
 */
export function GrantSheet({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const open = Boolean(useSocialUi().grant);
  const session = captureSocialUi();
  const snapshot = session.snapshot();
  const close = () => { if (session.snapshot() === snapshot) session.set({ grant: undefined }); };
  const unusable = pageUnusable(c);
  const host = unusable ? undefined : c.pageHost;
  const site = host ? pageSite(c) : undefined;
  return <Sheet open={open} onOpenChange={open => { if (!open) close(); }} boundarySelector="[data-palside-app]" aria-labelledby="grant-sheet-title" className={s.sheet}>
    {open && <div key={host ?? ''} className={s.swap}>
      <header className={s.head}>
        <SiteFace site={site} className={s.headLogo} />
        <h2 id="grant-sheet-title" className={s.title}>{site?.name ?? t('extension.web.thisPage')}{host && site?.name !== host && <small>{host}</small>}</h2>
        <IconButton size="sm" variant="quiet" className={s.close} label={t('common.close')} onClick={close}><X size={16} /></IconButton>
      </header>
      {host ? <SiteControls c={c} host={host} /> : <p className={s.note}>{t(unusable ? 'extension.web.pageUnusable' : 'extension.web.siteLoading')}</p>}
    </div>}
  </Sheet>;
}

/**
 * 网页互动 for one site: first a quiet line with Chrome's permission in Chrome's own words (已允许 / 未允许, never a switch), then
 * one card with the 网页互动 switch and the site's 弹幕, 信号 and 共享画线 tiles, shown even while it is off.
 */
export function SiteControls({ c, host }: { c: PalsideController; host: string }) {
  const t = useTranslations();
  const grants = useGrants(c);
  const waiting = useAsking();
  const allowed = siteAllowed(c, grants, host);
  const on = allowed && siteRunning(c, host);
  const busy = waiting === host;
  const session = captureSocialUi();
  function turn(next: boolean) {
    if (!next || allowed) { void turnSite(c, host, next); return; }
    const denied = () => { if (session.current()) c.setNotice(uiMessage('extension.sites.denied')); };
    // Chrome's prompt must open synchronously from this click.
    const asking = askSiteAccess(host);
    void asking.then(granted => { if (!session.current()) return; if (granted) void turnSite(c, host, true); else denied(); }, denied);
  }
  const label = t('extension.settings.interaction');
  return <>
    <div className={s.siteAccess}>
      <ChromeMark size={14} />
      <span>{t('extension.access.sites')}</span>
      <b data-on={allowed || undefined}>{t(allowed ? 'extension.privacy.allowed' : 'extension.privacy.notAllowed')}</b>
    </div>
    <section className={s.siteCard}>
      <div className={s.siteMaster}>
        <Layers size={16} />
        <span>{label}</span>
        <Switch hideLabel label={label} checked={on} disabled={busy} onChange={event => turn(event.currentTarget.checked)} />
      </div>
      <SiteFeatureTiles c={c} host={host} live={on} />
    </section>
  </>;
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
        <Fact icon={<Scissors size={16} />}>{t('extension.sites.allowAllShot')}</Fact>
      </Group>
      <Group title={t('extension.access.chrome')}>
        <Fact icon={<KeyRound size={16} />}>{t('extension.sites.allowAllAccess')}</Fact>
      </Group>
      <div className={s.actions}>
        <Button size="lg" className={s.soft} onClick={close}>{t('common.cancel')}</Button>
        <Button variant="solid" size="lg" className={s.primary} onClick={allow}>{t('extension.grant.allow')}</Button>
      </div>
    </>}
  </Sheet>;
}
