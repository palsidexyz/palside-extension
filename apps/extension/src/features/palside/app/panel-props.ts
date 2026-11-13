import type { TextValue } from '@palside/i18n';
import type { LivePort } from './live-port';
/** `done` holds the finished registration on screen for a beat before the next step; a failure stays on the wait screen with
    its reason, a retry with the same PIN and a way back to the PIN step. */
export type Working = boolean | 'done' | { error: TextValue; retry: () => void; back: () => void };
/** Setting the password registers this device and connects; the account remounts the session midway, so this outlives it. */
/** create: a generated phrase; restore: sign in; import: a new account from a phrase the person already has. */
export type OnboardingFlow = 'create' | 'restore' | 'import';
export type OnboardingState = { working: Working; setWorking: (working: Working) => void; flow: OnboardingFlow; setFlow: (flow: OnboardingFlow) => void };
/** The panel always runs on a runtime port: the offscreen runtime in the extension, a fixture port on review pages. */
export type PalsideProps = { live: LivePort; onboarding?: OnboardingState };
