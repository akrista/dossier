"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KeyPreference, UserRole } from "@/generated/prisma/enums";

import { changeOwnPassword, updateOwnAccount } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export type AccountView = {
  email: string;
  name: string;
  role: UserRole;
  allowGlobalKeys: boolean;
  effectiveKeyPreference: KeyPreference;
};

export function AccountSection({ initial }: { initial: AccountView }) {
  const router = useRouter();
  const track = useTrackSave();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initial.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const keyPolicySummary = !initial.allowGlobalKeys
    ? "Bring Your Own Key (BYOK) required"
    : initial.effectiveKeyPreference === KeyPreference.GLOBAL_FIRST
      ? "Global server keys allowed (Global key first, fallback to personal key)"
      : "Global server keys allowed (Personal key first, fallback to global key)";

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = toastResult(await track(updateOwnAccount({ name })));
      if (!res.ok) return;
      setName(res.data.name);
      toast("Display name saved.");
      router.refresh();
    });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = toastResult(
        await changeOwnPassword({
          currentPassword,
          newPassword,
        }),
      );
      if (!res.ok) return;
      setCurrentPassword("");
      setNewPassword("");
      router.refresh();
    });
  };

  return (
    <>
      <SettingsSectionIntro title="Account">
        Manage your display name and sign-in password. Your login identifier and API key permissions are managed by an administrator.
      </SettingsSectionIntro>

      <Card padding="none" className="px-7 py-2">
        <dl>
          <div className="flex justify-between gap-4 py-3.5 text-sm">
            <dt className="text-muted">Login identifier (read-only)</dt>
            <dd className="text-right font-mono text-[13px] [overflow-wrap:anywhere]">{initial.email}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line py-3.5 text-sm">
            <dt className="text-muted">Role</dt>
            <dd className="text-right font-mono text-[13px]">
              {initial.role === UserRole.ADMIN ? "Administrator (ADMIN)" : "User (USER)"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line py-3.5 text-sm">
            <dt className="text-muted">API key policy</dt>
            <dd className="text-right text-[13px]">{keyPolicySummary}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <form onSubmit={handleSaveName} className="flex flex-col gap-4">
          <Input
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={initial.email}
          />
          <div>
            <Button type="submit" disabled={pending}>
              Save display name
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
          <h3 className="font-serif text-base font-medium">Change password</h3>
          <p className="text-meta text-muted">
            Changing your password keeps this browser signed in and signs out any other devices or active sessions.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
