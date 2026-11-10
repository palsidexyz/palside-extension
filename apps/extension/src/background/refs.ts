import { pageAsset } from '../runtime/browser/page-layer-host.ts';
import type { LocateReply,LocateResult } from '../runtime/browser/page-protocol.ts';
import { samePage } from '../domain/annotations/interaction.ts';
import { signalAsset } from '../runtime/annotations/signals.ts';
import type { Background } from './index.ts';

type Located = { ok: true; value: LocateReply };
const located = (result: LocateResult, opened = false): Located => ({ ok: true, value: { result, opened } });

/** The panel's locate actions in chat: open the page a signal's or a drawing's line points at and show it there once. */
export function refs(bg: Background) {
  /** Same login, same squad. Opening a token page moves the 弹幕 room and with it the page policy, so the policy version cannot be the check here. */
  const stillValid = (accountId: string | undefined, teamId: string) => {
    const version = bg.sessionVersion;
    return () => version === bg.sessionVersion && accountId === bg.state?.account?.id && teamId === bg.state?.preferences.current && bg.teamAvailable();
  };
  return {
    /** Panel `signal-replay`: open the signal's page and show the signal again, where it was made. */
    async replaySignal(payload: Record<string, unknown>, senderUrl: string): Promise<Located> {
      const accountId = bg.state?.account?.id, teamId = String(payload.teamId || bg.state?.preferences.current), windowId = Number(payload.windowId);
      const record = bg.state?.signalRecords?.find(value => value.teamId === teamId && value.id === payload.recordId);
      if (!record) return located('missing');
      const { kind, target, url } = record, asset = signalAsset(record);
      const valid = stillValid(accountId, teamId);
      const matches = (page: string | undefined) => Boolean(page && samePage(page, url, pageAsset(page, bg.state), asset ?? pageAsset(url, bg.state)));
      const value = await bg.locator.locateOnPage({ windowId, senderUrl, url, matches, show: author => ({ type: 'signal-replay', kind, target, author }), author: () => bg.pagePerson(record.personId), valid });
      return { ok: true, value };
    },
    /** Panel `drawing-show`: open the page a 共享画线 drawing is on and bring the chart to it. A deleted drawing is missing. */
    async showDrawing(payload: Record<string, unknown>, senderUrl: string): Promise<Located> {
      const accountId = bg.state?.account?.id, teamId = String(payload.teamId || bg.state?.preferences.current), windowId = Number(payload.windowId);
      const record = bg.state?.chartDrawings?.find(value => value.teamId === teamId && value.personId === payload.personId && value.id === payload.recordId);
      if (!record?.shape) return located('missing');
      const { id, url } = record, valid = stillValid(accountId, teamId);
      const matches = (page: string | undefined) => Boolean(page && samePage(page, url, pageAsset(page, bg.state), record.asset ?? pageAsset(url, bg.state)));
      const value = await bg.locator.locateOnPage({ windowId, senderUrl, url, matches, show: () => ({ type: 'drawing-show', id }), author: () => bg.pagePerson(record.personId), valid });
      return { ok: true, value };
    },
  };
}
