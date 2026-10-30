import { message as uiMessage, MessageError, type TextMessage } from '@palside/i18n';

/** Reads an image blob as a data URL, the form avatars and message images are sent in. */
export const readImage = (blob: Blob, failure: TextMessage = uiMessage('extension.copy.avatarReadFailed')) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new MessageError(failure));
  reader.readAsDataURL(blob);
});
