import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AiProvider, KeyPreference, UserRole } from "@/generated/prisma/enums";
import { verifyPassword } from "@/lib/auth/password-hash";
import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const sessionState = vi.hoisted(() => ({
  userId: "admin-1",
  role: "ADMIN" as UserRole,
  allowGlobalKeys: true,
  keyPreference: null as KeyPreference | null,
}));

vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    persistent: false,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    userId: sessionState.userId,
    role: sessionState.role,
    allowGlobalKeys: sessionState.allowGlobalKeys,
    keyPreference: sessionState.keyPreference,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_DATA_DIR: "/tmp" },
}));

import {
  createUser,
  deleteUser,
  resetUserCredentials,
  saveGlobalKeySettings,
  setUserApiKeys,
  updateUserAccess,
} from "./actions";
import { loadAdminDashboardData } from "./data";

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  sessionState.userId = "admin-1";
  sessionState.role = UserRole.ADMIN;
  sessionState.allowGlobalKeys = true;
  sessionState.keyPreference = null;

  await runUnscoped(() =>
    prisma().user.create({
      data: {
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin One",
        passwordHash: "hashed-pw",
        role: UserRole.ADMIN,
        allowGlobalKeys: true,
      },
    }),
  );
});

afterAll(async () => prisma().$disconnect());

describe("Admin actions (Task 5.1)", () => {
  it("rejects calls when the signed-in user is not an ADMIN", async () => {
    sessionState.role = UserRole.USER;
    const res = await createUser({
      email: "bob@example.com",
      role: UserRole.USER,
      allowGlobalKeys: false,
    });
    expect(res).toEqual({
      ok: false,
      error: "Only an administrator can do that.",
    });
  });

  it("creates users with either a direct password or a one-time invite link", async () => {
    const invited = await createUser({
      email: "Alice@Example.com",
      name: "Alice",
      role: UserRole.USER,
      allowGlobalKeys: true,
      keyPreference: KeyPreference.USER_FIRST,
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;
    expect(invited.data.invitePath).toMatch(/^\/login\/invite\?token=[A-Za-z0-9_-]+$/);

    const direct = await createUser({
      email: "bob@example.com",
      name: "Bob",
      role: UserRole.USER,
      allowGlobalKeys: false,
      password: "super-secret-password",
    });
    expect(direct).toEqual({
      ok: true,
      data: { userId: expect.any(String), invitePath: null },
    });
    if (!direct.ok) return;

    const bob = await runUnscoped(() => prisma().user.findUniqueOrThrow({ where: { id: direct.data.userId } }));
    expect(await verifyPassword("super-secret-password", bob.passwordHash)).toBe(true);
  });

  it("protects the last active ADMIN from being disabled, demoted, or deleted", async () => {
    expect(await updateUserAccess({ userId: "admin-1", disabled: true })).toEqual({
      ok: false,
      error: "You cannot disable or demote the last active administrator.",
    });
    expect(await updateUserAccess({ userId: "admin-1", role: UserRole.USER })).toEqual({
      ok: false,
      error: "You cannot disable or demote the last active administrator.",
    });
    expect(await deleteUser({ userId: "admin-1" })).toEqual({
      ok: false,
      error: "You cannot delete the last active administrator.",
    });
  });

  it("updates user access flags, resets credentials, and deletes non-last users with their data", async () => {
    const created = await createUser({
      email: "member@example.com",
      role: UserRole.USER,
      allowGlobalKeys: false,
      password: "initial-password-123",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const userId = created.data.userId;

    await runWithUserId(userId, async () => {
      await prisma().application.create({ data: { company: "Acme", role: "Designer" } });
      await prisma().skill.create({ data: { name: "Figma" } });
    });

    expect(
      await updateUserAccess({
        userId,
        allowGlobalKeys: true,
        keyPreference: KeyPreference.GLOBAL_FIRST,
        disabled: true,
      }),
    ).toEqual({ ok: true, data: null });

    const reset = await resetUserCredentials({ userId });
    expect(reset.ok).toBe(true);
    if (reset.ok) expect(reset.data.invitePath).toMatch(/^\/login\/invite\?token=/);

    expect(await deleteUser({ userId })).toEqual({ ok: true, data: null });
    expect(await runUnscoped(() => prisma().user.findUnique({ where: { id: userId } }))).toBeNull();
    expect(await runUnscoped(() => prisma().application.count({ where: { userId } }))).toBe(0);
    expect(await runUnscoped(() => prisma().skill.count({ where: { userId } }))).toBe(0);
  });

  it("sets and clears a specific user's BYOK keys and global keys without exposing plaintext", async () => {
    const created = await createUser({
      email: "byok@example.com",
      role: UserRole.USER,
      allowGlobalKeys: true,
    });
    if (!created.ok) throw new Error(created.error);
    const userId = created.data.userId;

    expect(
      await setUserApiKeys({
        userId,
        aiProvider: AiProvider.OPENAI,
        aiKey: { action: "set", value: "sk-user-secret" },
        jsearchKey: { action: "set", value: "ak-user-jsearch" },
      }),
    ).toEqual({ ok: true, data: null });

    expect(
      await saveGlobalKeySettings({
        keyPreference: KeyPreference.GLOBAL_FIRST,
        aiProvider: AiProvider.ANTHROPIC,
        aiModel: "claude-sonnet-5",
        aiKey: { action: "set", value: "sk-global-secret" },
        jobSource: "JSEARCH",
        jsearchKey: { action: "set", value: "ak-global-jsearch" },
      }),
    ).toEqual({ ok: true, data: null });

    const dashboard = await loadAdminDashboardData();
    const userSummary = dashboard.users.find((u) => u.id === userId)!;
    expect(userSummary).toMatchObject({
      aiProvider: AiProvider.OPENAI,
      aiKeyState: "set",
      jsearchKeyState: "set",
    });
    expect(JSON.stringify(dashboard)).not.toContain("sk-user-secret");
    expect(JSON.stringify(dashboard)).not.toContain("sk-global-secret");
    expect(dashboard.globalSettings).toMatchObject({
      keyPreference: KeyPreference.GLOBAL_FIRST,
      ai: {
        provider: AiProvider.ANTHROPIC,
        model: "claude-sonnet-5",
        keyState: "set",
      },
      jobSearch: {
        source: "JSEARCH",
        jsearch: { keyState: "set" },
      },
    });
  });
});
