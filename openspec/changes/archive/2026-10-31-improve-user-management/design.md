# Design

## Context

Dossier recently transitioned from a single-password self-hosted tool to a multi-user BYOK architecture (`2026-10-31-multi-user-byok`). While `User` records, `ADMIN`/`USER` roles, one-time invite tokens, and `tenant-prisma` isolation are in place, several user-facing and admin-facing workflows remain incomplete (see `proposal.md`).

## Goals / Non-Goals

**Goals:**
- Provide self-service display name (`User.name`) and password management in `Settings → Account` (`?section=account`) while keeping login identifiers (`User.email`) read-only for regular users.
- Rotate the active browser's session cookie (`startSession`) when a user changes their own password so they remain signed in while all other sessions for that account are invalidated.
- Give administrators visibility into per-user activity (`lastSignInAt`, non-draft `application` count) and full credential/profile lifecycle controls (edit `email`/username and `name`, set password directly, revoke pending invite, clear stored global keys).
- Polish multi-user identity display in the sidebar, `Settings → About`, and key-resolution banners in `Settings → AI provider` and `Settings → Job search`.

**Non-Goals:**
- Self-service login identifier (`email`/username) changes by non-admin users.
- Public self-registration or automated transactional email delivery for invites/password resets.
- Per-token usage metering or billing quotas.

## Decisions

### 1. `User.lastSignInAt` column on `User`
- **Choice**: Add `lastSignInAt DateTime?` to `User` in `prisma/schema.prisma` and update it in `signIn` and `acceptInvite` (`src/app/login/actions.ts`).
- **Rationale**:Sessions in Dossier are stateless encrypted JWE cookies (`src/lib/auth/session.ts`). Updating `lastSignInAt` at sign-in and invite acceptance requires zero per-request database writes while giving administrators accurate visibility into whether an invited or existing user has signed in and when.
- **Alternatives considered**: Updating a `lastActiveAt` column inside `getSession()` on every page load—rejected because `getSession()` runs on every RSC render and would introduce write contention on every navigation.

### 2. Self-Service `Settings → Account` (`?section=account`)
- **Choice**: Add `{ id: "account", label: "Account" }` to `SETTINGS_SECTIONS` in `src/app/(app)/settings/sections.ts` and render `AccountSection` in `src/app/(app)/settings/page.tsx`.
- **Server Actions (`src/app/(app)/settings/actions.ts`)**:
  - `updateOwnAccount({ name })`: Updates `User.name` for the signed-in `userId` (falling back to `user.email` if cleared) and revalidates the layout.
  - `changeOwnPassword({ currentPassword, newPassword })`: Verifies `currentPassword` against `user.passwordHash` (or `env.DOSSIER_PASSWORD` in legacy fallback), hashes `newPassword` (min 8 chars), updates `User.passwordHash` (and clears any stale `inviteTokenHash`), and calls `startSession({ persistent: session.persistent, userId: user.id, role: user.role, passwordHash })` so the current browser receives a new JWE with the updated `passwordFingerprint`.
- **Rationale**: Because `getSession()` validates `passwordFingerprint(user.passwordHash) === pwd`, updating `passwordHash` immediately invalidates old cookies on other devices while `startSession` keeps the current browser signed in seamlessly.

### 3. Admin User Lifecycle & Global Key Controls (`/admin`)
- **Choice**:
  - Extend `updateUserAccess` in `src/app/(app)/admin/actions.ts` to accept `email` (normalized to lowercase and checked for uniqueness across `User`).
  - Extend `resetUserCredentials` in `src/app/(app)/admin/actions.ts` to support three modes:
    1. `mode: "password"` (with `password` min 8 chars): sets `passwordHash` and clears `inviteTokenHash` / `inviteExpiresAt`.
    2. `mode: "invite"` (default when omitted): generates a new one-time invite token and returns `invitePath`.
    3. `mode: "revoke_invite"`: clears `inviteTokenHash` and `inviteExpiresAt` without changing `passwordHash`.
  - Extend `loadAdminDashboardData` in `src/app/(app)/admin/data.ts` to query `lastSignInAt` from `User` and group non-draft application counts (`prisma.application.groupBy({ by: ["userId"], where: { awaitingReview: false }, _count: { _all: true } })`) inside `runUnscoped`.
  - Add "Clear global key" buttons in `AdminScreen` (`src/app/(app)/admin/admin-screen.tsx`) that invoke `saveGlobalKeySettings` with `{ action: "clear" }` for `aiKey`, `jsearchKey`, or `adzunaKey`.

### 4. Multi-User Shell, About & Key Transparency Polish
- **Choice**:
  - Include `email` and `name` on `Session` returned by `getSession()` (`src/lib/auth/session.ts`) when a `User` row is loaded so `AppLayout` (`src/app/(app)/layout.tsx`) and `SettingsPage` (`src/app/(app)/settings/page.tsx`) already have the signed-in user's display name and identifier without an extra query.
  - In `AppLayout`, compute `userName = name.trim() || session.userName?.trim() || session.userEmail?.trim() || "New user"`.
  - In `Settings → About` (`aboutFacts` in `src/app/(app)/settings/page.tsx`), format the `"Sign-in"` row as `${session.userEmail} · ${session.role === "ADMIN" ? "Administrator" : "User"}` when `session.userEmail` is present (falling back to `"set via DOSSIER_PASSWORD"` for legacy/unscoped tests).
  - In `Settings → AI provider` and `Settings → Job search`, render a concise `role="note"` banner for both `allowGlobalKeys = false` (BYOK required) and `allowGlobalKeys = true` (showing effective key priority `USER_FIRST` vs `GLOBAL_FIRST` and whether a personal key is saved).

## Risks / Trade-offs

- **[Risk] Admin changes a user's `email` while the user is signed in** → Sessions are keyed by `userId` (`uid` claim in JWE), not `email`, so the user's active session remains valid and their next sign-in uses the new identifier.
- **[Risk] Admin revokes an invite for a user who has never set a password** → The user has `passwordHash = ""` and `inviteTokenHash = null`, which `signIn` already rejects (`!user.passwordHash`). The UI will show `"No password set"` until the admin sets a password or issues a new invite.
