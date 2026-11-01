import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { DEFAULT_BASE_THEME, settingsFromRows, settingValue, type SettingsData } from "@/lib/settings";

/**
 * The settings in effect for the active user context. Nothing in the database
 * ties the base theme setting to its theme, so a deleted custom theme reads as
 * Editorial here.
 */
export async function loadSettings(): Promise<SettingsData> {
  const settings = settingsFromRows(await prisma.setting.findMany());
  if (settings.baseThemeId !== DEFAULT_BASE_THEME) {
    const theme = await prisma.theme.findUnique({ where: { id: settings.baseThemeId }, select: { id: true } });
    if (!theme) return { ...settings, baseThemeId: DEFAULT_BASE_THEME };
  }
  return settings;
}

/**
 * Saves the given settings together for the active user context; null removes
 * one, so it reads as not set. Pass a transaction client to save them as part
 * of that transaction.
 */
export async function saveSettings(changes: Partial<SettingsData>, db?: Prisma.TransactionClient): Promise<void> {
  if (!db) return prisma.$transaction((tx) => saveSettings(changes, tx));
  for (const [key, change] of Object.entries(changes)) {
    if (change === undefined) continue;
    const value = settingValue(change);
    if (value === null) await db.setting.deleteMany({ where: { key } });
    else await db.setting.upsert({ where: { userId_key: { userId: "", key } }, create: { key, value }, update: { value } });
  }
}

/**
 * Loads the instance-wide global settings (`userId = ""`), used for admin-configured
 * global AI/job-search keys, default `keyPreference`, backups, and telemetry.
 */
export async function loadGlobalSettings(): Promise<SettingsData> {
  return runUnscoped(async () => {
    const rows = await prisma.setting.findMany({ where: { userId: "" } });
    return settingsFromRows(rows);
  });
}

/**
 * Saves instance-wide global settings (`userId = ""`), bypassing per-user scoping.
 */
export async function saveGlobalSettings(changes: Partial<SettingsData>, db?: Prisma.TransactionClient): Promise<void> {
  return runUnscoped(async () => {
    if (!db) return prisma.$transaction((tx) => saveGlobalSettings(changes, tx));
    for (const [key, change] of Object.entries(changes)) {
      if (change === undefined) continue;
      const value = settingValue(change);
      if (value === null) await db.setting.deleteMany({ where: { userId: "", key } });
      else {
        await db.setting.upsert({
          where: { userId_key: { userId: "", key } },
          create: { userId: "", key, value },
          update: { value },
        });
      }
    }
  });
}

/** Loads a specific user's personal settings. */
export async function loadUserSettings(userId: string): Promise<SettingsData> {
  return runWithUserId(userId, () => loadSettings());
}

/** Saves settings for a specific user (e.g., when an admin updates or clears a user's BYOK keys). */
export async function saveUserSettings(userId: string, changes: Partial<SettingsData>): Promise<void> {
  return runWithUserId(userId, () => saveSettings(changes));
}
