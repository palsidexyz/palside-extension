import { message as uiMessage,MessageError,type TextMessage } from '@palside/i18n';

export const AUTH_CANCEL_COMMANDS = new Set(['account-discard', 'logout']);
export const AUTH_SETUP_COMMANDS = new Set(['account-generate', 'account-create', 'account-login']);

export const SERIAL_COMMANDS = new Set([
  'account-generate',
  'account-discard',
  'account-create',
  'account-login',
  'password-set',
  'mnemonic-reveal',
  'device-remove',
  'identity-approve',
  'logout',
  'delete-account',
]);

export function commandError(
  code: string,
  key: string,
  values?: Record<string, string | number>,
): MessageError & { code: string } {
  return Object.assign(new MessageError(uiMessage(key, values)), { code });
}

export function readTextMessage(value: unknown): TextMessage {
  if (
    value
    && typeof value === 'object'
    && typeof (value as { key?: unknown }).key === 'string'
  ) {
    return value as TextMessage;
  }
  return uiMessage('common.error');
}
