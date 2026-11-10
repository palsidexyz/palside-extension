import { translator } from '@palside/i18n';
import type { Message } from '../../../domain/chat/model.ts';
import { expired } from '../../../domain/chat/expiry.ts';

export function quotedText(message: Message | undefined, referenceExpiresAt?: number, now = Date.now(), t = translator('en')) {
  const expiresAt = message?.expiresAt ?? referenceExpiresAt;
  if (expired(expiresAt, now)) return t('extension.copy.originalExpired');
  return !message ? t('extension.copy.originalUnavailable') : message.recalled ? message.removedByOwner ? t('extension.copy.originalRemoved') : t('extension.copy.originalRecalled') : message.text || (message.attachment?.kind === 'image' ? t('extension.copy.imageQuote') : t('extension.copy.tokenQuote'));
}
