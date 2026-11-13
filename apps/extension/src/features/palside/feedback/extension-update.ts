import { useEffect, useRef, useState } from 'react';
import { MINUTE_MS } from '@palside/shared/units';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import type { PalsideController } from '../app/use-palside';

/**
 * 更新 (docs/engineering/release.md「扩展更新」): applies the version Chrome downloaded, which reloads the extension and closes this
 * panel once the draft is saved; with none downloaded it asks the store and stays busy until the version arrives.
 */
export function useExtensionUpdate(c: PalsideController) {
  const status = c.live.update;
  const ready = status?.ready;
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pending = useRef(false);
  // The store found a version: busy until Chrome has downloaded it, giving up after a minute.
  useEffect(() => {
    if (!downloading || ready) return;
    const timer = setTimeout(() => setDownloading(false), MINUTE_MS);
    return () => clearTimeout(timer);
  }, [downloading, ready]);
  async function run() {
    if (pending.current) return;
    pending.current = true; setRunning(true);
    try {
      await c.flushDraft().catch(() => 0);
      const result = await c.live.command('update');
      if (result.applied) return;
      if (result.check === 'update_available') setDownloading(true);
      else c.setNotice(uiMessage('extension.copy.updateNotReady'));
    } catch (error) { c.setNotice(errorMessage(error)); }
    finally { pending.current = false; setRunning(false); }
  }
  return { ready, busy: running || downloading && !ready || Boolean(status?.checking), run };
}
