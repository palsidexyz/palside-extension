'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'use-intl';
import { ArrowRight, PanelRightOpen, Pin } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { motionPresets } from '@palside/design/motion';
import { Swap } from '../ui/motion-details';
import s from './installed-page.module.css';

type UserSettings = { isOnToolbar?: boolean };
export type InstalledHost = {
  action: { getUserSettings(): Promise<UserSettings>; onUserSettingsChanged?: { addListener(listener: (settings: UserSettings) => void): void; removeListener(listener: (settings: UserSettings) => void): void } };
  sidePanel: { open(options: { windowId: number }): Promise<void> };
  tabs: { getCurrent(): Promise<{ windowId?: number } | undefined> };
};

/** The install tab. Both marks are what Chrome reports: pinned from the toolbar settings, opened once sidePanel.open resolved. */
export function InstalledPage({ host, websiteUrl }: { host: InstalledHost; websiteUrl: string }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const [pinned, setPinned] = useState<boolean>();
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const windowId = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = t('extension.installed.title');
  }, [t]);
  useEffect(() => {
    let active = true;
    const apply = (settings: UserSettings) => { if (active) setPinned(settings.isOnToolbar === true); };
    void host.action.getUserSettings().then(apply, () => {});
    host.action.onUserSettingsChanged?.addListener(apply);
    // sidePanel.open must run inside the click, so the window is known beforehand.
    void host.tabs.getCurrent().then(tab => { windowId.current = tab?.windowId; }, () => {});
    return () => { active = false; host.action.onUserSettingsChanged?.removeListener(apply); };
  }, [host]);

  const open = () => {
    if (windowId.current === undefined) { setFailed(true); return; }
    host.sidePanel.open({ windowId: windowId.current }).then(() => { setOpened(true); setFailed(false); }, () => setFailed(true));
  };

  const ready = opened && pinned === true;
  const spring = reduced ? motionPresets.reduced : { type: 'spring' as const, stiffness: 420, damping: 30 };
  return <div className={s.page}>
    <div className={s.sky} aria-hidden="true" />
    {/* Until Chrome reports Palside on the toolbar, a bold arrow points up-right toward the extensions menu. It aims at
        the area, not a pixel: the extension cannot read toolbar coordinates. */}
    <AnimatePresence initial={false}>
      {pinned === false && <motion.span key="arrow" className={s.arrowWrap} aria-hidden="true"
        initial={{ opacity: 0, x: reduced ? 0 : -12, y: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, x: reduced ? 0 : 16, y: reduced ? 0 : -16 }} transition={spring}>
        <svg className={s.arrow} viewBox="0 0 132 56"><path d="M6 20.5h80V6l40 22-40 22V35.5H6z" /></svg>
      </motion.span>}
    </AnimatePresence>

    <motion.section className={s.card} initial={reduced ? false : { opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
      <img className={s.logo} src="/brand/palside.svg" width={60} height={60} alt="" draggable={false} />
      <h1 className={s.title}><Swap k={ready ? 'ready' : 'installed'}>{t(ready ? 'extension.installed.ready' : 'extension.installed.title')}</Swap></h1>
      {/* The two jobs as status lights, each with its own mark; a light comes on only when Chrome confirms it. */}
      <div className={s.lights}>
        <Light on={opened} icon={<PanelRightOpen size={22} />} label={t(opened ? 'extension.installed.opened' : 'extension.installed.sidePanel')} />
        <Light on={pinned === true} icon={<Pin size={22} />} label={t(pinned ? 'extension.installed.pinned' : 'extension.installed.toolbar')} hint={pinned ? undefined : t('extension.installed.pinHow')} />
      </div>
      <div className={s.slot}>
        {opened
          // Reopens the panel if it was closed meanwhile; the arrow points at where it docks.
          ? <button type="button" className={s.continue} onClick={open}>{t('extension.installed.continue')}<ArrowRight size={18} aria-hidden="true" /></button>
          : <Button variant="primary" size="lg" className={s.open} leadingIcon={<PanelRightOpen size={18} />} onClick={open}>{t('extension.host.open')}</Button>}
      </div>
      {failed && <p className={s.failed} role="alert">{t('extension.installed.openFailed')}</p>}
      <footer className={s.links}>
        <a href={`${websiteUrl}/docs`} target="_blank" rel="noreferrer">{t('extension.installed.docs')}</a>
        <a href={`${websiteUrl}/privacy`} target="_blank" rel="noreferrer">{t('extension.installed.privacy')}</a>
      </footer>
    </motion.section>
  </div>;
}

function Light({ on, icon, label, hint }: { on: boolean; icon: ReactNode; label: string; hint?: string }) {
  const reduced = useReducedMotion();
  return <div className={s.light} data-on={on || undefined} role="status" title={hint}>
    <motion.span key={on ? 'on' : 'off'} className={s.lamp} aria-hidden="true"
      initial={reduced || !on ? false : { scale: .6 }} animate={{ scale: 1 }} transition={reduced ? motionPresets.reduced : { type: 'spring', stiffness: 520, damping: 14 }}>{icon}</motion.span>
    <Swap k={label}>{label}</Swap>
  </div>;
}
