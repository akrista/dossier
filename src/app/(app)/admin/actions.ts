"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AiProvider, KeyPreference, UserRole } from "@/generated/prisma/enums";
import { ActionError, adminAction } from "@/lib/action";
import { applyApiKeyChange } from "@/lib/ai/api-key";
import { createInviteToken } from "@/lib/auth/invite";
import { hashPassword } from "@/lib/auth/password-hash";
import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { disconnectGoogle } from "@/lib/google/account";
import { JOB_SOURCES, JSEARCH_HOSTS } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { applySecretChange, JOB_SOURCE_KEY } from "@/lib/secrets";
import { loadGlobalSettings, loadUserSettings, saveGlobalSettings, saveUserSettings } from "@/lib/settings-data";

async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  return runUnscoped(() =>
    prisma.user.count({
      where: {
        role: UserRole.ADMIN,
        disabledAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    }),
  );
}

/**
 * Creates a new user account with either a direct password or a one-time
 * invitation link (`/login/invite?token=...`).
 */
export const createUser = adminAction(
  z.object({
    email: z.string().trim().min(1, "Enter an email or username.").max(200),
    name: z.string().trim().max(120).optional(),
    role: z.enum(UserRole).default(UserRole.USER),
    allowGlobalKeys: z.boolean().default(false),
    keyPreference: z.enum(KeyPreference).nullable().optional(),
    password: z.string().min(8, "Use at least 8 characters.").optional(),
  }),
  async ({ email, name, role, allowGlobalKeys, keyPreference, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await runUnscoped(() => prisma.user.findUnique({ where: { email: normalizedEmail } }));
    if (existing) throw new ActionError("A user with that email or username already exists.");

    const passwordHash = password ? await hashPassword(password) : "";
    const invite = password ? null : createInviteToken();

    const created = await runUnscoped(() =>
      prisma.user.create({
        data: {
          email: normalizedEmail,
          name: name?.trim() || normalizedEmail,
          role,
          allowGlobalKeys,
          keyPreference: keyPreference ?? null,
          passwordHash,
          inviteTokenHash: invite?.tokenHash ?? null,
          inviteExpiresAt: invite?.expiresAt ?? null,
        },
      }),
    );

    revalidatePath("/admin");
    return {
      userId: created.id,
      invitePath: invite ? `/login/invite?token=${invite.token}` : null,
    };
  },
);

/**
 * Updates a user's role, `allowGlobalKeys`, `keyPreference`, or enabled/disabled status.
 * Refuses to disable or demote the last active `ADMIN`.
 */
export const updateUserAccess = adminAction(
  z.object({
    userId: z.string().min(1),
    email: z.string().trim().min(1, "Enter an email or username.").max(200).optional(),
    name: z.string().trim().max(120).optional(),
    role: z.enum(UserRole).optional(),
    allowGlobalKeys: z.boolean().optional(),
    keyPreference: z.enum(KeyPreference).nullable().optional(),
    disabled: z.boolean().optional(),
  }),
  async ({ userId, email, name, role, allowGlobalKeys, keyPreference, disabled }) => {
    const target = await runUnscoped(() => prisma.user.findUnique({ where: { id: userId } }));
    if (!target) throw new ActionError("User not found.");

    const normalizedEmail = email !== undefined ? email.trim().toLowerCase() : undefined;
    if (normalizedEmail !== undefined && normalizedEmail !== target.email) {
      const existing = await runUnscoped(() => prisma.user.findUnique({ where: { email: normalizedEmail } }));
      if (existing && existing.id !== target.id) {
        throw new ActionError("A user with that email or username already exists.");
      }
    }

    const wasActiveAdmin = target.role === UserRole.ADMIN && target.disabledAt === null;
    const willBeRole = role ?? target.role;
    const willBeDisabled = disabled !== undefined ? disabled : target.disabledAt !== null;
    const willBeActiveAdmin = willBeRole === UserRole.ADMIN && !willBeDisabled;

    if (wasActiveAdmin && !willBeActiveAdmin) {
      const otherAdmins = await countActiveAdmins(target.id);
      if (otherAdmins === 0) {
        throw new ActionError("You cannot disable or demote the last active administrator.");
      }
    }

    const effectiveEmail = normalizedEmail ?? target.email;

    await runUnscoped(() =>
      prisma.user.update({
        where: { id: userId },
        data: {
          ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
          ...(name !== undefined ? { name: name || effectiveEmail } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(allowGlobalKeys !== undefined ? { allowGlobalKeys } : {}),
          ...(keyPreference !== undefined ? { keyPreference } : {}),
          ...(disabled !== undefined ? { disabledAt: disabled ? new Date() : null } : {}),
        },
      }),
    );

    revalidatePath("/admin");
    return null;
  },
);

/**
 * Resets a user's password directly, generates a fresh one-time invite link,
 * or revokes an unaccepted pending invite link.
 */
export const resetUserCredentials = adminAction(
  z.object({
    userId: z.string().min(1),
    password: z.string().min(8, "Use at least 8 characters.").optional(),
    revokeInvite: z.boolean().optional(),
  }),
  async ({ userId, password, revokeInvite }) => {
    const target = await runUnscoped(() => prisma.user.findUnique({ where: { id: userId } }));
    if (!target) throw new ActionError("User not found.");

    const passwordHash = password ? await hashPassword(password) : target.passwordHash;
    const invite = password || revokeInvite ? null : createInviteToken();

    await runUnscoped(() =>
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          inviteTokenHash: invite?.tokenHash ?? null,
          inviteExpiresAt: invite?.expiresAt ?? null,
        },
      }),
    );

    revalidatePath("/admin");
    return {
      invitePath: invite ? `/login/invite?token=${invite.token}` : null,
    };
  },
);

/**
 * Deletes a user account and all of their isolated records and settings.
 * Refuses to delete the last active `ADMIN`.
 */
export const deleteUser = adminAction(
  z.object({
    userId: z.string().min(1),
  }),
  async ({ userId }) => {
    const target = await runUnscoped(() => prisma.user.findUnique({ where: { id: userId } }));
    if (!target) throw new ActionError("User not found.");

    if (target.role === UserRole.ADMIN && target.disabledAt === null) {
      const otherAdmins = await countActiveAdmins(target.id);
      if (otherAdmins === 0) {
        throw new ActionError("You cannot delete the last active administrator.");
      }
    }

    await runWithUserId(userId, () => disconnectGoogle().catch(() => {}));

    await runUnscoped(() =>
      prisma.$transaction(async (tx) => {
        await tx.job.deleteMany({ where: { userId } });
        await tx.posting.deleteMany({ where: { userId } });
        await tx.postingSearch.deleteMany({ where: { userId } });
        await tx.claudePaste.deleteMany({ where: { userId } });
        await tx.agentCandidate.deleteMany({ where: { userId } });
        await tx.postingScore.deleteMany({ where: { userId } });
        await tx.startup.deleteMany({ where: { userId } });
        await tx.startupBlock.deleteMany({ where: { userId } });
        await tx.emailMessage.deleteMany({ where: { userId } });
        await tx.application.deleteMany({ where: { userId } });
        await tx.experience.deleteMany({ where: { userId } });
        await tx.project.deleteMany({ where: { userId } });
        await tx.skill.deleteMany({ where: { userId } });
        await tx.language.deleteMany({ where: { userId } });
        await tx.education.deleteMany({ where: { userId } });
        await tx.publication.deleteMany({ where: { userId } });
        await tx.reference.deleteMany({ where: { userId } });
        await tx.fact.deleteMany({ where: { userId } });
        await tx.profileField.deleteMany({ where: { userId } });
        await tx.theme.deleteMany({ where: { userId, builtIn: false } });
        await tx.setting.deleteMany({ where: { userId } });
        await tx.googleAccount.deleteMany({ where: { id: userId } });
        await tx.user.delete({ where: { id: userId } });
      }),
    );

    revalidatePath("/admin");
    return null;
  },
);

/**
 * Allows an administrator to directly set or clear a specific user's BYOK AI or
 * job-search keys without exposing stored plaintext keys.
 */
export const setUserApiKeys = adminAction(
  z.object({
    userId: z.string().min(1),
    aiProvider: z.enum(AiProvider).optional(),
    aiKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
    jsearchKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
    adzunaAppId: z.string().trim().max(200).optional(),
    adzunaKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
  }),
  async ({ userId, aiProvider, aiKey, jsearchKey, adzunaAppId, adzunaKey }) => {
    const target = await runUnscoped(() => prisma.user.findUnique({ where: { id: userId } }));
    if (!target) throw new ActionError("User not found.");

    const current = await loadUserSettings(userId);
    await saveUserSettings(userId, {
      ...(aiProvider !== undefined ? { provider: aiProvider } : {}),
      ...(aiKey !== undefined ? { apiKeyEnc: applyApiKeyChange(current.apiKeyEnc, aiKey) } : {}),
      ...(jsearchKey !== undefined ? { jsearchKeyEnc: applySecretChange(JOB_SOURCE_KEY, current.jsearchKeyEnc, jsearchKey) } : {}),
      ...(adzunaAppId !== undefined ? { adzunaAppId: adzunaAppId || null } : {}),
      ...(adzunaKey !== undefined ? { adzunaKeyEnc: applySecretChange(JOB_SOURCE_KEY, current.adzunaKeyEnc, adzunaKey) } : {}),
    });

    revalidatePath("/admin");
    return null;
  },
);

/**
 * Updates the instance-wide global AI configuration, global job-search keys,
 * and default `keyPreference` (`USER_FIRST` vs `GLOBAL_FIRST`).
 */
export const saveGlobalKeySettings = adminAction(
  z.object({
    keyPreference: z.enum(KeyPreference).optional(),
    aiProvider: z.enum(AiProvider).optional(),
    aiBaseUrl: z.string().trim().max(500).optional(),
    aiModel: z.string().trim().max(200).optional(),
    aiKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
    jobSource: z.enum([...JOB_SOURCES, "OFF"]).optional(),
    jsearchHost: z.enum(JSEARCH_HOSTS).optional(),
    jsearchKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
    adzunaAppId: z.string().trim().max(200).optional(),
    adzunaKey: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
        z.object({ action: z.literal("clear") }),
      ])
      .optional(),
  }),
  async (input) => {
    const current = await loadGlobalSettings();
    await saveGlobalSettings({
      ...(input.keyPreference !== undefined ? { keyPreference: input.keyPreference } : {}),
      ...(input.aiProvider !== undefined ? { provider: input.aiProvider } : {}),
      ...(input.aiBaseUrl !== undefined ? { baseUrl: input.aiBaseUrl || null } : {}),
      ...(input.aiModel !== undefined ? { model: input.aiModel || null } : {}),
      ...(input.aiKey !== undefined ? { apiKeyEnc: applyApiKeyChange(current.apiKeyEnc, input.aiKey) } : {}),
      ...(input.jobSource !== undefined ? { jobSource: input.jobSource } : {}),
      ...(input.jsearchHost !== undefined ? { jsearchHost: input.jsearchHost } : {}),
      ...(input.jsearchKey !== undefined ? { jsearchKeyEnc: applySecretChange(JOB_SOURCE_KEY, current.jsearchKeyEnc, input.jsearchKey) } : {}),
      ...(input.adzunaAppId !== undefined ? { adzunaAppId: input.adzunaAppId || null } : {}),
      ...(input.adzunaKey !== undefined ? { adzunaKeyEnc: applySecretChange(JOB_SOURCE_KEY, current.adzunaKeyEnc, input.adzunaKey) } : {}),
    });

    revalidatePath("/admin");
    return null;
  },
);
