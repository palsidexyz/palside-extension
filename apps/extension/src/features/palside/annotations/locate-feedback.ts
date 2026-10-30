import type { LocateResult } from '../../../runtime/browser/page-protocol';

export const locateFeedback = {
  shown: undefined,
  missing: 'extension.composer.refMissing',
  hidden: 'extension.composer.refHidden',
  'other-site': 'extension.composer.refOtherSite',
  unavailable: 'extension.composer.refUnavailable',
} as const satisfies Record<LocateResult, string | undefined>;
