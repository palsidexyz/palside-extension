import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { IntlProvider } from 'use-intl';
import { browser } from 'wxt/browser';
import { messagesFor, translator } from '@palside/i18n';
import { InstalledPage } from '../../src/features/palside/welcome/installed-page';
import { useAppearance } from '../../src/features/palside/settings/appearance';
import { readLanguage, type LanguageState } from '../../src/runtime/transport/language';
import '@palside/design/fonts.css';
import '../../src/styles.css';

const websiteUrl = (import.meta.env.WXT_WEBSITE_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Opened once after install, in an ordinary tab: open the panel now, and keep Palside on the toolbar. */
function WelcomeTab() {
  const [language, setLanguage] = useState<LanguageState>();
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    const refresh = () => { void readLanguage(browser).then(value => { if (active) { setLanguage(value); document.documentElement.lang = value.locale; } }); };
    refresh(); browser.storage.onChanged.addListener(refresh);
    return () => { active = false; browser.storage.onChanged.removeListener(refresh); };
  }, []);
  const locale = language?.locale ?? 'en';
  const fallback = useCallback(() => translator(locale)('common.error'), [locale]);
  return <main data-palside-app data-appearance={appearance} style={{ height: '100%', background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
    {language && <IntlProvider locale={locale} messages={messagesFor(locale)} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} getMessageFallback={fallback}>
      <InstalledPage host={browser} websiteUrl={`${websiteUrl}/${locale}`} />
    </IntlProvider>}
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Palside root element is missing');
ReactDOM.createRoot(root).render(<React.StrictMode><WelcomeTab /></React.StrictMode>);
