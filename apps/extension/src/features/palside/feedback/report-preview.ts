import { translator } from '@palside/i18n';
import { assetView } from '../../../domain/assets/model.ts';
import { type Message } from '../../../domain/chat/model.ts';

/** Only the selected message; reply targets are not included. */
export function messageReportPreview(message: Message, t = translator('en')) {
  const parts = message.text ? [message.text] : [];
  if (message.attachment?.kind === 'asset') {
    const view = assetView(message.attachment);
    parts.push(view ? [t('extension.copy.tokenSharing'), view.name, view.chain, view.address, view.source, view.url].filter(Boolean).join('\n') : t('extension.copy.missingTokenQuote'));
  } else if (!parts.length && message.attachment?.kind === 'image') parts.push(t('extension.copy.imageMessage'));
  return parts.join('\n\n');
}
