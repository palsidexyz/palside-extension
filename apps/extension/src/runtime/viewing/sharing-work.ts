import { message as uiMessage,MessageError } from '@palside/i18n';
/** Matrix discovery/encryption can stall independently of the HTTP request timeout. */
export const PING_ENCRYPTION_WAIT_MS = 6_000;
export const SHARE_ENCRYPTION_WAIT_MS = 12_000;

export async function sharingWork<T>(work: Promise<T>, timeoutMs = SHARE_ENCRYPTION_WAIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new MessageError(uiMessage('extension.runtime.sharingConnectionPending'))), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
