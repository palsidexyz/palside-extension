import { commandHandler } from './handler-registry';
import { message as uiMessage,MessageError } from '@palside/i18n';
import { ApiError,type ApiOptions,type ApiResult } from '../transport/api';
import type { EndpointId } from '@palside/shared/contracts/endpoints';
import type { Command } from '../transport/command-map';
import { DAY } from './state';
import type { PalsideService } from './core';

export class RuntimeCommands {
  readonly runtime: PalsideService;
  constructor(runtime: PalsideService) { this.runtime = runtime; }
  inviteRequest = 0;
  inviteExpiresAt = 0;
  mutations = new Map<string, Promise<unknown>>();
  async mutate<I extends EndpointId>(endpoint: I, options: ApiOptions<I>): Promise<ApiResult<I>> {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    if (!runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    const account = runtime.auth.session.account.id;
    const hash = [...new Uint8Array(await scope.wait(crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ endpoint, options })))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const id = `${account}:operation:${hash}`; const running = this.mutations.get(id); if (running) return running as Promise<ApiResult<I>>;
    const operation = (async () => {
      let key = await scope.wait(runtime.storage.get<string>(id)); if (!key) { key = crypto.randomUUID(); await scope.wait(runtime.storage.put(id, account, 'operation', key, Date.now() + 7 * DAY)); }
      try { const result = await scope.wait(runtime.api.request(endpoint, { ...options, key })); await scope.wait(runtime.storage.remove(id)); return result; }
      catch (error) { scope.check(); if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) await scope.wait(runtime.storage.remove(id)); throw error; }
    })();
    this.mutations.set(id, operation);
    try { return await scope.wait(operation); } finally { if (scope.current()) { this.mutations.delete(id); } }
  }
  async dismissInvite(url: string) {
    const runtime = this.runtime;
    const scope = runtime.auth.scope();
    if (runtime.state.data.pendingInvite !== url) return;
    await scope.wait(runtime.storage.removeIfValue('pending-invite', url));
    if (runtime.state.data.pendingInvite === url) { runtime.state.data.pendingInvite = undefined; runtime.emit(); }
  }
  async execute(command: Command): Promise<unknown> {
    await this.runtime.initialise();
    const handler = commandHandler(command.name);
    if (handler) return handler.call(this, command);
    if (!this.runtime.auth.session) throw new MessageError(uiMessage('extension.runtime.signInFirst'));
    throw new MessageError(uiMessage('extension.runtime.operationUnavailable'));
  }
}
