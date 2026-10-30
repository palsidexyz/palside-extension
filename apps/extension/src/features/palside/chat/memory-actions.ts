import { message as uiMessage,MessageError } from '@palside/i18n';
import { readonlyNotice } from '../../../runtime/transport/connection';
import { applyMessageEdit,canSend,characterLength,draftAttachmentPatch,emptyDraft,recallMessage,type Attachment,type Draft,type Message } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createMemoryDraftActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'updateDraft' | 'flushDraft' | 'resolveDraftConflict' | 'attach' | 'send' | 'retry' | 'saveEdit' | 'recall'> {
const { view: { current, setNotice, data, draft, setConfirmation, disconnected, draftConflict, canWrite, team, setMessages, editing, editText, messages, setEditing }, setDrafts, draftQueue, blockedDrafts, draftRevisions, pending, deliver, mounted } = state;

function updateDraft(patch: Partial<Draft>, teamId = current) {

    {
        setDrafts(old => ({ ...old, [teamId]: { ...(old[teamId] ?? emptyDraft), ...draftAttachmentPatch(old[teamId] ?? emptyDraft, patch) } }));
        return;
    }
}

async function flushDraft(teamId = current) {

    await draftQueue.current;
    if (blockedDrafts.current.has(teamId))
        throw new MessageError(uiMessage('extension.copy.draftUnsaved'));
    return Math.max(draftRevisions.current[teamId] ?? 0, 0);
}

async function resolveDraftConflict() {

    return;
}

function attach(attachment: Attachment, teamId = current) {
    const { go } = getActions();
    if (attachment.kind === 'asset') {
        const assetId = attachment.assetId;
        const selected = attachment.view ?? data.views.find(view => view.id === assetId);
        if (selected)
            attachment = { ...attachment, view: { ...selected } };
        else
            return;
    }
    const add = () => { updateDraft({ attachment }, teamId); if (state.view.ownsScreen() && teamId === current) go('chat'); };
    const targetDraft = state.view.drafts[teamId] ?? emptyDraft;
    if (targetDraft.attachment && !(targetDraft.attachment.kind === 'asset' && attachment.kind === 'asset' && targetDraft.attachment.assetId === attachment.assetId)) {
        if (!state.view.ownsScreen() || teamId !== current) return;
        setConfirmation({ title: uiMessage('extension.copy.replaceAttachmentTitle'), description: uiMessage('extension.copy.replaceAttachmentDescription'), confirm: add });
    }
    else
        add();
}

/** `prepare` sees the outgoing message synchronously, while the composer still shows the draft. */
async function send(prepare?: (message: Message) => void): Promise<boolean> {

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
    setMessages(old => [...old, message]);
    setDrafts(old => ({ ...old, [current]: emptyDraft }));
    return submit(message);
}

function retry(message: Message) {

    if (disconnected || !canWrite)
        return;
    if (canWrite && ['failed', 'waiting', 'uncertain'].includes(message.status))
        void submit(message);
}

function saveEdit() {

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
    setMessages(old => applyMessageEdit(old, editing, data.self, editText.trim()));
    setEditing(undefined);
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
    setConfirmation({ title: message.author === data.self ? uiMessage('extension.copy.recallMessageTitle') : uiMessage('extension.copy.removeMessageTitle'), description: uiMessage('extension.copy.removeMessageDescription'), confirm: () => { setMessages(old => recallMessage(old, message.id, data.self)); } });
}

async function submit(message: Message) {

    if (pending.current.has(message.id))
        return false;
    pending.current.add(message.id);
    setMessages(old => old.map(m => m.id === message.id ? { ...m, status: 'sending' } : m));
    try {
        if (disconnected)
            throw new Error('connection unavailable');
        await deliver(message);
        if (mounted.current)
            setMessages(old => old.map(m => m.id === message.id && m.status === 'sending' ? { ...m, status: 'sent' } : m));
        return true;
    }
    catch {
        if (mounted.current)
            setMessages(old => old.map(m => m.id === message.id ? { ...m, status: 'failed' } : m));
        return false;
    }
    finally {
        pending.current.delete(message.id);
    }
}
  return { updateDraft, flushDraft, resolveDraftConflict, attach, send, retry, saveEdit, recall };
}
