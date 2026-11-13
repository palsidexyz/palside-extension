import { errorMessage, message as uiMessage, MessageError, failureText } from '@palside/i18n';
import { readonlyNotice } from '../../../runtime/transport/connection';
import { canSend, characterLength, draftAttachmentPatch, emptyDraft, type Attachment, type Draft, type Message } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

type DraftActions = Pick<PanelActions, 'updateDraft' | 'flushDraft' | 'resolveDraftConflict' | 'attach' | 'send' | 'retry' | 'saveEdit' | 'recall'>;

export function createLiveDraftActions(state: PanelState, getActions: () => PanelActions): DraftActions {
  const { view: { current, drafts, data, setNotice, draft, setConfirmation, teams, team, disconnected, draftConflict, canWrite, editing, editText, messages, setEditing, live }, draftVersions, blockedDrafts, draftConflicts, setOptimisticDrafts, draftRevisions, draftQueue, setDraftConflicts, resolvingDrafts, editRevision, setEditRevision } = state;
  /** The newest draft revision this panel knows: its own queued writes or the runtime's saved one. */
  const knownRevision = (teamId: string) => Math.max(draftRevisions.current[teamId] ?? 0, live.state.drafts[teamId]?.revision ?? 0);
  const savedRevision = (teamId: string) => live.state.drafts[teamId]?.revision ?? 0;

  /**
   * Edits show at once and are written in order. A blocked or conflicting draft keeps local edits only, until the user picks a
   * version; a failed write blocks the draft and asks for that choice.
   */
  function updateDraft(patch: Partial<Draft>, teamId = current) {
    patch = draftAttachmentPatch(drafts[teamId] ?? emptyDraft, patch);
    draftVersions.current[teamId] = (draftVersions.current[teamId] ?? 0) + 1;
    if (blockedDrafts.current.has(teamId) || draftConflicts[teamId]) {
      setOptimisticDrafts(old => ({ ...old, [teamId]: { value: { ...(old[teamId]?.value ?? drafts[teamId] ?? emptyDraft), ...patch }, revision: Number.MAX_SAFE_INTEGER } }));
      return;
    }
    const revision = knownRevision(teamId);
    draftRevisions.current[teamId] = revision + 1;
    setOptimisticDrafts(old => {
      const pending = old[teamId] && old[teamId].revision > savedRevision(teamId) ? old[teamId].value : drafts[teamId] ?? emptyDraft;
      return { ...old, [teamId]: { value: { ...pending, ...patch }, revision: revision + 1 } };
    });
    const written = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]));
    draftQueue.current = draftQueue.current.then(async () => {
      if (blockedDrafts.current.has(teamId)) return;
      await live.command('draft', { accountId: data.self, teamId, patch: written, revision });
    }).catch(error => {
      blockedDrafts.current.add(teamId);
      setNotice(errorMessage(error));
      draftRevisions.current[teamId] = 0;
      setDraftConflicts(old => ({ ...old, [teamId]: true }));
      setOptimisticDrafts(old => ({ ...old, [teamId]: { value: old[teamId]?.value ?? drafts[teamId] ?? emptyDraft, revision: Number.MAX_SAFE_INTEGER } }));
    });
  }

  async function flushDraft(teamId = current) {
    await draftQueue.current;
    if (blockedDrafts.current.has(teamId)) throw new MessageError(uiMessage('extension.copy.draftUnsaved'));
    return knownRevision(teamId);
  }

  /** 保留本机 writes every field of the local draft over the saved one; 使用已保存 drops the local edits. */
  async function resolveDraftConflict(keepLocal: boolean) {
    if (resolvingDrafts.current.has(current)) return;
    const teamId = current, version = draftVersions.current[teamId] ?? 0;
    resolvingDrafts.current.add(teamId);
    try {
      await draftQueue.current;
      if (keepLocal) {
        const patch = { ...draft, attachment: draft.attachment ?? null, replyTo: draft.replyTo ?? null, replyRange: draft.replyRange ?? null, mentions: draft.mentions ?? [], automaticCard: draft.automaticCard ?? null, dismissedUrls: draft.dismissedUrls ?? [] };
        await live.command('draft', { accountId: data.self, teamId, revision: savedRevision(teamId), patch });
      }
      if ((draftVersions.current[teamId] ?? 0) !== version) return;
      blockedDrafts.current.delete(teamId);
      draftRevisions.current[teamId] = 0;
      setDraftConflicts(old => ({ ...old, [teamId]: false }));
      setOptimisticDrafts(old => { const next = { ...old }; delete next[teamId]; return next; });
    } catch (error) {
      setNotice(failureText(error, 'extension.copy.draftUnsaved'));
    } finally {
      resolvingDrafts.current.delete(teamId);
    }
  }

  /** Puts an image, card or token into the squad's draft; one that already holds an attachment asks before replacing it. */
  function attach(attachment: Attachment, teamId = current) {
    const { go } = getActions();
    if (attachment.kind === 'asset') {
      const assetId = attachment.assetId;
      const selected = attachment.view ?? data.views.find(view => view.id === assetId);
      // A completed lookup can precede React's next state render. The runtime owns
      // the prepared snapshot and resolves this ID when attaching it to the draft.
      if (selected) attachment = { ...attachment, view: { ...selected } };
    }
    const target = { teamId, accountId: data.self, attachment };
    void live.command('attach', target).then(result => {
      if (!state.view.ownsScreen() || teamId !== current) return;
      if (!result.requiresReplace) { go('chat'); return; }
      setConfirmation({
        title: uiMessage('extension.copy.replaceAttachmentTitle'),
        description: uiMessage('extension.dynamic.keepTeamDraft', { name: (teams.find(item => item.id === teamId) ?? team).name ?? '' }),
        confirm: async () => {
          await live.command('attach', { ...target, replace: true, revision: result.revision });
          if (state.view.ownsScreen()) go('chat');
        },
      });
    }).catch(error => { if (state.view.ownsScreen()) setNotice(errorMessage(error)); });
  }

  /** `prepare` sees the outgoing message synchronously, while the composer still shows the draft. */
  async function send(prepare?: (message: Message) => void): Promise<boolean> {
    if (disconnected) return false;
    if (draftConflict) { setNotice(uiMessage('extension.copy.chooseDraftFirst')); return false; }
    if (!canWrite || !canSend(draft)) return false;
    const mentionIds = draft.mentions?.filter(person => draft.text.includes(`@${person.label}`) && team.memberIds.includes(person.id)).map(person => person.id);
    const message: Message = {
      id: crypto.randomUUID(), teamId: current, author: data.self, text: draft.text.trim(), time: '', timestamp: Date.now(),
      attachment: draft.attachment, replyTo: draft.replyTo, ...(draft.replyTo && draft.replyRange ? { replyRange: draft.replyRange } : {}), mentionIds, status: 'sending',
    };
    prepare?.(message);
    const revision = knownRevision(current);
    await draftQueue.current;
    if (blockedDrafts.current.has(current)) { setNotice(uiMessage('extension.copy.chooseDraftFirst')); return false; }
    const result = await getActions().guarded('send', { message, revision }, () => send());
    return Boolean(result?.eventId);
  }

  /** 重试 sends the failed message again as it was, not the current draft. */
  function retry(message: Message) {
    if (disconnected || !canWrite) return;
    const { run, guarded } = getActions();
    void run('prepare-retry', { id: message.id, accountId: data.self }).then(result => {
      if (result) void guarded('send', { message: result.message, revision: -1 }, () => retry(message));
    });
  }

  /** Saves an edit of one's own sent message. An edit made elsewhere since this one began is a conflict, never overwritten. */
  function saveEdit() {
    if (!editing) return;
    if (!canWrite) { setNotice(readonlyNotice(team.readonlyReason).title); return; }
    if (disconnected) { setNotice(uiMessage('extension.runtime.editDisconnected')); return; }
    if (characterLength(editText) > 4000) return;
    const original = messages.find(message => message.id === editing);
    if (!original || original.recalled || original.status !== 'sent' || original.author !== data.self || original.teamId !== current) { setEditing(undefined); return; }
    if (!editText.trim() && !original.attachment) return;
    if ((original.editedAt ?? 0) !== editRevision) {
      setNotice(uiMessage('extension.copy.editConflict'));
      setEditRevision(original.editedAt ?? 0);
      return;
    }
    const session = state.editSession.current;
    const stillEditing = () => state.mounted.current && state.editSession.current === session;
    void getActions().guarded('edit', { teamId: current, id: editing, text: editText.trim(), baseEditedAt: editRevision }, () => { if (stillEditing()) saveEdit(); })
      .then(result => { if (result && stillEditing()) setEditing(undefined); });
  }

  /** 撤回 one's own message, or (as captain) 移除 someone else's, after a confirmation. */
  function recall(message: Message) {
    if (!canWrite) { setNotice(readonlyNotice(team.readonlyReason).title); return; }
    if (disconnected) { setNotice(uiMessage('extension.runtime.recallDisconnected')); return; }
    setConfirmation({
      title: message.author === data.self ? uiMessage('extension.copy.recallMessageTitle') : uiMessage('extension.copy.removeMessageTitle'),
      description: uiMessage('extension.copy.removeMessageDescription'),
      confirm: () => live.command('recall', { teamId: current, id: message.id }).then(() => {}),
    });
  }

  return { updateDraft, flushDraft, resolveDraftConflict, attach, send, retry, saveEdit, recall };
}
