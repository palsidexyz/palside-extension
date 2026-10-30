type PanelContext = { contextType: string; documentId?: string; documentUrl?: string; windowId?: number; incognito: boolean };
type PanelConnection = { documentId?: string; documentUrl?: string; windowId?: number };

/** Connections here have already passed the extension ID, panel URL and non-tab checks. */
export function hasPanelForWindow(contexts: readonly PanelContext[], connections: readonly PanelConnection[], windowId: number) {
  return windowId >= 0 && contexts.some(context => context.contextType === 'SIDE_PANEL' && !context.incognito && Boolean(context.documentId) &&
    (context.windowId === undefined || context.windowId === -1 || context.windowId === windowId) &&
    connections.some(connection => connection.windowId === windowId && (connection.documentId
      ? connection.documentId === context.documentId
      // Native side-panel ports can omit MessageSender.documentId. Their verified
      // source URL and live port's windows.getCurrent() identity remain available.
      : Boolean(connection.documentUrl && connection.documentUrl === context.documentUrl))));
}
