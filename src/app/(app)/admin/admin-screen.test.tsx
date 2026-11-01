import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiProvider, KeyPreference, UserRole } from "@/generated/prisma/enums";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/admin" }));
vi.mock("./actions", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  resetUserCredentials: vi.fn(),
  saveGlobalKeySettings: vi.fn(),
  setUserApiKeys: vi.fn(),
  updateUserAccess: vi.fn(),
}));

import { AdminScreen } from "./admin-screen";

describe("AdminScreen", () => {
  it("renders user list, invite form, and global key settings without exposing secret keys", () => {
    render(
      <AdminScreen
        currentUserId="admin-1"
        initialUsers={[
          {
            id: "admin-1",
            email: "admin@example.com",
            name: "Admin User",
            role: UserRole.ADMIN,
            allowGlobalKeys: true,
            keyPreference: null,
            disabled: false,
            hasPassword: true,
            invitePending: false,
            aiProvider: AiProvider.OPENAI,
            aiKeyState: "set",
            jsearchKeyState: "none",
            adzunaAppId: "",
            adzunaKeyState: "none",
            lastSignInAt: "2026-10-31T10:00:00.000Z",
            applicationCount: 7,
            createdAt: "2026-10-30T00:00:00.000Z",
          },
          {
            id: "user-1",
            email: "member@example.com",
            name: "Member User",
            role: UserRole.USER,
            allowGlobalKeys: false,
            keyPreference: KeyPreference.USER_FIRST,
            disabled: false,
            hasPassword: false,
            invitePending: true,
            aiProvider: null,
            aiKeyState: "none",
            jsearchKeyState: "set",
            adzunaAppId: "",
            adzunaKeyState: "none",
            lastSignInAt: null,
            applicationCount: 0,
            createdAt: "2026-10-31T00:00:00.000Z",
          },
        ]}
        initialGlobal={{
          keyPreference: KeyPreference.USER_FIRST,
          ai: {
            provider: AiProvider.ANTHROPIC,
            baseUrl: "https://api.anthropic.com",
            model: "claude-sonnet-5",
            keyState: "set",
          },
          jobSearch: {
            source: "JSEARCH",
            jsearch: { host: "openwebninja", keyState: "set" },
            adzuna: { appId: "", keyState: "none" },
            arbeitsagentur: { offered: true, acceptedAt: null },
            freehire: { host: "freehire.me" },
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invite or create user" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Users (2)" })).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("Member User")).toBeInTheDocument();
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear global AI key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear global JSearch key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Global keys & failover policy" })).toBeInTheDocument();
  });
});
