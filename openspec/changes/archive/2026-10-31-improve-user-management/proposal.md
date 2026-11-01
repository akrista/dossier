# Proposal

## Why

The initial multi-user BYOK release introduced user roles, one-time invitations, per-user data isolation, and global/BYOK key failover, but left regular users without self-service credential or display-name controls, gave administrators limited visibility and lifecycle tools in `/admin`, and left several single-user UI artifacts (`"New user"` sidebar fallback, `"set via DOSSIER_PASSWORD"` in About, and opaque key-source indicators in Settings). Completing these three pillars makes multi-user self-hosting practical for everyday administration and transparent for end users.

## What Changes

- **Self-Service Account Management (`Settings → Account`)**:
  - Add an `Account` section to `/settings` (`?section=account`) available to all authenticated users.
  - Display the signed-in user's login identifier (`email`/username, read-only and managed only by administrators), role (`ADMIN` or `USER`), and effective API key policy (`allowGlobalKeys` and active key priority).
  - Allow users to update their own `User.name` display name.
  - Allow users to change their own password by verifying their current password, updating `passwordHash`, and immediately re-issuing their current browser's session cookie (`startSession`) so their active session continues while any other devices/sessions are invalidated.
- **Admin UX & Visibility (`/admin`)**:
  - Track `lastSignInAt` (`DateTime?`) on the `User` model, updated upon credential sign-in and one-time invitation acceptance.
  - Display per-user activity and usage metrics in `/admin`: `lastSignInAt` timestamp, total non-draft applications count, and account creation date.
  - Allow administrators to edit a user's login identifier (`email`/username, enforcing uniqueness) and display name (`name`).
  - Expose direct password assignment in `/admin` alongside one-time invite generation, plus an explicit action to revoke an unaccepted pending invite token.
  - Add "Clear global key" actions in `/admin` for Global AI, JSearch, and Adzuna keys so administrators can remove stored global keys without replacing them.
- **Multi-User Polish & Key Transparency**:
  - Fall back to `User.name` and then `User.email` in the app shell sidebar (`src/app/(app)/layout.tsx`) before `"New user"` when the user's resume profile name is still empty.
  - Update `Settings → About` to display the signed-in user's identifier and role (`<email> (<role>)`) instead of the legacy static `"set via DOSSIER_PASSWORD"` text.
  - Show a clear status notice in `Settings → AI provider` and `Settings → Job search` when `allowGlobalKeys = true` explaining whether the user is currently using a personal BYOK key, relying on the server's global key, or configured for automatic failover (`USER_FIRST` vs `GLOBAL_FIRST`).

## Capabilities

### New Capabilities
<!-- None: all changes extend the existing multi-user capabilities. -->

### Modified Capabilities
- `user-auth-and-isolation`: Add self-service display name and password management (`Settings → Account`), record `lastSignInAt` on sign-in and invite acceptance, and reflect the signed-in `User` identity in the app shell and `Settings → About`.
- `admin-management`: Add admin editing of user login identifiers (`email`/username) and display names, direct password reset and pending-invite revocation in `/admin`, per-user `lastSignInAt` and application count visibility, and clearing stored global keys.
- `key-management-and-failover`: Surface transparent key-resolution status (personal BYOK vs global server key and failover order) in `Settings → AI provider` and `Settings → Job search`.

## Impact

- **Database Schema (`prisma/schema.prisma`)**: Add `lastSignInAt DateTime?` to `User` with a new Prisma migration.
- **Auth & Session (`src/app/login/actions.ts`, `src/lib/auth/session.ts`)**: Update `signIn` and `acceptInvite` to record `lastSignInAt`; expose user identity details for layout and settings views.
- **Settings (`src/app/(app)/settings/*`)**: Add `account` section (`sections.ts`, `account-section.tsx`, `actions.ts`, `page.tsx`), update `About` facts, and enhance key-policy banners on `ai` and `jobs` sections.
- **Admin (`src/app/(app)/admin/*`)**: Expand `loadAdminDashboardData`, `actions.ts`, and `admin-screen.tsx` with identifier/name editing, direct password setting, invite revocation, global key clearing, and per-user stats (`lastSignInAt`, `applicationCount`).
