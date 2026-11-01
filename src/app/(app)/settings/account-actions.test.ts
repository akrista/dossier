import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { getSession, passwordMatches, startSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { changeOwnPassword, updateOwnAccount } from "./actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  passwordMatches: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("Settings → Account self-service actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      persistent: true,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      userId: "user-1",
      userEmail: "alex@example.com",
      userName: "Alex",
      role: "USER",
    });
  });

  describe("updateOwnAccount", () => {
    it("updates the signed-in user's display name", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "alex@example.com",
        name: "Alex",
      } as never);
      vi.mocked(prisma.user.update).mockImplementation((async ({ data }: { data: { name: string } }) => ({
        id: "user-1",
        email: "alex@example.com",
        name: data.name,
      })) as never);

      const res = await updateOwnAccount({ name: "  Alex Rivera  " });
      expect(res).toEqual({
        ok: true,
        data: { name: "Alex Rivera" },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { name: "Alex Rivera" },
      });
    });

    it("falls back to the user's email when display name is cleared", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "alex@example.com",
        name: "Alex Rivera",
      } as never);
      vi.mocked(prisma.user.update).mockImplementation((async ({ data }: { data: { name: string } }) => ({
        id: "user-1",
        email: "alex@example.com",
        name: data.name,
      })) as never);

      const res = await updateOwnAccount({ name: "   " });
      expect(res).toEqual({
        ok: true,
        data: { name: "alex@example.com" },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { name: "alex@example.com" },
      });
    });
  });

  describe("changeOwnPassword", () => {
    it("verifies current password, saves new hash, and rotates the active session cookie", async () => {
      const oldHash = await hashPassword("old-password-123");
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "alex@example.com",
        name: "Alex",
        role: "USER",
        passwordHash: oldHash,
      } as never);
      vi.mocked(passwordMatches).mockImplementation((candidate, stored) => verifyPassword(candidate, stored!));
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const res = await changeOwnPassword({
        currentPassword: "old-password-123",
        newPassword: "new-password-456",
      });

      expect(res).toEqual({
        ok: true,
        data: null,
        toast: "Password updated.",
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          passwordHash: expect.stringMatching(/^argon2id:/),
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
      const updatedHash = vi.mocked(prisma.user.update).mock.calls[0]![0].data.passwordHash as string;
      expect(await verifyPassword("new-password-456", updatedHash)).toBe(true);
      expect(startSession).toHaveBeenCalledWith({
        persistent: true,
        userId: "user-1",
        role: "USER",
        passwordHash: updatedHash,
      });
    });

    it("rejects password change when current password does not match", async () => {
      const oldHash = await hashPassword("old-password-123");
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "alex@example.com",
        name: "Alex",
        role: "USER",
        passwordHash: oldHash,
      } as never);
      vi.mocked(passwordMatches).mockImplementation((candidate, stored) => verifyPassword(candidate, stored!));

      const res = await changeOwnPassword({
        currentPassword: "wrong-password",
        newPassword: "new-password-456",
      });

      expect(res).toEqual({
        ok: false,
        error: "Your current password didn't match.",
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(startSession).not.toHaveBeenCalled();
    });
  });
});
