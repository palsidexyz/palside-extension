import { MessageError,message as uiMessage } from '@palside/i18n';
import { accessStatus } from '../runtime/browser/permissions.ts';
import { pageAsset,pageStickies,type PageConnection } from '../runtime/browser/page-layer-host.ts';
import type { LocateReply,LocateResult,PageDown } from '../runtime/browser/page-protocol.ts';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import { pageScopeUrl,viewAsset } from '../domain/annotations/interaction.ts';
import { visibleStickies } from '../runtime/browser/page-layer-host.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

type Located = { ok: true; value: LocateReply };
const located = (result: LocateResult, opened = false): Located => ({ ok: true, value: { result, opened } });

/** 便利贴 on pages (projection, open from a pin) and the panel's quote and locate actions for notes and references. */
export function stickies(bg: Background) {
  const { browser } = bg;
  const sent = new WeakMap<Port, string>();
  const versions = new WeakMap<Port, number>();
  /** A pin clicked while the panel was closed: delivered to the panel that opens for that window. */
  const pending = new Map<number, { id: string; url: string; teamId: string }>();

  function stickyOn(info: { url?: string; windowId?: number }) { return bg.allows('sticky') && bg.interactivePage(info); }
  function notesFor(info: PageConnection, state: RuntimeState | undefined) {
    try { return stickyOn(info) ? pageStickies(info, state) : []; } catch { return []; }
  }
  /** Settles a page that is loading toward a URL, within eight seconds; false if it went elsewhere, the context changed, or it is still loading. */
  async function settle(windowId: number, scope: string | undefined, valid: () => boolean) {
    let active = await bg.activeTab(windowId);
    const tabId = active?.id, deadline = Date.now() + 8000;
    while (active?.status === 'loading' && valid() && Date.now() < deadline) {
      await new Promise(resolve => bg.setTimeout(resolve, 80));
      active = await bg.activeTab(windowId);
      if (active?.id !== tabId || scope !== undefined && pageScopeUrl(active?.url) !== scope) return;
    }
    return valid() && active?.status !== 'loading' ? active : undefined;
  }

  return {
    stickyOn,
    /** Sends a page its full set of pins when it changed. */
    async pushStickies(port: Port, info: PageConnection) {
      const version = (versions.get(port) ?? 0) + 1;
      versions.set(port, version);
      const state = bg.state, url = info.url, session = bg.sessionVersion;
      const items = await Promise.all(notesFor(info, state).map(async item => ({ id: item.id, target: item.target!, text: item.text, timestamp: item.timestamp, author: await bg.pagePerson(item.author), self: item.author === state?.account?.id })));
      if (session !== bg.sessionVersion || bg.pages.pagePorts.get(port) !== info || info.url !== url || bg.state !== state || versions.get(port) !== version) return;
      const key = JSON.stringify(items);
      if (sent.get(port) === key) return;
      try {
        port.postMessage({ type: 'stickies', items } satisfies PageDown);
        sent.set(port, key);
        info.missingStickies = info.missingStickies?.filter(id => items.some(item => item.id === id));
      } catch { bg.pages.pagePorts.delete(port); }
    },
    forgetStickies(port: Port) { sent.delete(port); },
    stickiesLocated(info: PageConnection, missing: unknown) {
      const ids = new Set(notesFor(info, bg.state).map(item => item.id));
      info.missingStickies = Array.isArray(missing) ? [...new Set(missing.filter(id => ids.has(id)))] : [];
    },
    /** A pin was clicked: open the panel on that note. */
    openStickyFromPage(info: PageConnection, id: string) {
      const sticky = notesFor(info, bg.state).find(item => item.id === id);
      const teamId = bg.state?.preferences.current, accountId = bg.state?.account?.id;
      if (!sticky || !teamId) return;
      const request = { id: sticky.id, url: info.url, teamId };
      pending.set(info.windowId, request);
      void browser.sidePanel.open({ windowId: info.windowId }).then(() => {
        if (bg.state?.account?.id !== accountId || bg.state?.preferences.current !== teamId) { pending.delete(info.windowId); return; }
        let delivered = false;
        for (const [panel, windowId] of bg.panels) if (windowId === info.windowId && bg.post(panel, { type: 'open-sticky', ...request })) delivered = true;
        if (delivered) pending.delete(info.windowId);
      }).catch(() => { pending.delete(info.windowId); });
    },
    /** A panel announced its window: hand it a pin clicked before it opened. */
    deliverPendingSticky(port: Port, windowId: number) {
      const request = pending.get(windowId);
      if (!request) return;
      if (bg.state?.preferences.current === request.teamId) bg.post(port, { type: 'open-sticky', ...request });
      pending.delete(windowId);
    },
    clearPendingStickies() { pending.clear(); },

    /** Panel `quote-sticky`: the note's original text goes into the draft as a reference. */
    async quoteSticky(payload: Record<string, unknown>) {
      const state = bg.state, accountId = state?.account?.id, teamId = String(payload.teamId || state?.preferences.current);
      if (!accountId || !state?.authenticated || payload.accountId !== undefined && payload.accountId !== accountId || !state.remoteTeams.some(team => team.id === teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      const original = state.items.stickies?.find(item => item.teamId === teamId && item.id === payload.stickyId);
      const sticky = original && visibleStickies(state.items, teamId, { asset: original.asset, url: original.url }).find(item => item.id === original.id);
      if (!sticky?.target || !sticky.url) return { ok: false, text: uiMessage('extension.runtime.messageUnavailable') };
      return bg.run({ name: 'attach-ref', payload: { accountId, teamId, url: sticky.url, target: sticky.target, caption: sticky.caption || (sticky.target.kind === 'quote' ? [...sticky.target.exact].slice(0, 40).join('') : '') } });
    },
    /** Panel `locate-sticky`: open the note's page and flash its text once. Locating never turns 便利贴 or 互动 on for the page. */
    async locateSticky(payload: Record<string, unknown>, senderUrl: string): Promise<Located> {
      const state = bg.state, accountId = state?.account?.id, teamId = String(payload.teamId || state?.preferences.current), version = bg.sessionVersion;
      if (!accountId || !state?.authenticated || payload.accountId !== undefined && payload.accountId !== accountId || !state.remoteTeams.some(team => team.id === teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
      const original = state.items.stickies?.find(item => item.teamId === teamId && item.id === payload.stickyId);
      const sticky = original && visibleStickies(state.items, teamId, { asset: original.asset, url: original.url }).find(item => item.id === original.id);
      if (!sticky?.target || !sticky.url) return located('missing');
      const windowId = Number(payload.windowId);
      await bg.panelTab(windowId, senderUrl);
      if (!(await accessStatus(sticky.url, browser)).site) return located('unavailable');
      if (state.preferences.hiddenStickies?.includes(sticky.id)) return located('hidden');
      const scope = pageScopeUrl(sticky.url);
      const same = () => bg.state?.account?.id === accountId && bg.state?.preferences.current === teamId && Boolean(bg.state?.remoteTeams.some(team => team.id === teamId && team.joined));
      let opened = false;
      try {
        if (pageScopeUrl((await bg.activeTab(windowId))?.url) !== scope) await bg.openPage(sticky.url, true);
        opened = true;
        const page = await bg.activeTab(windowId);
        if (!page?.url || pageScopeUrl(page.url) !== scope || !same()) return located('unavailable', opened);
        if (!await settle(windowId, scope, same)) return located('unavailable', opened);
        const context = await bg.pages.openPageTools(windowId, senderUrl, 'pick');
        try {
          const author = await bg.pagePerson(sticky.author);
          const current = bg.state?.items.stickies?.find(item => item.id === sticky.id && item.teamId === teamId);
          if (version !== bg.sessionVersion || !same() || !current || current.expiresAt <= Date.now() || pageScopeUrl(context.info.url) !== scope || bg.pages.pagePorts.get(context.port) !== context.info) return located('unavailable', opened);
          return located(await bg.pages.locate(context.port, { type: 'flash', target: sticky.target, author }), opened);
        } finally { context.finish(4500); }
      } catch (error) { if (opened) return located('unavailable', opened); throw error; }
    },
    /** Panel `locate-ref`: open the reference's page (or the same asset on this site) and outline the quoted target once. */
    async locateRef(payload: Record<string, unknown>, senderUrl: string): Promise<Located> {
      const accountId = bg.state?.account?.id, teamId = String(payload.teamId || bg.state?.preferences.current), windowId = Number(payload.windowId);
      const message = bg.state?.data.messages.find(value => value.teamId === teamId && value.id === payload.messageId), ref = message?.ref;
      // A quoted 弹幕 line opens in the panel, never on a page.
      if (!message || !ref || ref.target.kind === 'danmaku') return located('missing');
      const version = bg.policyVersion;
      const valid = () => version === bg.policyVersion && accountId === bg.state?.account?.id && teamId === bg.state?.preferences.current && bg.teamAvailable();
      if (!valid()) return located('unavailable');
      const active = (await bg.panelTab(windowId, senderUrl))?.tab;
      const asset = viewAsset(ref.view);
      const matches = (url: string | undefined) => Boolean(url && (ref.view.kind === 'website' || ref.target.kind === 'quote' ? pageScopeUrl(url) === pageScopeUrl(ref.view.url) : asset && pageAsset(url, bg.state) === asset));
      let opened = false;
      try {
        if (!matches(active?.url)) {
          if (!valid()) return located('unavailable');
          await bg.openPage(ref.view.url, true);
        }
        opened = true;
        const page = await settle(windowId, undefined, valid);
        if (!page || !matches(page.url)) return located('unavailable', opened);
        const context = await bg.pages.openPageTools(windowId, senderUrl, 'pick');
        try {
          const author = await bg.pagePerson(message.author);
          if (!valid() || bg.pages.pagePorts.get(context.port) !== context.info || !matches(context.info.url)) return located('unavailable', opened);
          return located(await bg.pages.locate(context.port, { type: 'flash', target: ref.target, author }), opened);
        } finally { context.finish(4500); }
      } catch (error) { if (opened) return located('unavailable', opened); throw error; }
    },
  };
}
