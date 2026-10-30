import Type, { type StaticDecode as Static } from 'typebox';
import { contractString, strictObject } from './validation.ts';
import { id } from './common.ts';
import { REPORT_REASONS, REPORT_NOTE_LIMIT, REPORT_TARGET_LENGTH, REPORT_SNAPSHOT_LENGTH } from './limits.ts';
export const reportSubmission = Type.Refine(strictObject({ kind: Type.Enum(['team', 'account', 'message']), targetId: Type.Decode(Type.Refine(contractString({ max: REPORT_TARGET_LENGTH, unit: 'grapheme' }), value => value.trim().length > 0, () => 'expected target'), value => value.trim()), reason: Type.Enum(REPORT_REASONS), note: Type.Decode(contractString({ max: REPORT_NOTE_LIMIT, unit: 'grapheme' }), value => value.trim()), snapshot: Type.Refine(contractString({ max: REPORT_SNAPSHOT_LENGTH, unit: 'grapheme' }), value => value.trim().length > 0, () => 'expected selected content'), mediaId: Type.Optional(id) }), value => (value.reason !== 'other' || value.note.trim().length > 0) && (value.mediaId === undefined || value.kind === 'message'), () => 'expected a note for other and media only for messages');
export const reportResult = strictObject({ submitted: Type.Literal(true) });
export type ReportSubmission = Static<typeof reportSubmission>;
