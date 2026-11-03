/** Message and team-item expiry; `undefined` is a message without a known deadline, kept until one is known. */
export const expired = (expiresAt: number | undefined, now: number) => expiresAt !== undefined && expiresAt <= now;
