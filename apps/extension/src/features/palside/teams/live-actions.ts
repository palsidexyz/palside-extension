import { TEAM_NAME_LENGTH,TEAM_DESCRIPTION_LENGTH,TEAM_MEMBER_LIMIT,TEAM_JOINED_LIMIT,TEAM_OWNED_LIMIT } from '@palside/shared/contracts/limits';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { requestIsActive } from '../../../domain/teams/lobby-values';
import { characterLength } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
import { saveTeamAvatar } from './team-avatar-upload';
export function createLiveTeamActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'saveInvitePassword' | 'createTeam' | 'setRecruitment' | 'requestTeam' | 'cancelApplication' | 'leave' | 'approve'> {
const { view: { current, data, setNotice, setConfirmation, teams, team, requests } } = state;
const live = state.view.live!;

/** Sets, changes or (with `null`) turns off the current team's join password. */
async function saveInvitePassword(password: string | null) {

    {
        await live.command('invitation', { teamId: current, password });
        return;
    }
}

async function createTeam(name: string, description = '', avatar?: string) {
    const { chooseTeam } = getActions();
    const clean = name.trim();
    if (!clean || characterLength(clean) > TEAM_NAME_LENGTH || characterLength(description.trim()) > TEAM_DESCRIPTION_LENGTH)
        return;
    if (teams.filter(t => t.joined).length >= TEAM_JOINED_LIMIT || teams.filter(t => t.joined && t.owner === data.self).length >= TEAM_OWNED_LIMIT) {
        throw new MessageError(uiMessage('extension.copy.teamLimit'));
    }
    {
        const result = await live.command('create', { name: clean, description: description.trim() });
        chooseTeam(result.teamId);
        if (avatar) await saveTeamAvatar(live, data.self, result.teamId, avatar).catch(() => setNotice(uiMessage('extension.copy.avatarSaveFailed')));
        return;
    }
}

function setRecruitment(active: boolean) {
    const { run } = getActions();
    if (!team.joined || team.readonly || team.owner !== data.self)
        return;
    {
        void run('recruitment', { teamId: current, active });
        return;
    }
}

function requestTeam(id: string, text: string) {
    const { run } = getActions();
    {
        void run('apply', { teamId: id, note: text }).then(result => { if (result) void getActions().refreshLobby(); });
        return;
    }
}

function cancelApplication(id: string) {
    const { run } = getActions();
    {
        void run('cancel-application', { teamId: id }).then(result => { if (result) void getActions().refreshLobby(); });
        return;
    }
}

function leave() {
    const { exitTeam } = getActions();
    if (team.owner === data.self) {
        setNotice(uiMessage('extension.copy.ownerLeaveRequirement'));
        return;
    }
    {
        setConfirmation({ title: uiMessage('extension.copy.leaveTeamTitle'), description: uiMessage('extension.copy.leaveTeamDescription'), action: uiMessage('extension.copy.leaveTeam'), danger: true, confirm: async () => { await live.command('leave', { teamId: current }); exitTeam(current, uiMessage('extension.start.leftNotice', { name: team.name })); } });
        return;
    }
}

function approve(id: string, accept: boolean) {
    const { run } = getActions();
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
    {
        void run('decide', { teamId: current, accountId: request.personId, accept });
        return;
    }
}

  return { saveInvitePassword, createTeam, setRecruitment, requestTeam, cancelApplication, leave, approve };
}
