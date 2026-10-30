export type CleanupIntent = { accountId?: string; cryptoDatabasePrefix?: string; preservePreferences: boolean };

export async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: number | undefined;
  try { return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(resolve, ms) as unknown as number; })]); }
  finally { clearTimeout(timer); }
}

/** A timeout releases the caller, never the barrier protecting a still-open database. */
export class DeviceCleanup {
  private tasks = new Map<string, { work: () => Promise<void>; running?: Promise<void> }>();
  add(key: string, work: () => Promise<void>) {
    if (!this.tasks.has(key)) this.tasks.set(key, { work });
  }
  async flush(ms = 3000): Promise<boolean> {
    const jobs = [...this.tasks].map(([key, task]) => {
      task.running ??= Promise.resolve().then(task.work).then(() => {
        if (this.tasks.get(key) === task) this.tasks.delete(key);
      }, () => { task.running = undefined; });
      return task.running;
    });
    await within(Promise.all(jobs), ms);
    return this.tasks.size === 0;
  }
}
