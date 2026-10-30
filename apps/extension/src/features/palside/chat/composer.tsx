'use client';
import { Spinner } from '@palside/ui/spinner';
import { VisuallyHidden } from '@palside/ui/visually-hidden';
import { errorMessage, message as uiMessage, MessageError } from '@palside/i18n';
import { useTranslations } from 'use-intl';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { ArrowUp, Check, Gift, ImageIcon, Plus, Pencil, X } from 'lucide-react';
import { IconButton } from '@palside/ui/button';
import { prepareImage } from '@palside/ui/lib/image';
import { ImageEditor } from '../media/image-editor';
import { DraftConflict } from '../feedback/draft-conflict';
import { AssetCard } from '../assets/asset-card';
import { ComposerRows, EditLine, ReplyLine, composerStyles as refStyles } from './composer-social';
import { assetView } from '../../../domain/assets/model';
import { canSend, characterLength, quotedFragment } from '../../../domain/chat/model';
import { quotedText } from './quotes';
import { type Person } from '../../../domain/account/model';
import { insertMention, mentionQuery } from '../../../domain/chat/mentions';
import { insertPastedText, pastedImage } from './clipboard';
import { ReactionPicker } from '../annotations/reaction-picker';
import { StateGlyph } from '../ui/motion-details';
import { CaptureTool } from '../media/capture-tool';
import { PageStrip } from '../viewing/page-strip';
import { InteractToggle, ShareToggle } from '../viewing/page-toggles';
import { Action, PersonAvatar } from '../ui/primitives';
import { IMAGE_LIMIT } from '../../../domain/images/image-policy';
import { readImage } from '../account/read-image';
import type { PalsideController } from '../app/use-palside';
import { whenWalletOpen } from '../wallet/closed';
import s from '../app/palside.module.css';

const TEXT_MAX = 4000;

type Mention = ReturnType<typeof mentionQuery>;

/** The message box: the 本页条 while 互动 runs here, draft rows, the text field, outgoing tools (emoji, image, 截图) on the left and 共享 + 互动 + send on the right. Images come in by paste or drop.
 * Editing a sent message happens here too, like a reply: its text takes the field, the draft waits untouched, and send becomes save. */
export function Composer({ c, inputRef, onSend }: { c: PalsideController; inputRef: RefObject<HTMLTextAreaElement | null>; onSend: () => Promise<void> }) {
  const t = useTranslations();
  const [preparing, setPreparing] = useState(false);
  const [editingImage, setEditingImage] = useState<{ src: string; name: string; teamId: string; accountId: string; revision: number }>();
  const [dragging, setDragging] = useState(false);
  const replyOriginal = c.currentMessages.find(m => m.id === c.draft.replyTo);
  const replyText = quotedText(replyOriginal, undefined, undefined, t);
  const mention = useMention(c, inputRef);
  const latest = useRef(c);
  useEffect(() => { latest.current = c; }, [c]);
  const imageInput = useRef<HTMLInputElement>(null);
  useLinkCard(c);
  const ready = canSend(c.draft);
  const draftAsset = assetView(c.draft.attachment);
  const edited = c.editing && c.canWrite ? c.currentMessages.find(m => m.id === c.editing && !m.recalled && m.author === c.data.self && m.status === 'sent') : undefined;
  const editInvalid = !edited || characterLength(c.editText) > TEXT_MAX || (!c.editText.trim() && !edited.attachment);
  const { editing, setEditing } = c;
  // End editing when the original is unavailable or recalled.
  useEffect(() => { if (editing && !edited) setEditing(undefined); }, [editing, edited, setEditing]);
  useEffect(() => {
    const input = inputRef.current;
    if (!editing || !input) return;
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }, [editing, c.editSessionId, inputRef]);

  /** Opens the draft's image in the editor once the draft is saved, if it is still that image for this account and team. */
  function editDraftImage(src: string, name: string, teamId = c.current) {
    const accountId = c.data.self;
    void c.flushDraft(teamId).then(revision => { const now = latest.current; if (c.ownsScreen() && now.data.self === accountId && now.current === teamId && now.drafts[teamId]?.attachment?.kind === 'image' && now.drafts[teamId]?.attachment?.src === src) setEditingImage({ src, name, teamId, accountId, revision }); }).catch(error => { if (c.ownsScreen()) c.setNotice(errorMessage(error)); });
  }
  async function addImage(file: File) {
    setPreparing(true);
    try {
      const image = await prepareImage(file, IMAGE_LIMIT);
      const src = await readImage(image.blob, uiMessage('extension.copy.imageReadFailed'));
      c.attach({ kind: 'image', src, name: image.name });
    } catch (error) {
      if (c.ownsScreen()) c.setNotice(error instanceof Error ? errorMessage(error) : uiMessage('extension.copy.imageProcessFailed'));
    } finally {
      setPreparing(false);
    }
  }
  function takeImage(files: File[]) {
    const result = pastedImage(files);
    if (result.error) c.setNotice(result.error);
    else if (result.file) void addImage(result.file);
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (edited) return;
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    const pasted = event.clipboardData.getData('text/plain');
    if (pasted) {
      const element = event.currentTarget;
      const next = insertPastedText(c.draft.text, element.selectionStart, element.selectionEnd, pasted);
      c.updateDraft({ text: next.text });
      requestAnimationFrame(() => { if (element.isConnected && element.value === next.text) element.setSelectionRange(next.caret, next.caret); });
    }
    takeImage(files);
  }
  function dragOver(event: DragEvent) {
    if (edited || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  }
  function drop(event: DragEvent) {
    if (edited || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    setDragging(false);
    takeImage([...event.dataTransfer.files]);
  }
  async function send() {
    if (c.disconnected || !ready || preparing || c.draftConflict) return;
    await onSend();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (edited) {
      if (event.key === 'Escape') { event.preventDefault(); c.setEditing(undefined); }
      else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!editInvalid) c.saveEdit(); }
      return;
    }
    if (mention.keyDown(event)) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  const live = c.live;
  // Queued messages show in the list itself; this only tells assistive technology that they go out on their own.
  const queue = live?.state.sendQueue?.[c.current];
  const attach = c.attach;
  useEffect(() => {
    if (!live?.onCaptured) return;
    // A screenshot belongs to the team it was taken for, even if another team is open when it arrives.
    return live.onCaptured(({ src, teamId }) => attach({ kind: 'image', src, name: t('extension.copy.screenshotName') }, teamId));
  }, [live, attach, t]);
  const pendingShare = live?.state.pendingShare && (!live.state.pendingShareTeamId || live.state.pendingShareTeamId === c.current) ? live.state.pendingShare : undefined;
  return <>
    {editingImage && <ImageEditor src={editingImage.src} name={editingImage.name} teamId={editingImage.teamId} command={c.live?.command} onClose={() => setEditingImage(undefined)} onSave={async src => {
      if (c.live) await c.live.command('image-draft-save', { accountId: editingImage.accountId, teamId: editingImage.teamId, source: editingImage.src, draftRevision: editingImage.revision, src });
      else {
        const original = c.drafts[editingImage.teamId]?.attachment;
        if (original?.kind !== 'image' || original.src !== editingImage.src) throw new MessageError(uiMessage('extension.runtime.draftChanged'));
        c.updateDraft({ attachment: { kind: 'image', src, name: editingImage.name } }, editingImage.teamId);
      }
    }} />}
    {pendingShare && <div className={s.replyDraft}>
      <span>{t('extension.copy.addSelectionTo')}{c.team.name}</span>
      <Action label={t('extension.copy.addSelectionDraft')} onClick={() => { c.updateDraft({ text: [c.draft.text, pendingShare].filter(Boolean).join('\n') }); void c.run('clear-share'); }}><Plus /></Action>
      <Action label={t('extension.copy.cancelShare')} onClick={() => void c.run('clear-share')}><X /></Action>
    </div>}
    {mention.picker}
    <div className={s.composerWrap}>
      <PageStrip c={c} />
      <VisuallyHidden role="status">{queue ? t('extension.dynamic.sendPacingStatus', { count: queue.count }) : ''}</VisuallyHidden>
      <div className={s.composer} data-composer-surface data-dragging={dragging || undefined}
        onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={drop}>
        {edited ? <div className={refStyles.refDraft}>
          <EditLine original={edited} />
          <IconButton size="sm" variant="quiet" className={refStyles.remove} label={t('extension.copy.cancelEdit')} onClick={() => c.setEditing(undefined)}><StateGlyph state={t('extension.copy.cancelEdit')}><X size={14} /></StateGlyph></IconButton>
        </div> : <>
        <ComposerRows c={c} />
        <DraftConflict c={c} />
        {c.draft.replyTo && <div className={refStyles.refDraft}>
          <ReplyLine c={c} original={replyOriginal} text={replyText} fragment={quotedFragment(replyOriginal, c.draft.replyRange)} />
          <IconButton size="sm" variant="quiet" className={refStyles.remove} label={t('extension.copy.cancelReply')} onClick={() => c.updateDraft({ replyTo: undefined, replyRange: undefined })}><StateGlyph state={t('extension.copy.cancelReply')}><X size={14} /></StateGlyph></IconButton>
        </div>}
        {c.draft.attachment?.kind === 'asset' && (draftAsset
          ? <AssetCard view={draftAsset} onOpen={() => c.selectAsset(draftAsset.id)} onRemove={() => c.updateDraft({ attachment: undefined })} />
          : <div className={s.replyDraft}><span>{t('extension.copy.tokenUnavailableAddAgain')}</span><Action label={t('extension.copy.removeCard')} onClick={() => c.updateDraft({ attachment: undefined })}><X /></Action></div>)}
        {c.draft.attachment?.kind === 'image' && <div className={s.imageDraft}>
          <img src={c.draft.attachment.src} alt={c.draft.attachment.name} />
          <span>{c.draft.attachment.name}</span>
          <Action label={t('extension.composer.editImage')} onClick={() => { const image = c.draft.attachment; if (image?.kind === 'image') editDraftImage(image.src, image.name); }}><Pencil /></Action>
          <Action label={t('extension.copy.removeImage')} onClick={() => c.updateDraft({ attachment: undefined })}><X /></Action>
        </div>}
        </>}
        <div className={s.composerInput}>
          <textarea ref={inputRef} rows={1} data-message-input value={edited ? c.editText : c.draft.text}
            aria-label={edited ? t('extension.copy.editMessage') : t('extension.copy.message')}
            placeholder={t('extension.copy.chatPlaceholder')}
            aria-autocomplete="list" aria-controls={mention.listId} aria-activedescendant={mention.activeId}
            onPaste={paste} onKeyDown={keyDown} onBlur={mention.close}
            onKeyUp={event => { if (!edited && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) mention.detect(event.currentTarget); }}
            onClick={event => { if (!edited) mention.detect(event.currentTarget); }}
            onChange={event => { if (edited) { c.setEditText(event.target.value); return; } c.updateDraft({ text: event.target.value }); mention.detect(event.currentTarget); }} />
        </div>
        <div className={s.composerToolbar}>
          {edited ? <span /> : <div className={s.tools}>
            <ReactionPicker c={c} />
            <Action label={t('extension.copy.image')} disabled={preparing} onClick={() => imageInput.current?.click()}><ImageIcon /></Action>
            <input ref={imageInput} type="file" accept="image/*" hidden onChange={event => { takeImage([...event.target.files ?? []]); event.target.value = ''; }} />
            {live && <CaptureTool c={c} />}
            <Action label={t('extension.wallet.createPacket')} onClick={() => whenWalletOpen(c, () => c.go('wallet-packet'))}><Gift /></Action>
          </div>}
          {edited ? <div className={s.tools}>
            {characterLength(c.editText) > TEXT_MAX - 200 && <small className={characterLength(c.editText) > TEXT_MAX ? s.danger : s.muted}>{characterLength(c.editText)}/{TEXT_MAX}</small>}
            <IconButton size="sm" className={s.sendButton} label={t('extension.copy.saveChanges')} variant={editInvalid ? 'surface' : 'primary'} disabled={editInvalid} onClick={c.saveEdit}>
              <StateGlyph state="save"><Check /></StateGlyph>
            </IconButton>
          </div> : <div className={s.tools}>
            <span className={s.pageToggles}><ShareToggle c={c} /><InteractToggle c={c} /></span>
            {characterLength(c.draft.text) > TEXT_MAX - 200 && <small className={characterLength(c.draft.text) > TEXT_MAX ? s.danger : s.muted}>{characterLength(c.draft.text)}/{TEXT_MAX}</small>}
            <IconButton data-film-action="send" size="sm" className={s.sendButton}
              label={c.disconnected ? t('extension.copy.sendWhenConnected') : t('extension.copy.sendMessage')}
              variant={ready ? 'primary' : 'surface'} disabled={c.disconnected || !ready || preparing || c.draftConflict} onClick={() => void send()}>
              <StateGlyph state={ready ? 'ready' : 'empty'}>{preparing ? <Spinner className={s.loadingIcon} size={18} /> : <ArrowUp />}</StateGlyph>
            </IconButton>
          </div>}
        </div>
      </div>
    </div>
  </>;
}

const LINK = /https?:\/\/[^\s<>"'，。）)]+/i;

/** 链接卡片: the first web address typed or pasted becomes the draft's page card. Removing the card keeps it away for that address;
 * deleting the address takes its card with it. The card is built locally from the address, never by fetching the page. */
function useLinkCard(c: PalsideController) {
  const { draft, current: teamId, data: { self: accountId } } = c;
  const url = LINK.exec(draft.text)?.[0];
  const attachment = c.draft.attachment;
  const auto = c.draft.automaticCard;
  const dismissed = c.draft.dismissedUrls;
  const latest = useRef(c);
  useEffect(() => { latest.current = c; });
  const command = c.live?.command;
  useEffect(() => {
    if (auto) {
      const owned = attachment?.kind === 'asset' && attachment.assetId === auto.assetId;
      if (!owned) { latest.current.updateDraft({ automaticCard: undefined, dismissedUrls: [...new Set([...(dismissed ?? []), auto.url])] }); return; }
      if (auto.url !== url) { latest.current.updateDraft({ attachment: undefined, automaticCard: undefined }); return; }
    }
    if (!url || !command || attachment || dismissed?.includes(url)) return;
    let current = true;
    const timer = setTimeout(() => {
      void command('link-card', { url }).then(result => {
        if (!current || !result?.attachment || latest.current.draft !== draft || latest.current.current !== teamId || latest.current.data.self !== accountId) return;
        latest.current.updateDraft({ attachment: result.attachment, automaticCard: { url, assetId: result.attachment.assetId } });
      }).catch(() => {});
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [url, attachment, auto, dismissed, command, draft, teamId, accountId]);
}

/** @ mentions typed into the field: the query under the caret, the matching teammates and keyboard choice. */
function useMention(c: PalsideController, inputRef: RefObject<HTMLTextAreaElement | null>) {
  const t = useTranslations();
  const [at, setAt] = useState<Mention>();
  const [index, setIndex] = useState(0);
  const query = at?.query.toLocaleLowerCase() ?? '';
  const people = c.people.filter(person => c.team.memberIds.includes(person.id) && person.id !== c.data.self && person.name.toLocaleLowerCase().includes(query));
  const active = Math.min(index, Math.max(0, people.length - 1));
  useEffect(() => { if (at) document.getElementById(`mention-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, at]);
  function detect(element: HTMLTextAreaElement) {
    setAt(element.selectionStart === element.selectionEnd ? mentionQuery(element.value, element.selectionStart) : undefined);
    setIndex(0);
  }
  function choose(person: Person) {
    const input = inputRef.current;
    const next = insertMention(c.draft, person, at?.start ?? input?.selectionStart ?? c.draft.text.length, at?.end ?? input?.selectionEnd ?? c.draft.text.length);
    c.updateDraft({ text: next.text, mentions: next.mentions });
    setAt(undefined);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.caret, next.caret); });
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!at) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAt(undefined); return true; }
    if (!people.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + people.length) % people.length);
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); choose(people[active]!); return true; }
    return false;
  }
  const picker = c.canWrite && at ? <div className={s.mentionPicker} id="mention-options" role="listbox" aria-label={t('extension.copy.chooseMention')} onMouseDown={event => event.preventDefault()}>
    {people.length
      ? people.map((person, i) => <button type="button" role="option" id={`mention-option-${i}`} aria-selected={i === active} key={person.id} onClick={() => choose(person)}><PersonAvatar person={person} size="sm" /><span>{person.name}</span><small>#{person.id.slice(0, 6)}</small></button>)
      : <p>{t('extension.copy.noMatchingMembers')}</p>}
  </div> : null;
  return {
    picker,
    detect,
    keyDown,
    close: () => setAt(undefined),
    listId: at ? 'mention-options' : undefined,
    activeId: at && people.length ? `mention-option-${active}` : undefined,
  };
}
