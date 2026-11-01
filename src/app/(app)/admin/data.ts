import "server-only";

import type { AiProvider, KeyPreference, UserRole } from "@/generated/prisma/enums";
import { apiKeyState } from "@/lib/ai/api-key";
import { keyStateOf, resolveAiConfig } from "@/lib/ai/config";
import type { AiSettingsView, KeyState } from "@/lib/ai/provider-options";
import { runUnscoped } from "@/lib/auth/user-context";
import { env } from "@/lib/env";
import { jobSearchView, resolveJobSearchConfig } from "@/lib/job-search/config";
import type { JobKeyState, JobSearchSettingsView } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { decryptSecret, JOB_SOURCE_KEY, SecretUnreadable } from "@/lib/secrets";
import { loadGlobalSettings, loadUserSettings } from "@/lib/settings-data";

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  allowGlobalKeys: boolean;
  keyPreference: KeyPreference | null;
  disabled: boolean;
  hasPassword: boolean;
  invitePending: boolean;
  aiProvider: AiProvider | null;
  aiKeyState: KeyState;
  jsearchKeyState: JobKeyState;
  adzunaAppId: string;
  adzunaKeyState: JobKeyState;
  lastSignInAt: string | null;
  applicationCount: number;
  createdAt: string;
};

export type AdminGlobalSettingsSummary = {
  keyPreference: KeyPreference;
  ai: AiSettingsView;
  jobSearch: JobSearchSettingsView;
};

function jobKeyStateOf(stored: string | null): JobKeyState {
  if (!stored) return "none";
  try {
    decryptSecret(JOB_SOURCE_KEY, stored);
    return "set";
  } catch (error) {
    if (error instanceof SecretUnreadable) return "unreadable";
    throw error;
  }
}

/**
 * Loads all users along with their non-secret BYOK key states and the global
 * AI/job-search key configuration for `/admin`.
 */
export async function loadAdminDashboardData(): Promise<{
  users: AdminUserSummary[];
  globalSettings: AdminGlobalSettingsSummary;
}> {
  const [users, appCounts] = await runUnscoped(() =>
    Promise.all([
      prisma.user.findMany({
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      }),
      prisma.application.groupBy({
        by: ["userId"],
        where: { awaitingReview: false },
        _count: { _all: true },
      }),
    ]),
  );

  const countByUserId = new Map<string, number>();
  for (const row of appCounts) {
    countByUserId.set(row.userId, row._count._all);
  }

  const now = new Date();
  const summaries: AdminUserSummary[] = [];
  for (const user of users) {
    const settings = await loadUserSettings(user.id);
    summaries.push({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      allowGlobalKeys: user.allowGlobalKeys,
      keyPreference: user.keyPreference,
      disabled: user.disabledAt !== null,
      hasPassword: Boolean(user.passwordHash),
      invitePending: Boolean(user.inviteTokenHash && user.inviteExpiresAt && user.inviteExpiresAt > now),
      aiProvider: settings.provider,
      aiKeyState: settings.apiKeyEnc ? apiKeyState(settings.apiKeyEnc) : "none",
      jsearchKeyState: jobKeyStateOf(settings.jsearchKeyEnc),
      adzunaAppId: settings.adzunaAppId ?? "",
      adzunaKeyState: jobKeyStateOf(settings.adzunaKeyEnc),
      lastSignInAt: user.lastSignInAt ? user.lastSignInAt.toISOString() : null,
      applicationCount: countByUserId.get(user.id) ?? 0,
      createdAt: user.createdAt.toISOString(),
    });
  }

  const globalSaved = await loadGlobalSettings();
  const resolvedGlobalAi = resolveAiConfig(globalSaved, env);
  const resolvedGlobalJobs = resolveJobSearchConfig(globalSaved, env);

  return {
    users: summaries,
    globalSettings: {
      keyPreference: globalSaved.keyPreference,
      ai: {
        provider: resolvedGlobalAi.provider,
        baseUrl: resolvedGlobalAi.baseUrl,
        model: resolvedGlobalAi.model ?? "",
        keyState: keyStateOf(globalSaved, resolvedGlobalAi),
      },
      jobSearch: jobSearchView(resolvedGlobalJobs),
    },
  };
}
