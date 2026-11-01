import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { verifyPassword } from "@/lib/auth/password-hash";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { resetUserCredentials, updateUserAccess } from "./actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Admin user lifecycle actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      persistent: false,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      userId: "admin-1",
      role: UserRole.ADMIN,
    });
  });

  describe("updateUserAccess", () => {
    it("updates a user's normalized email and display name when unique", async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce({
          id: "user-1",
          email: "old@example.com",
          name: "Old Name",
          role: UserRole.USER,
          disabledAt: null,
        } as never)
        .mockResolvedValueOnce(null as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const res = await updateUserAccess({
        userId: "user-1",
        email: "  New@Example.com ",
        name: "New Name",
      });

      expect(res).toEqual({ ok: true, data: null });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          email: "new@example.com",
          name: "New Name",
        },
      });
    });

    it("rejects updating email when another user already has that identifier", async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce({
          id: "user-1",
          email: "old@example.com",
          name: "Old Name",
          role: UserRole.USER,
          disabledAt: null,
        } as never)
        .mockResolvedValueOnce({
          id: "user-2",
          email: "taken@example.com",
        } as never);

      const res = await updateUserAccess({
        userId: "user-1",
        email: "Taken@Example.com",
      });

      expect(res).toEqual({
        ok: false,
        error: "A user with that email or username already exists.",
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe("resetUserCredentials", () => {
    it("directly sets a user's password and clears any pending invite", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "member@example.com",
        passwordHash: "",
        inviteTokenHash: "pending-hash",
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const res = await resetUserCredentials({
        userId: "user-1",
        password: "temp-password-123",
      });

      expect(res).toEqual({
        ok: true,
        data: { invitePath: null },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          passwordHash: expect.stringMatching(/^argon2id:/),
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
      const savedHash = vi.mocked(prisma.user.update).mock.calls[0]![0].data.passwordHash as string;
      expect(await verifyPassword("temp-password-123", savedHash)).toBe(true);
    });

    it("revokes a pending invite without generating a new invite or erasing an existing password", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "member@example.com",
        passwordHash: "existing-hash",
        inviteTokenHash: "pending-hash",
        inviteExpiresAt: new Date(Date.now() + 86_400_000),
      } as never);
      vi.mocked(prisma.user.update).mockResolvedValue({} as never);

      const res = await resetUserCredentials({
        userId: "user-1",
        revokeInvite: true,
      });

      expect(res).toEqual({
        ok: true,
        data: { invitePath: null },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          passwordHash: "existing-hash",
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });
    });
  });
});
