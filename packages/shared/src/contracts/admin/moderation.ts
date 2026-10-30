import Type from 'typebox';

// Changed targets write one audit row; unchanged targets write none. Bulk rows share `batchId`.
export const accountFields = Type.Array(Type.Enum(['nickname', 'bio', 'avatar', 'tags']), { minItems: 1, uniqueItems: true });
export const teamFields = Type.Array(Type.Enum(['name', 'description', 'avatar']), { minItems: 1, uniqueItems: true });
export const duration = Type.Enum(['7d', '30d', 'permanent']);
