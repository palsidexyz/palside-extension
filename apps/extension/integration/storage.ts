import { ClientStorage, DraftConflictError, type RevisionedDraft } from '../src/runtime/storage/storage';
import { autoRun, reviewStatus } from './review-harness';

const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#result')!;
const DAY = 86_400_000, MiB = 1024 * 1024;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function run() {
  button.disabled = true;
  const name = `palside-storage-qa-${crypto.randomUUID()}`;
  const first = new ClientStorage(name), second = new ClientStorage(name); const now = Date.now();
  const result: { checks: string[]; retainedCacheBytes?: number; cleaned?: boolean; error?: string } = { checks: [] };
  output.textContent = '正在验证独立数据库…';
  try {
    await first.updateDraft('a', 'team', { text: 'initial' }, 0, { text: '' });
    const changes = await Promise.allSettled([
      first.updateDraft('a', 'team', { text: 'window-a' }, 1, { text: '' }),
      second.updateDraft('a', 'team', { text: 'window-b' }, 1, { text: '' }),
    ]);
    check(changes.filter(change => change.status === 'fulfilled').length === 1, 'Concurrent drafts overwrote each other');
    check(changes.some(change => change.status === 'rejected' && change.reason instanceof DraftConflictError), 'Conflict was not explicit');
    const saved = await first.get<RevisionedDraft<{ text: string }>>('a:draft:team');
    check(saved?.revision === 2, 'Draft revision did not commit');
    check(!await first.clearSentDraft('a', 'team', 1, { text: '' }), 'Old acknowledgement erased new draft');
    result.checks.push('Independent IndexedDB connections serialize conflicting drafts; stale send acknowledgement preserves the new draft');
    await first.put('a:preferences', 'a', 'preferences', { site: 'test' });
    await first.put('a:protected', 'a', 'protected-fixture', 'not-a-real-key');
    await first.put('b:protected', 'b', 'protected-fixture', 'other-account');
    await first.put('a:outgoing', 'a', 'outgoing', 'unsent-fixture', now + DAY);
    await first.put('a:report', 'a', 'report', 'report-fixture', now + DAY);
    await first.cache('a', 'oldest', { payload: 'a'.repeat(40 * MiB) }, now + 30 * DAY);
    await first.cache('a', 'middle', { payload: 'b'.repeat(40 * MiB) }, now + 30 * DAY);
    await first.cache('a', 'latest', { payload: 'c'.repeat(30 * MiB) }, now + 30 * DAY);
    const cache = await first.rows('a', 'cache'); result.retainedCacheBytes = cache.reduce((total, row) => total + (row.bytes ?? 0), 0);
    check(result.retainedCacheBytes <= 100 * MiB && cache.length === 2 && !cache.some(row => row.key.endsWith(':oldest')), 'Cache did not evict oldest content at 100 MiB');
    check((await first.get<RevisionedDraft<{ text: string }>>('a:draft:team'))?.value.text === saved.value.text, 'Cache eviction erased draft');
    check(await first.get('a:protected') === 'not-a-real-key', 'Cache eviction erased non-cache records');
    result.checks.push('110 MiB of synthetic content evicts oldest cache and preserves drafts and non-cache records');
    const evicted = await first.cache('a', 'media:blob', new Blob([new Uint8Array(40 * MiB)], { type: 'application/octet-stream' }), now + 30 * DAY);
    check(evicted.includes('a:cache:middle'), 'Binary cache did not share the text cache budget');
    const binary = await second.get<Blob>('a:cache:media:blob');
    check(binary instanceof Blob && binary.size === 40 * MiB, 'Binary cache did not survive another connection');
    const combined = await first.rows('a', 'cache'); result.retainedCacheBytes = combined.reduce((total, row) => total + (row.bytes ?? 0), 0);
    check(result.retainedCacheBytes <= 100 * MiB, 'Binary and metadata exceeded their shared budget');
    result.checks.push('Binary Blob data and message metadata share the 100 MiB budget and report evicted keys');
    await first.cleanup(now + 2 * DAY);
    check(!await first.get('a:outgoing') && !await first.get('a:report') && await first.get('a:draft:team'), 'One-day expiry crossed the draft boundary');
    await first.cleanup(now + 8 * DAY); check(!await first.get('a:draft:team'), 'Seven-day draft expiry failed');
    check(await first.get('a:protected'), 'Expiry cleanup erased undated protected record');
    result.checks.push('One-day outgoing/report expiry and seven-day draft expiry are isolated from undated records');
    await first.clearAccount('a');
    check((await first.rows('a')).every(row => row.kind === 'preferences'), 'Account cleanup retained private rows');
    check(await first.get('a:preferences') && await first.get('b:protected'), 'Logout erased retained preferences or another account');
    await first.clearAccount('a', false); check((await first.rows('a')).length === 0, 'Full account cleanup left preferences');
    result.checks.push('Account cleanup preserves preferences only when requested and leaves other accounts untouched');
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  finally {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    result.cleaned = true; output.textContent = JSON.stringify(result, null, 2); button.disabled = false;
    reviewStatus(result.error ? 'failed' : 'passed');
  }
}
button.addEventListener('click', () => void run());
if (autoRun) void run();
