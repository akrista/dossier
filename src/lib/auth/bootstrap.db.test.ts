import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { ensureInitialAdmin } from "@/lib/auth/bootstrap";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { createTestClient, resetDatabase } from "@/test/db";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("ensureInitialAdmin", () => {
  it("creates an initial ADMIN user when the User table is empty and claims legacy unscoped rows", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    await runUnscoped(async () => {
      await db.profileField.create({ data: { userId: "", key: "name", value: "Jane Doe" } });
      await db.skill.create({ data: { userId: "", name: "TypeScript" } });
      await db.application.create({ data: { userId: "", company: "Acme", role: "Engineer" } });
      await db.theme.create({
        data: { name: "Custom Theme", builtIn: false, userId: "", headFont: "GEIST", bodyFont: "GEIST", accent: "#123456" },
      });
      await db.theme.create({
        data: { id: "editorial", name: "Editorial", builtIn: true, userId: "", headFont: "GEIST", bodyFont: "GEIST", accent: "#000000" },
      });
      await db.setting.createMany({
        data: [
          { userId: "", key: "paper", value: "LETTER" },
          { userId: "", key: "apiKeyEnc", value: "v1.global-key" },
        ],
      });
    });

    const admin = await ensureInitialAdmin(db, { email: "Admin@Example.com", passwordHash: hash });
    expect(admin).not.toBeNull();
    expect(admin?.email).toBe("admin@example.com");
    expect(admin?.role).toBe(UserRole.ADMIN);
    expect(admin?.disabledAt).toBeNull();
    expect(admin?.allowGlobalKeys).toBe(true);
    expect(await verifyPassword("correct-horse-battery-staple", admin!.passwordHash)).toBe(true);

    // Scoped to the newly created admin: legacy profile, skills, applications, personal settings, and custom themes belong to them.
    await runWithUserId(admin!.id, async () => {
      expect(await db.profileField.findUnique({ where: { userId_key: { userId: "", key: "name" } } })).toMatchObject({
        userId: admin!.id,
        value: "Jane Doe",
      });
      expect(await db.skill.count()).toBe(1);
      expect(await db.application.count()).toBe(1);
      expect(await db.setting.findUnique({ where: { userId_key: { userId: "", key: "paper" } } })).toMatchObject({
        userId: admin!.id,
        value: "LETTER",
      });
      const themes = await db.theme.findMany({ orderBy: { name: "asc" } });
      expect(themes.map((t) => ({ name: t.name, userId: t.userId, builtIn: t.builtIn }))).toEqual([
        { name: "Custom Theme", userId: admin!.id, builtIn: false },
        { name: "Editorial", userId: "", builtIn: true },
      ]);
    });

    // Global settings remain at userId = "".
    await runUnscoped(async () => {
      expect(await db.setting.findUnique({ where: { userId_key: { userId: "", key: "apiKeyEnc" } } })).toMatchObject({
        userId: "",
        value: "v1.global-key",
      });
    });

    // Running a second time is a no-op.
    expect(await ensureInitialAdmin(db, { email: "other@example.com", passwordHash: hash })).toBeNull();
    expect(await db.user.count()).toBe(1);
  });
});
