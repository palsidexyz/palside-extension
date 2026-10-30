import { deviceStates } from './common.ts';
import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from './validation.ts';
export const deviceState = Type.Enum(deviceStates);
export const activity = strictObject({ state: deviceState });
export type DeviceState = Static<typeof deviceState>;
