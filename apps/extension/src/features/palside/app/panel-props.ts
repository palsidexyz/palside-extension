import type { LivePort } from './live-port';
import { type Site } from '../settings/site-catalog';
import { type Message } from '../../../domain/chat/model';
import { type Dataset } from '../../../runtime/composition/dataset';
import { type Scenario } from './panel-model';
import type { PanelAdapter } from './panel-adapter';
/** Setting the password registers this device and connects; the account remounts the session midway, so this outlives it. */
export type OnboardingState = { working: boolean; setWorking: (working: boolean) => void; flow: 'create' | 'restore'; setFlow: (flow: 'create' | 'restore') => void };
export type PalsideProps = { live?: LivePort; adapter?: PanelAdapter; data: Dataset; scenario?: Scenario; sites: Site[]; deliver: (message: Message) => Promise<void>; onboarding?: OnboardingState };
