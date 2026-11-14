'use client';
import { useTranslations } from 'use-intl';
import { Megaphone, ArrowUpRight } from 'lucide-react';
import { Button } from '@palside/ui/button';
import type { Viewing } from '../../../domain/assets/model';
import type { Message } from '../../../domain/chat/model';
import { personFor } from '../../../domain/account/model';
import { reachedCall, samePage, viewAsset } from '../../../domain/annotations/social';
import { AssetCard } from '../assets/asset-card';
import { PersonAvatar } from '../ui/primitives';
import { openPage } from '../annotations/reminders';
import type { PalsideController } from '../app/use-palside';
import s from './call-card.module.css';

/**
 * 喊来看 in the message's name line: 喊大家来看, 喊你来看, or 喊 Mia 来看. The message's own line names the sender; for your own message it
 * stands alone on the right, above the card.
 */
export function CallLabel({ c, message }: { c: PalsideController; message: Message }) {
  const t = useTranslations();
  const target = message.call === 'one' ? message.mentionIds?.[0] : undefined;
  const text = !target ? t('extension.member.callAll')
    : target === c.data.self ? t('extension.member.callYou')
    : t('extension.member.callOne', { name: personFor(c.people, target, t('common.member')).name });
  return <span className={s.label}><Megaphone size={13} strokeWidth={2.2} aria-hidden="true" />{text}</span>;
}

/**
 * The page card a 喊来看 carries — a token card on a token page, a website card elsewhere — with one answer line under a hairline: who
 * came, then 去看. Came means provably there: online teammates whose 共享在看 shows the page (any page of the same token); nobody shown,
 * nothing said. Your own call shows only who came; a call you are already answering says 已在这里.
 */
export function CallCard({ c, message, view }: { c: PalsideController; message: Message; view: Viewing }) {
  const t = useTranslations();
  const self = message.author === c.data.self;
  const arrived = c.people.filter(person => person.id !== message.author && person.id !== c.data.self && (person.presence === 'active' || person.presence === 'away'))
    .filter(person => { const there = c.data.views.find(item => item.id === person.viewing); return there && reachedCall(view, there); });
  const page = c.live.page;
  const here = Boolean(page?.url && (samePage(page.url, view.url, page.asset) || view.kind === 'asset' && page.asset && viewAsset(view) === page.asset));
  const foot = arrived.length > 0 || !self;
  return <div className={s.card} data-call-card>
    <AssetCard view={view} onOpen={() => c.selectAsset(view.id)} />
    {foot && <div className={s.foot}>
      {arrived.length > 0
        ? <span className={s.arrived} title={arrived.map(person => person.name).join('、')}>
          <span className={s.faces} aria-hidden="true">{arrived.slice(0, 3).map(person => <PersonAvatar key={person.id} person={{ ...person, presence: undefined }} size="xs" />)}</span>
          {t('extension.member.callArrived', { count: arrived.length })}
        </span>
        : <span />}
      {!self && (here
        ? <span className={s.here}>{t('extension.member.callHere')}</span>
        : <Button size="sm" variant="primary" className={s.go} onClick={() => openPage(c, view)}>{t('extension.member.callGo')}<ArrowUpRight size={13} aria-hidden="true" /></Button>)}
    </div>}
  </div>;
}
