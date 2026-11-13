import { TEAM_NAME_LENGTH, TEAM_DESCRIPTION_LENGTH, TEAM_MEMBER_LIMIT, TEAM_JOINED_LIMIT, TEAM_OWNED_LIMIT } from '@palside/shared/rules/teams';
import { message as uiMessage, MessageError } from '@palside/i18n';
import { requestIsActive } from '../../../domain/teams/lobby-values';
import { characterLength } from '../../../domain/chat/model';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';
import { saveTeamAvatar } from './team-avatar-upload';

type TeamActions = Pick<PanelActions, 'saveInvitePassword' | 'createTeam' | 'setRecruitment' | 'requestTeam' | 'cancelApplication' | 'leave' | 'approve'>;

export function createLiveTeamActions(state: PanelState, getActions: () => PanelActions): TeamActions {
  const { view: { current, data, setNotice, setConfirmation, teams, team, requests, live } } = state;

  /** Sets, changes or (with `null`) turns off the current team's join password. */
  async function saveInvitePassword(password: string | null) {
    await live.command('invitation', { teamId: current, password });
  }

  async function createTeam(name: string, description = '', avatar?: string) {
    const clean = name.trim();
    if (!clean || characterLength(clean) > TEAM_NAME_LENGTH || characterLength(description.trim()) > TEAM_DESCRIPTION_LENGTH) return;
    const joined = teams.filter(item => item.joined);
    if (joined.length >= TEAM_JOINED_LIMIT || joined.filter(item => item.owner === data.self).length >= TEAM_OWNED_LIMIT) throw new MessageError(uiMessage('extension.copy.teamLimit'));
    const result = await live.command('create', { name: clean, description: description.trim() });
    getActions().chooseTeam(result.teamId);
    if (avatar) await saveTeamAvatar(live, data.self, result.teamId, avatar).catch(() => setNotice(uiMessage('extension.copy.avatarSaveFailed')));
  }

  function setRecruitment(active: boolean) {
    if (!team.joined || team.readonly || team.owner !== data.self) return Promise.resolve(false);
    return getActions().run('recruitment', { teamId: current, active }).then(result => result !== undefined);
  }

  function requestTeam(id: string, text: string) {
    void getActions().run('apply', { teamId: id, note: text }).then(result => { if (result) void getActions().refreshLobby(); });
  }

  function cancelApplication(id: string) {
    void getActions().run('cancel-application', { teamId: id }).then(result => { if (result) void getActions().refreshLobby(); });
  }

  function leave() {
    if (team.owner === data.self) { setNotice(uiMessage('extension.copy.ownerLeaveRequirement')); return; }
    setConfirmation({
      title: uiMessage('extension.copy.leaveTeamTitle'), description: uiMessage('extension.copy.leaveTeamDescription'), action: uiMessage('extension.copy.leaveTeam'), danger: true,
      confirm: async () => {
        await live.command('leave', { teamId: current });
        getActions().exitTeam(current, uiMessage('extension.start.leftNotice', { name: team.name }));
      },
    });
  }

  function approve(id: string, accept: boolean) {
    const request = requests.find(item => item.id === id);
    if (!request || request.teamId !== current || team.owner !== data.self) return;
    if (!requestIsActive(request, Date.now())) { setNotice(uiMessage('extension.copy.applicationExpired')); return; }
    if (accept && (team.memberCount ?? team.memberIds.length) >= TEAM_MEMBER_LIMIT) { setNotice(uiMessage('extension.copy.teamFull')); return; }
    void getActions().run('decide', { teamId: current, accountId: request.personId, accept });
  }

  return { saveInvitePassword, createTeam, setRecruitment, requestTeam, cancelApplication, leave, approve };
}
