import { useEffect, useRef, useState } from 'react';
import type { PalsideController } from '../app/use-palside';

/** Copy feedback follows the latest clipboard result: `copied` for 1.4 s, or the value to copy by hand when the clipboard refused. */
export function useCopied(c: Pick<PalsideController, 'copy'>): [boolean, (value: string) => void, string | undefined] {
  const [copied, setCopied] = useState(false), [failedValue, setFailedValue] = useState<string>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined), attemptRef = useRef(0);
  useEffect(() => () => { attemptRef.current++; clearTimeout(timerRef.current); }, []);
  return [copied, value => {
    const attempt = ++attemptRef.current;
    clearTimeout(timerRef.current); setCopied(false); setFailedValue(undefined);
    void c.copy(value).then(success => {
      if (attempt !== attemptRef.current) return;
      if (!success) { setFailedValue(value); return; }
      setCopied(true); timerRef.current = setTimeout(() => setCopied(false), 1400);
    });
  }, failedValue];
}
