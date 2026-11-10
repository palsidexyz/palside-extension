'use client';
import { useTranslations } from 'use-intl';
import { Pencil } from 'lucide-react';
import type { Message } from '../../../domain/chat/model';
import { PersonAvatar } from '../ui/primitives';
import { quotedText } from './quotes';
import type { PalsideController } from '../app/use-palside';
import s from './composer-social.module.css';

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
