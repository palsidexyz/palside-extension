import styles from './language-button-review.module.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider, useTranslations } from 'use-intl';
import { Globe } from 'lucide-react';
import { messagesFor, type LanguagePreference } from '@palside/i18n';
import { createLanguageController, type LanguageState } from '../src/runtime/transport/language';
import { LanguageContext, LanguageSetting } from '../src/features/palside/settings/language-setting';
import { SettingControl, SettingGroup, settingRows } from '../src/features/palside/settings/setting-rows';
import shell from '../src/features/palside/app/live-app.module.css';
import '@palside/design/fonts.css';
import '../src/styles.css';

// Controlled fixture for the language selector only: storage and browser languages are local stubs.
let stored: LanguagePreference = 'auto'; let failSave = false; let delay = 400;
const listeners = new Set<(value: LanguageState) => void>();
const language = createLanguageController({
  storage: { local: { get: async () => ({ 'palside:language': stored }), set: async values => { await new Promise(resolve => setTimeout(resolve, delay)); if (failSave) throw new Error('Fixture storage failure'); stored = values['palside:language'] as LanguagePreference; } } },
  i18n: { getAcceptLanguages: async () => ['zh-CN'], getUILanguage: () => 'zh-CN' },
}, value => { for (const listener of listeners) listener(value); });

function Sample({ appearance }: { appearance: 'light' | 'dark' }) {
  const t = useTranslations('common'); const id = `language-${appearance}`;
  return <section data-palside-app data-appearance={appearance} className={styles.surface} style={{ width: 360, maxWidth: '100%', overflow: 'hidden', background: 'var(--ui-canvas)', color: 'var(--ui-text-primary)' }}>
    <div className={shell.shell} style={{ height: 'auto', paddingBottom: 8 }}>
      <header className={shell.header}><LanguageSetting compact /></header>
    </div>
    <div style={{ padding: '0 8px 12px' }}>
      <SettingGroup><SettingControl icon={<Globe size={16} />}><label className={settingRows.label} htmlFor={id}>{t('language')}</label><LanguageSetting id={id} /></SettingControl></SettingGroup>
    </div>
  </section>;
}

function Review() {
  const [lang, setLang] = useState<LanguageState>({ preference: 'auto', locale: 'zh-CN' });
  const [connected, setConnected] = useState(true);
  const [failing, setFailing] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => { listeners.add(setLang); void language.get().then(setLang); return () => { listeners.delete(setLang); }; }, []);
  const save = useCallback(async (value: LanguagePreference) => { try { await language.save(value); } catch { throw Object.assign(new Error('Fixture write failed'), { code: 'LANGUAGE_SAVE_FAILED' }); } }, []);
  return <>
    <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: 12, fontSize: 12, background: '#eee', color: '#111' }}>
      <span>语言按钮 · 幽灵样式 · 偏好只存于本页内存</span>
      <label><input type="checkbox" checked={!connected} onChange={event => setConnected(!event.target.checked)} />断开（禁用）</label>
      <label><input type="checkbox" checked={failing} onChange={event => { failSave = event.target.checked; setFailing(event.target.checked); }} />保存失败</label>
      <label><input type="checkbox" checked={slow} onChange={event => { delay = event.target.checked ? 3000 : 400; setSlow(event.target.checked); }} />慢保存 3s</label>
      <button onClick={() => { stored = 'auto'; void language.get().then(setLang); }}>重置为自动</button>
      <a href="/surface-review.html">阴影排查 →</a>
      <output data-testid="language-result">{JSON.stringify(lang)}</output>
    </nav>
    <IntlProvider locale={lang.locale} messages={messagesFor(lang.locale)} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      <LanguageContext.Provider value={{ state: lang, connected, save }}>
        <main style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', padding: 24 }}>
          <Sample appearance="light" />
          <Sample appearance="dark" />
        </main>
      </LanguageContext.Provider>
    </IntlProvider>
  </>;
}
createRoot(document.getElementById('root')!).render(<Review />);
