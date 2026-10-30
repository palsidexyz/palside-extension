import { errorMessage,message as uiMessage } from '@palside/i18n';
/** Browser reachability is a hint; API and message sync readiness are independent. */
export type Connection = {
  networkOnline: boolean;
  service: 'connecting' | 'ready' | 'unavailable';
  messaging: 'connecting' | 'ready' | 'unavailable' | 'failed';
  retrying: boolean;
};
export type ConnectionStatus = 'connected' | 'network-offline' | 'service-unavailable' | 'messaging-unavailable' | 'initialization-failed' | 'connecting';
export function connectionStatus(connection: Connection): ConnectionStatus {
  if (!connection.networkOnline) return 'network-offline';
  if (connection.service === 'unavailable') return 'service-unavailable';
  if (connection.messaging === 'failed') return 'initialization-failed';
  if (connection.messaging === 'unavailable') return 'messaging-unavailable';
  return connection.service === 'ready' && connection.messaging === 'ready' ? 'connected' : 'connecting';
}
export const connectionNotices = {
  'network-offline': { title: uiMessage('extension.runtime.networkOfflineTitle'), detail: uiMessage('extension.runtime.networkOfflineDetail') },
  'service-unavailable': { title: uiMessage('extension.runtime.serviceUnavailableTitle'), detail: uiMessage('extension.runtime.serviceUnavailableDetail') },
  'messaging-unavailable': { title: uiMessage('extension.runtime.messagingUnavailableTitle'), detail: uiMessage('extension.runtime.messagingUnavailableDetail') },
  'initialization-failed': { title: uiMessage('extension.runtime.encryptionFailedTitle'), detail: uiMessage('extension.runtime.encryptionFailedDetail') },
  connecting: { title: uiMessage('extension.runtime.connectingTitle'), detail: uiMessage('extension.runtime.connectingDetail') },
};
export function readonlyNotice(reason?: string) {
  const title = reason === 'removed' ? uiMessage('extension.runtime.removedReadonly') : reason === 'dissolved' ? uiMessage('extension.runtime.dissolvedReadonly') : uiMessage('extension.runtime.leftReadonly');
  return { title, detail: uiMessage('extension.runtime.readonlyDetail') };
}
export function connectionBlock(connection: Connection) {
  const status = connectionStatus(connection);
  return status === 'connected' ? undefined : connectionNotices[status].title;
}

/** Only a definite rejection proves non-delivery once a transaction was attempted. */
export function sendFailure(error: unknown, attempted: boolean, confirmed: boolean) {
  const failure = error && typeof error === 'object' ? error as { status?: number; httpStatus?: number; code?: string; errcode?: string; message?: string } : {};
  const httpStatus = failure.httpStatus ?? failure.status;
  const rejected = !confirmed && httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500;
  const status = attempted && !rejected ? 'uncertain' : failure.code === 'CONNECTION_UNAVAILABLE' ? 'waiting' : 'failed';
  const detail = status === 'uncertain' ? uiMessage('extension.runtime.sendUncertain')
    : httpStatus === 401 ? uiMessage('extension.runtime.sessionExpired')
    : httpStatus === 403 ? uiMessage('extension.runtime.sendForbidden')
    : httpStatus === 429 ? (failure.code === 'UPLOAD_QUOTA' ? errorMessage(error) : uiMessage('extension.runtime.sendRateLimited'))
    : failure.code === 'CONNECTION_UNAVAILABLE' ? uiMessage('extension.runtime.sendWaiting')
    : failure.code === 'UPLOAD_FAILED' ? uiMessage('extension.runtime.sendUploadFailed')
    : httpStatus === 0 || (httpStatus !== undefined && httpStatus >= 500) ? uiMessage('extension.runtime.sendServiceUnavailable')
    : errorMessage(error);
  return { status, detail } as const;
}
