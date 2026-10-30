'use client';
import { Spinner } from '@palside/ui/spinner';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useEffect, useRef, useState } from 'react';
import { Scissors } from 'lucide-react';
import { openShortcuts, shortcutKeys } from '../../../runtime/browser/shortcuts';
import { capability, unavailableReason } from '../settings/access';
import { Action } from '../ui/primitives';
import { Button, IconButton } from '@palside/ui/button';
import { Popover, PopoverTrigger, PopoverContent, usePopoverContext } from '@palside/ui/popover';
import styles from './capture-tool.module.css';
import { KeyCaps } from '../settings/signal-settings';
import { useCaptureShortcut } from '../settings/use-shortcut';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';

/**
 * 截图 in the composer. Chrome lets Palside take a tab only after the user hands it over from Chrome itself — the toolbar icon or the
 * shortcut — never from a click inside the panel. Where it already has the tab (or every site is allowed) the scissors start the page
 * editor at once; elsewhere they open how to do it: the shortcut, which works on any page and opens the editor straight away.
 */
export function CaptureTool({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const shortcut = useCaptureShortcut(c);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const teamId = c.current;
  useEffect(() => () => { version.current++; }, [teamId]);
  const { state } = capability(c, 'capture');
  const reason = unavailableReason(c, 'capture');
  const label = shortcut ? t('extension.shot.labelKey', { key: shortcut }) : t('extension.copy.captureAnnotate');
  async function run() {
    if (!c.live) return;
    const current = ++version.current;
    setBusy(true);
    try { await c.live.command('capture', { teamId: c.current, accountId: c.data.self }); }
    catch (error) { if (current === version.current) c.setNotice(error instanceof Error ? errorMessage(error) : uiMessage('extension.copy.captureFailed')); }
    finally { setBusy(false); }
  }
  if (state === 'access') return <span><Popover boundarySelector="[data-palside-app]" align="end"><PopoverTrigger asChild><IconButton label={label} size="sm" variant="quiet"><Scissors /></IconButton></PopoverTrigger><PopoverContent aria-label={label} className={styles.guide}><ShotGuide shortcut={shortcut} /></PopoverContent></Popover></span>;
  return <Action aria-disabled={reason ? true : undefined} disabled={busy}
    label={reason ? `${label} · ${t(reason)}` : label} onClick={() => { if (!reason) void run(); }}>{busy ? <Spinner className={s.loadingIcon} size={18} /> : <Scissors />}</Action>;
}

/** Where Palside cannot take the tab itself: the shortcut that can, as Chrome shows it on this computer (⌥⇧S on a Mac, Alt+Shift+S elsewhere), and
 * the one button that changes it — or, with none set, only the button. */
function ShotGuide({ shortcut }: { shortcut?: string }) {
  const { close } = usePopoverContext();
  const t = useTranslations();
  const keys = shortcutKeys(shortcut ?? '');
  return <div className={styles.line}>
    <span>{t(keys.length ? 'extension.shot.step1' : 'extension.shot.shortcut')}</span>
    {keys.length > 0 && <KeyCaps keys={keys} />}
    <Button size="sm" variant={keys.length ? 'surface' : 'primary'} onClick={() => { close(); void openShortcuts(); }}>{t(keys.length ? 'extension.signal.keyChange' : 'extension.shot.set')}</Button>
  </div>;
}
