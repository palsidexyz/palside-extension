import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IntlProvider, useTranslations } from 'use-intl';
import { browser } from 'wxt/browser';
import { messagesFor, translator, type TextValue, type LanguagePreference } from '@palside/i18n';
import { PUBLIC_LINKS } from '@palside/shared/public-links';
import { PageState } from '../ui/page-state';
import { Brand } from '../ui/brand';
import { useAppearance } from '../settings/appearance';
import { LanguageContext, LanguageSetting } from '../settings/language-setting';
import { PalsideApp } from './palside-app';
import type { LivePort } from './live-port';
import { RotateCcw } from 'lucide-react';
import { Button } from '@palside/ui/button';
import s from './live-app.module.css';
import { command, onFollowStatus, onOpenRoom, openPage, observeState, requestFollow } from '../../../runtime/transport/bridge';
import { readLanguage, type LanguageState } from '../../../runtime/transport/language';
import type { RuntimeState } from '../../../runtime/composition/runtime-state';
import type { DanmakuSettings, PageStatus } from '../../../runtime/browser/page-protocol';
import type { SiteIcon } from '../../../domain/assets/site-icon';
import { Band, MarkLogo } from '../ui/wait';
import type { UpdateStatus } from '../../../runtime/browser/extension-update';
function Banned({ expiresAt }: { expiresAt: number | null }) {
  const t = useTranslations(), appearance = useAppearance();
  return <main data-palside-app data-appearance={appearance} className={s.shell}><header className={s.header}><Brand /><LanguageSetting compact /></header><section className={s.state} role="alert"><h1 className={s.title}>{t('extension.ban.title')}</h1><p className={s.detail}>{expiresAt === null ? t('extension.ban.permanent', { email: PUBLIC_LINKS.contactEmail }) : t('extension.ban.temporary', { date: new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(expiresAt), email: PUBLIC_LINKS.contactEmail })}</p><Button onClick={() => { void command('logout').catch(() => {}); }}>{t('extension.copy.signOut')}</Button></section></main>;
}
function Loading({ error }: { error: TextValue }) {
  const t = useTranslations('common'); const appearance = useAppearance();
  // Startup failure uses the same page state as a lost connection with no cached squads: brand, one sentence, one action.
  return <main data-palside-app data-appearance={appearance} className={s.shell}>
    <header className={s.header}>{error ? <Brand /> : <span />}<LanguageSetting compact /></header>
    {error ? <PageState title={t('connectionLostTitle')} action={<Button variant="surface" leadingIcon={<RotateCcw size={16} />} onClick={() => { void command('snapshot').catch(() => {}).finally(() => location.reload()); }}>{t('retry')}</Button>} />
      : <section className={s.state} role="status">
        <span className={s.mark} aria-hidden="true"><MarkLogo blink /></span>
        <p className={s.detail}><Band>{t('opening')}</Band></p>
      </section>}
  </main>;
}
export function LiveApp() {
  const appearance = useAppearance();
  const [state, setState] = useState<RuntimeState>();
  const [error, setError] = useState<TextValue>('');
  const [language, setLanguage] = useState<LanguageState>();
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<PageStatus>();
  const [danmaku, setDanmaku] = useState<DanmakuSettings>();
  const [siteIcons, setSiteIcons] = useState<Record<string, SiteIcon>>({});
  const [update, setUpdate] = useState<UpdateStatus>({});
  const capturedListeners = useRef(new Set<(capture: { src: string; teamId?: string }) => void>());
  const onCaptured = useCallback((listener: (capture: { src: string; teamId?: string }) => void) => {
    capturedListeners.current.add(listener);
    return () => capturedListeners.current.delete(listener);
  }, []);
  useEffect(() => {
    let active = true; let received = false;
    const unsubscribe = observeState({
      onState: setState, onError: setError, onPage: setPage, onDanmaku: setDanmaku, onSiteIcons: setSiteIcons, onUpdate: setUpdate,
      onLanguage: value => { received = true; setLanguage(value); setConnected(true); },
      onDisconnect: () => { setConnected(false); },
      onCaptured: capture => { for (const listener of capturedListeners.current) listener(capture); },
    });
    // Only cold-start failure needs a local, read-only fallback. Keep the last confirmed language on disconnect.
    const timer = setTimeout(() => { if (!received) void readLanguage(browser).then(value => { if (active && !received) { setLanguage(value); setError({ key: 'common.connectionLost' }); } }); }, 2000);
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, []);
  useEffect(() => { if (language) document.documentElement.lang = language.locale; }, [language]);
  const save = useCallback(async (preference: LanguagePreference) => { await command('language', { preference }); }, []);
  const locale = language?.locale ?? 'en';
  const getMessageFallback = useCallback(() => translator(locale)('common.error'), [locale]);
  const live = useMemo(() => state ? { state, command, openPage, page, danmaku, siteIcons, update, onCaptured, onOpenRoom, follow: requestFollow, onFollowStatus } : undefined, [state, page, danmaku, siteIcons, update, onCaptured]);
  if (!language) return <main data-palside-app data-appearance={appearance} aria-busy="true" style={{ height: '100%', background: 'var(--ui-canvas)' }} />;
  return <IntlProvider timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} locale={language.locale} messages={messagesFor(language.locale)} getMessageFallback={getMessageFallback}>
    <LanguageContext.Provider value={{ state: language, connected, save }}>
      {state?.banned ? <Banned expiresAt={state.banned.expiresAt} /> : !state?.ready ? <Loading error={error} /> : <PalsideApp live={live as LivePort} />}
    </LanguageContext.Provider>
  </IntlProvider>;
}
