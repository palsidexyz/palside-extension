import { message as uiMessage, type TextMessage } from '@palside/i18n';
import { useEffect, useRef } from 'react';
import type { PanelState } from '../app/use-panel-state';
import type { PanelActions } from '../app/panel-actions';

export function useTeamActions(state: PanelState, getActions: () => PanelActions): Pick<PanelActions, 'chooseTeam' | 'exitTeam' | 'openFormerTeam' | 'forgetTeam'> {
  const { view: { teams, setNotice, data, live, setEditing, setMemberFilter, setConfirmation }, setKeptTeams } = state;
  const selections = useRef<string[]>([]);
  const latestTeams = useRef(teams);
  useEffect(() => { latestTeams.current = teams; }, [teams]);
  const keep = (id: string, kept: boolean) => setKeptTeams(old => { const next = new Set(old); if (kept) next.add(id); else next.delete(id); return next; });
  const forgotten = live.state.preferences.forgottenTeams;
  const rejoined = forgotten?.filter(id => teams.some(team => team.id === id && team.joined)).join();
  const command = live.command;
  const accountId = data.self;
  // A forgotten team joined again is remembered again, so leaving it later keeps its history like any other.
  useEffect(() => { if (rejoined && forgotten) void command('preferences', { accountId, forgottenTeams: forgotten.filter(id => !rejoined.split(',').includes(id)) }).catch(() => {}); }, [rejoined, command, forgotten, accountId]);

  function exitTeam(teamId: string, notice: TextMessage) {
    const { chooseTeam, run, go } = getActions();
    keep(teamId, false);
    const remaining = latestTeams.current.filter(team => team.joined && team.id !== teamId);
    selections.current = selections.current.filter(id => remaining.some(team => team.id === id));
    const next = remaining.find(team => team.id === selections.current[0]) ?? remaining[0];
    if (next) chooseTeam(next.id);
    else { void run('preferences', { accountId, current: '' }); setEditing(undefined); setMemberFilter(undefined); go('chat'); }
    setNotice(notice);
  }

  function openFormerTeam(id: string) {
    keep(id, true);
    getActions().chooseTeam(id);
  }

  function forgetTeam(id: string) {
    const team = teams.find(item => item.id === id);
    if (!team || team.joined) return;
    setConfirmation({ title: uiMessage('extension.start.forgetTitle', { name: team.name }), description: uiMessage('extension.start.forgetDescription'), action: uiMessage('extension.start.forget'), danger: true, confirm: async () => {
      keep(id, false);
      await live.command('preferences', { accountId, forgottenTeams: [...new Set([...(forgotten ?? []).filter(item => data.teams.some(team => team.id === item)), id])] });
    } });
  }

  function chooseTeam(id: string) {
    const { run, go } = getActions();
    selections.current = [id, ...selections.current.filter(selected => selected !== id)];
    void run('preferences', { accountId, current: id });
    setEditing(undefined); setMemberFilter(undefined); go('chat');
  }

  return { chooseTeam, exitTeam, openFormerTeam, forgetTeam };
}
