/**
 * A read that may be asked for many times in a row: it runs at most once at a time, and every call made while it runs shares one
 * follow-up run that starts after it, so a burst of change events costs at most two reads and the last answer is never stale.
 */
export function coalesced<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined, queued: Promise<T> | undefined;
  const start = () => {
    const run: Promise<T> = task().finally(() => { if (running === run) running = undefined; });
    running = run;
    return run;
  };
  return () => {
    if (queued) return queued;
    if (!running) return start();
    queued = running.catch(() => undefined).then(() => { queued = undefined; return start(); });
    return queued;
  };
}
