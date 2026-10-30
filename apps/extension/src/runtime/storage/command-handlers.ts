import { decodeContract } from '@palside/shared/contracts/validation';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { submitReport } from './report-submission';
import { reportSubmission } from '@palside/shared/contracts/reports';
import type { Command } from '../transport/command-map';
import { DAY,text } from '../composition/state';
import type { RuntimeCommands } from '../composition/dispatch';
import type { HandlerRegistry } from '../composition/handler-registry';

export async function reportCommand(this: RuntimeCommands, command: Extract<Command, { name: "report" }>) {
 const p = command.payload ?? {};
    const runtime = this.runtime;
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const scope = runtime.auth.scope();
    const id = runtime.auth.session.account.id; 
      if (p.accountId !== id) throw new MessageError(uiMessage('extension.runtime.reportAccountChanged'));
      const session = runtime.auth.session;
      const guard = () => { if (runtime.auth.session !== session) throw new MessageError(uiMessage('extension.runtime.reportAccountChanged')); };
      return submitReport(runtime.api, runtime.storage, id, text(p.key), async () => {
        const submission = decodeContract(reportSubmission, { kind: p.kind, targetId: p.targetId, reason: p.reason, note: p.note, snapshot: p.snapshot });
        if (!submission) throw new MessageError(uiMessage('extension.copy.reportFailed'));
        let mediaId: string | undefined;
        if (typeof p.image === 'string') {
          const selected = runtime.state.data.messages.find(m => m.id === p.targetId && !m.recalled && m.attachment?.kind === 'image');
          if (!selected || selected.attachment?.kind !== 'image' || selected.attachment.src !== p.image) throw new MessageError(uiMessage('extension.runtime.reportImageExpired'));
          const blob = await scope.wait((await scope.wait(fetch(p.image))).blob()); if (runtime.auth.session?.account.id !== id) throw new MessageError(uiMessage('extension.runtime.accountChanged'));
          const pendingKey = `${id}:report-image:${text(p.key)}`; mediaId = await scope.wait(runtime.storage.get<string>(pendingKey)); guard();
          if (!mediaId) { mediaId = await scope.wait(runtime.api.upload(blob, 'report', undefined, text(p.targetId))); guard(); await scope.wait(runtime.storage.put(pendingKey, id, 'operation', mediaId, Date.now() + DAY)); }
        }
        return { ...submission, mediaId };
      }, guard, JSON.stringify([p.kind, p.targetId]));
}

export const reportsHandlers = {
  'report': reportCommand,
} satisfies HandlerRegistry;
