import type { ClientStorage } from '../storage/storage';

/** All durable content, including the offline directory, uses cache records. */
export async function cacheUsage(storage: Pick<ClientStorage, 'cacheBytes'>): Promise<{ bytes: number }> {
  return { bytes: await storage.cacheBytes() };
}

export async function clearCache(
  storage: Pick<ClientStorage, 'clearCache' | 'cacheBytes'>,
): Promise<{ bytes: number }> {
  await storage.clearCache();
  return cacheUsage(storage);
}
