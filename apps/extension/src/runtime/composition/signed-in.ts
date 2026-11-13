import { message as uiMessage, MessageError } from '@palside/i18n';
import type { RuntimeCommands } from './dispatch';

/**
 * The signed-in session a command runs under. `scope` ends the command (with 登录已变化) when the account signs out or switches while it
 * waits; commands that change the account's data check it after every await.
 */
export function signedIn(commands: RuntimeCommands) {
  const runtime = commands.runtime, session = runtime.auth.session;
  if (!session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
  return { runtime, session, accountId: session.account.id, scope: runtime.auth.scope() };
}
