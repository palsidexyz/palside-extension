'use client';
import { useEffect,useState } from 'react';
import { captureShortcut } from '../../../runtime/browser/shortcuts';

/** The live 截图 shortcut, read again whenever the panel comes back into view — the user may have just changed it in Chrome. */
export function useCaptureShortcut() {
  const [value, setValue] = useState<string>();
  useEffect(() => {
    let active = true;
    const read = () => { void captureShortcut().then(shortcut => { if (active) setValue(shortcut); }, () => { if (active) setValue(''); }); };
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return value;
}
