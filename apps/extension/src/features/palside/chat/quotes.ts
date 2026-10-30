import { translator } from '@palside/i18n';
import type { Message } from '../../../domain/chat/model.ts';

export function quotedText(message: Message | undefined, referenceExpiresAt?: number, now = Date.now(), t = translator('en')) {
  const expiresAt = message?.expiresAt ?? referenceExpiresAt;
  if (Number.isFinite(expiresAt) && expiresAt! <= now) return t('extension.copy.originalExpired');
  return !message ? t('extension.copy.originalUnavailable') : message.recalled ? message.removedByOwner ? t('extension.copy.originalRemoved') : t('extension.copy.originalRecalled') : message.text || (message.attachment?.kind === 'image' ? t('extension.copy.imageQuote') : message.ref && !message.attachment ? message.ref.caption : t('extension.copy.tokenQuote'));
}
