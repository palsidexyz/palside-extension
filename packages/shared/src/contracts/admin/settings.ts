import { REPORT_THRESHOLD } from '../../rules/admin.ts';
import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from '../validation.ts';
import { text } from './common.ts';

import { SIGNUP_MODES } from '../../rules/accounts.ts';
export type SignupMode = typeof SIGNUP_MODES[number];
const signupMode = Type.Enum(SIGNUP_MODES);
const reportThreshold = Type.Integer({ minimum: REPORT_THRESHOLD.min, maximum: REPORT_THRESHOLD.max });
export const adminSettings = strictObject({ reportThreshold, signupMode, revision: Type.Integer({ minimum: 1 }) });
export const adminSettingsChange = strictObject({ reportThreshold, signupMode, expectedRevision: Type.Integer({ minimum: 1 }), reason: text });
/** Site-wide signups per hour, oldest first; counts only. */
export const adminSignups = strictObject({
  difficulty: Type.Integer({ minimum: 0 }), surge: Type.Boolean(), mode: signupMode,
  hours: Type.Array(strictObject({ startsAt: Type.Integer({ minimum: 0 }), count: Type.Integer({ minimum: 0 }) })),
});
export type AdminSignups = Static<typeof adminSignups>;
