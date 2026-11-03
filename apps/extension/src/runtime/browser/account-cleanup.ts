import { browser } from 'wxt/browser';

export async function clearBrowserAccount(accountId: string, preservePreferences: boolean) {
  // Outside the extension (integration pages) there is no background holding per-account browser data.
  if (!browser?.runtime?.id) return;
  const result = await browser.runtime.sendMessage({ type: 'palside/account-cleanup', accountId, preservePreferences });
  if (!result?.ok) throw new Error('Account cleanup failed');
}
