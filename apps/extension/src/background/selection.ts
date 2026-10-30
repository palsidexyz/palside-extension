import { MessageError,errorMessage,message as uiMessage,renderMessage } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { currentPick,pageUrlHost,type PageConnection,type PickContext } from '../runtime/browser/page-layer-host.ts';
import type { PageDown,PageUp } from '../runtime/browser/page-protocol.ts';
import type { Reply } from '../runtime/transport/reply';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

const REQUEST_ID = /^[\w-]{1,100}$/;

/**
 * Native selection on a 网页互动 page: the page offers 引用到聊天 (and 贴便利贴 when 便利贴 is on) beside the user's selection.
 * Each window holds one selection context, bound to the account, team, tab and document it was offered on.
 */
export function selection(bg: Background) {
  const { browser } = bg;
  const picks = new Map<number, PickContext>();
  /** Windows whose panel paused selection, e.g. while the composer holds a reference. */
  const paused = new Set<number>();

  function post(port: Port, message: PageDown) { try { port.postMessage(message); } catch { /* page gone */ } }

  function discardPick(windowId: number) {
    const context = picks.get(windowId);
    picks.delete(windowId);
    for (const [port, info] of bg.pages.pagePorts) if (info.windowId === windowId && (!context || info.tabId === context.tabId)) post(port, { type: 'pick', on: false });
  }
  function bindSelection(port: Port, info: PageConnection) {
    if (!bg.interactivePage(info)) {
      if (picks.get(info.windowId)?.tabId === info.tabId) discardPick(info.windowId);
      else post(port, { type: 'pick', on: false });
      return;
    }
    const accountId = bg.state?.account?.id, teamId = bg.state?.preferences.current;
    if (!accountId || !teamId || bg.capture.captures.has(info.windowId)) return;
    let context = picks.get(info.windowId);
    if (!context || !currentPick(context, info, bg.state)) {
      context = { contextId: crypto.randomUUID(), accountId, teamId, tabId: info.tabId, windowId: info.windowId, url: info.url, documentId: info.documentId };
      picks.set(info.windowId, context);
    }
    port.postMessage({ type: 'pick', on: true, canSticky: bg.stickies.stickyOn(info), contextId: context.contextId } satisfies PageDown);
    if (paused.has(info.windowId)) port.postMessage({ type: 'selection-enabled', on: false } satisfies PageDown);
  }

  return {
    picks, bindSelection, discardPick,
    dropSelections(predicate: (context: PickContext) => boolean) {
      for (const [windowId, context] of picks) if (predicate(context)) discardPick(windowId);
    },
    clearSelections() {
      paused.clear();
      for (const windowId of [...picks.keys()]) discardPick(windowId);
    },
    /** The window's last panel closed or its tab changed: selection resumes and the context ends. */
    resetWindowSelection(windowId: number) { discardPick(windowId); paused.delete(windowId); },
    /** Panel `selection-enabled`: pause or resume selection on this window's active page. */
    async setSelectionEnabled(windowId: number, senderUrl: string, on: unknown) {
      await bg.panelTab(windowId, senderUrl);
      if (typeof on !== 'boolean') throw new MessageError(uiMessage('common.error'));
      if (on) paused.delete(windowId); else paused.add(windowId);
      const tab = await bg.activeTab(windowId);
      for (const [port, info] of bg.pages.pagePorts) if (info.windowId === windowId && info.tabId === tab?.id) {
        if (on) bindSelection(port, info);
        port.postMessage({ type: 'selection-enabled', on } satisfies PageDown);
      }
    },
    pickError(info: PageConnection, message: Extract<PageUp, { type: 'pick-error' }>) {
      const context = picks.get(info.windowId);
      if (message.contextId !== context?.contextId || !currentPick(context, info, bg.state)) return;
      bg.notifyWindow(info.windowId, { ok: false, message: 'Selection unavailable', text: uiMessage(message.reason === 'too-long' ? 'extension.page.selectionTooLong' : 'extension.page.selectionUnavailable') });
    },
    /** The page submitted a selection: `picked` attaches a reference to the draft, `marked` saves a 便利贴. One request at a time. */
    async finishPick(port: Port, info: PageConnection, message: Extract<PageUp, { type: 'picked' | 'marked' }>) {
      const context = picks.get(info.windowId), version = bg.sessionVersion;
      const enabled = message.type === 'marked' ? bg.stickies.stickyOn(info) : bg.interactivePage(info);
      if (!enabled || !context || !currentPick(context, info, bg.state) || message.contextId !== context.contextId || paused.has(info.windowId) || context.requestId || typeof message.requestId !== 'string' || !REQUEST_ID.test(message.requestId)) return;
      const current = () => version === bg.sessionVersion && picks.get(info.windowId) === context && currentPick(context, info, bg.state) && bg.pages.pagePorts.get(port) === info;
      context.requestId = message.requestId;
      let result: Reply;
      try {
        if (!(await accessStatus(info.url, browser)).site) { discardPick(info.windowId); return; }
        const active = await bg.activeTab(info.windowId);
        if (active?.id !== info.tabId || active.url !== info.url || active.incognito || active.status === 'loading') { context.requestId = undefined; return; }
        if (!current()) return;
        const payload = { accountId: context.accountId, teamId: context.teamId, url: context.url, target: message.target, caption: message.caption };
        if (message.type === 'picked') result = await bg.run({ name: 'attach-ref', payload });
        else {
          if (message.action !== 'sticky' || message.target?.kind !== 'quote') throw new MessageError(uiMessage('extension.runtime.pageUnavailable'));
          result = await bg.run({ name: 'team-event', payload: { ...payload, kind: 'sticky', operationId: message.requestId, asset: info.asset, site: pageUrlHost(context.url), text: typeof message.text === 'string' ? message.text : '' } });
        }
      } catch (error) { result = { ok: false, message: 'Action failed', text: errorMessage(error) }; }
      if (!current()) return;
      const { locale } = await bg.language.get();
      if (!current()) return;
      const saved = result.ok && message.type === 'marked' ? result.value as { id?: string; revision?: string; existing?: boolean } | undefined : undefined;
      port.postMessage({ type: 'pick-result', requestId: message.requestId, ok: result.ok, ...(saved?.id ? { stickyId: saved.id, revision: saved.revision, existing: saved.existing } : {}), ...(!result.ok ? { error: renderMessage(locale, result.text ?? errorMessage(result)) } : {}) } satisfies PageDown);
      context.requestId = undefined;
      if (result.ok) void bg.stickies.pushStickies(port, info);
    },
  };
}
