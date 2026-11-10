import { MessageError } from '@palside/i18n';
import type { LocateReply,LocateResult,PageDown,PagePerson } from '../runtime/browser/page-protocol.ts';
import type { Background } from './index.ts';

/** How long an opened page may take to finish loading. */
const LOAD_MS = 10_000;
/** A finished page that stays on another address this long has gone elsewhere (a redirect, a login wall). */
const MOVED_MS = 1_500;
const POLL_MS = 80;
/** The replayed signal stays this long after it is shown; the page tools stay connected for it. */
const HOLD_MS = 4_500;
/** A single-page site can rewrite its address or keep rendering just after loading; connecting and finding retry briefly. */
const RETRIES = 3, RETRY_MS = 400;

/** What the page is asked to show once it is open; the request id is added on the way. */
export type LocateMessage = Extract<PageDown, { type: 'signal-replay' | 'drawing-show' }> extends infer M ? M extends unknown ? Omit<M, 'requestId'> : never : never;

type LocateRequest = {
  windowId: number;
  senderUrl: string;
  /** The page to open when the panel window is not on it. */
  url: string;
  /** Whether an address is the target's page (`pageKey`). */
  matches: (url: string | undefined) => boolean;
  /** What to show, by the person it came from. */
  show: (author: PagePerson) => LocateMessage;
  author: () => Promise<PagePerson>;
  /** The account, squad and the thing being located are unchanged. */
  valid: () => boolean;
};

/**
 * 定位: one flow for a quote in a message and for a signal's line in the chat. It opens the page (reusing the panel window's tab when it
 * already shows it), waits until that page has loaded, connects the page tools, then asks the page to show the target. Every way it can
 * end has its own result, so the panel can say what happened.
 */
export function locator(bg: Background) {
  const sleep = (ms: number) => new Promise(resolve => bg.setTimeout(resolve, ms));
  const code = (error: unknown) => error instanceof MessageError ? error.text.key : undefined;

  async function waitForPage(request: LocateRequest): Promise<LocateResult | undefined> {
    const deadline = Date.now() + LOAD_MS;
    let elsewhereSince: number | undefined;
    for (;;) {
      if (!request.valid()) return 'unavailable';
      const page = await bg.activeTab(request.windowId);
      const loading = page?.status === 'loading';
      if (!loading && request.matches(page?.url)) return;
      if (!loading) {
        elsewhereSince ??= Date.now();
        if (Date.now() - elsewhereSince >= MOVED_MS) return 'moved';
      } else elsewhereSince = undefined;
      if (Date.now() >= deadline) return loading ? 'loading' : 'moved';
      await sleep(POLL_MS);
    }
  }

  async function locateOnPage(request: LocateRequest): Promise<LocateReply> {
    let opened = false;
    const reply = (result: LocateResult): LocateReply => ({ result, opened });
    if (!request.valid()) return reply('unavailable');
    const active = (await bg.panelTab(request.windowId, request.senderUrl))?.tab;
    if (!request.matches(active?.url)) {
      await bg.openPage(request.url);
      opened = true;
    }
    const waited = await waitForPage(request);
    if (waited) return reply(waited);
    for (let attempt = 0; ; attempt++) {
      let context: Awaited<ReturnType<Background['pages']['openPageTools']>>;
      try { context = await bg.pages.openPageTools(request.windowId, request.senderUrl); }
      catch (error) {
        if (!request.valid()) return reply('unavailable');
        // The address changed under the page tools (a single-page site rewriting it) or the page reloaded: wait and connect again.
        if (code(error) === 'extension.runtime.contextChanged' && attempt < RETRIES) {
          await sleep(RETRY_MS);
          const again = await waitForPage(request);
          if (again) return reply(again);
          continue;
        }
        if (code(error) === 'extension.runtime.contextChanged') return reply('moved');
        if (code(error) === 'extension.runtime.pageActionFailed') return reply('blocked');
        // Anything else (Chrome access the page needs, a capture in progress) has its own message for the panel.
        throw error;
      }
      try {
        if (!request.valid() || bg.pages.pagePorts.get(context.port) !== context.info) return reply('unavailable');
        if (!request.matches(context.info.url)) return reply('moved');
        const author = await request.author();
        // A page that just loaded may still be rendering the quoted part.
        for (let find = 0; ; find++) {
          const result = await bg.pages.locate(context.port, request.show(author));
          if (result !== 'missing' || !opened || find >= RETRIES || !request.valid()) return reply(result);
          await sleep(RETRY_MS * 2);
        }
      } finally { context.finish(HOLD_MS); }
    }
  }
  return { locateOnPage };
}
