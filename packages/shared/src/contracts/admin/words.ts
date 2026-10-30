import Type from 'typebox';
import { strictObject } from '../validation.ts';
import { text, id, page } from './common.ts';

export const adminWordRow = strictObject({ id, word: Type.String(), kind: Type.Enum(['reserved', 'sensitive']), builtin: Type.Boolean(), createdAt: Type.Integer() });
export const adminWordPage = page(adminWordRow);
// Details.
export const wordMatch = strictObject({ id: Type.String(), word: Type.String(), kind: Type.Enum(['reserved', 'sensitive']) });
export const adminWordChange = strictObject({ word: Type.String({ minLength: 1, maxLength: 100 }), kind: Type.Enum(['reserved', 'sensitive']), reason: text });
export const adminWordAddResult = strictObject({ id });
export const adminWordRemoveResult = strictObject({ removed: Type.Literal(true) });
export const adminWordTest = strictObject({ text: Type.String({ maxLength: 10000 }) });
export const adminWordTestResult = strictObject({ matches: Type.Array(wordMatch) });
