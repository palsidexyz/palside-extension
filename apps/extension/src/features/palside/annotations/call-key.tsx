'use client';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Megaphone } from 'lucide-react';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { reachedPoke } from '../../../domain/annotations/social';
import { Action } from '../ui/primitives';
import { tokenLabel } from '../assets/token-name';
import type { PalsideController } from '../app/use-palside';

/**
 * 喊大家来看, in the composer's tools: one press calls every teammate who is online (active or away) and not already on the page this
 * device shares. Unavailable, it stays in place, greyed, and says why in its tooltip.
 */
export function CallKey({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const published = c.live.state.publishedViewing;
  const own = published?.teamId === c.current ? c.data.views.find(view => view.id === published.viewId) : undefined;
  const online = c.people.filter(person => person.id !== c.data.self && c.team.memberIds.includes(person.id) && (person.presence === 'active' || person.presence === 'away'));
  const away = own ? online.filter(person => { const there = c.data.views.find(view => view.id === person.viewing); return !there || !reachedPoke(own, there); }) : [];
  const place = own ? tokenLabel(own, t, c) : '';
  const reason = !own ? t('extension.member.needSharing') : !online.length ? t('extension.member.nobodyOnline') : !away.length ? t('extension.member.everyoneHere') : undefined;
  async function call() {
    if (reason || busy) return;
    setBusy(true);
    try {
      const { people } = await c.live.command('poke', { teamId: c.current });
      c.setNotice(uiMessage('extension.member.pokedAll', { count: people, place }));
    } catch (error) { c.setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Action label={reason ?? t('extension.member.pokeAll', { place })} aria-disabled={reason ? true : undefined} aria-busy={busy || undefined} onClick={() => void call()}><Megaphone /></Action>;
}
