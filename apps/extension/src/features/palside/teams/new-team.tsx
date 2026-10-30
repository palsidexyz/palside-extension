'use client';
import { Button } from '@palside/ui/button';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { errorMessage, message as uiMessage } from '@palside/i18n';
import { Check, Copy, UsersRound } from 'lucide-react';
import { CountText } from '../ui/motion-details';
import { TeamAvatar } from './team-avatar';
import type { PalsideController } from '../app/use-palside';
import s from './new-team.module.css';

/** An owner's empty, friendless team. Inviting someone or saying something ends it for good. */
export function showsNewTeam(c: PalsideController) {
  return !c.live?.state.preferences.startedTeams?.includes(c.current) && Boolean(c.live && c.canWrite) && c.team.owner === c.data.self && c.team.memberIds.length <= 1 && !c.currentMessages.length;
}

/** A new team's first screen: the team itself, centred, and the one thing to do next — copy its invitation link. Any other team without
 * messages shows the same face, name and headcount alone (`invite` off): no button, no prompt. */
export function NewTeam({ c, invite = true }: { c: PalsideController; invite?: boolean }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2400); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    const live = c.live;
    if (busy || !live) return;
    setBusy(true);
    try {
      // Reuse the active link; a team that never had one, or whose link lapsed, gets a fresh one.
      const read = (invitation?: { url?: string | null; active?: boolean } | null) => invitation?.active ? invitation.url : undefined;
      const url = read(live.state.invitations[c.current]) ?? read(await live.command('invitation', { teamId: c.current })) ?? read(await live.command('invitation', { teamId: c.current, action: 'regenerate' }));
      if (!url) { c.setNotice(uiMessage('extension.copy.inviteLoadFailed')); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (failure) { c.setNotice(failure instanceof Error ? errorMessage(failure) : uiMessage('extension.copy.inviteLoadFailed')); }
    finally { setBusy(false); }
  }
  const count = c.team.memberCount ?? c.team.memberIds.length;
  return <section className={s.newTeam} aria-labelledby="new-team-name">
    <TeamAvatar team={c.team} size="xl" />
    <h2 id="new-team-name" className={s.nameLine}><span className={s.name}>{c.team.name}</span><span className={s.count}><UsersRound size={14} aria-hidden="true" /><CountText text={t('extension.dynamic.peopleCount', { count })} value={count} /></span></h2>
    {invite && <Button variant={copied ? "surface" : "primary"} className={s.copy} disabled={busy} aria-busy={busy || undefined} onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{copied ? t('extension.newTeam.copied') : t('extension.copy.copyInvite')}</span>
    </Button>}
  </section>;
}
