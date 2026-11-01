import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runUnscoped, runWithUserId } from "@/lib/auth/user-context";
import { createTestClient, resetDatabase } from "@/test/db";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("per-user Prisma tenant scoping", () => {
  it("isolates profile fields, skills, applications, settings, and custom themes between users", async () => {
    await runUnscoped(async () => {
      await db.theme.create({
        data: { id: "editorial", name: "Editorial", builtIn: true, headFont: "GEIST", bodyFont: "GEIST", accent: "#000000" },
      });
    });

    await runWithUserId("alice", async () => {
      await db.profileField.upsert({
        where: { userId_key: { userId: "", key: "name" } },
        create: { key: "name", value: "Alice" },
        update: { value: "Alice" },
      });
      await db.skill.create({ data: { name: "Rust" } });
      await db.application.create({ data: { company: "Acme", role: "Designer" } });
      await db.setting.upsert({
        where: { userId_key: { userId: "", key: "paper" } },
        create: { key: "paper", value: "LETTER" },
        update: { value: "LETTER" },
      });
      await db.theme.create({
        data: { name: "Alice Theme", headFont: "GEIST", bodyFont: "GEIST", accent: "#ff0000" },
      });
    });

    await runWithUserId("bob", async () => {
      // Bob sees none of Alice's data, and can create rows with identical keys/names without conflict.
      expect(await db.profileField.count()).toBe(0);
      expect(await db.skill.count()).toBe(0);
      expect(await db.application.count()).toBe(0);
      expect(await db.setting.count()).toBe(0);

      await db.profileField.upsert({
        where: { userId_key: { userId: "", key: "name" } },
        create: { key: "name", value: "Bob" },
        update: { value: "Bob" },
      });
      await db.skill.create({ data: { name: "Rust" } });
      await db.application.create({ data: { company: "Beta", role: "Engineer" } });

      // Bob sees the built-in theme, but not Alice's custom theme.
      const themes = await db.theme.findMany();
      expect(themes.map((t) => t.name)).toEqual(["Editorial"]);
    });

    await runWithUserId("alice", async () => {
      expect((await db.profileField.findUniqueOrThrow({ where: { userId_key: { userId: "", key: "name" } } })).value).toBe("Alice");
      expect((await db.application.findMany()).map((a) => a.company)).toEqual(["Acme"]);
      const themes = await db.theme.findMany({ orderBy: { name: "asc" } });
      expect(themes.map((t) => t.name)).toEqual(["Alice Theme", "Editorial"]);
    });
  });
});
