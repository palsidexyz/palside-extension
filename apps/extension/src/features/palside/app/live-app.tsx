import { Spinner } from '@palside/ui/spinner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IntlProvider, useTranslations } from 'use-intl';
import { browser } from 'wxt/browser';
import { messagesFor, translator, type TextValue, type LanguagePreference } from '@palside/i18n';
import { PUBLIC_LINKS } from '@palside/shared/public-links';
import { useText } from '../ui/text';
import { useAppearance } from '../settings/appearance';
import { LanguageContext, LanguageSetting } from '../settings/language-setting';
import { PalsideApp } from './palside-app';
import { siteCatalog } from '../settings/site-catalog';
import { RotateCcw, Unplug } from 'lucide-react';
import { Button } from '@palside/ui/button';
import s from './live-app.module.css';
import { command, onOpenRoom, onOpenSticky, openPage, observeState } from '../../../runtime/transport/bridge';
import { setSocialUi } from '../annotations/social-state';
import { readLanguage, type LanguageState } from '../../../runtime/transport/language';
import type { RuntimeState } from '../../../runtime/composition/runtime-state';
import type { DanmakuSettings, PageStatus } from '../../../runtime/browser/page-protocol';
function Banned({ expiresAt }: { expiresAt: number | null }) {
  const t = useTranslations(), appearance = useAppearance();
  return <main data-palside-app data-appearance={appearance} className={s.shell}><header className={s.header}><LanguageSetting compact /></header><section className={s.state} role="alert"><h1 className={s.title}>{t('extension.ban.title')}</h1><p className={s.detail}>{expiresAt === null ? t('extension.ban.permanent', { email: PUBLIC_LINKS.contactEmail }) : t('extension.ban.temporary', { date: new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(expiresAt), email: PUBLIC_LINKS.contactEmail })}</p><Button onClick={() => { void command('logout').catch(() => {}); }}>{t('extension.copy.signOut')}</Button></section></main>;
}
function Loading({ error }: { error: TextValue }) {
  const t = useTranslations('common'); const text = useText(); const appearance = useAppearance();
  return <main data-palside-app data-appearance={appearance} className={s.shell}>
    <header className={s.header}><LanguageSetting compact /></header>
    {error ? <section className={s.state} role="alert">
      <span className={s.badge} aria-hidden="true"><Unplug size={22} /></span>
      <h1 className={s.title}>{t('connectionLostTitle')}</h1>
      <p className={s.detail}>{text(error)}</p>
      <Button className={s.action} variant="primary" leadingIcon={<RotateCcw size={16} />} onClick={() => { void command('snapshot').catch(() => {}).finally(() => location.reload()); }}>{t('retry')}</Button>
    </section> : <section className={s.state} role="status">
      <Spinner className={s.loadingIcon} size={22} />
      <p className={s.detail}>{t('loading')}</p>
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
  const capturedListeners = useRef(new Set<(capture: { src: string; teamId?: string }) => void>());
  const onCaptured = useCallback((listener: (capture: { src: string; teamId?: string }) => void) => {
    capturedListeners.current.add(listener);
    return () => capturedListeners.current.delete(listener);
  }, []);
  useEffect(() => {
    let active = true; let received = false;
    const unsubscribe = observeState({
      onState: setState, onError: setError, onPage: setPage, onDanmaku: setDanmaku,
      onLanguage: value => { received = true; setLanguage(value); setConnected(true); },
      onDisconnect: () => { setConnected(false); },
      onCaptured: capture => { for (const listener of capturedListeners.current) listener(capture); },
    });
    // Only cold-start failure needs a local, read-only fallback. Keep the last confirmed language on disconnect.
    const timer = setTimeout(() => { if (!received) void readLanguage(browser).then(value => { if (active && !received) { setLanguage(value); setError({ key: 'common.connectionLost' }); } }); }, 2000);
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, []);
  // A pin clicked on the page opens the 便利贴 list at that note.
  const latest = useRef({ state, page });
  useEffect(() => { latest.current = { state, page }; }, [state, page]);
  useEffect(() => onOpenSticky(request => {
    if (request.teamId && request.teamId !== latest.current.state?.preferences.current) return;
    const item = latest.current.state?.items.stickies?.find(item => item.id === request.id);
    const asset = item?.asset;
    const url = item?.url ?? request.url;
    if (asset || url) setSocialUi({ stickies: { asset, url, focus: request.id } });
  }), []);
  useEffect(() => { if (language) document.documentElement.lang = language.locale; }, [language]);
  const save = useCallback(async (preference: LanguagePreference) => { await command('language', { preference }); }, []);
  const locale = language?.locale ?? 'en';
  const getMessageFallback = useCallback(() => translator(locale)('common.error'), [locale]);
  const live = useMemo(() => state ? { state, command, openPage, page, danmaku, onCaptured, onOpenRoom } : undefined, [state, page, danmaku, onCaptured]);
  if (!language) return <main data-palside-app data-appearance={appearance} aria-busy="true" style={{ height: '100%', background: 'var(--ui-canvas)' }} />;
  return <IntlProvider timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} locale={language.locale} messages={messagesFor(language.locale)} getMessageFallback={getMessageFallback}>
    <LanguageContext.Provider value={{ state: language, connected, save }}>
      {state?.banned ? <Banned expiresAt={state.banned.expiresAt} /> : !state?.ready ? <Loading error={error} /> : <PalsideApp data={state.data} sites={siteCatalog} live={live} deliver={async () => { throw new Error('Send service is unavailable'); }} />}
    </LanguageContext.Provider>
  </IntlProvider>;
}
