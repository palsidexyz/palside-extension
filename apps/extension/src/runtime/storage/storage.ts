import { message as uiMessage,MessageError } from '@palside/i18n';
/** IndexedDB transactions own all durable client writes; UI state is not the store. */
export type StoredRow<T = unknown> = { key: string; account: string; kind: string; value: T; updatedAt: number; expiresAt?: number; bytes?: number };
export type CacheEntry = { id: string; value: unknown; expiresAt: number };
const CACHE_BYTES = 100 * 1024 * 1024;
const sizeOf = (value: unknown) => value instanceof Blob ? value.size : new TextEncoder().encode(JSON.stringify(value)).length;
export type RevisionedDraft<T> = { revision: number; value: T; updatedAt: number };
export class DraftConflictError<T> extends MessageError {
  readonly current: RevisionedDraft<T>;
  constructor(current: RevisionedDraft<T>) { super(uiMessage('extension.runtime.draftConflict')); this.current = current; }
}

export class ClientStorage {
  private database?: Promise<IDBDatabase>;
  private readonly name: string;
  private usage = new WeakMap<IDBTransaction, { key: string; bytes: number }>();
  constructor(name = 'palside-local') { this.name = name; }
  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('records', { keyPath: 'key' });
        store.createIndex('account', 'account'); store.createIndex('account-kind', ['account', 'kind']);
        store.createIndex('kind', 'kind'); store.createIndex('expires', 'expiresAt');
        const cache = request.result.createObjectStore('cache', { keyPath: 'key' });
        cache.createIndex('expires', 'expiresAt'); cache.createIndex('updated', 'updatedAt');
        request.result.createObjectStore('usage', { keyPath: 'key' });
      };
      request.onerror = () => reject(new MessageError(uiMessage('extension.runtime.storageOpenFailed')));
      request.onblocked = () => { blocked = true; reject(new MessageError(uiMessage('extension.runtime.closeOtherSidebars'))); };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.database = undefined; };
        resolve(request.result);
      };
    }).catch(error => { this.database = undefined; throw error; });
    return this.database;
  }
  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (result: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(['records', 'cache', 'usage'], mode);
      let result: T; let failure: Error | undefined;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? new MessageError(uiMessage('extension.runtime.storageSaveFailed')));
      transaction.onerror = () => { /* abort supplies the final result */ };
      const run = () => {
        try { work(transaction.objectStore('records'), value => { result = value; }, error => { failure = error; transaction.abort(); }); }
        catch (error) { failure = error instanceof Error ? error : new MessageError(uiMessage('extension.runtime.storageFailed')); transaction.abort(); }
      };
      if (mode === 'readonly') run();
      else {
        const request = transaction.objectStore('usage').get('cache');
        request.onsuccess = () => { this.usage.set(transaction, request.result ?? { key: 'cache', bytes: 0 }); run(); };
      }
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.transaction('readonly', (store, done) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result as StoredRow<T> | undefined;
        done(row && (!row.expiresAt || row.expiresAt > Date.now()) ? row.value : undefined);
      };
    });
  }
  private accountBytes(store: IDBObjectStore, delta: number) {
    const usage = this.usage.get(store.transaction)!; usage.bytes += delta;
    store.transaction.objectStore('usage').put(usage);
  }
  private deleteRow(store: IDBObjectStore, key: IDBValidKey, done: () => void = () => {}) {
    const cache = store.transaction.objectStore('cache'), request = cache.get(key);
    request.onsuccess = () => {
      if (request.result) { this.accountBytes(store, -request.result.bytes); cache.delete(key); }
      store.delete(key); done();
    };
  }
  private writeRow(store: IDBObjectStore, row: StoredRow, done: () => void = () => {}) {
    this.deleteRow(store, row.key, () => {
      if (row.kind === 'cache') {
        row.bytes = sizeOf(row.value);
        const { key, bytes, updatedAt, expiresAt } = row;
        store.transaction.objectStore('cache').put({ key, bytes, updatedAt, expiresAt: expiresAt || undefined }); this.accountBytes(store, bytes);
      }
      store.put(row); done();
    });
  }
  async put<T>(key: string, account: string, kind: string, value: T, expiresAt?: number): Promise<void> {
    await this.putMany([{ key, account, kind, value, expiresAt }]);
  }
  async putMany(rows: Array<{ key: string; account: string; kind: string; value: unknown; expiresAt?: number }>): Promise<void> {
    await this.transaction<void>('readwrite', (store, done) => {
      const updatedAt = Date.now(); let index = 0;
      const next = () => { const row = rows[index++]; if (row) this.writeRow(store, { ...row, updatedAt }, next); else done(); }; next();
    });
  }
  async remove(key: string): Promise<void> {
    await this.transaction<void>('readwrite', (store, done) => this.deleteRow(store, key, done));
  }
  async removeIfValue(key: string, expected: string): Promise<boolean> {
    return this.transaction('readwrite', (store, done) => {
      const request = store.get(key);
      request.onsuccess = () => { const matches = request.result?.value === expected; if (matches) this.deleteRow(store, key, () => done(true)); else done(false); };
    });
  }
  async rows<T>(account: string, kind?: string): Promise<StoredRow<T>[]> {
    return this.transaction('readonly', (store, done) => {
      const request = kind ? store.index('account-kind').getAll([account, kind]) : store.index('account').getAll(account);
      request.onsuccess = () => done((request.result as StoredRow<T>[]).filter(row => (!row.expiresAt || row.expiresAt > Date.now())));
    });
  }
  async updateDraft<T extends object>(account: string, team: string, patch: Partial<T>, expectedRevision: number, empty: T): Promise<RevisionedDraft<T>> {
    return this.transaction('readwrite', (store, done, fail) => {
      const key = `${account}:draft:${team}`; const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result as StoredRow<RevisionedDraft<T>> | undefined;
        const current = row && (!row.expiresAt || row.expiresAt > Date.now()) ? row.value : { revision: 0, value: empty, updatedAt: 0 };
        if (current.revision !== expectedRevision) { fail(new DraftConflictError(current)); return; }
        const now = Date.now(); const next = { revision: current.revision + 1, value: { ...current.value, ...patch }, updatedAt: now };
        store.put({ key, account, kind: 'draft', value: next, updatedAt: now, expiresAt: now + 7 * 86_400_000 } satisfies StoredRow<RevisionedDraft<T>>); done(next);
      };
    });
  }
  async clearSentDraft<T extends object>(account: string, team: string, revision: number, empty: T): Promise<boolean> {
    return this.transaction('readwrite', (store, done) => {
      const key = `${account}:draft:${team}`; const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result as StoredRow<RevisionedDraft<object>> | undefined;
        if (row?.value.revision === revision) {
          const now = Date.now();
          store.put({ key, account, kind: 'draft', value: { revision: revision + 1, value: empty, updatedAt: now }, updatedAt: now, expiresAt: now + 7 * 86_400_000 });
          done(true);
        } else done(false);
      };
    });
  }
  async cache<T>(account: string, id: string, value: T, expiresAt: number): Promise<string[]> {
    return this.cacheMany(account, [{ id, value, expiresAt }]);
  }
  async cacheMany(account: string, entries: CacheEntry[]): Promise<string[]> {
    const sizes = entries.map(entry => sizeOf(entry.value));
    if (sizes.some(size => size > CACHE_BYTES)) throw new MessageError(uiMessage('extension.runtime.cacheCapacity'));
    return this.transaction<string[]>('readwrite', (store, done) => {
      const cache = store.transaction.objectStore('cache'), evicted = new Set<string>(); let index = 0;
      const remove = (row: { key: string; bytes: number }) => {
        cache.delete(row.key); store.delete(row.key); this.accountBytes(store, -row.bytes); evicted.add(row.key);
      };
      const next = () => {
        const entry = entries[index], size = sizes[index++]!;
        if (!entry) { done([...evicted]); return; }
        const key = `${account}:cache:${entry.id}`, now = Date.now();
        this.deleteRow(store, key, () => {
          const expired: string[] = [], request = cache.index('expires').openCursor(IDBKeyRange.upperBound(now));
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { const row = cursor.value; remove(row); expired.push(row.key); evicted.delete(row.key); cursor.continue(); return; }
            for (const key of expired.sort()) evicted.add(key);
            const save = () => {
              evicted.delete(key);
              cache.put({ key, bytes: size, updatedAt: now, expiresAt: entry.expiresAt || undefined }); this.accountBytes(store, size);
              store.put({ key, account, kind: 'cache', value: entry.value, bytes: size, updatedAt: now, expiresAt: entry.expiresAt }); next();
            };
            if (this.usage.get(store.transaction)!.bytes + size <= CACHE_BYTES) { save(); return; }
            const oldest = cache.index('updated').openCursor();
            oldest.onsuccess = () => {
              const cursor = oldest.result;
              if (!cursor || this.usage.get(store.transaction)!.bytes + size <= CACHE_BYTES) { save(); return; }
              remove(cursor.value);
              if (this.usage.get(store.transaction)!.bytes + size <= CACHE_BYTES) save(); else cursor.continue();
            };
          };
        });
      }; next();
    });
  }
  async cacheBytes(): Promise<number> {
    return this.transaction('readonly', (store, done) => {
      const request = store.transaction.objectStore('usage').get('cache');
      request.onsuccess = () => done(request.result?.bytes ?? 0);
    });
  }
  async clearCache(): Promise<void> {
    await this.transaction<void>('readwrite', (store, done) => {
      const request = store.transaction.objectStore('cache').openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(); return; }
        this.deleteRow(store, cursor.primaryKey, () => cursor.continue());
      };
    });
  }
  async cleanup(now = Date.now()): Promise<void> {
    await this.transaction<void>('readwrite', (store, done) => {
      const request = store.index('expires').openKeyCursor(IDBKeyRange.upperBound(now));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(); return; }
        if (cursor.key === 0) cursor.continue(); else this.deleteRow(store, cursor.primaryKey, () => cursor.continue());
      };
    });
  }
  async clearAccount(account: string, preservePreferences = true): Promise<void> {
    await this.transaction<void>('readwrite', (store, done) => {
      const request = store.index('account').openCursor(account);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(); return; }
        const row = cursor.value as StoredRow;
        if (!preservePreferences || row.kind !== 'preferences') this.deleteRow(store, row.key, () => cursor.continue());
        else cursor.continue();
      };
    });
  }
}
