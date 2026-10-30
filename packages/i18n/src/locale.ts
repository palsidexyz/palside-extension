export const locales = ['en', 'zh-CN'] as const;
export type Locale = typeof locales[number];
export type LanguagePreference = Locale | 'auto';
export const languageStorageKey = 'palside:language';
export const languageCookie = 'palside_locale';
export function isLocale(value: unknown): value is Locale { return value === 'en' || value === 'zh-CN'; }
export function localeOrEnglish(value: unknown): Locale { return isLocale(value) ? value : 'en'; }
export function languagePreference(value: unknown): LanguagePreference { return isLocale(value) ? value : 'auto'; }
export function matchLanguages(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    try {
      const language = new Intl.Locale(candidate).language;
      if (language === 'en') return 'en';
      if (language === 'zh') return 'zh-CN';
    } catch { /* Ignore malformed browser signals. */ }
  }
  return 'en';
}
export function acceptLanguages(header: string | null): string[] {
  return (header ?? '').split(',').map((part, index) => {
    const [tag = '', ...parameters] = part.trim().split(';');
    const quality = parameters.length ? parameters.join(';').trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i)?.[1] : '1';
    return { tag: tag.trim(), quality: quality === undefined ? 0 : Number(quality), index };
  }).filter(item => item.quality > 0 && item.tag !== '*').sort((a, b) => b.quality - a.quality || a.index - b.index).map(item => item.tag);
}
export function resolveLanguage(preference: unknown, candidates: readonly string[]): Locale {
  return isLocale(preference) ? preference : matchLanguages(candidates);
}
export function localizedPath(pathname: string, locale?: Locale): string {
  const path = pathname.replace(/^\/(en|zh-CN)(?=\/|$)/, '') || '/';
  return locale ? `/${locale}${path === '/' ? '' : path}` : path;
}
