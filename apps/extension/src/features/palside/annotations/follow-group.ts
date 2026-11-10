import { requestTabGroups } from '../../../runtime/browser/permissions';

const ASKED = 'palside:follow-group-asked';

/**
 * The first 跟看 on this device asks Chrome to let Palside name its tab group; asked once, so a no stays a no and a 收回 in 隐私与数据
 * is not silently undone by the next 跟看. 隐私与数据 can allow it later. Call synchronously from the click; following never waits on the answer's outcome.
 */
export async function askFollowGroup(): Promise<void> {
  let asked = false;
  try { asked = localStorage.getItem(ASKED) !== null; } catch { /* Ask again next time. */ }
  if (asked) return;
  const asking = requestTabGroups().catch(() => false);
  try { localStorage.setItem(ASKED, '1'); } catch { /* Ask again next time. */ }
  await asking;
}
