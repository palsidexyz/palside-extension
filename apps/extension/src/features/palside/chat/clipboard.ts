import { IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { message as uiMessage,type TextMessage } from '@palside/i18n';
/** Only the files delivered by this paste event are inspected. */
export function pastedImage(files: File[]): { file?: File; error?: TextMessage } {
  if (files.length > 1) return { error: uiMessage('extension.copy.oneImageOnly') };
  const file = files[0];
  if (!file) return {};
  if (!IMAGE_MIME_TYPES.some(type => type === file.type)) return { error: uiMessage('extension.copy.imageFormats') };
  return { file };
}

export function insertPastedText(value: string, start: number, end: number, pasted: string) {
  return { text: value.slice(0, start) + pasted + value.slice(end), caret: start + pasted.length };
}
