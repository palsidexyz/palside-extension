import { type Message } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

export function useDrafts(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'mention' | 'edit'> {
  const { view: { people, team, draft, setEditing, setEditText }, setEditRevision } = state;
function mention(id: string) {
    const { updateDraft } = getActions(); const person = people.find(p => p.id === id); if (!person || !team.memberIds.includes(id)) return; updateDraft({ text: `${draft.text}@${person.name} `, mentions: [...(draft.mentions ?? []).filter(p => p.id !== id), { id, label: person.name }] }); }
function edit(message: Message) {
    setEditing(message.id); setEditText(message.text); setEditRevision(message.editedAt ?? 0); }
  return { mention, edit };
}
