'use client';
import { message as uiMessage } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { ArrowLeftRight, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@palside/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@palside/ui/popover';
import { TeamOptions } from '../chat/chat-header';
import { assetView } from '../../../domain/assets/model';
import { AssetCard } from '../assets/asset-card';
import { DraftConflict } from './draft-conflict';
import { Action } from '../ui/primitives';
import type { PalsideController } from '../app/use-palside';
import s from '../app/palside.module.css';
import h from '../chat/chat-header.module.css';

/** Where the composer was, a read-only team offers the ways onward — another team, or a new one — with any kept draft above them. */
export function ReadonlyDraft({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const others = c.teams.some(team => team.joined && team.id !== c.current);
  return <section className={s.readonlyFooter} aria-label={t('extension.copy.readonlyDraft')}>
    <KeptDraft c={c} />
    <div className={s.readonlyActions}>
      {others && <Popover side="top" boundarySelector="[data-palside-app]">
        <PopoverTrigger asChild><Button size="lg" leadingIcon={<ArrowLeftRight size={16} />}>{t('extension.copy.switchTeam')}</Button></PopoverTrigger>
        <PopoverContent aria-label={t('extension.copy.switchTeam')} className={h.teamPopup}><TeamOptions c={c} onTeam={c.chooseTeam} /></PopoverContent>
      </Popover>}
      <Button size="lg" variant={others ? 'surface' : 'primary'} leadingIcon={<Plus size={16} />} onClick={() => c.go('add-team')}>{t(others ? 'extension.start.createOrJoin' : 'extension.copy.startTeam')}</Button>
    </div>
  </section>;
}

function KeptDraft({ c }: { c: PalsideController }) {
  const t = useTranslations();
  const draft = c.draft;
  if (!c.draftConflict && !draft.text && !draft.attachment && !draft.ref && !draft.replyTo) return null;
  const view = assetView(draft.attachment);
  const copy = [draft.text, draft.ref?.caption, draft.ref?.view.url, view?.url].filter(Boolean).join('\n');
  function remove() {
    const teamId = c.current;
    c.setConfirmation({ title: uiMessage('extension.copy.clearDraft'), description: uiMessage('extension.copy.clearDraftDescription'), action: uiMessage('extension.copy.clearDraft'), confirm: async () => {
      c.updateDraft({ text: '', attachment: undefined, ref: undefined, replyTo: undefined, replyRange: undefined, mentions: [] }, teamId);
      try { await c.flushDraft(teamId); }
      catch (error) { c.updateDraft(draft, teamId); throw error; }
    } });
  }
  return <div className={s.composer}>
      <DraftConflict c={c} />
      <div className={s.replyDraft}><span>{t('extension.copy.readonlyDraft')}</span>{copy && <Action label={t('extension.copy.copy')} onClick={() => void c.copy(copy)}><Copy /></Action>}<Action label={t('extension.copy.clearDraft')} onClick={remove}><Trash2 /></Action></div>
      {draft.text && <div className={s.composerInput}><textarea rows={1} readOnly aria-label={t('extension.copy.readonlyDraft')} value={draft.text} /></div>}
      {draft.ref && <div className={s.replyDraft}><span>{draft.ref.caption}</span></div>}
      {view && <AssetCard view={view} onOpen={() => c.selectAsset(view.id)} />}
      {draft.attachment?.kind === 'image' && <div className={s.imageDraft}>
        <img src={draft.attachment.src} alt={draft.attachment.name} /><span>{draft.attachment.name}</span>
      </div>}
  </div>;
}
