"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { UserRole } from "@/generated/prisma/enums";
import { ActionError, publicAction } from "@/lib/action";
import { ensureInitialAdmin } from "@/lib/auth/bootstrap";
import { clientIp } from "@/lib/auth/client-ip";
import { hashInviteToken } from "@/lib/auth/invite";
import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { safeNextPath } from "@/lib/auth/next-path";
import { hashPassword } from "@/lib/auth/password-hash";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { loginMessages } from "./messages";

/**
 * Signs in a user by email/username and password (or falls back to the initial
 * ADMIN account when identifier is omitted). Failed attempts are rate-limited
 * per IP and globally (AUTH-5).
 */
export const signIn = publicAction(
  z.object({
    identifier: z.string().optional(),
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ identifier, password, remember, next }, { toast }) => {
    const ip = clientIp(await headers());
    const wait = await loginWaitMs(prisma, ip);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    if (!password) throw new ActionError(loginMessages.empty);

    const normalizedId = identifier?.trim().toLowerCase() ?? "";
    const hasUserTable = Boolean((prisma as { user?: unknown }).user);

    if (hasUserTable) {
      await ensureInitialAdmin();
      const user = await runUnscoped(() =>
        normalizedId
          ? prisma.user.findUnique({ where: { email: normalizedId } })
          : prisma.user.findFirst({ where: { role: UserRole.ADMIN, disabledAt: null }, orderBy: { createdAt: "asc" } }),
      );

      if (!user || user.disabledAt !== null || !user.passwordHash || !(await passwordMatches(password, user.passwordHash))) {
        await recordLoginFailure(prisma, ip);
        throw new ActionError(loginMessages.wrong);
      }

      await recordLoginSuccess(prisma, ip);
      await runUnscoped(() =>
        prisma.user.update({
          where: { id: user.id },
          data: { lastSignInAt: new Date() },
        }),
      );
      await startSession({
        persistent: remember,
        userId: user.id,
        role: user.role,
        passwordHash: user.passwordHash,
      });

      const profileName = await runWithUserId(user.id, () => loadProfileName());
      const firstName = (profileName || user.name).trim().split(/\s+/)[0] || "there";
      toast(`Welcome back, ${firstName}.`);
      return { redirectTo: safeNextPath(next) };
    }

    if (!(await passwordMatches(password))) {
      await recordLoginFailure(prisma, ip);
      throw new ActionError(loginMessages.wrong);
    }
    await recordLoginSuccess(prisma, ip);

    await startSession({ persistent: remember });
    const firstName = (await loadProfileName()).trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);

/**
 * Completes a one-time invitation link by setting the user's password and
 * signing them in immediately.
 */
export const acceptInvite = publicAction(
  z.object({
    token: z.string().min(1),
    name: z.string().trim().max(120).optional(),
    password: z.string().min(8, "Use at least 8 characters."),
  }),
  async ({ token, name, password }, { toast }) => {
    const tokenHash = hashInviteToken(token);
    const now = new Date();

    const user = await runUnscoped(() => prisma.user.findUnique({ where: { inviteTokenHash: tokenHash } }));
    if (!user || user.disabledAt !== null || !user.inviteExpiresAt || user.inviteExpiresAt <= now) {
      throw new ActionError(loginMessages.invalidInvite);
    }

    const passwordHash = await hashPassword(password);
    const updated = await runUnscoped(() =>
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          lastSignInAt: now,
          ...(name ? { name } : {}),
        },
      }),
    );

    await startSession({
      persistent: true,
      userId: updated.id,
      role: updated.role,
      passwordHash: updated.passwordHash,
    });

    const firstName = updated.name.trim().split(/\s+/)[0] || "there";
    toast(`Welcome, ${firstName}.`);
    return { redirectTo: "/" };
  },
);

/** What the sign-in form shows after a submit that `signInWithForm` handled. */
export type SignInFormState = { error: string } | null;

/**
 * `signIn` for the form's own submit, which the browser makes before the
 * page's scripts have run or when they're off (#187).
 */
export async function signInWithForm(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const identifier = text(form, "identifier").trim();
  const result = await signIn({
    ...(identifier ? { identifier } : {}),
    password: text(form, "password"),
    remember: form.get("remember") === "on",
    next: text(form, "next") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(result.data.redirectTo);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
