'use client';
import { useEffect,useState } from 'react';
import { captureShortcut, suggestedCaptureShortcut } from '../../../runtime/browser/shortcuts';
import type { PalsideController } from '../app/use-palside';

/** The live 截图 shortcut, read again whenever the panel comes back into view — the user may have just changed it in Chrome. */
export function useCaptureShortcut(c: PalsideController) {
  const live = Boolean(c.live);
  const [value, setValue] = useState<string>();
  useEffect(() => {
    if (!live) return;
    let active = true;
    const read = () => { void captureShortcut().then(shortcut => { if (active) setValue(shortcut); }, () => { if (active) setValue(''); }); };
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', onVisible); };
  }, [live]);
  // Without Chrome (the review pages) it shows the suggested key in this platform's own form.
  return live ? value : suggestedCaptureShortcut();
}
