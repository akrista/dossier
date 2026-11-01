import "server-only";

import { createHmac } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { KeyPreference, UserRole } from "@/generated/prisma/enums";
import { ensureInitialAdmin } from "@/lib/auth/bootstrap";
import { verifyPassword } from "@/lib/auth/password-hash";
import { enterUserContext, runUnscoped } from "@/lib/auth/user-context";
import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";
import { prisma } from "@/lib/prisma";

// Sessions are stateless: the cookie holds an encrypted token (JWE,
// A256GCM with a key derived from DOSSIER_SECRET), so nothing is stored on
// the server, and tampering or a different secret makes it invalid. Each
// token also carries a fingerprint of the account's password hash (or
// DOSSIER_PASSWORD), so changing a password signs that user out (AUTH-6).

export const SESSION_COOKIE = "dossier_session";

const HOUR = 60 * 60;
/** How long a sign-in lasts: 24 hours for a browser session (decision in #27), 30 days with "Keep me signed in". */
export const SESSION_LIFETIME = { browser: 24 * HOUR, persistent: 30 * 24 * HOUR } as const;

/** A signed-in session. */
export type Session = {
  /** Signed in with "Keep me signed in". */
  persistent: boolean;
  issuedAt: Date;
  expiresAt: Date;
  userId?: string;
  userEmail?: string;
  userName?: string;
  role?: UserRole;
  allowGlobalKeys?: boolean;
  keyPreference?: KeyPreference | null;
};

type TokenOptions = {
  key: Uint8Array;
  /** passwordFingerprint() of the expected password hash. */
  fingerprint: string;
  /** When false, skips matching `pwd` against `fingerprint` for user-scoped tokens (checked against the DB in getSession). */
  strictUserFingerprint?: boolean;
  now?: Date;
};

/**
 * A short HMAC of a password hash (or DOSSIER_PASSWORD), keyed from DOSSIER_SECRET.
 * It identifies the password a session was created with, without revealing it.
 */
export function passwordFingerprint(
  password = env.DOSSIER_PASSWORD,
  key = deriveKey("password-fingerprint"),
): string {
  return createHmac("sha256", key).update(password, "utf8").digest("base64url").slice(0, 16);
}

/** The key and fingerprint that sessions are created and checked with. */
export function sessionTokenOptions(passwordHash?: string): TokenOptions {
  return {
    key: deriveKey("session"),
    fingerprint: passwordFingerprint(passwordHash ?? env.DOSSIER_PASSWORD),
    strictUserFingerprint: passwordHash !== undefined,
  };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Creates the encrypted session token. */
export async function encodeSession(
  { persistent, userId, role }: { persistent: boolean; userId?: string; role?: UserRole },
  { key, fingerprint, now = new Date() }: TokenOptions,
): Promise<string> {
  const issuedAt = seconds(now);
  return new EncryptJWT({
    persistent,
    pwd: fingerprint,
    ...(userId !== undefined ? { uid: userId, role: role ?? UserRole.USER } : {}),
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_LIFETIME[persistent ? "persistent" : "browser"])
    .encrypt(key);
}

async function decryptTokenPayload(
  token: string | undefined,
  { key, fingerprint, strictUserFingerprint = true, now = new Date() }: TokenOptions,
): Promise<{ session: Session; pwd: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, {
      currentDate: now,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"],
    });
    if (typeof payload.persistent !== "boolean" || typeof payload.pwd !== "string" || !payload.pwd) return null;
    const hasUid = typeof payload.uid === "string" && payload.uid.length > 0;
    if ((!hasUid || strictUserFingerprint) && payload.pwd !== fingerprint) return null;

    const session: Session = {
      persistent: payload.persistent,
      issuedAt: new Date(payload.iat! * 1000),
      expiresAt: new Date(payload.exp! * 1000),
      ...(hasUid
        ? {
            userId: payload.uid as string,
            role: payload.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER,
          }
        : {}),
    };
    return { session, pwd: payload.pwd };
  } catch {
    return null;
  }
}

/**
 * Reads a session token; null when it's missing, tampered with, expired, made
 * with another key, or made while a different password was set.
 */
export async function decodeSession(
  token: string | undefined,
  options: TokenOptions,
): Promise<Session | null> {
  const decoded = await decryptTokenPayload(token, options);
  return decoded?.session ?? null;
}

/** Whether `candidate` is the password that DOSSIER_PASSWORD (or `hash`) is a hash of. */
export function passwordMatches(candidate: string, hash = env.DOSSIER_PASSWORD): Promise<boolean> {
  return verifyPassword(candidate, hash);
}

/** Whether the browser reached us over HTTPS, as the reverse proxy reports it. */
async function isHttps(): Promise<boolean> {
  const proto = (await headers()).get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim() === "https";
}

/** Signs the user in: sets the session cookie. Call from a Server Action or route handler. */
export async function startSession({
  persistent,
  userId,
  role,
  passwordHash,
}: {
  persistent: boolean;
  userId?: string;
  role?: UserRole;
  passwordHash?: string;
}): Promise<void> {
  const token = await encodeSession({ persistent, userId, role }, sessionTokenOptions(passwordHash));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isHttps(),
    // Without maxAge it's a browser-session cookie; the token expires anyway.
    ...(persistent ? { maxAge: SESSION_LIFETIME.persistent } : {}),
  });
}

/**
 * The current session, or null when the request isn't signed in or the user
 * account has been disabled/deleted or had its password changed. Also enters
 * the active user's tenant context (`enterUserContext`) for the request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const decoded = await decryptTokenPayload(token, sessionTokenOptions());
  if (!decoded) return null;

  const { session, pwd } = decoded;
  if (session.userId) {
    const user = await runUnscoped(() => prisma.user.findUnique({ where: { id: session.userId } }));
    if (!user || user.disabledAt !== null) return null;
    if (passwordFingerprint(user.passwordHash) !== pwd) return null;

    enterUserContext({
      userId: user.id,
      role: user.role,
      allowGlobalKeys: user.allowGlobalKeys,
      keyPreference: user.keyPreference,
    });
    return {
      ...session,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      role: user.role,
      allowGlobalKeys: user.allowGlobalKeys,
      keyPreference: user.keyPreference,
    };
  }

  // Legacy token (without userId): resolve or bootstrap the initial ADMIN user when available.
  try {
    await ensureInitialAdmin();
    const admin = await runUnscoped(() =>
      prisma.user.findFirst({
        where: { role: UserRole.ADMIN, disabledAt: null },
        orderBy: { createdAt: "asc" },
      }),
    );
    if (admin) {
      enterUserContext({
        userId: admin.id,
        role: admin.role,
        allowGlobalKeys: admin.allowGlobalKeys,
        keyPreference: admin.keyPreference,
      });
      return {
        ...session,
        userId: admin.id,
        userEmail: admin.email,
        userName: admin.name,
        role: admin.role,
        allowGlobalKeys: admin.allowGlobalKeys,
        keyPreference: admin.keyPreference,
      };
    }
  } catch {
    // In unit tests without a database, fall back to the decoded token.
  }

  return {
    ...session,
    role: session.role ?? UserRole.ADMIN,
  };
});

/**
 * The current session, for pages and layouts: sends the visitor to /login
 * when there is none. Proxy (src/proxy.ts) usually redirects first; this is
 * the check that counts, next to the data.
 */
export async function verifySession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Verifies the visitor is signed in as an ADMIN user; redirects signed-out
 * visitors to /login and non-admin users to /.
 */
export async function verifyAdminSession(): Promise<Session> {
  const session = await verifySession();
  if (session.role && session.role !== UserRole.ADMIN) redirect("/");
  return session;
}

/** Signs the user out: deletes the session cookie (AUTH-7). */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
