import { parseCommand } from '../runtime/transport/command-map.ts';
import { MessageError,message as uiMessage } from '@palside/i18n';
import type { Command } from '../runtime/transport/command-map';
import { diagnostics,type RuntimeDiagnostics } from '../runtime/diagnostics/diagnostics.ts';
import type { Background } from './index.ts';
import { accessStatus, broadOrigin, siteOriginPattern } from '../runtime/browser/permissions.ts';

/** Commands only the worker itself may send to the offscreen runtime. */
const hostOnly = new Set(['signal-send', 'room-panels', 'room-tab', 'visible-drop', 'wallet-panel-drop']);
/** Commands whose success may turn sharing on before the state that says so arrives. */
const claimsSharing = (command: Command) => command.name === 'toggle' && command.payload?.share === true || command.name === 'preferences' && 'current' in (command.payload ?? {});

/**
 * Panel `palside/command`: page, capture, settings and locate commands run here; everything else goes to the offscreen runtime.
 * The bridge adds `windowId` to window-bound commands.
 */
export function commands(bg: Background) {
  async function execute(command: Command, senderUrl: string, panelDocument?: string): Promise<unknown> {
    const { name } = command; const payload: Record<string, unknown> = command.payload ?? {};
    const windowId = Number(payload.windowId);
    switch (command.name) {
      case 'permissions-get': {
        const [grants, access] = await Promise.all([
          bg.browser.permissions.getAll(),
          accessStatus(command.payload?.url, bg.browser),
        ]);
        return { ok: true, value: { origins: grants.origins ?? [], tabs: grants.permissions?.includes('tabs') ?? false, notifications: grants.permissions?.includes('notifications') ?? false, site: access.site } };
      }
      case 'permissions-sync':
        bg.notifications.listenNotifications();
        bg.pages.syncPermissions(false);
        await bg.roomTab.refresh();
        return { ok: true };
      case 'permissions-remove': {
        const request = command.payload;
        let removed = false, origins: string[] = [];
        if (request.kind === 'site') {
          const origin = siteOriginPattern(request.url);
          if (origin) {
            removed = await bg.browser.permissions.remove({ origins: [origin] });
            removed = !await bg.browser.permissions.contains({ origins: [origin] }) && removed;
          }
        } else if (request.kind === 'tabs' || request.kind === 'notifications') {
          removed = await bg.browser.permissions.remove({ permissions: request.kind === 'tabs' ? ['tabs', 'favicon'] : ['notifications'] });
        } else {
          const granted = (await bg.browser.permissions.getAll()).origins ?? [];
          const removing = request.kind === 'sites' ? granted : granted.filter(broadOrigin);
          origins = request.kind === 'sites' ? granted : granted.filter(origin => !broadOrigin(origin));
          removed = !removing.length || await bg.browser.permissions.remove({ origins: removing });
          if (!removed) origins = [];
        }
        return { ok: true, value: { removed, origins } };
      }
      case 'diagnostics': {
        const result = await bg.run(command); if (!result.ok) return result;
        const [tabs, site, scripts] = await Promise.all([
          bg.browser.permissions.contains({ permissions: ['tabs'] }),
          bg.browser.permissions.contains({ origins: ['<all_urls>'] }),
          bg.browser.scripting.getRegisteredContentScripts(),
        ]);
        return { ok: true, value: diagnostics({
          ...result.value as RuntimeDiagnostics,
          version: bg.browser.runtime.getManifest().version,
          ua: navigator.userAgent,
          locale: typeof payload.locale === 'string' && ['en', 'zh-CN'].includes(payload.locale) ? payload.locale : navigator.language,
          access: { tabs, site },
          pageLayer: { enabled: site, registered: scripts.length > 0 },
        }) };
      }
      case 'signal-settings-get': return { ok: true, value: await bg.signals.readSignalSettings() };
      case 'signal-settings': return { ok: true, value: await bg.signals.changeSignalSettings(payload.settings, payload.expectedAccountId) };
      case 'danmaku-settings': await bg.danmaku.saveDanmakuSettings(payload.settings); return { ok: true };
      case 'selection-enabled': await bg.selection.setSelectionEnabled(windowId, senderUrl, payload.on); return { ok: true };
      case 'quote-sticky': return bg.stickies.quoteSticky(payload);
      case 'locate-sticky': return bg.stickies.locateSticky(payload, senderUrl);
      case 'locate-ref': return bg.stickies.locateRef(payload, senderUrl);
      case 'capture': return { ok: true, value: await bg.capture.startCapture(windowId, senderUrl, payload) };
      case 'link-card': return { ok: true, value: await bg.sharing.linkCard(windowId, senderUrl, payload.url) };
      case 'language':
        try { return { ok: true, value: await bg.language.save(payload.preference) }; }
        catch { return { ok: false, code: 'LANGUAGE_SAVE_FAILED', message: 'Could not save language.' }; }
    }
    if (hostOnly.has(name)) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
    if (command.name === 'wallet-export-private-key' || command.name === 'wallet-hide-private-key') {
      if (!panelDocument) throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
      if (command.name === 'wallet-export-private-key') command = { name: command.name, payload: { password: command.payload.password, owner: panelDocument } };
      else command = { name: 'wallet-hide-private-key', payload: { owner: panelDocument } };
    }
    // A view subscription belongs to its panel document, so the panel's port closing can drop it.
    if (command.name === 'visible') command = { ...command, payload: { ...command.payload, sourceId: `${panelDocument ?? ''}:${command.payload.sourceId}` } };
    if (command.name === 'room-watch') command = { ...command, payload: { ...command.payload, id: `${panelDocument ?? ''}:${command.payload.id}` } };
    if (command.name === 'room-hot') command = { name: command.name, payload: { ...command.payload, sourceId: `${panelDocument ?? ''}:hot` } };
    if (name === 'logout') { bg.images.clearImageSessions(); bg.policyVersion++; bg.sessionVersion++; bg.pages.clearPages(); }
    const result = await bg.run(command);
    // Switching 网页互动 changes which pages run the layer; it follows before the reply.
    if (result.ok && name === 'toggle' && 'interact' in payload) { await bg.pages.registerPageLayer(); await bg.pages.pushPageStatus(); }
    return result;
  }

  return {
    async panelCommand(input: unknown, senderUrl: string, panelDocument?: string) {
      const command = parseCommand(input);
      const result = await execute(command, senderUrl, panelDocument);
      if ((result as { ok?: boolean } | undefined)?.ok && claimsSharing(command)) bg.sharing.claimSharing();
      return result;
    },
  };
}
