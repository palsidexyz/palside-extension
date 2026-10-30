import { websiteUrl } from '@palside/shared/navigation';

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
