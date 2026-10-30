import { IMAGE_MIME_TYPES } from '@palside/shared/contracts/limits';
import { parseCommand } from '../runtime/transport/command-map.ts';
import { MessageError,errorMessage,message as uiMessage } from '@palside/i18n';
import type { Browser } from 'wxt/browser';
import { ImageSessionBroker,ImageSessionError,imageSource } from '../runtime/media/image-sessions.ts';
import { IMAGE_LIMIT } from '../domain/images/image-policy.ts';
import type { Background } from './index.ts';

type Binding = { source: string; windowId?: number; ready?: Promise<void>; ports?: Set<Browser.runtime.Port> };

/**
 * The image window: a popup that views or edits one image from a draft or message. The panel opens it; afterwards only that
 * popup (and the panel for `return`/`read`) may drive its session, and every change is queued per session.
 */
export function images(bg: Background) {
  const { browser } = bg;
  const sessions = new ImageSessionBroker({ currentAccount: () => bg.state?.authenticated ? bg.state.account?.id : undefined });
  const windows = new Map<string, Binding>();
  const changes = new Map<string, Promise<unknown>>();
  let epoch = 0;

  /** The image window's lifeline: a revoke, or the port dropping when the worker restarts, clears its copy. */
  function connectImage(port: Browser.runtime.Port) {
    if (port.sender?.id !== browser.runtime.id || !bg.extensionPage(port.sender.url, '/image.html')) return;
    const id = new URL(port.sender.url!).searchParams.get('session') ?? '';
    let connected = true;
    port.onDisconnect.addListener(() => { connected = false; windows.get(id)?.ports?.delete(port); });
    void command('image-session-read', { id }, port.sender).then(() => {
      if (!connected) return;
      const binding = windows.get(id);
      if (binding) { binding.ports ??= new Set(); binding.ports.add(port); }
      try { port.postMessage({ type: binding ? 'ready' : 'revoke' }); } catch { /* window closed */ }
    }, () => {
      try { port.postMessage({ type: 'revoke' }); } catch { /* window closed */ }
    });
  }

  /** Ends a delivered copy: the window clears its pixels, then closes. */
  function revokeWindow(id: string, binding: Binding) {
    windows.delete(id);
    for (const port of binding.ports ?? []) { try { port.postMessage({ type: 'revoke' }); } catch { /* window closed */ } }
    void browser.runtime.sendMessage({ type: 'palside/image-revoke', id }).catch(() => {});
    if (binding.windowId !== undefined) void browser.windows.remove(binding.windowId).catch(() => {});
  }

  function account(teamId: unknown) {
    const state = bg.state;
    if (!state?.authenticated || !state.account?.id || !state.remoteTeams.some(team => team.id === teamId && team.joined)) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
    return state.account.id;
  }
  function snapshot(id: string) {
    const accountId = bg.state?.account?.id;
    if (!accountId) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
    const value = sessions.read(id, accountId);
    account(value.teamId);
    return { ...value, windowOpen: windows.get(id)?.windowId !== undefined };
  }
  function change<T>(id: string, action: () => Promise<T> | T): Promise<T> {
    const next = (changes.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    changes.set(id, next);
    void next.finally(() => { if (changes.get(id) === next) changes.delete(id); }).catch(() => {});
    return next;
  }

  async function open(payload: Record<string, unknown>) {
    const accountId = account(payload.teamId), teamId = String(payload.teamId), opened = epoch;
    const source = payload.source as { src?: unknown; name?: unknown } | undefined;
    if (!source || typeof source.src !== 'string' || typeof source.name !== 'string' || !['view', 'edit'].includes(String(payload.mode))) throw new ImageSessionError('IMAGE_SESSION_INVALID');
    const original = source.src, mode = payload.mode as 'view' | 'edit';
    const draft = bg.state!.drafts[teamId];
    const inDraft = draft?.value.attachment?.kind === 'image' && draft.value.attachment.src === original;
    // The image must still be in this draft (edit: at the same revision) or in a live message of the team.
    const available = () => {
      if (epoch !== opened || account(teamId) !== accountId) return false;
      const current = bg.state?.drafts[teamId];
      const attached = current?.value.attachment?.kind === 'image' && current.value.attachment.src === original;
      return mode === 'edit' ? attached && current?.revision === draft?.revision
        : attached || Boolean(bg.state?.data.messages.some(message => message.teamId === teamId && !message.recalled && (!message.expiresAt || message.expiresAt > Date.now()) && message.attachment?.kind === 'image' && message.attachment.src === original));
    };
    if (mode === 'edit' && !inDraft || !available()) throw new MessageError(uiMessage('extension.runtime.imageUnavailable'));
    let src = original;
    // The popup cannot read the offscreen document's blob URLs, so an owned blob travels as a data URL.
    if (src.startsWith(`blob:${browser.runtime.getURL('/')}`)) {
      const response = await bg.fetch(src);
      if (!response.ok) throw new MessageError(uiMessage('extension.runtime.imageUnavailable'));
      const blob = await response.blob();
      if (blob.size > IMAGE_LIMIT.maxBytes || !IMAGE_MIME_TYPES.some(type => type === blob.type)) throw new ImageSessionError('IMAGE_SESSION_INVALID');
      src = await bg.dataUrl(blob, blob.type);
    }
    if (!available()) throw new MessageError(uiMessage('extension.runtime.contextChanged'));
    for (const [id, binding] of windows) { try { sessions.read(id, accountId); } catch { revokeWindow(id, binding); } }
    let session = sessions.open({ accountId, teamId, mode, source: { src, name: source.name.trim() || 'image.png' }, ...(mode === 'edit' ? { draftRevision: draft!.revision } : {}) });
    const binding: Binding = { source: original };
    windows.set(session.id, binding);
    try {
      if (mode === 'edit' && payload.document !== undefined && payload.document !== null) session = sessions.update(session.id, accountId, session.revision, payload.document);
      const id = session.id;
      binding.ready = browser.windows.create({ url: `${browser.runtime.getURL('/image.html')}?session=${encodeURIComponent(id)}`, type: 'popup', width: 1100, height: 800 }).then(async window => {
        if (epoch !== opened || windows.get(id) !== binding) { if (window?.id !== undefined) await browser.windows.remove(window.id).catch(() => {}); throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE'); }
        if (window?.id === undefined) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
        binding.windowId = window.id;
      });
      await binding.ready;
      return snapshot(id);
    } catch (error) {
      windows.delete(session.id);
      try { sessions.cancel(session.id, accountId, session.revision); } catch { /* already closed */ }
      throw error;
    }
  }

  async function command(name: string, payload: Record<string, unknown>, sender: Browser.runtime.MessageSender) {
    try { parseCommand({ name, payload }); } catch { throw new ImageSessionError('IMAGE_SESSION_INVALID'); }
    const panel = bg.extensionPage(sender.url, '/sidepanel.html') && !sender.tab;
    const popup = bg.extensionPage(sender.url, '/image.html');
    if (name === 'image-session-open') { if (!panel) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE'); return open(payload); }
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!panel && (!popup || new URL(sender.url!).searchParams.get('session') !== id)) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
    const binding = windows.get(id);
    if (!binding) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
    await binding.ready;
    const authorized = () => {
      if (windows.get(id) !== binding || !panel && (binding.windowId === undefined || sender.tab?.windowId !== binding.windowId)) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
    };
    authorized();
    if (name === 'image-session-read') return change(id, () => { authorized(); return snapshot(id); });
    // The panel may only take the image back; everything else comes from the popup.
    if (panel !== (name === 'image-session-return')) throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
    if (name === 'image-session-return' && binding.windowId !== undefined) {
      // The renderer may still have updates queued locally. Let them enter the queue before taking it.
      let flushed = false;
      try { flushed = (await browser.runtime.sendMessage({ type: 'palside/image-flush', id }))?.ok === true; } catch { /* popup gone */ }
      authorized();
      if (!flushed && binding.windowId !== undefined) throw new MessageError(uiMessage('extension.runtime.imageUnavailable'));
    }
    return change(id, async () => {
      authorized();
      const current = snapshot(id), accountId = current.accountId;
      if (name === 'image-session-return') {
        const windowId = binding.windowId;
        binding.windowId = undefined;
        if (windowId !== undefined) await browser.windows.remove(windowId).catch(() => {});
        return snapshot(id);
      }
      const revision = payload.expectedRevision as number;
      if (name === 'image-session-update') return { ...sessions.update(id, accountId, revision, payload.document), windowOpen: true };
      if (name === 'image-session-cancel') { const cancelled = sessions.cancel(id, accountId, revision); windows.delete(id); return { ...cancelled, windowOpen: false }; }
      if (name !== 'image-session-save') throw new ImageSessionError('IMAGE_SESSION_UNAVAILABLE');
      if (current.status !== 'open') throw new ImageSessionError('IMAGE_SESSION_CLOSED');
      if (current.mode !== 'edit') throw new ImageSessionError('IMAGE_SESSION_READ_ONLY');
      if (!Number.isSafeInteger(revision) || revision !== current.revision || revision === Number.MAX_SAFE_INTEGER) throw new ImageSessionError('IMAGE_SESSION_CONFLICT');
      const src = imageSource(payload.src);
      const result = await bg.run({ name: 'image-draft-save', payload: { accountId, teamId: current.teamId, source: binding.source, draftRevision: current.draftRevision!, src } });
      if (!result.ok) throw Object.assign(new MessageError(result.text ?? errorMessage(result)), { code: result.code });
      return { ...sessions.save(id, accountId, revision, src).snapshot, windowOpen: binding.windowId !== undefined };
    });
  }

  return {
    /** Revoke delivered copies as well as the broker's account-scoped sessions. */
    clearImageSessions() {
      epoch++; sessions.clear(); changes.clear(); bg.clearAvatarCache();
      for (const [id, binding] of windows) revokeWindow(id, binding);
    },
    connectImage,
    imageCommand: command,
    imageFailure(error: unknown) {
      if (!(error instanceof ImageSessionError)) return errorMessage(error);
      return uiMessage(error.code === 'IMAGE_SESSION_CONFLICT' ? 'extension.runtime.draftChanged' : error.code === 'IMAGE_SESSION_INVALID' ? 'extension.runtime.imageSizeLimit' : 'extension.runtime.imageUnavailable');
    },
    /** A popup closed by hand keeps its session (the panel can still take the image back) but no longer accepts commands. */
    imageWindowClosed(windowId: number) { for (const binding of windows.values()) if (binding.windowId === windowId) binding.windowId = undefined; },
  };
}
