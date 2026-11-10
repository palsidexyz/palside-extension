import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { tokenChains } from '../../tokens.ts';
import { nullable, text } from './common.ts';

const chain = Type.Enum(tokenChains);
/** EVM hex or Solana base58; the server canonicalizes and rejects anything else. */
const address = Type.String({ minLength: 32, maxLength: 66 });
export const adminTokenKey = strictObject({ chain, address });
/** One directory entry as the chain gave it, with the operator's blocks. `name`/`symbol` are shown here even when blocked. */
export const adminTokenRow = strictObject({
  chain, address, status: Type.Enum(['token', 'missing']), name: nullable(Type.String()), symbol: nullable(Type.String()), decimals: nullable(Type.Integer()),
  logo: Type.Enum(['none', 'pending', 'ready', 'failed']), logoVersion: Type.Integer({ minimum: 0 }), nameBlocked: Type.Boolean(), logoBlocked: Type.Boolean(),
  checkedAt: Type.Integer(), lookedAt: Type.Integer(),
});
export const adminTokenList = strictObject({ items: Type.Array(adminTokenRow) });
export const adminTokenBlock = strictObject({ chain, address, name: Type.Boolean(), logo: Type.Boolean(), reason: text });
export const adminTokenRefresh = strictObject({ chain, address, reason: text });
export type AdminTokenRow = Infer<typeof adminTokenRow>;
