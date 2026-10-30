'use client';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { Star, X } from 'lucide-react';
import { pageScopeUrl } from '../../../domain/annotations/social';
import { normalizeSiteHost } from '../../../domain/assets/site-host';
import { captureSocialUi, openWithReturn } from '../annotations/social-state';
import { currentPage } from '../viewing/page-strip';
import { SettingGroup } from '../settings/setting-rows';
import { SiteLogo } from '../assets/site-logo';
import { siteForUrl, type Site } from '../settings/site-catalog';
import { Action, Token } from '../ui/primitives';
import { EmptyState } from '../chat/history-scope';
import type { Viewing } from '../../../domain/assets/model';
import type { PalsideController } from '../app/use-palside';
import s from '../app/pages.module.css';

const LIMIT = 200;

/** Save or remove a page by its canonical public URL. */
export function toggleFavoritePage(c: PalsideController, view: Pick<Viewing, 'url' | 'name'>) {
  const url = pageScopeUrl(view.url);
  if (!url) return;
  const saved = c.favorites.pages.some(page => page.url === url);
  if (!saved && c.favorites.pages.length >= LIMIT) { c.setNotice(uiMessage('extension.web.favoritesFull', { count: LIMIT })); return; }
  void c.setFavorites(old => ({ ...old, pages: saved ? old.pages.filter(page => page.url !== url) : [{ url, title: view.name.slice(0, 200) }, ...old.pages] })).catch(error => c.setNotice(errorMessage(error)));
}
export function isFavoritePage(c: PalsideController, url: string) {
  const scope = pageScopeUrl(url);
  return Boolean(scope && c.favorites.pages.some(page => page.url === scope));
}
function toggleFavoriteSite(c: PalsideController, host: string) {
  const saved = c.favorites.sites.includes(host);
  if (!saved && c.favorites.sites.length >= LIMIT) { c.setNotice(uiMessage('extension.web.favoritesFull', { count: LIMIT })); return; }
  void c.setFavorites(old => ({ ...old, sites: saved ? old.sites.filter(item => item !== host) : [host, ...old.sites] })).catch(error => c.setNotice(errorMessage(error)));
}

/** 收藏: whole websites and single pages, for this account on this device. The open tab can be saved from the top;
 * empty groups stay hidden and an empty list shows one centred state. */
export function Favorites({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const view = currentPage(c);
  const host = normalizeSiteHost(c.live?.page?.host);
  const site: Site | undefined = host ? c.sites.find(item => item.domain === host) ?? { id: host, name: host, domain: host } : undefined;
  const pageSaved = Boolean(view && isFavoritePage(c, view.url));
  const siteSaved = Boolean(host && c.favorites.sites.includes(host));
  const open = (url: string) => { const session = captureSocialUi(); if (c.live) void openWithReturn(c.live, url).catch(error => { if (session.current()) c.setNotice(errorMessage(error)); }); else window.open(url, '_blank', 'noopener'); };
  const sites = c.favorites.sites.map(domain => c.sites.find(item => item.domain === domain) ?? { id: domain, name: domain, domain });
  const star = (on: boolean) => <Star size={16} className={on ? s.starOn : s.star} aria-hidden="true" />;
  return <div className={s.page} data-fill>
    {view && site && <div className={s.card}>
      <button type="button" className={s.row} aria-pressed={pageSaved} onClick={() => toggleFavoritePage(c, view)}>
        <Token view={view} size="sm" /><span className={s.text}><strong>{view.name}</strong><small>{t('extension.web.thisPage')}</small></span>{star(pageSaved)}
      </button>
      <button type="button" className={s.row} aria-pressed={siteSaved} onClick={() => toggleFavoriteSite(c, site.domain)}>
        <SiteLogo site={site} size="sm" /><span className={s.text}><strong>{site.name}</strong><small>{t('extension.web.thisSite')}</small></span>{star(siteSaved)}
      </button>
    </div>}
    {sites.length > 0 && <SettingGroup title={t('extension.center.sites')} aside={sites.length}>
      <div className={s.options}><div className={s.grid}>{sites.map(item => <div key={item.domain} className={s.favorite}>
        <SiteLogo site={item} size="sm" /><a className={s.siteName} href={`https://${item.domain}/`} onClick={event => { event.preventDefault(); open(`https://${item.domain}/`); }}>{item.name}</a>
        <Action label={t('extension.web.unsave', { name: item.name })} onClick={() => toggleFavoriteSite(c, item.domain)}><X size={13} /></Action>
      </div>)}</div></div>
    </SettingGroup>}
    {c.favorites.pages.length > 0 && <SettingGroup title={t('extension.web.pages')} aside={c.favorites.pages.length}>
      {c.favorites.pages.map(item => <div key={item.url} className={s.row}>
        <SiteLogo site={siteForUrl(item.url, c.sites)} size="sm" />
        <button type="button" className={s.rowLink} onClick={() => open(item.url)}><strong>{item.title}</strong><small>{new URL(item.url).hostname}</small></button>
        <Action label={t('extension.web.unsave', { name: item.title })} onClick={() => toggleFavoritePage(c, { url: item.url, name: item.title })}><X size={14} /></Action>
      </div>)}
    </SettingGroup>}
    {!sites.length && !c.favorites.pages.length && <EmptyState icon={<Star />} title={t('extension.web.noFavorites')} fill={!(view && site)} />}
  </div>;
}
