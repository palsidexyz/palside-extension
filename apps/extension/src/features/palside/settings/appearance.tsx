'use client';

import { useTranslations } from 'use-intl';
import { useSyncExternalStore } from 'react';
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
/** Reads like the language row: the current value as quiet text with an up-down mark. */
export function AppearanceSetting() {
  const t = useTranslations();
  const appearance = useAppearance();
  return <ValueSelect id="appearance" value={appearance} options={[['system', t('extension.copy.browserDefault')], ['light', t('extension.copy.light')], ['dark', t('extension.copy.dark')]]} onChange={event => {
    const value = event.target.value as Appearance;
    fallback = value;
    try { localStorage.setItem(key, value); } catch { /* Keep this window usable when storage is unavailable. */ }
    window.dispatchEvent(new Event(changed));
  }} />;
}
