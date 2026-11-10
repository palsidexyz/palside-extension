import type { LocateResult } from '../../../runtime/browser/page-protocol';

/** What the panel says when a 定位 ends without showing the target: one sentence per cause. */
export const locateFeedback = {
  shown: undefined,
  missing: 'extension.composer.refMissing',
  loading: 'extension.composer.refLoading',
  blocked: 'extension.composer.refBlocked',
  moved: 'extension.composer.refMoved',
  timeout: 'extension.composer.refTimeout',
  unavailable: 'extension.composer.refChanged',
  outside: 'extension.composer.refOutside',
} as const satisfies Record<LocateResult, string | undefined>;
