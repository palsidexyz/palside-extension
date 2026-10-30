import type { CommandName,CommandArgs,CommandPayload,CommandResult } from '../../../runtime/transport/command-map';
import { errorMessage,message as uiMessage } from '@palside/i18n';
import type { PanelState } from './use-panel-state';
import type { PanelActions } from './panel-actions';

export function usePanelCommands(state: PanelState): Pick<PanelActions, 'run' | 'guarded' | 'copy'> {
  const { view: { live, setNotice, setConfirmation, current, setCopied } } = state;
async function run<N extends CommandName>(...args: CommandArgs<N>): Promise<CommandResult<N> | undefined> {
    if (!live) return;
    try { return await live.command<N>(...args); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && ['CONNECTION_UNAVAILABLE', 'MESSAGE_SEND_FAILED'].includes(String(error.code)))) setNotice(error instanceof Error ? errorMessage(error) : uiMessage('common.error')); return; }
  }
/** Sending stops when a member's encryption identity changed (MSC4153) until the user confirms. */
  async function guarded<N extends CommandName>(name: N, payload: CommandPayload<N>, again: () => unknown): Promise<CommandResult<N> | undefined> {
    if (!live) return;
    try { return await live.command<N>(...[name, payload] as CommandArgs<N>); } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'IDENTITY_CHANGED') setConfirmation({ title: uiMessage('extension.copy.identityChangedTitle'), description: errorMessage(error), confirm: async () => { await live.command('identity-approve', { teamId: current }); void again(); } });
      else if (!['CONNECTION_UNAVAILABLE', 'MESSAGE_SEND_FAILED'].includes(code)) setNotice(error instanceof Error ? errorMessage(error) : uiMessage('common.error'));
      return;
    }
  }
async function copy(value: string) { try { await navigator.clipboard.writeText(value); setCopied(true); setNotice(uiMessage('extension.copy.copied')); return true; } catch { setNotice(uiMessage('extension.copy.copyManual')); return false; } }
  return { run, guarded, copy };
}
