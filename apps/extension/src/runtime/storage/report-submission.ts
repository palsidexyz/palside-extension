import { message as uiMessage,MessageError } from '@palside/i18n';
import type { Api } from '../transport/api';
import type { ClientStorage } from './storage';
import type { ReportSubmission } from '@palside/shared/contracts/reports';

type ReportStorage = Pick<ClientStorage, 'get' | 'put' | 'removeIfValue'>;
const submissions = new WeakMap<ReportStorage, Map<string, Promise<Result>>>();

type Result = { submitted: true; recovered?: boolean } | { pending: true };

/** Manual retries keep one frozen payload and key; no background resubmission. */
export async function submitReport(api: Pick<Api, 'request'>, storage: ReportStorage, account: string, key: string, makeBody: () => Promise<ReportSubmission>, guard: () => void, scope = key): Promise<Result> {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new MessageError(uiMessage('extension.runtime.reportExpired'));
  const record = `${account}:report-submit:${scope}`;
  guard();
  let active = submissions.get(storage);
  if (!active) { active = new Map(); submissions.set(storage, active); }
  const current = active.get(record);
  if (current) {
    try { return await current; } finally { guard(); }
  }
  const attempt = runSubmission(api, storage, account, record, key, makeBody, guard);
  active.set(record, attempt);
  try { return await attempt; } finally { active.delete(record); }
}

async function runSubmission(api: Pick<Api, 'request'>, storage: ReportStorage, account: string, record: string, key: string, makeBody: () => Promise<ReportSubmission>, guard: () => void): Promise<Result> {
  // The single runtime host shares each account/target reservation through completion.
  let reservation = await storage.get<string>(record); guard();
  const pending = reservation ? JSON.parse(reservation) as { key: string; body: ReportSubmission } : undefined;
  let body = pending?.body;
  if (pending) key = pending.key;
  const lookup = async () => {
    guard();
    try { const state = await api.request('operations.read', { query: { id: key } }); guard(); return state; }
    catch { guard(); return undefined; }
  };
  const release = async () => { await storage.removeIfValue(record, reservation!); };
  const complete = async (recovered: boolean): Promise<Result> => { await release(); guard(); return { submitted: true, ...(recovered ? { recovered: true } : {}) }; };
  if (body) {
    const status = await lookup();
    if (status?.status === 'complete' && 'submitted' in status.result && status.result.submitted) return complete(true);
    if (!status) return { pending: true };
    if (status.status === 'cancelled') { await release(); throw new MessageError(uiMessage('extension.runtime.previousReportEnded')); }
  } else {
    body = await makeBody(); guard();
    reservation = JSON.stringify({ key, body });
    body = (JSON.parse(reservation) as { body: ReportSubmission }).body;
    await storage.put(record, account, 'operation', reservation, Date.now() + 86_400_000); guard();
  }
  try {
    const result = await api.request('reports.submit', { body, key }); guard();
    if (!result.submitted) return { pending: true };
    return complete(false);
  } catch (error) {
    guard();
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
    if (status >= 400 && status < 500 && ![408, 429].includes(status)) { await release(); throw error; }
    const outcome = await lookup();
    if (outcome?.status === 'complete' && 'submitted' in outcome.result && outcome.result.submitted) return complete(true);
    return { pending: true };
  }
}
