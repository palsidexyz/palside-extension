'use client';
import { errorMessage } from '@palside/i18n';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, type ReactNode } from 'react';
import { personFor } from '../../../domain/account/model';
import { type Viewing } from '../../../domain/assets/model';
import { viewAsset } from '../../../domain/annotations/social';
import { captureSocialUi, openWithReturn, setSocialUi, useSocialUi } from './social-state';
import { relativeTime } from '../assets/asset-discussion';
import { PersonAvatar, Token } from '../ui/primitives';
import { ContextBar } from '../ui/context-bar';
import { SessionCard } from '../feedback/session-notice';
import type { PalsideController } from '../app/use-palside';
import s from '../viewing/watch-strip.module.css';

type Poke = NonNullable<NonNullable<PalsideController['live']>['state']['pokes']>[number];
export type TopCard = {
  /** Changes when the card means something else, so the slot fades the new one in. */
  key: string;
  card: ReactNode;
  /** Further 喊你来看 waiting behind the card, listed under the slot's +N. */
  waiting: Poke[];
  /** The teammate the card already shows; their 在看 group is not counted again under +N. */
  person?: string;
};

/** 跟看 ends when the team changes or the teammate leaves. */
function useSocialLifecycle(c: PalsideController) {
  const { follow } = useSocialUi();
  const teamId = c.current; const memberIds = c.team.memberIds;
  useEffect(() => { if (follow && (follow.teamId !== teamId || !memberIds.includes(follow.personId))) setSocialUi({ follow: undefined }); }, [follow, teamId, memberIds]);
}

/** What the top slot shows instead of the 在看 chips, most urgent first: connection or read-only state, then 跟看 (a mode), then
 *  喊你来看 — which goes away by itself once you are on that page. Nothing returns undefined and the chips stay. */
export function useTopCard(c: PalsideController): TopCard | undefined {
  const t = useTranslations();
  const page = c.live?.page;
  const follow = useSocialUi().follow;
  useSocialLifecycle(c);
  const pokes = (c.live?.state.pokes ?? []).filter(poke => poke.teamId === c.current).sort((a, b) => b.at - a.at);
  const here = (view?: Viewing) => Boolean(view && page && (page.url === view.url || view.kind === 'asset' && page.asset && viewAsset(view) === page.asset));
  const arrived = pokes.filter(poke => here(poke.view)).map(poke => poke.id).join();
  const command = c.live?.command;
  useEffect(() => { if (arrived && command) for (const id of arrived.split(',')) void command('dismiss-poke', { id }).catch(() => {}); }, [arrived, command]);
  const waiting = pokes.filter(poke => !here(poke.view));
  if (c.disconnected || c.team.readonly) return { key: c.team.readonly ? 'readonly' : `connection-${c.connection}`, card: <SessionCard c={c} />, waiting: [] };
  const following = follow?.teamId === c.current && c.team.memberIds.includes(follow.personId) ? personFor(c.people, follow.personId, t('common.member')) : undefined;
  if (following) {
    const view = c.data.views.find(item => item.id === following.viewing);
    const synced = here(view);
    const card = <ContextBar tone="accent" lead={<PersonAvatar person={following} size="sm" />} badge={view && <Token view={view} size="sm" />} title={t('extension.top.followTitle', { name: following.name })}
      meta={view ? synced ? <><i data-live="" /><span>{t('extension.top.syncing')}</span><span>· {view.name}</span></> : <><Token view={view} size="sm" /><span>{view.name}</span></> : <span>{t('extension.top.notSharing')}</span>}
      actions={[...(view && !synced ? [{ label: t('extension.top.go'), primary: true, onClick: () => openPage(c, view) }] : []), { label: t('extension.top.end'), onClick: () => setSocialUi({ follow: undefined }) }]} />;
    return { key: `follow-${following.id}-${view?.id ?? ''}-${synced}`, card, waiting, person: following.id };
  }
  const poke = waiting[0];
  if (!poke) return;
  return { key: `poke-${poke.id}`, card: <PokeCard c={c} poke={poke} />, waiting: waiting.slice(1) };
}

function openPage(c: PalsideController, view: Viewing, then?: () => void) {
  const session = captureSocialUi();
  if (c.live) void openWithReturn(c.live, view.url).then(() => { if (session.current()) then?.(); }, error => { if (session.current()) c.setNotice(errorMessage(error)); });
}
const dismiss = (c: PalsideController, id: string) => void c.live?.command('dismiss-poke', { id }).catch(() => {});

function PokeCard({ c, poke }: { c: PalsideController; poke: Poke }) {
  const t = useTranslations();
  const locale = useLocale();
  const person = personFor(c.people, poke.from, t('common.member'));
  return <ContextBar lead={<PersonAvatar person={person} size="sm" />} badge={<Token view={poke.view} size="sm" />} title={t('extension.top.pokeTitle', { name: person.name })}
    meta={<span>{[poke.view.name, poke.view.source, relativeTime(poke.at, locale, c.now)].filter(Boolean).join(' · ')}</span>}
    actions={[{ label: t('extension.top.open'), primary: true, onClick: () => openPage(c, poke.view, () => dismiss(c, poke.id)) }]}
    onClose={() => dismiss(c, poke.id)} closeLabel={t('extension.top.ignore')} />;
}

/** A waiting 喊你来看 in the +N list: who, which page, open or ignore. */
export function PokeRow({ c, poke, onDone }: { c: PalsideController; poke: Poke; onDone: () => void }) {
  const t = useTranslations();
  const person = personFor(c.people, poke.from, t('common.member'));
  return <div className={s.pokeRow}>
    <PersonAvatar person={person} size="xs" />
    <span className={s.pokeText}><strong>{t('extension.top.pokeTitle', { name: person.name })}</strong><small><Token view={poke.view} size="sm" />{poke.view.name}</small></span>
    <button type="button" className={s.pokeOpen} onClick={() => { onDone(); openPage(c, poke.view, () => dismiss(c, poke.id)); }}>{t('extension.top.open')}</button>
  </div>;
}
