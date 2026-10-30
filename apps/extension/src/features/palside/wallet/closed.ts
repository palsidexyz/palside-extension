import { message as uiMessage } from '@palside/i18n';
import type { PalsideController } from '../app/use-palside';

export const walletOpen = (c: PalsideController) => Boolean(c.live?.state.wallet?.config?.enabled);

/** PALS entries stay in place while the server has the chain switched off; using one says so instead of opening an empty flow. */
export function whenWalletOpen(c: PalsideController, open: () => void) {
  if (walletOpen(c)) open();
  else c.setNotice(uiMessage('extension.wallet.closed'));
}
