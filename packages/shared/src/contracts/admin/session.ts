import Type from 'typebox';
import { strictObject, type Infer } from '../validation.ts';
import { nullable } from './common.ts';

export const ADMIN_LOCK_MS = 15 * 60 * 1000;
export const ADMIN_MAX_FAILURES = 5;
const password = Type.String({ minLength: 1, maxLength: 1024 });
const newPassword = Type.String({ minLength: 12, maxLength: 1024 });
const totp = Type.String({ pattern: '^[0-9]{6}$' });
export const adminLogin = strictObject({ password, totp });
export const adminPasswordChange = strictObject({ password, totp, newPassword });
export const adminTotpChange = strictObject({ password, totp, newSecret: Type.String({ pattern: '^[A-Z2-7]{32}$' }), newTotp: totp });
export const adminSession = strictObject({ csrfToken: Type.String(), idleExpiresAt: Type.Integer(), checkedAt: Type.Integer() });
// Operator security.
export const adminSecurityState = strictObject({ checkedAt: Type.Integer(), activeSessions: Type.Integer(), currentSince: Type.Integer(), previousLoginAt: nullable(Type.Integer()), failedCredentialChecks: Type.Integer(), failuresSince: nullable(Type.Integer()), lockedUntil: nullable(Type.Integer()) });
export type AdminSecurityState = Infer<typeof adminSecurityState>;
export type AdminSession = Infer<typeof adminSession>;
