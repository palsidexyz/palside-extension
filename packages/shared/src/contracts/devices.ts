import Type, { type StaticDecode as Static } from 'typebox';
import { strictObject } from './validation.ts';
import { id, text, timestamp } from './common.ts';
import { DEVICE_LABEL_LENGTH } from './limits.ts';
export const device = strictObject({ id, label: text(DEVICE_LABEL_LENGTH, 1), createdAt: timestamp, current: Type.Boolean() });
export type Device = Static<typeof device>;
