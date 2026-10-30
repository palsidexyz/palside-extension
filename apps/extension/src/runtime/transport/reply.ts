import type { TextMessage } from '@palside/i18n';
export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; message: string; code?: string; text?: TextMessage; lockedUntil?: number; retryAfterMs?: number; remaining?: number };
