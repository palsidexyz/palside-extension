import { message as uiMessage,MessageError } from '@palside/i18n';
/** Matrix discovery/encryption can stall independently of the HTTP request timeout. */
export async function sharingWork<T>(work: Promise<T>, timeoutMs = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new MessageError(uiMessage('extension.runtime.sharingConnectionPending'))), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
