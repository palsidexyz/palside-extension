import { TEAM_NAME_LENGTH,TEAM_DESCRIPTION_LENGTH,TEAM_MEMBER_LIMIT,TEAM_JOINED_LIMIT,TEAM_OWNED_LIMIT,APPLICATION_NOTE_LENGTH,APPLICATION_TTL_MS } from '@palside/shared/contracts/limits';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { isRecruiting,publishRecruitment,requestIsActive } from '../../../domain/teams/lobby-values';
import { characterLength } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
export function createMemoryTeamActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'saveInvitePassword' | 'createTeam' | 'setRecruitment' | 'requestTeam' | 'cancelApplication' | 'leave' | 'approve'> {
const { view: { current, setNotice, data, setConfirmation, team, teams, setTeams, requests }, setInvitations, setRequests } = state;

/** Sets, changes or (with `null`) turns off the current team's join password. */
async function saveInvitePassword(password: string | null) {

    setInvitations(old => ({ ...old, [current]: { active: old[current]?.active ?? true, version: old[current]?.version ?? 1, password } }));
}

async function createTeam(name: string, description = '', avatar?: string) {
    const { chooseTeam } = getActions();
    const clean = name.trim();
    if (!clean || characterLength(clean) > TEAM_NAME_LENGTH || characterLength(description.trim()) > TEAM_DESCRIPTION_LENGTH)
        return;
    if (teams.filter(t => t.joined).length >= TEAM_JOINED_LIMIT || teams.filter(t => t.joined && t.owner === data.self).length >= TEAM_OWNED_LIMIT) {
        throw new MessageError(uiMessage('extension.copy.teamLimit'));
    }
    const id = crypto.randomUUID();
    setTeams(old => [...old, { id, name: clean, description: description.trim(), avatar, owner: data.self, memberIds: [data.self], joined: true, published: false, muted: false, unread: 0 }]);
    chooseTeam(id);
}

function setRecruitment(active: boolean) {

    if (!team.joined || team.readonly || team.owner !== data.self)
        return;
    setTeams(old => old.map(t => t.id === current ? active ? publishRecruitment(t, Date.now()) : { ...t, published: false } : t));
    setNotice(active ? uiMessage('extension.copy.recruitmentPublished') : uiMessage('extension.copy.recruitmentStopped'));
}

function requestTeam(id: string, text: string) {

    const target = teams.find(t => t.id === id);
    const submittedAt = Date.now();
    if (!target || !isRecruiting(target, submittedAt)) {
        setNotice(uiMessage('extension.copy.recruitmentEnded'));
        return;
    }
    if (target.joined || requests.some(r => r.teamId === id && r.personId === data.self && requestIsActive(r, submittedAt)))
        return;
    if ((target.memberCount ?? target.memberIds.length) >= TEAM_MEMBER_LIMIT || teams.filter(t => t.joined).length >= TEAM_JOINED_LIMIT) {
        setNotice(uiMessage('extension.copy.joinLimit'));
        return;
    }
    if (characterLength(text.trim()) > APPLICATION_NOTE_LENGTH)
        return;
    setTeams(old => old.map(t => t.id === id ? { ...t, requested: true } : t));
    setRequests(old => [...old.filter(r => !(r.teamId === id && r.personId === data.self)), { id: crypto.randomUUID(), personId: data.self, teamId: id, text: text.trim(), createdAt: submittedAt, expiresAt: submittedAt + APPLICATION_TTL_MS }]);
    setNotice(uiMessage('extension.copy.applicationSent'));
}

function cancelApplication(id: string) {

    setTeams(old => old.map(t => t.id === id ? { ...t, requested: false } : t));
    setRequests(old => old.filter(r => !(r.teamId === id && r.personId === data.self)));
    setNotice(uiMessage('extension.copy.applicationCancelled'));
}

function leave() {
    const { exitTeam } = getActions();
    if (team.owner === data.self) {
        setNotice(uiMessage('extension.copy.ownerLeaveRequirement'));
        return;
    }
    setConfirmation({ title: uiMessage('extension.copy.leaveTeamTitle'), description: uiMessage('extension.copy.leaveTeamDescription'), action: uiMessage('extension.copy.leaveTeam'), danger: true, confirm: () => { setTeams(old => old.map(t => t.id === current ? { ...t, readonly: true, readonlyReason: 'left', joined: false } : t)); exitTeam(current, uiMessage('extension.start.leftNotice', { name: team.name })); } });
}

function approve(id: string, accept: boolean) {

    const request = requests.find(r => r.id === id);
    if (!request || request.teamId !== current || team.owner !== data.self)
        return;
    if (!requestIsActive(request, Date.now())) {
        setNotice(uiMessage('extension.copy.applicationExpired'));
        return;
    }
    if (accept && (team.memberCount ?? team.memberIds.length) >= TEAM_MEMBER_LIMIT) {
        setNotice(uiMessage('extension.copy.teamFull'));
        return;
    }
    if (accept)
        setTeams(old => old.map(t => t.id === current ? { ...t, memberIds: [...new Set([...t.memberIds, request.personId])] } : t));
    setRequests(old => old.filter(r => r.id !== id));
}

  return { saveInvitePassword, createTeam, setRecruitment, requestTeam, cancelApplication, leave, approve };
}
