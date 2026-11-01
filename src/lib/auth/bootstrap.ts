import "server-only";

import { type PrismaClient, type User, UserRole } from "@/generated/prisma/client";
import { hashPassword, isPasswordHash } from "@/lib/auth/password-hash";
import { runUnscoped } from "@/lib/auth/user-context";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Settings keys that belong to the instance/global scope (`userId = ""`)
 * rather than an individual user's personal preferences.
 */
export const GLOBAL_SETTING_KEYS = new Set([
  "provider",
  "baseUrl",
  "model",
  "apiKeyEnc",
  "keyPreference",
  "jobSource",
  "jsearchKeyEnc",
  "jsearchHost",
  "adzunaAppId",
  "adzunaKeyEnc",
  "arbeitsagenturAcceptedAt",
  "googleClientId",
  "googleClientSecretEnc",
  "nightlyBackup",
  "backupProblem",
  "jobRetentionHours",
  "updateCheck",
  "latestVersion",
  "latestVersionUrl",
  "updateCheckDay",
  "updateDismissed",
  "usagePingId",
  "usagePingDay",
  "usagePingChoice",
  "usagePingChoiceAt",
  "usagePingChoiceText",
]);

/**
 * Ensures at least one `User` exists in the database. When the `User` table is
 * empty on startup, creates the initial `ADMIN` account from `DOSSIER_PASSWORD`
 * and `DOSSIER_ADMIN_EMAIL` (defaulting to `"admin"`) and claims any legacy
 * unscoped user rows (`userId = ""`) for that administrator.
 */
export async function ensureInitialAdmin(
  db: PrismaClient = prisma,
  options?: { email?: string; passwordHash?: string },
): Promise<User | null> {
  return runUnscoped(async () => {
    const existingCount = await db.user.count();
    if (existingCount > 0) return null;

    const rawEmail = (options?.email ?? env.DOSSIER_ADMIN_EMAIL ?? "admin").trim().toLowerCase() || "admin";
    const rawPassword = options?.passwordHash ?? env.DOSSIER_PASSWORD;
    const passwordHash = isPasswordHash(rawPassword) ? rawPassword : await hashPassword(rawPassword);

    return db.$transaction(async (tx) => {
      const countInTx = await tx.user.count();
      if (countInTx > 0) return null;

      const admin = await tx.user.create({
        data: {
          email: rawEmail,
          name: "Admin",
          passwordHash,
          role: UserRole.ADMIN,
          disabledAt: null,
          allowGlobalKeys: true,
          keyPreference: null,
        },
      });

      const claimWhere = { userId: "" };
      const claimData = { userId: admin.id };

      await tx.profileField.updateMany({ where: claimWhere, data: claimData });
      await tx.skill.updateMany({ where: claimWhere, data: claimData });
      await tx.language.updateMany({ where: claimWhere, data: claimData });
      await tx.experience.updateMany({ where: claimWhere, data: claimData });
      await tx.project.updateMany({ where: claimWhere, data: claimData });
      await tx.education.updateMany({ where: claimWhere, data: claimData });
      await tx.publication.updateMany({ where: claimWhere, data: claimData });
      await tx.reference.updateMany({ where: claimWhere, data: claimData });
      await tx.fact.updateMany({ where: claimWhere, data: claimData });
      await tx.application.updateMany({ where: claimWhere, data: claimData });
      await tx.posting.updateMany({ where: claimWhere, data: claimData });
      await tx.claudePaste.updateMany({ where: claimWhere, data: claimData });
      await tx.agentCandidate.updateMany({ where: claimWhere, data: claimData });
      await tx.postingScore.updateMany({ where: claimWhere, data: claimData });
      await tx.postingSearch.updateMany({ where: claimWhere, data: claimData });
      await tx.startup.updateMany({ where: claimWhere, data: claimData });
      await tx.startupBlock.updateMany({ where: claimWhere, data: claimData });
      await tx.emailMessage.updateMany({ where: claimWhere, data: claimData });
      await tx.job.updateMany({ where: claimWhere, data: claimData });

      await tx.theme.updateMany({
        where: { builtIn: false, userId: "" },
        data: { userId: admin.id },
      });

      await tx.setting.updateMany({
        where: {
          userId: "",
          key: { notIn: [...GLOBAL_SETTING_KEYS] },
        },
        data: claimData,
      });

      const legacyGoogle = await tx.googleAccount.findUnique({ where: { id: "google" } });
      if (legacyGoogle) {
        await tx.googleAccount.update({
          where: { id: "google" },
          data: { id: admin.id },
        });
      }

      return admin;
    });
  });
}
