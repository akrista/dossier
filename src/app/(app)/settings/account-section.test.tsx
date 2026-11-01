import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KeyPreference, UserRole } from "@/generated/prisma/enums";

import { AccountSection } from "./account-section";
import { changeOwnPassword, updateOwnAccount } from "./actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("./actions", () => ({
  updateOwnAccount: vi.fn(),
  changeOwnPassword: vi.fn(),
}));

describe("AccountSection", () => {
  it("displays read-only login identifier, role, and key policy, and allows updating display name and password", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOwnAccount).mockResolvedValue({ ok: true, data: { name: "Alex Rivera" } });
    vi.mocked(changeOwnPassword).mockResolvedValue({ ok: true, data: null, toast: "Password updated." });

    render(
      <AccountSection
        initial={{
          email: "alex@example.com",
          name: "Alex",
          role: UserRole.USER,
          allowGlobalKeys: false,
          effectiveKeyPreference: KeyPreference.USER_FIRST,
        }}
      />,
    );

    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("User (USER)")).toBeInTheDocument();
    expect(screen.getByText("Bring Your Own Key (BYOK) required")).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Display name");
    await user.clear(nameInput);
    await user.type(nameInput, "Alex Rivera");
    await user.click(screen.getByRole("button", { name: "Save display name" }));
    expect(updateOwnAccount).toHaveBeenCalledWith({ name: "Alex Rivera" });

    await user.type(screen.getByLabelText(/Current password/), "old-password-123");
    await user.type(screen.getByLabelText(/New password/), "new-password-456");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(changeOwnPassword).toHaveBeenCalledWith({
      currentPassword: "old-password-123",
      newPassword: "new-password-456",
    });
  });
});
