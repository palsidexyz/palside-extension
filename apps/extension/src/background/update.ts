import { SECOND_MS } from '@palside/shared/units';
import { productColors } from '@palside/design/colors';
import type { RuntimeState } from '../runtime/composition/runtime-state';
import type { UpdateRequest, UpdateStatus } from '../runtime/browser/extension-update.ts';
import type { Background } from './index.ts';
import type { Port } from './context.ts';

/** The downloaded version, kept while the worker sleeps. */
const READY = 'palside:update-ready';
/** Set when an update closed open panels; the next worker marks the toolbar icon until a panel opens again. */
const RETURN = 'palside:update-return';
/** How long every panel must stay closed, with no message still sending, before a downloaded version applies on its own. */
const QUIET_MS = 5 * SECOND_MS;

/**
 * Extension updates (docs/engineering/release.md「扩展更新」). Chrome installs a new version only while the extension has no page
 * open, and the offscreen runtime never closes, so the worker applies it: on its own once no panel is open, or when 更新 is pressed
 * in a panel, which closes. A version the service refuses asks the store at once.
 */
export function updates(bg: Background) {
  const { browser } = bg;
  let ready: string | undefined, checking = false, applying = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;

  function status(): UpdateStatus { return { ...(ready ? { ready } : {}), ...(checking ? { checking: true } : {}) }; }
  function send(port: Port) { bg.post(port, { type: 'update', status: status() }); }
  function broadcast() { for (const port of bg.panels.keys()) send(port); }
  const sending = () => Boolean(bg.state?.data.messages.some(message => message.status === 'sending'));

  function apply(closesPanels: boolean) {
    if (applying || !ready) return;
    applying = true;
    bg.clearTimeout(quiet);
    void (closesPanels ? browser.storage.local?.set({ [RETURN]: true }) ?? Promise.resolve() : Promise.resolve()).catch(() => {}).finally(() => browser.runtime.reload());
  }
  function schedule() {
    bg.clearTimeout(quiet); quiet = undefined;
    if (!ready || applying || bg.panels.size) return;
    quiet = bg.setTimeout(() => { if (sending()) schedule(); else if (!bg.panels.size) apply(false); }, QUIET_MS);
  }
  function available(version: string) {
    ready = version;
    void browser.storage.session?.set({ [READY]: version }).catch(() => {});
    broadcast(); schedule();
  }
  async function check(): Promise<UpdateRequest> {
    if (checking) return { applied: false, check: 'throttled' };
    checking = true; broadcast();
    try {
      const result = await browser.runtime.requestUpdateCheck();
      // `update_available` downloads it; onUpdateAvailable then makes it ready.
      return { applied: false, check: result.status };
    } catch { return { applied: false, check: 'failed' }; }
    finally { checking = false; broadcast(); }
  }

  void browser.storage.session?.get(READY).then(value => {
    if (typeof value[READY] === 'string' && !ready) { ready = value[READY]; broadcast(); schedule(); }
  }).catch(() => {});
  void browser.storage.local?.get(RETURN).then(value => {
    if (value[RETURN] !== true) return;
    if (bg.panels.size) return void browser.storage.local.remove(RETURN).catch(() => {});
    void browser.action.setBadgeBackgroundColor({ color: productColors.accent }).catch(() => {});
    void browser.action.setBadgeText({ text: ' ' }).catch(() => {});
  }).catch(() => {});

  return {
    available,
    /** A panel connected: it learns the status, and the way back after an update is found. */
    panelConnected(port: Port) {
      send(port); schedule();
      void browser.storage.local?.get(RETURN).then(value => {
        if (value[RETURN] !== true) return;
        void browser.storage.local.remove(RETURN).catch(() => {});
        void browser.action.setBadgeText({ text: '' }).catch(() => {});
      }).catch(() => {});
    },
    panelClosed: schedule,
    /** The panel's 更新: apply the downloaded version, or ask the store for one. */
    request(): Promise<UpdateRequest> {
      if (ready) { apply(bg.panels.size > 0); return Promise.resolve({ applied: true }); }
      return check();
    },
    /** The service refusing this version asks the store at once, so the newer one is usually ready by the time 更新 is pressed. */
    stateChanged(previous: RuntimeState | undefined, next: RuntimeState) {
      if (next.connection.outdated && !previous?.connection.outdated && !ready) void check();
    },
  };
}
