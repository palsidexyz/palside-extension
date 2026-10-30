import { IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { IMAGE_LIMIT } from '../../domain/images/image-policy.ts';

export type ImageSessionMode = 'view' | 'edit';
export type ImageSessionStatus = 'open' | 'saved' | 'cancelled';
export type ImageDocument = null | boolean | number | string | ImageDocument[] | { [key: string]: ImageDocument };
export type ImageSessionSnapshot = {
  id: string;
  accountId: string;
  teamId: string;
  source: { src: string; name: string };
  mode: ImageSessionMode;
  revision: number;
  status: ImageSessionStatus;
  document: ImageDocument;
  draftRevision?: number;
  expiresAt: number;
};
export type ImageSessionErrorCode = 'IMAGE_SESSION_UNAVAILABLE' | 'IMAGE_SESSION_CONFLICT' | 'IMAGE_SESSION_CLOSED' | 'IMAGE_SESSION_READ_ONLY' | 'IMAGE_SESSION_INVALID' | 'IMAGE_SESSION_LIMIT';
export class ImageSessionError extends Error {
  readonly code: ImageSessionErrorCode;
  constructor(code: ImageSessionErrorCode) { super(code); this.name = 'ImageSessionError'; this.code = code; }
}

const DOCUMENT_BYTES = 256 * 1024;
const SOURCE_CHARACTERS = 4 * Math.ceil(IMAGE_LIMIT.maxBytes / 3) + 32;
const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const fail = (code: ImageSessionErrorCode): never => { throw new ImageSessionError(code); };
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);

/** Blob URLs belong to their creating context; only bounded image bytes cross windows. */
export function imageSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > SOURCE_CHARACTERS) return fail('IMAGE_SESSION_INVALID');
  const comma = value.indexOf(',');
  if (!IMAGE_MIME_TYPES.some(type => `data:${type};base64` === value.slice(0, comma))) return fail('IMAGE_SESSION_INVALID');
  const data = value.slice(comma + 1);
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return fail('IMAGE_SESSION_INVALID');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.length / 4 * 3 - padding > IMAGE_LIMIT.maxBytes) return fail('IMAGE_SESSION_INVALID');
  return value;
}

/** Restrict state to plain JSON before cloning; no custom serializers or prototype keys. */
export function documentCopy(value: unknown): ImageDocument {
  const ancestors = new Set<object>();
  let nodes = 0, bytes = 0;
  const encoder = new TextEncoder();
  function visit(item: unknown, depth: number): ImageDocument {
    if (++nodes > 50_000 || depth > 32) return fail('IMAGE_SESSION_INVALID');
    if (typeof item === 'string') { bytes += encoder.encode(item).length; if (bytes > DOCUMENT_BYTES) fail('IMAGE_SESSION_INVALID'); return item; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || ancestors.has(item)) return fail('IMAGE_SESSION_INVALID');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return fail('IMAGE_SESSION_INVALID');
    ancestors.add(item);
    let copy: ImageDocument;
    if (Array.isArray(item)) {
      if (item.length > 50_000) return fail('IMAGE_SESSION_INVALID');
      copy = [];
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, i);
        if (!descriptor || !('value' in descriptor)) return fail('IMAGE_SESSION_INVALID');
        copy.push(visit(descriptor.value, depth + 1));
      }
    } else {
      copy = {};
      for (const key of Object.keys(item)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return fail('IMAGE_SESSION_INVALID');
        bytes += encoder.encode(key).length;
        if (bytes > DOCUMENT_BYTES) return fail('IMAGE_SESSION_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) return fail('IMAGE_SESSION_INVALID');
        copy[key] = visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
    return copy;
  }
  const json = JSON.stringify(visit(value, 0));
  if (encoder.encode(json).length > DOCUMENT_BYTES) fail('IMAGE_SESSION_INVALID');
  return JSON.parse(json) as ImageDocument;
}

/** The background owns these sessions; renderers only pass an opaque id and a revision. */
export class ImageSessionBroker {
  private readonly sessions = new Map<string, ImageSessionSnapshot>();
  private readonly currentAccount: () => string | undefined;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private observedAccount: string | undefined;

  constructor(options: { currentAccount: () => string | undefined; now?: () => number; createId?: () => string; ttlMs?: number; maxSessions?: number }) {
    this.currentAccount = options.currentAccount;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxSessions = options.maxSessions ?? 8;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || !Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0) fail('IMAGE_SESSION_INVALID');
    this.observedAccount = this.currentAccount();
  }

  private authorize(accountId: string) {
    const active = this.currentAccount();
    if (active !== this.observedAccount) { this.sessions.clear(); this.observedAccount = active; }
    if (!identifier(accountId) || !active || active !== accountId) fail('IMAGE_SESSION_UNAVAILABLE');
    const now = this.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }
  private session(id: string, accountId: string) {
    this.authorize(accountId);
    const session = this.sessions.get(id);
    if (!session || session.accountId !== accountId) return fail('IMAGE_SESSION_UNAVAILABLE');
    return session;
  }
  private writable(session: ImageSessionSnapshot, revision: number, editing = true) {
    if (session.status !== 'open') fail('IMAGE_SESSION_CLOSED');
    if (!validRevision(revision) || revision !== session.revision || revision === Number.MAX_SAFE_INTEGER) fail('IMAGE_SESSION_CONFLICT');
    if (editing && session.mode !== 'edit') fail('IMAGE_SESSION_READ_ONLY');
  }
  private snapshot(session: ImageSessionSnapshot): ImageSessionSnapshot {
    return { ...session, source: { ...session.source }, document: documentCopy(session.document) };
  }

  open(input: { accountId: string; teamId: string; source: { src: string; name: string }; mode: ImageSessionMode; draftRevision?: number }): ImageSessionSnapshot {
    this.authorize(input.accountId);
    if (!identifier(input.teamId) || !input.source || !identifier(input.source.name) || !['view', 'edit'].includes(input.mode) || input.draftRevision !== undefined && !validRevision(input.draftRevision)) return fail('IMAGE_SESSION_INVALID');
    const src = imageSource(input.source.src);
    if (this.sessions.size >= this.maxSessions) {
      for (const [id, session] of this.sessions) if (session.status !== 'open') { this.sessions.delete(id); if (this.sessions.size < this.maxSessions) break; }
    }
    if (this.sessions.size >= this.maxSessions) return fail('IMAGE_SESSION_LIMIT');
    const id = this.createId();
    if (!identifier(id) || this.sessions.has(id)) return fail('IMAGE_SESSION_INVALID');
    const session: ImageSessionSnapshot = { id, accountId: input.accountId, teamId: input.teamId, source: { src, name: input.source.name }, mode: input.mode, revision: 0, status: 'open', document: null, expiresAt: this.now() + this.ttlMs, ...(input.draftRevision === undefined ? {} : { draftRevision: input.draftRevision }) };
    this.sessions.set(id, session);
    return this.snapshot(session);
  }

  read(id: string, accountId: string): ImageSessionSnapshot { return this.snapshot(this.session(id, accountId)); }

  update(id: string, accountId: string, expectedRevision: number, document: unknown): ImageSessionSnapshot {
    const session = this.session(id, accountId);
    this.writable(session, expectedRevision);
    const copy = documentCopy(document);
    session.document = copy; session.revision++; session.expiresAt = this.now() + this.ttlMs;
    return this.snapshot(session);
  }

  /** Consumes the current revision once; attaching it to the original draft is the caller's separate CAS. */
  save(id: string, accountId: string, expectedRevision: number, src: string): { snapshot: ImageSessionSnapshot; src: string } {
    const session = this.session(id, accountId);
    this.writable(session, expectedRevision);
    const result = imageSource(src);
    session.status = 'saved'; session.revision++;
    return { snapshot: this.snapshot(session), src: result };
  }

  cancel(id: string, accountId: string, expectedRevision: number): ImageSessionSnapshot {
    const session = this.session(id, accountId);
    this.writable(session, expectedRevision, false);
    session.status = 'cancelled'; session.revision++;
    const snapshot = this.snapshot(session);
    this.sessions.delete(id);
    return snapshot;
  }

  /** Call on every logout/account transition, even if the same account signs in again before another command. */
  clear() { this.sessions.clear(); this.observedAccount = this.currentAccount(); }
}
