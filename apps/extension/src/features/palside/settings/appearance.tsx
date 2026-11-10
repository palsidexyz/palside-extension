'use client';

import { useTranslations } from 'use-intl';
import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Select } from '@palside/ui/select';
import { ValueSelect } from './setting-rows';

type Appearance = 'system' | 'light' | 'dark';
const key = 'palside:appearance';
const changed = 'palside:appearance-change';
let fallback: Appearance = 'system';
function read(): Appearance {
  try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return fallback; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
  window.addEventListener('storage', storage);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changed, listener); };
}
export function useAppearance() { return useSyncExternalStore(subscribe, read, () => 'system' as const); }
function save(value: Appearance) {
  fallback = value;
  try { localStorage.setItem(key, value); } catch { /* Keep this window usable when storage is unavailable. */ }
  window.dispatchEvent(new Event(changed));
}
const glyphs = { system: Monitor, light: Sun, dark: Moon };
/** Reads like the language row: the current value as quiet text with an up-down mark. Compact is the signed-out header's
    bare glyph beside the globe; the glyph itself names the current choice. */
export function AppearanceSetting({ compact = false }: { compact?: boolean }) {
  const t = useTranslations();
  const appearance = useAppearance();
  const options = [['system', t('extension.copy.browserDefault')], ['light', t('extension.copy.light')], ['dark', t('extension.copy.dark')]] as const;
  const change = (event: { target: { value: string } }) => save(event.target.value as Appearance);
  if (!compact) return <ValueSelect id="appearance" value={appearance} options={options} onChange={change} />;
  const Glyph = glyphs[appearance];
  return <span style={{ width: 40, flex: '0 0 40px' }}><Select variant="ghost" compact leading={<Glyph size={18} />} aria-label={t('extension.copy.appearance')} value={appearance} options={options.map(([value, label]) => ({ value, label }))} onChange={change} /></span>;
}
