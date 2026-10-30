import { errorMessage,message as uiMessage,MessageError } from '@palside/i18n';
import { readonlyNotice } from '../../../runtime/transport/connection';
import { canSend,characterLength,draftAttachmentPatch,emptyDraft,type Attachment,type Draft,type Message } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createLiveDraftActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'updateDraft' | 'flushDraft' | 'resolveDraftConflict' | 'attach' | 'send' | 'retry' | 'saveEdit' | 'recall'> {
const { view: { current, drafts, data, setNotice, draft, setConfirmation, teams, team, disconnected, draftConflict, canWrite, editing, editText, messages, setEditing }, draftVersions, blockedDrafts, draftConflicts, setOptimisticDrafts, draftRevisions, draftQueue, setDraftConflicts, resolvingDrafts, editRevision, setEditRevision } = state;
const live = state.view.live!;

function updateDraft(patch: Partial<Draft>, teamId = current) {
    patch = draftAttachmentPatch(drafts[teamId] ?? emptyDraft, patch);
    draftVersions.current[teamId] = (draftVersions.current[teamId] ?? 0) + 1;
    if (blockedDrafts.current.has(teamId) || draftConflicts[teamId]) {
        setOptimisticDrafts(old => ({ ...old, [teamId]: { value: { ...(old[teamId]?.value ?? drafts[teamId] ?? emptyDraft), ...patch }, revision: Number.MAX_SAFE_INTEGER } }));
        return;
    }
    const revision = Math.max(draftRevisions.current[teamId] ?? 0, live.state.drafts[teamId]?.revision ?? 0);
    draftRevisions.current[teamId] = revision + 1;
    setOptimisticDrafts(old => ({ ...old, [teamId]: { value: { ...(old[teamId] && old[teamId]!.revision > (live.state.drafts[teamId]?.revision ?? 0) ? old[teamId]!.value : drafts[teamId] ?? emptyDraft), ...patch }, revision: revision + 1 } }));
    draftQueue.current = draftQueue.current.then(async () => { if (blockedDrafts.current.has(teamId))
        return; await live.command('draft', { accountId: data.self, teamId, patch: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value])), revision }); }).catch(error => { blockedDrafts.current.add(teamId); setNotice(errorMessage(error)); draftRevisions.current[teamId] = 0; setDraftConflicts(old => ({ ...old, [teamId]: true })); setOptimisticDrafts(old => ({ ...old, [teamId]: { value: old[teamId]?.value ?? drafts[teamId] ?? emptyDraft, revision: Number.MAX_SAFE_INTEGER } })); });
}

async function flushDraft(teamId = current) {

    await draftQueue.current;
    if (blockedDrafts.current.has(teamId))
        throw new MessageError(uiMessage('extension.copy.draftUnsaved'));
    return Math.max(draftRevisions.current[teamId] ?? 0, live?.state.drafts[teamId]?.revision ?? 0);
}

async function resolveDraftConflict(keepLocal: boolean) {

    if (resolvingDrafts.current.has(current))
        return;
    const teamId = current, version = draftVersions.current[teamId] ?? 0;
    resolvingDrafts.current.add(teamId);
    try {
        await draftQueue.current;
        if (keepLocal)
            await live.command('draft', { accountId: data.self, teamId, revision: live.state.drafts[teamId]?.revision ?? 0, patch: { ...draft, attachment: draft.attachment ?? null, replyTo: draft.replyTo ?? null, replyRange: draft.replyRange ?? null, ref: draft.ref ?? null, mentions: draft.mentions ?? [], automaticCard: draft.automaticCard ?? null, dismissedUrls: draft.dismissedUrls ?? [] } });
        if ((draftVersions.current[teamId] ?? 0) !== version)
            return;
        blockedDrafts.current.delete(teamId);
        draftRevisions.current[teamId] = 0;
        setDraftConflicts(old => ({ ...old, [teamId]: false }));
        setOptimisticDrafts(old => { const next = { ...old }; delete next[teamId]; return next; });
    }
    catch (error) {
        setNotice(error instanceof Error ? errorMessage(error) : uiMessage('extension.copy.draftUnsaved'));
    }
    finally {
        resolvingDrafts.current.delete(teamId);
    }
}

function attach(attachment: Attachment, teamId = current) {
    const { go } = getActions();
    if (attachment.kind === 'asset') {
        const assetId = attachment.assetId;
        const selected = attachment.view ?? data.views.find(view => view.id === assetId);
        // A completed lookup can precede React's next state render. The live service owns
        // the prepared snapshot and resolves this ID when attaching it to the draft.
        if (selected)
            attachment = { ...attachment, view: { ...selected } };
    }
    {
        const target = { teamId, accountId: data.self, attachment };
        void live.command('attach', target).then(result => {
            if (!state.view.ownsScreen() || teamId !== current) return;
            if (result.requiresReplace)
                setConfirmation({ title: uiMessage('extension.copy.replaceAttachmentTitle'), description: uiMessage('extension.dynamic.keepTeamDraft', { name: (teams.find(item => item.id === teamId) ?? team).name ?? '' }), confirm: async () => { await live.command('attach', { ...target, replace: true, revision: result.revision }); if (state.view.ownsScreen()) go('chat'); } });
            else
                go('chat');
        }).catch(error => { if (state.view.ownsScreen()) setNotice(errorMessage(error)); });
        return;
    }
}

/** `prepare` sees the outgoing message synchronously, while the composer still shows the draft. */
async function send(prepare?: (message: Message) => void): Promise<boolean> {
    const { guarded } = getActions();
    if (disconnected)
        return false;
    if (draftConflict) {
        setNotice(uiMessage('extension.copy.chooseDraftFirst'));
        return false;
    }
    if (!canWrite || !canSend(draft))
        return false;
    const message: Message = { id: crypto.randomUUID(), teamId: current, author: data.self, text: draft.text.trim(), time: '', timestamp: Date.now(), attachment: draft.attachment, ref: draft.ref, replyTo: draft.replyTo, ...(draft.replyTo && draft.replyRange ? { replyRange: draft.replyRange } : {}), mentionIds: draft.mentions?.filter(p => draft.text.includes(`@${p.label}`) && team.memberIds.includes(p.id)).map(p => p.id), status: 'sending' };
    prepare?.(message);
    {
        const revision = Math.max(draftRevisions.current[current] ?? 0, live.state.drafts[current]?.revision ?? 0);
        await draftQueue.current;
        if (blockedDrafts.current.has(current)) {
            setNotice(uiMessage('extension.copy.chooseDraftFirst'));
            return false;
        }
        const result = await guarded('send', { message, revision }, () => send());
        return Boolean(result?.eventId);
    }
}

function retry(message: Message) {
    const { run, guarded } = getActions();
    if (disconnected || !canWrite)
        return;
    {
        void run('prepare-retry', { id: message.id, accountId: data.self }).then(result => {
            if (result)
                void guarded('send', { message: result.message, revision: -1 }, () => retry(message));
        });
        return;
    }
}

function saveEdit() {
    const { guarded } = getActions();
    if (!editing)
        return;
    if (!canWrite) {
        setNotice(readonlyNotice(team.readonlyReason).title);
        return;
    }
    if (disconnected) {
        setNotice(uiMessage('extension.runtime.editDisconnected'));
        return;
    }
    if (characterLength(editText) > 4000)
        return;
    const original = messages.find(m => m.id === editing);
    if (!original || original.recalled || original.status !== 'sent' || original.author !== data.self || original.teamId !== current) {
        setEditing(undefined);
        return;
    }
    if (!editText.trim() && !original?.attachment)
        return;
    {
        if ((original?.editedAt ?? 0) !== editRevision) {
            setNotice(uiMessage('extension.copy.editConflict'));
            setEditRevision(original?.editedAt ?? 0);
            return;
        }
        const submittedSession = state.editSession.current;
        void guarded('edit', { teamId: current, id: editing, text: editText.trim(), baseEditedAt: editRevision }, () => {
            if (state.mounted.current && state.editSession.current === submittedSession) saveEdit();
        }).then(result => { if (result && state.mounted.current && state.editSession.current === submittedSession)
            setEditing(undefined); });
        return;
    }
}

function recall(message: Message) {

    if (!canWrite) {
        setNotice(readonlyNotice(team.readonlyReason).title);
        return;
    }
    if (disconnected) {
        setNotice(uiMessage('extension.runtime.recallDisconnected'));
        return;
    }
    setConfirmation({ title: message.author === data.self ? uiMessage('extension.copy.recallMessageTitle') : uiMessage('extension.copy.removeMessageTitle'), description: uiMessage('extension.copy.removeMessageDescription'), confirm: () => { return live.command('recall', { teamId: current, id: message.id }).then(() => { }); } });
}
  return { updateDraft, flushDraft, resolveDraftConflict, attach, send, retry, saveEdit, recall };
}
