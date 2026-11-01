import { createHash, randomBytes } from "node:crypto";

/** Default lifetime for a one-time user invite link: 7 days. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hashes a raw invite token with SHA-256 so only the digest is stored in `User.inviteTokenHash`. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("base64url");
}

/** Generates a fresh one-time invite token, its stored SHA-256 hash, and its expiration timestamp. */
export function createInviteToken(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(24).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  };
}
