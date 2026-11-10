import { websiteUrl } from '@palside/shared/navigation';

/** The host a person reads for a link: no scheme, no leading www. Not a URL: undefined. */
export function displayHost(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return undefined; }
}

/** Exact public DNS hosts only; URL parsing supplies case folding and IDNA normalization. */
export function normalizeSiteHost(input: unknown): string | undefined {
  if (typeof input !== 'string') return;
  const value = input.trim();
  if (!value || /[\s/:@\\?#%*\[\]]/u.test(value)) return;
  const host = websiteUrl(`https://${value}`)?.hostname;
  if (!host) return;
  if (host.length > 253 || !host.includes('.') || /^\d+(?:\.\d+)*$/.test(host)) return;
  const labels = host.split('.');
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return;
  return host;
}
