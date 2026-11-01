# Tasks

## 1. Schema & Auth Session Updates

- [x] 1.1 Add `lastSignInAt DateTime?` to `User` in `prisma/schema.prisma`, create the Prisma migration, and regenerate the Prisma client so `User.lastSignInAt` is available in TypeScript.
- [x] 1.2 Update `signIn` and `acceptInvite` in `src/app/login/actions.ts` to set `lastSignInAt: new Date()` on the `User` record and verify `src/app/login/actions.test.ts` passes.
- [x] 1.3 Enrich `Session` in `src/lib/auth/session.ts` with `userEmail?: string` and `userName?: string` populated from the `User` row in `getSession()` and verify `src/lib/auth/session.test.ts` passes.

## 2. Self-Service Account Management (`Settings → Account`)

- [x] 2.1 Add `{ id: "account", label: "Account" }` to `SETTINGS_SECTIONS` in `src/app/(app)/settings/sections.ts` and verify `src/lib/settings.test.ts` (or section routing tests) pass.
- [x] 2.2 Implement `updateOwnAccount` (updates `User.name`) and `changeOwnPassword` (verifies `currentPassword`, hashes `newPassword`, updates `User.passwordHash`, clears pending invite fields, and calls `startSession` to rotate the current cookie) in `src/app/(app)/settings/actions.ts`, with unit/DB tests verifying display name updates, password rotation, and wrong-current-password rejection.
- [x] 2.3 Create `src/app/(app)/settings/account-section.tsx` and wire `?section=account` in `src/app/(app)/settings/page.tsx` to display the read-only `email`/username, role, key policy summary, display-name form, and password-change form.

## 3. Admin UX, User Lifecycle & Global Key Controls (`/admin`)

- [x] 3.1 Extend `loadAdminDashboardData` in `src/app/(app)/admin/data.ts` to include `lastSignInAt: string | null` and `applicationCount: number` (non-draft applications) per user.
- [x] 3.2 Extend `updateUserAccess` in `src/app/(app)/admin/actions.ts` to allow updating `email` (normalized and checked for uniqueness) and `name`, and extend `resetUserCredentials` to support setting a direct password, generating a new invite link, or revoking a pending invite (`revokeInvite: true`), with unit/DB test coverage.
- [x] 3.3 Update `AdminScreen` in `src/app/(app)/admin/admin-screen.tsx` to display per-user `lastSignInAt`, creation date, and application count, add controls to edit user `email`/`name`, set a password directly, revoke a pending invite, and clear stored Global AI, JSearch, and Adzuna keys.

## 4. Multi-User Shell, About & Key Transparency Polish

- [x] 4.1 Update `AppLayout` in `src/app/(app)/layout.tsx` so the sidebar display name falls back to `session.userName` and `session.userEmail` before `"New user"`, and update `aboutFacts` in `src/app/(app)/settings/page.tsx` to show the signed-in user's identifier and role (`<email> · <role>`).
- [x] 4.2 Update `SettingsPage` (`src/app/(app)/settings/page.tsx`) on the `ai` and `jobs` sections so users with `allowGlobalKeys = true` see a clear status note indicating their effective key priority (`USER_FIRST` vs `GLOBAL_FIRST`) and whether a personal BYOK key or global server key is currently active.
- [x] 4.3 Run typecheck (`tsc --noEmit`) and the relevant test suites to verify all new and existing multi-user tests pass.
