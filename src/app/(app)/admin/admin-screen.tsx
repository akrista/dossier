"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { AiProvider, KeyPreference, UserRole } from "@/generated/prisma/enums";
import { PROVIDER_OPTIONS } from "@/lib/ai/provider-options";
import { JOB_SOURCES, JSEARCH_HOSTS, type JobSource } from "@/lib/job-search/search";

import {
  createUser,
  deleteUser,
  resetUserCredentials,
  saveGlobalKeySettings,
  setUserApiKeys,
  updateUserAccess,
} from "./actions";
import type { AdminGlobalSettingsSummary, AdminUserSummary } from "./data";

export function AdminScreen({
  initialUsers,
  initialGlobal,
  currentUserId,
}: {
  initialUsers: AdminUserSummary[];
  initialGlobal: AdminGlobalSettingsSummary;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // New user form state
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>(UserRole.USER);
  const [newAllowGlobal, setNewAllowGlobal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  // Global key settings state
  const [globalPref, setGlobalPref] = useState<KeyPreference>(initialGlobal.keyPreference);
  const [globalAiProvider, setGlobalAiProvider] = useState<AiProvider>(initialGlobal.ai.provider);
  const [globalAiUrl, setGlobalAiUrl] = useState(initialGlobal.ai.baseUrl);
  const [globalAiModel, setGlobalAiModel] = useState(initialGlobal.ai.model);
  const [globalAiKey, setGlobalAiKey] = useState("");
  const [globalJobSource, setGlobalJobSource] = useState<JobSource | "OFF">(initialGlobal.jobSearch.source);
  const [globalJsearchHost, setGlobalJsearchHost] = useState(initialGlobal.jobSearch.jsearch.host);
  const [globalJsearchKey, setGlobalJsearchKey] = useState("");
  const [globalAdzunaAppId, setGlobalAdzunaAppId] = useState(initialGlobal.jobSearch.adzuna.appId);
  const [globalAdzunaKey, setGlobalAdzunaKey] = useState("");

  // Per-user editing state
  const [editingKeysFor, setEditingKeysFor] = useState<string | null>(null);
  const [userAiKey, setUserAiKey] = useState("");
  const [userJsearchKey, setUserJsearchKey] = useState("");
  const [userAdzunaAppId, setUserAdzunaAppId] = useState("");
  const [userAdzunaKey, setUserAdzunaKey] = useState("");
  const [editingAccountFor, setEditingAccountFor] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [deletingUser, setDeletingUser] = useState<AdminUserSummary | null>(null);

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = toastResult(
        await createUser({
          email: newEmail,
          name: newName || undefined,
          role: newRole,
          allowGlobalKeys: newAllowGlobal,
          password: newPassword.trim() ? newPassword : undefined,
        }),
      );
      if (!res.ok) return;
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      if (res.data.invitePath) {
        const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${res.data.invitePath}` : res.data.invitePath;
        setLastInviteUrl(fullUrl);
        toast("User created. Share the one-time invite link below.");
      } else {
        setLastInviteUrl(null);
        toast("User created.");
      }
      router.refresh();
    });
  };

  const handleSaveGlobal = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = toastResult(
        await saveGlobalKeySettings({
          keyPreference: globalPref,
          aiProvider: globalAiProvider,
          aiBaseUrl: globalAiUrl,
          aiModel: globalAiModel,
          ...(globalAiKey.trim() ? { aiKey: { action: "set", value: globalAiKey } } : {}),
          jobSource: globalJobSource,
          jsearchHost: globalJsearchHost,
          ...(globalJsearchKey.trim() ? { jsearchKey: { action: "set", value: globalJsearchKey } } : {}),
          adzunaAppId: globalAdzunaAppId,
          ...(globalAdzunaKey.trim() ? { adzunaKey: { action: "set", value: globalAdzunaKey } } : {}),
        }),
      );
      if (!res.ok) return;
      setGlobalAiKey("");
      setGlobalJsearchKey("");
      setGlobalAdzunaKey("");
      toast("Global key settings saved.");
      router.refresh();
    });
  };

  const handleToggleUserFlag = (userId: string, changes: Parameters<typeof updateUserAccess>[0]) => {
    startTransition(async () => {
      const res = toastResult(await updateUserAccess(changes));
      if (res.ok) router.refresh();
    });
  };

  const handleResetInvite = (userId: string) => {
    startTransition(async () => {
      const res = toastResult(await resetUserCredentials({ userId }));
      if (!res.ok) return;
      if (res.data.invitePath) {
        const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${res.data.invitePath}` : res.data.invitePath;
        setLastInviteUrl(fullUrl);
        toast("New one-time invite link generated.");
      }
      router.refresh();
    });
  };

  const handleRevokeInvite = (userId: string) => {
    startTransition(async () => {
      const res = toastResult(await resetUserCredentials({ userId, revokeInvite: true }));
      if (!res.ok) return;
      toast("Pending invite revoked.");
      router.refresh();
    });
  };

  const handleSaveUserProfile = (userId: string) => {
    startTransition(async () => {
      const res = toastResult(
        await updateUserAccess({
          userId,
          email: editEmail,
          name: editName,
        }),
      );
      if (!res.ok) return;
      toast("User profile updated.");
      router.refresh();
    });
  };

  const handleSetUserPassword = (userId: string) => {
    if (!editPassword.trim()) return;
    startTransition(async () => {
      const res = toastResult(
        await resetUserCredentials({
          userId,
          password: editPassword,
        }),
      );
      if (!res.ok) return;
      setEditPassword("");
      toast("User password updated.");
      router.refresh();
    });
  };

  const handleClearGlobalKey = (which: "ai" | "jsearch" | "adzuna") => {
    startTransition(async () => {
      const res = toastResult(
        await saveGlobalKeySettings({
          ...(which === "ai" ? { aiKey: { action: "clear" } } : {}),
          ...(which === "jsearch" ? { jsearchKey: { action: "clear" } } : {}),
          ...(which === "adzuna" ? { adzunaKey: { action: "clear" }, adzunaAppId: "" } : {}),
        }),
      );
      if (res.ok) {
        if (which === "adzuna") setGlobalAdzunaAppId("");
        toast("Cleared global key.");
        router.refresh();
      }
    });
  };

  const handleSaveUserKeys = (userId: string) => {
    startTransition(async () => {
      const res = toastResult(
        await setUserApiKeys({
          userId,
          ...(userAiKey.trim() ? { aiKey: { action: "set", value: userAiKey } } : {}),
          ...(userJsearchKey.trim() ? { jsearchKey: { action: "set", value: userJsearchKey } } : {}),
          ...(userAdzunaAppId.trim() ? { adzunaAppId: userAdzunaAppId } : {}),
          ...(userAdzunaKey.trim() ? { adzunaKey: { action: "set", value: userAdzunaKey } } : {}),
        }),
      );
      if (!res.ok) return;
      setUserAiKey("");
      setUserJsearchKey("");
      setUserAdzunaKey("");
      setEditingKeysFor(null);
      toast("User API keys updated.");
      router.refresh();
    });
  };

  const handleClearUserKey = (userId: string, which: "ai" | "jsearch" | "adzuna") => {
    startTransition(async () => {
      const res = toastResult(
        await setUserApiKeys({
          userId,
          ...(which === "ai" ? { aiKey: { action: "clear" } } : {}),
          ...(which === "jsearch" ? { jsearchKey: { action: "clear" } } : {}),
          ...(which === "adzuna" ? { adzunaKey: { action: "clear" }, adzunaAppId: "" } : {}),
        }),
      );
      if (res.ok) {
        toast("Cleared key.");
        router.refresh();
      }
    });
  };

  const handleConfirmDelete = () => {
    if (!deletingUser) return;
    const targetId = deletingUser.id;
    setDeletingUser(null);
    startTransition(async () => {
      const res = toastResult(await deleteUser({ userId: targetId }));
      if (res.ok) {
        toast("User deleted.");
        router.refresh();
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Administration"
        description="Manage users, one-time invitations, Bring Your Own Key (BYOK) permissions, and global fallback keys."
      />

      <div className="flex max-w-[960px] flex-col gap-8 px-10 pb-20">
        {lastInviteUrl && (
          <Card className="flex flex-col gap-2 border-primary bg-selected">
            <h2 className="text-sm font-semibold">One-time invite link ready</h2>
            <p className="text-meta text-muted">Share this link with the user so they can set their password and sign in:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-control border border-line-field bg-input px-3 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">
                {lastInviteUrl}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(lastInviteUrl);
                  toast("Copied invite link.");
                }}
              >
                Copy link
              </Button>
            </div>
          </Card>
        )}

        {/* Section 1: Create / Invite User */}
        <section aria-labelledby="create-user-heading" className="flex flex-col gap-3">
          <h2 id="create-user-heading" className="font-serif text-section">
            Invite or create user
          </h2>
          <Card>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Email or username"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="alex@example.com"
              />
              <Input
                label="Display name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Alex Rivera"
              />
              <Select
                label="Role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
              >
                <option value={UserRole.USER}>User</option>
                <option value={UserRole.ADMIN}>Administrator</option>
              </Select>
              <Input
                label="Initial password (leave empty for one-time invite link)"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to generate invite link"
              />
              <div className="sm:col-span-2">
                <Toggle
                  label="Allow global keys"
                  description="When enabled, this user can use the server's global AI and job-search keys according to the key priority policy. When off, they must bring their own keys (BYOK)."
                  checked={newAllowGlobal}
                  onCheckedChange={setNewAllowGlobal}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {newPassword.trim() ? "Create user" : "Create user & generate invite link"}
                </Button>
              </div>
            </form>
          </Card>
        </section>

        {/* Section 2: Users list */}
        <section aria-labelledby="users-heading" className="flex flex-col gap-3">
          <h2 id="users-heading" className="font-serif text-section">
            Users ({initialUsers.length})
          </h2>
          <div className="flex flex-col gap-3">
            {initialUsers.map((user) => (
              <Card key={user.id} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{user.name}</span>
                      <span className="font-mono text-xs text-muted">({user.email})</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                        {user.role}
                      </span>
                      {user.disabled && (
                        <span className="rounded-full bg-danger-surface px-2 py-0.5 text-[11px] font-medium text-error">
                          Disabled
                        </span>
                      )}
                      {user.invitePending && (
                        <span className="rounded-full bg-selected px-2 py-0.5 text-[11px] font-medium text-ink">
                          Invite pending
                        </span>
                      )}
                      {!user.hasPassword && !user.invitePending && (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                          No password set
                        </span>
                      )}
                    </div>
                    <p className="text-meta text-muted">
                      Applications: <span className="font-medium">{user.applicationCount}</span> · Last sign-in:{" "}
                      <span className="font-medium">{user.lastSignInAt ? user.lastSignInAt.slice(0, 10) : "Never"}</span> · Created:{" "}
                      <span className="font-medium">{user.createdAt.slice(0, 10)}</span>
                    </p>
                    <p className="text-meta text-muted">
                      BYOK status: AI key <span className="font-medium">{user.aiKeyState}</span> · JSearch key{" "}
                      <span className="font-medium">{user.jsearchKeyState}</span> · Adzuna key{" "}
                      <span className="font-medium">{user.adzunaKeyState}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (editingAccountFor === user.id) {
                          setEditingAccountFor(null);
                        } else {
                          setEditingAccountFor(user.id);
                          setEditEmail(user.email);
                          setEditName(user.name);
                          setEditPassword("");
                        }
                      }}
                    >
                      {editingAccountFor === user.id ? "Close account" : "Edit account"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditingKeysFor(editingKeysFor === user.id ? null : user.id);
                        setUserAdzunaAppId(user.adzunaAppId);
                      }}
                    >
                      {editingKeysFor === user.id ? "Close keys" : "Manage BYOK keys"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleResetInvite(user.id)}>
                      New invite link
                    </Button>
                    {user.invitePending && (
                      <Button variant="secondary" size="sm" onClick={() => handleRevokeInvite(user.id)}>
                        Revoke invite
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggleUserFlag(user.id, { userId: user.id, disabled: !user.disabled })}
                    >
                      {user.disabled ? "Enable" : "Disable"}
                    </Button>
                    {user.id !== currentUserId && (
                      <Button variant="danger-outline" size="sm" onClick={() => setDeletingUser(user)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {editingAccountFor === user.id && (
                  <div className="flex flex-col gap-4 rounded-control border border-line bg-paper p-4">
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Profile & identifier for {user.email}
                      </h3>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          label="User email or username"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                        />
                        <Input
                          label="User display name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Button size="sm" onClick={() => handleSaveUserProfile(user.id)} disabled={pending}>
                          Save profile
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-line pt-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Direct password reset
                      </h3>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          label="New password for user"
                          type="password"
                          autoComplete="new-password"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          placeholder="At least 8 characters"
                        />
                      </div>
                      <div>
                        <Button
                          size="sm"
                          onClick={() => handleSetUserPassword(user.id)}
                          disabled={pending || editPassword.trim().length < 8}
                        >
                          Set password
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 border-t border-line pt-3 sm:grid-cols-3">
                  <Toggle
                    label="Allow global keys"
                    description="Permit fallback to global keys"
                    checked={user.allowGlobalKeys}
                    onCheckedChange={(allowGlobalKeys) => handleToggleUserFlag(user.id, { userId: user.id, allowGlobalKeys })}
                  />
                  <Select
                    label="Key priority override"
                    value={user.keyPreference ?? "INHERIT"}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleToggleUserFlag(user.id, {
                        userId: user.id,
                        keyPreference: val === "INHERIT" ? null : (val as KeyPreference),
                      });
                    }}
                  >
                    <option value="INHERIT">Inherit global default ({globalPref})</option>
                    <option value={KeyPreference.USER_FIRST}>User key first (fallback to global)</option>
                    <option value={KeyPreference.GLOBAL_FIRST}>Global key first (fallback to user)</option>
                  </Select>
                  <Select
                    label="Role"
                    value={user.role}
                    onChange={(e) => handleToggleUserFlag(user.id, { userId: user.id, role: e.target.value as UserRole })}
                  >
                    <option value={UserRole.USER}>User</option>
                    <option value={UserRole.ADMIN}>Administrator</option>
                  </Select>
                </div>

                {editingKeysFor === user.id && (
                  <div className="flex flex-col gap-3 rounded-control border border-line bg-paper p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Set or clear BYOK keys for {user.email}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Input
                          label="User AI API Key"
                          type="password"
                          value={userAiKey}
                          onChange={(e) => setUserAiKey(e.target.value)}
                          placeholder={user.aiKeyState === "set" ? "Saved · enter new key to replace" : "Enter AI API key"}
                        />
                        {user.aiKeyState !== "none" && (
                          <Button variant="text" size="sm" className="self-start" onClick={() => handleClearUserKey(user.id, "ai")}>
                            Clear user AI key
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Input
                          label="User JSearch Key"
                          type="password"
                          value={userJsearchKey}
                          onChange={(e) => setUserJsearchKey(e.target.value)}
                          placeholder={user.jsearchKeyState === "set" ? "Saved · enter new key to replace" : "Enter JSearch key"}
                        />
                        {user.jsearchKeyState !== "none" && (
                          <Button variant="text" size="sm" className="self-start" onClick={() => handleClearUserKey(user.id, "jsearch")}>
                            Clear user JSearch key
                          </Button>
                        )}
                      </div>
                      <Input
                        label="User Adzuna App ID"
                        value={userAdzunaAppId}
                        onChange={(e) => setUserAdzunaAppId(e.target.value)}
                        placeholder="Adzuna App ID"
                      />
                      <div className="flex flex-col gap-1.5">
                        <Input
                          label="User Adzuna Key"
                          type="password"
                          value={userAdzunaKey}
                          onChange={(e) => setUserAdzunaKey(e.target.value)}
                          placeholder={user.adzunaKeyState === "set" ? "Saved · enter new key to replace" : "Enter Adzuna key"}
                        />
                        {user.adzunaKeyState !== "none" && (
                          <Button variant="text" size="sm" className="self-start" onClick={() => handleClearUserKey(user.id, "adzuna")}>
                            Clear user Adzuna key
                          </Button>
                        )}
                      </div>
                    </div>
                    <div>
                      <Button size="sm" onClick={() => handleSaveUserKeys(user.id)} disabled={pending}>
                        Save user keys
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* Section 3: Global Keys & Priority Policy */}
        <section aria-labelledby="global-keys-heading" className="flex flex-col gap-3">
          <h2 id="global-keys-heading" className="font-serif text-section">
            Global keys & failover policy
          </h2>
          <Card>
            <form onSubmit={handleSaveGlobal} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Select
                  label="Default key priority policy"
                  value={globalPref}
                  onChange={(e) => setGlobalPref(e.target.value as KeyPreference)}
                >
                  <option value={KeyPreference.USER_FIRST}>
                    User key first — use the user&apos;s own BYOK key first, and fail over to global keys on error
                  </option>
                  <option value={KeyPreference.GLOBAL_FIRST}>
                    Global key first — use global keys first, and fail over to the user&apos;s BYOK key on error
                  </option>
                </Select>
              </div>

              <Select
                label="Global AI provider"
                value={globalAiProvider}
                onChange={(e) => setGlobalAiProvider(e.target.value as AiProvider)}
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Global AI model"
                value={globalAiModel}
                onChange={(e) => setGlobalAiModel(e.target.value)}
                placeholder="e.g. claude-sonnet-5"
              />
              <Input
                label="Global AI server URL"
                value={globalAiUrl}
                onChange={(e) => setGlobalAiUrl(e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Global AI API key"
                  type="password"
                  value={globalAiKey}
                  onChange={(e) => setGlobalAiKey(e.target.value)}
                  placeholder={
                    initialGlobal.ai.keyState === "set"
                      ? "Saved · enter new key to replace"
                      : initialGlobal.ai.keyState === "env"
                        ? "From DOSSIER_AI_KEY · enter to override"
                        : "Enter global AI key"
                  }
                />
                {(initialGlobal.ai.keyState === "set" || initialGlobal.ai.keyState === "unreadable") && (
                  <Button variant="text" size="sm" type="button" className="self-start" onClick={() => handleClearGlobalKey("ai")}>
                    Clear global AI key
                  </Button>
                )}
              </div>

              <Select
                label="Global job search source"
                value={globalJobSource}
                onChange={(e) => setGlobalJobSource(e.target.value as JobSource | "OFF")}
              >
                <option value="OFF">Off</option>
                {JOB_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              <Select
                label="Global JSearch host"
                value={globalJsearchHost}
                onChange={(e) => setGlobalJsearchHost(e.target.value as (typeof JSEARCH_HOSTS)[number])}
              >
                {JSEARCH_HOSTS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Global JSearch API key"
                  type="password"
                  value={globalJsearchKey}
                  onChange={(e) => setGlobalJsearchKey(e.target.value)}
                  placeholder={
                    initialGlobal.jobSearch.jsearch.keyState === "set"
                      ? "Saved · enter new key to replace"
                      : "Enter global JSearch key"
                  }
                />
                {(initialGlobal.jobSearch.jsearch.keyState === "set" || initialGlobal.jobSearch.jsearch.keyState === "unreadable") && (
                  <Button variant="text" size="sm" type="button" className="self-start" onClick={() => handleClearGlobalKey("jsearch")}>
                    Clear global JSearch key
                  </Button>
                )}
              </div>
              <Input
                label="Global Adzuna App ID"
                value={globalAdzunaAppId}
                onChange={(e) => setGlobalAdzunaAppId(e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <Input
                  label="Global Adzuna API key"
                  type="password"
                  value={globalAdzunaKey}
                  onChange={(e) => setGlobalAdzunaKey(e.target.value)}
                  placeholder={
                    initialGlobal.jobSearch.adzuna.keyState === "set"
                      ? "Saved · enter new key to replace"
                      : "Enter global Adzuna key"
                  }
                />
                {(initialGlobal.jobSearch.adzuna.keyState === "set" || initialGlobal.jobSearch.adzuna.keyState === "unreadable") && (
                  <Button variant="text" size="sm" type="button" className="self-start" onClick={() => handleClearGlobalKey("adzuna")}>
                    Clear global Adzuna key
                  </Button>
                )}
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  Save global key settings
                </Button>
              </div>
            </form>
          </Card>
        </section>
      </div>

      {deletingUser && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeletingUser(null)}
          title={`Delete ${deletingUser.email}?`}
          description="This permanently deletes the user account along with their profile, applications, tailored documents, and settings."
          confirmLabel="Delete user"
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
