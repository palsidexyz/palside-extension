'use client';
import { createContext, useContext, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Globe } from 'lucide-react';
import { Select } from '@palside/ui/select';
import type { LanguageState } from '../../../runtime/transport/language';
import type { LanguagePreference } from '@palside/i18n/locale';
export const LanguageContext = createContext<{ state?: LanguageState; connected: boolean; save: (value: LanguagePreference) => Promise<void> }>({ connected: false, save: async () => {} });
export function LanguageSetting({ compact = false, id = 'language' }: { compact?: boolean; id?: string }) {
  const { state, connected, save } = useContext(LanguageContext);
  const t = useTranslations('common');
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const value = state?.preference === 'auto' ? state.locale : state?.preference ?? 'en';
  return <span style={compact ? { width: 40, flex: '0 0 40px', marginInlineStart: 'auto' } : { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}><Select variant="ghost" leading={compact ? <Globe size={18} /> : undefined} id={compact ? undefined : id} aria-label={compact ? t('language') : undefined} compact={compact} value={value} disabled={!connected || busy} aria-busy={busy || undefined} options={[
    { value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' },
  ]} onChange={async event => {
    const value = event.target.value as LanguagePreference; setBusy(true); setFailed(false);
    try { await save(value); } catch (error) { if ((error as { code?: string }).code === 'LANGUAGE_SAVE_FAILED') setFailed(true); }
    finally { setBusy(false); }
  }} />{failed && <small role="alert">{t('saveFailed')}</small>}</span>;
}
