'use client';
import { errorMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Pencil, X } from 'lucide-react';
import { IconButton } from '@palside/ui/button';
import { StateGlyph } from '../ui/motion-details';
import { motionPresets } from '@palside/design/motion';
import type { DanmakuTarget, PageRef } from '../../../domain/annotations/social';
import type { Message } from '../../../domain/chat/model';
import type { Person } from '../../../domain/account/model';
import { PersonAvatar, Token } from '../ui/primitives';
import { quotedText } from './quotes';
import { roomTime } from '../rooms/danmaku-view';
import type { PalsideController } from '../app/use-palside';
import s from './composer-social.module.css';

/** The pending page reference or 弹幕 line above the input. */
export function ComposerRows({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const reduced = useReducedMotion();
  const fold = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: reduced ? motionPresets.reduced : motionPresets.expand };
  return <AnimatePresence initial={false}>
    {c.draft.ref && <motion.div key="ref" className={s.fold} {...fold}>
      <span className={s.refDraft}><RefLine c={c} ref_={c.draft.ref} /><IconButton size="sm" variant="quiet" className={s.remove} label={t('extension.composer.removeRef')} onClick={() => void c.live?.command('attach-ref', { teamId: c.current, clear: true }).catch(error => c.setNotice(errorMessage(error)))}><StateGlyph state={t('extension.composer.removeRef')}><X size={14} /></StateGlyph></IconButton></span>
    </motion.div>}
  </AnimatePresence>;
}

/** The author of a quoted 弹幕 line: a teammate keeps their own avatar, anyone else is drawn from the saved name. */
function danmakuPerson(c: PalsideController, target: DanmakuTarget, fallback: string): Person {
  return c.people.find(person => person.id === target.author) ?? { id: target.author, name: target.name || fallback, color: '#e5e6e9', avatar: c.live?.state.rooms.avatars[target.author] };
}

/** One quoted source: the source row (icon, name, host or time, kind tag), then the excerpt. Page refs, 弹幕 lines and replies share it. */
export function RefLine({ c, ref_ }: { c: PalsideController; ref_: PageRef }) {
  const t = useTranslations();
  const locale = useLocale();
  const target = ref_.target;
  if (target.kind === 'danmaku') {
    const person = danmakuPerson(c, target, t('common.member'));
    return <span className={s.refBody}>
      <span className={s.refHead}><Token view={ref_.view} size="xs" /><span className={s.refSource}>{ref_.view.name}</span><span className={s.refSub}>{roomTime(target.at, c.now, locale)}</span><span className={s.refTag}>{t('extension.room.name')}</span></span>
      <span className={s.refLine}><PersonAvatar person={person} size="xs" /><span className={s.refText} title={ref_.caption}><b>{person.name}</b>{ref_.caption}</span></span>
    </span>;
  }
  let host = '';
  try { host = new URL(ref_.view.url).hostname.replace(/^www\./, ''); } catch { /* The saved page name remains available. */ }
  return <span className={s.refBody}>
    <span className={s.refHead}><Token view={ref_.view} size="xs" /><span className={s.refSource} title={ref_.view.name}>{ref_.view.name}</span><span className={s.refSub}>{host !== ref_.view.name ? host : ''}</span><span className={s.refTag}>{t('extension.composer.refPage')}</span></span>
    <span className={s.refText} title={ref_.caption}>{ref_.caption}</span>
  </span>;
}

/** The replied message as a source block: the author and time, then one line of it, or the quoted part of it in quotes. */
export function ReplyLine({ c, original, text, fragment }: { c: PalsideController; original?: Message; text: string; fragment?: string }) {
  const t = useTranslations();
  const person = original && (c.people.find(p => p.id === original.author) ?? { id: original.author, name: t('common.member'), color: '#e9edf0' });
  const shown = fragment ? `“${fragment}”` : text;
  return <span className={s.refBody}>
    <span className={s.refHead}>{person && <PersonAvatar person={person} size="xs" />}<span className={s.refSource}>{person?.name ?? t('extension.copy.reply')}</span><span className={s.refSub}>{original?.time}</span><span className={s.refTag}>{fragment ? t('extension.reading.quote') : t('extension.copy.reply')}</span></span>
    <span className={`${s.refText} ${fragment ? s.quoteText : s.replyText}`} title={shown}>{shown}</span>
  </span>;
}
/** The message being edited, above the field: the reply line's shape with 编辑消息 in place of the author. */
export function EditLine({ original }: { original: Message }) {
  const t = useTranslations();
  const text = original.text || quotedText(original, undefined, undefined, t);
  return <span className={s.refBody}>
    <span className={s.refHead}><Pencil size={13} aria-hidden="true" /><span className={s.refSource}>{t('extension.copy.editMessage')}</span><span className={s.refSub}>{original.time}</span></span>
    <span className={`${s.refText} ${s.replyText}`} title={text}>{text}</span>
  </span>;
}
export { s as composerStyles };
