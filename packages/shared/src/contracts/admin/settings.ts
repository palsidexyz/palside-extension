import Type from 'typebox';
import { strictObject } from '../validation.ts';
import { text } from './common.ts';

export const adminSettings = strictObject({ reportThreshold: Type.Integer({ minimum: 1, maximum: 5 }), revision: Type.Integer({ minimum: 1 }) });
export const adminSettingsChange = strictObject({ reportThreshold: Type.Integer({ minimum: 1, maximum: 5 }), expectedRevision: Type.Integer({ minimum: 1 }), reason: text });
