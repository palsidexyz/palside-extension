'use client';
import { errorMessage } from '@palside/i18n';
import { Button } from '@palside/ui/button';
import { motionPresets } from '@palside/design/motion';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Footprints } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { liveView } from '../assets/token-data';
import { tokenLabel } from '../assets/token-name';
import { Swap } from '../ui/motion-details';
import { Token } from '../ui/primitives';
import { personFor } from '../../../domain/account/model';
import type { PalsideController } from '../app/use-palside';
import { setSocialUi, useSocialUi } from './social-state';
import s from './follow-bar.module.css';

/** 跟看 as it stands, above every screen: who you follow and where they are, with pause, continue and end. */
function FollowingRow({ c, personId, paused }: { c: PalsideController; personId: string; paused: boolean }) {
  const t = useTranslations();
  const person = personFor(c.people, personId, t('common.member'));
  const found = c.data.views.find(view => view.id === person.viewing);
  const view = found && liveView(c, found);
  const request = (op: { op: 'pause' } | { op: 'resume'; url?: string }) => { void c.live?.follow?.(op).catch(error => c.setNotice(errorMessage(error))); };
  return <div className={s.row} data-follow-bar={paused ? 'paused' : 'on'} role="status">
    <Footprints size={15} strokeWidth={2} className={s.mark} aria-hidden="true" />
    <span className={s.text}><Swap k={paused ? 'paused' : 'on'}><b>{t(paused ? 'extension.top.followPausedHere' : 'extension.top.followOn', { name: person.name })}</b></Swap></span>
    {view && <span className={s.place}><Swap k={found!.id}><span className={s.page}><Token view={view} size="sm" /><span className={s.pageName}>{tokenLabel(view, t, c)}</span></span></Swap></span>}
    <span className={s.actions}>
      <Button size="sm" variant="quiet" className={s.action} onClick={() => request(paused ? { op: 'resume', ...(found ? { url: found.url } : {}) } : { op: 'pause' })}>{t(paused ? 'extension.top.followContinue' : 'extension.top.followPause')}</Button>
      <Button size="sm" variant="quiet" className={s.action} onClick={() => setSocialUi({ follow: undefined })}>{t('extension.top.end')}</Button>
    </span>
  </div>;
}

/** The other side of 跟看: who follows you right now, from their heartbeat. Nothing to do here but know it. */
function FollowersRow({ c, ids }: { c: PalsideController; ids: string[] }) {
  const t = useTranslations();
  const first = personFor(c.people, ids[0]!, t('common.member')).name;
  return <div className={s.row} data-follow-bar="followers" role="status">
    <Footprints size={15} strokeWidth={2} className={s.mark} aria-hidden="true" />
    <span className={s.text}><b>{ids.length > 1 ? t('extension.top.followingMany', { name: first, count: ids.length }) : t('extension.top.following', { name: first })}</b></span>
  </div>;
}

/** Under each screen's navigation while 跟看 runs in either direction; it opens and closes in place. */
export function FollowBar({ c }: { c: PalsideController }) {
  const reduced = useReducedMotion();
  const { follow } = useSocialUi();
  const mine = follow?.teamId === c.current ? follow : undefined;
  // The runtime removes a follower who stopped renewing and pushes the new state.
  const followers = (c.live?.state.followers ?? []).filter(item => item.teamId === c.current).map(item => item.personId);
  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 } };
  return <AnimatePresence initial={false}>
    {mine && <motion.div key="following" className={s.clip} transition={reduced ? motionPresets.reduced : motionPresets.feedback} {...motionProps}><FollowingRow c={c} personId={mine.personId} paused={Boolean(mine.paused)} /></motion.div>}
    {followers.length > 0 && <motion.div key="followers" className={s.clip} transition={reduced ? motionPresets.reduced : motionPresets.feedback} {...motionProps}><FollowersRow c={c} ids={followers} /></motion.div>}
  </AnimatePresence>;
}
