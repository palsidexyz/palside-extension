import assert from 'node:assert/strict';

const compare = (a, b) => Array.isArray(a) ? a.reduce((order, value, i) => order || compare(value, b[i]), 0) : a < b ? -1 : a > b ? 1 : 0;
export function indexedDb(t) {
  const stores = new Map(), operations = [];
  const range = { bound: (lower, upper, lowerOpen = false, upperOpen = false) => ({ lower, upper, lowerOpen, upperOpen }), upperBound: (upper, upperOpen = false) => ({ upper, upperOpen }) };
  const matches = (key, query) => query === undefined || (query && !Array.isArray(query) && typeof query === 'object' ? (query.lower === undefined || compare(key, query.lower) >= (query.lowerOpen ? 1 : 0)) && (query.upper === undefined || compare(key, query.upper) <= (query.upperOpen ? -1 : 0)) : compare(key, query) === 0);
  let tail = Promise.resolve();
  const db = { close() {}, createObjectStore(name, { keyPath }) { const data = { rows: new Map(), indexes: new Map(), keyPath }; stores.set(name, data); return { createIndex(name, path) { data.indexes.set(name, path); } }; }, transaction(names, mode) {
    operations.push({ method: 'transaction', mode });
    let pending = 0, started = false, ended = false, release;
    const ready = tail; tail = new Promise(resolve => { release = resolve; });
    const backups = new Map();
    const tx = { abort() { ended = true; for (const [name, rows] of backups) stores.get(name).rows = rows; queueMicrotask(() => { tx.onabort?.(); release(); }); }, objectStore(name) { return source(name); } };
    function request(work) {
      pending++; const req = {};
      void ready.then(() => { if (!started) { started = true; for (const [name, data] of stores) backups.set(name, new Map(data.rows)); } queueMicrotask(() => run()); });
      function run() {
        if (ended) return;
        try { req.result = work(req, () => { pending++; queueMicrotask(run); }); req.onsuccess?.(); }
        catch (error) { req.error = error; req.onerror?.(); tx.abort(); }
        pending--;
        queueMicrotask(() => { if (!pending && !ended) { ended = true; tx.oncomplete?.(); release(); } });
      }
      return req;
    }
    function source(name, index) {
      const data = stores.get(name); assert.ok(data, name);
      const keyOf = row => { const path = index ? data.indexes.get(index) : data.keyPath; assert.ok(path, index); return Array.isArray(path) ? path.map(field => row[field]) : row[path]; };
      const entries = query => [...data.rows.entries()].filter(([, row]) => keyOf(row) !== undefined && matches(keyOf(row), query)).sort((a, b) => compare(keyOf(a[1]), keyOf(b[1])) || compare(a[0], b[0]));
      const log = (method, query) => operations.push({ store: name, index, method, query });
      const cursor = (query, keys) => {
        log(keys ? 'openKeyCursor' : 'openCursor', query); let last;
        return request((_req, again) => {
          const entry = entries(query).find(([key, row]) => !last || compare(keyOf(row), last.index) > 0 || compare(keyOf(row), last.index) === 0 && compare(key, last.key) > 0);
          if (!entry) return null;
          const [key, row] = entry; last = { key, index: keyOf(row) }; log('cursorRow', key);
          return { primaryKey: key, key: last.index, ...keys ? {} : { value: structuredClone(row) }, continue: again, delete: () => source(name).delete(key) };
        });
      };
      return { transaction: tx, index: indexName => source(name, indexName), get(key) { log('get', key); return request(() => structuredClone(data.rows.get(key))); }, getAll(query) { log('getAll', query); return request(() => entries(query).map(([, row]) => structuredClone(row))); }, put(row) { log('put', row[data.keyPath]); const copy = structuredClone(row); return request(() => { data.rows.set(copy[data.keyPath], copy); return copy[data.keyPath]; }); }, delete(key) { log('delete', key); return request(() => data.rows.delete(key)); }, openCursor: query => cursor(query, false), openKeyCursor: query => cursor(query, true), clear() { log('clear'); return request(() => data.rows.clear()); } };
    }
    return tx;
  } };
  const factory = { open(name, version) { operations.push({ method: 'open', name, version }); const req = { result: db }; queueMicrotask(() => { if (!stores.size) req.onupgradeneeded?.(); req.onsuccess?.(); }); return req; } };
  for (const [key, value] of Object.entries({ indexedDB: factory, IDBKeyRange: range })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  return { operations, stores };
}
