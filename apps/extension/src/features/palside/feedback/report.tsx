'use client';
import { errorMessage, message as uiMessage, type TextValue } from '@palside/i18n';

import { useTranslations } from 'use-intl';
import { Checkbox } from '@palside/ui/checkbox';
import { Button } from '@palside/ui/button';
import { InlineFeedback } from '@palside/ui/inline-feedback';
import { Textarea, Field, CharacterCount } from '@palside/ui/field';
import { useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { REPORT_REASONS as reasons, REPORT_NOTE_LIMIT as DETAIL_LIMIT } from '@palside/shared/contracts/limits';
import { characterLength } from '../../../domain/chat/model';
import { type Team } from '../../../domain/teams/model';
import { PersonAvatar } from '../ui/primitives';
import { TeamAvatar } from '../teams/team-avatar';
import { useText } from '../ui/text';
import type { PalsideController } from '../app/use-palside';
import r from './report.module.css';
export type ReportTarget = { kind: 'message' | 'team' | 'account'; targetId: string; preview: string; author?: string; team?: Team; image?: { src: string; name: string } };

type Reason = typeof reasons[number];

export function Report({ c, target }: { c: PalsideController; target: ReportTarget }) {
  const t = useTranslations();
  const [reason, setReason] = useState<Reason>();
  const [details, setDetails] = useState('');
  const [includeImage, setIncludeImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  // The result stays here, under the form: sent, not yet confirmed, or failed.
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'warning' | 'error'; message: TextValue }>();
  const text = useText();
  const sent = outcome?.tone === 'success';
  const [key] = useState(() => crypto.randomUUID());
  const reasonLabel = (value: Reason) => ({ spam: t('extension.copy.reportSpam'), harassment: t('extension.copy.reportHarassment'), sexual: t('extension.copy.reportSexual'), illegal: t('extension.copy.reportIllegal'), other: t('extension.copy.reportOther') })[value];
  const tooLong = characterLength(details) > DETAIL_LIMIT;
  const ready = Boolean(reason) && !tooLong && (reason !== 'other' || Boolean(details.trim()));
  const locked = busy || pending || sent;
  const [title = '', ...rest] = target.preview.split('\n');
  const person = target.kind === 'message' ? c.people.find(p => p.id === target.author) : target.kind === 'account' ? c.people.find(p => p.id === target.targetId) ?? { id: target.targetId, name: title.replace(/ #.*$/, ''), color: '#e9edf0' } : undefined;
  const subject = target.kind === 'team' ? title : person?.name;
  const body = target.kind === 'message' ? target.preview : target.kind === 'team' ? rest.join('\n').trim() : '';
  return <form className={r.report} onSubmit={async event => {
    event.preventDefault(); if (!c.live || busy || !ready || !reason) return; setBusy(true);
    try { const result = await c.live.command('report', { accountId: c.data.self, kind: target.kind, targetId: target.targetId, reason, note: details.trim(), snapshot: target.preview, image: includeImage ? target.image?.src : undefined, key }); if (result.pending) { setPending(true); setOutcome({ tone: 'warning', message: uiMessage('extension.copy.reportUnknown') }); } else { setPending(false); setOutcome({ tone: 'success', message: uiMessage(result.recovered ? 'extension.copy.reportAlreadySent' : 'extension.copy.reportSent') }); } } catch (error) { setPending(false); setOutcome({ tone: 'error', message: error instanceof Error ? errorMessage(error) : uiMessage('extension.copy.reportFailed') }); } finally { setBusy(false); }
  }}>
    <section className={r.section} aria-labelledby="report-target-title">
      <h2 id="report-target-title" className={r.title}>{t(target.kind === 'message' ? 'extension.copy.reportMessage' : target.kind === 'team' ? 'extension.copy.reportTeam' : 'extension.copy.reportAccount')}</h2>
      <div className={r.target}>
        {subject && <div className={r.subject}>{target.kind === 'team' ? target.team && <TeamAvatar team={target.team} size="sm" /> : person && <PersonAvatar person={person} size="sm" />}<strong>{subject}</strong>{target.kind === 'account' && <small>#{target.targetId.slice(0, 6)}</small>}</div>}
        {body && <p className={r.body}>{body}</p>}
        {target.image && <motion.img className={r.image} src={target.image.src} alt={target.image.name} />}
        {target.image && <Checkbox className={r.attach} label={t('extension.copy.reportImage')} checked={includeImage} disabled={locked} onChange={event => setIncludeImage(event.target.checked)} />}
      </div>
      <p className={r.privacy}><ShieldCheck size={14} aria-hidden="true" />{t('extension.copy.reportPrivacy')}</p>
    </section>
    <fieldset className={r.section} disabled={locked}>
      <legend className={r.title}>{t('extension.copy.reportReasonTitle')}</legend>
      <div className={r.reasons}>{reasons.map(value => <label key={value} className={r.reason} data-checked={reason === value || undefined}><input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} required />{reasonLabel(value)}</label>)}</div>
    </fieldset>
    <Field id="report-details" label={t('extension.copy.reportReason')} optional={reason === 'other' ? undefined : t('extension.copy.optional')} counter={<CharacterCount label={t('extension.dynamic.characterCount', { count: characterLength(details), maximum: DETAIL_LIMIT, excess: Math.max(0, characterLength(details) - DETAIL_LIMIT) })} value={details} limit={DETAIL_LIMIT} />}>{props => <Textarea {...props} rows={3} aria-invalid={tooLong} value={details} disabled={locked} placeholder={t('extension.copy.reportDetailsPlaceholder')} onChange={event => setDetails(event.target.value)} />}</Field>
    {outcome && <InlineFeedback tone={outcome.tone}>{text(outcome.message)}</InlineFeedback>}
    <div className={r.actions}>{sent ? <Button onClick={() => c.go('chat')}>{t('common.back')}</Button> : <><Button onClick={() => c.go('chat')}>{pending ? t('common.back') : t('common.cancel')}</Button><Button loadingLabel={t('common.working')} type="submit" variant="primary" loading={busy} disabled={!ready}>{pending ? t('extension.copy.retryCheck') : t('extension.copy.submitReport')}</Button></>}</div>
  </form>;
}
