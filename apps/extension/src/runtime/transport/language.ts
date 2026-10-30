import { languagePreference,languageStorageKey,resolveLanguage,type Locale,type LanguagePreference } from '@palside/i18n/locale';
export type LanguageState = { preference: LanguagePreference; locale: Locale };
type LanguageHost = {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  i18n: { getAcceptLanguages(): Promise<string[]>; getUILanguage(): string };
};
export async function readLanguage(host: LanguageHost): Promise<LanguageState> {
  let preference: LanguagePreference = 'auto';
  try { preference = languagePreference((await host.storage.local.get(languageStorageKey))[languageStorageKey]); } catch { /* Never overwrite an unreadable saved preference. */ }
  return { preference, locale: await resolveBrowserLanguage(host, preference) };
}
async function resolveBrowserLanguage(host: LanguageHost, preference: LanguagePreference): Promise<Locale> {
  if (preference !== 'auto') return preference;
  let candidates: string[] = [];
  try { candidates = await host.i18n.getAcceptLanguages(); } catch { /* Fall back to the UI language below. */ }
  if (!candidates.length) { try { candidates = [host.i18n.getUILanguage()]; } catch { /* English fallback. */ } }
  return resolveLanguage(preference, candidates);
}
/** One worker owns writes; storage commits precede broadcasts. Reconnects read the durable value. */
export function createLanguageController(host: LanguageHost, changed: (state: LanguageState) => void) {
  let state: LanguageState;
  let pending = readLanguage(host).then(value => { state = value; changed(value); });
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = pending.then(work); pending = result.then(() => {}, () => {}); return result;
  }
  return {
    get: async () => { await pending; return state; },
    refresh: () => serial(async () => {
      const locale = await resolveBrowserLanguage(host, state.preference);
      if (locale !== state.locale) { state = { ...state, locale }; changed(state); }
      return state;
    }),
    save: (value: unknown) => serial(async () => {
      const preference = languagePreference(value);
      const locale = await resolveBrowserLanguage(host, preference);
      await host.storage.local.set({ [languageStorageKey]: preference });
      state = { preference, locale }; changed(state); return state;
    }),
  };
}
