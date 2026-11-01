# Tasks

## 1. Schema, Migration & Initial Admin Bootstrap

- [x] 1.1 Add `User`, `UserRole` (`ADMIN`, `USER`), and `KeyPreference` (`USER_FIRST`, `GLOBAL_FIRST`) to `prisma/schema.prisma`, along with `userId` scoping and composite primary/unique keys on user-owned tables (`ProfileField`, `Setting`, `Skill`, `Language`, `Experience`, `Project`, `Education`, `Publication`, `Reference`, `Fact`, `Theme`, `Application`, `Posting`, `PostingScore`, `PostingSearch`, `AgentCandidate`, `Startup`, `StartupBlock`, `EmailMessage`, `ClaudePaste`, `Job`); verify `prisma validate` and client generation succeed.
- [x] 1.2 Create the Prisma migration and implement `ensureInitialAdmin()` in `src/lib/auth/bootstrap.ts` (invoked from `src/instrumentation.ts` and seed/test helpers) so an empty `User` table automatically provisions an active `ADMIN` user from `DOSSIER_PASSWORD` / `DOSSIER_ADMIN_EMAIL` with `allowGlobalKeys = true` and claims unscoped rows; verify with database unit tests in `src/lib/auth/bootstrap.db.test.ts`.

## 2. Multi-User Authentication, Invite Onboarding & Tenant Context

- [x] 2.1 Implement `src/lib/auth/user-context.ts` (`AsyncLocalStorage` holding `{ userId, role, allowGlobalKeys, keyPreference }`) and update `src/lib/prisma.ts` with a Prisma client extension that automatically scopes tenant-owned models to the active `userId` (and allows global `Setting` access via `userId = ""` plus shared `builtIn = true` themes); verify isolation with `src/lib/auth/user-context.db.test.ts`.
- [x] 2.2 Update `src/lib/auth/session.ts`, `src/lib/action.ts` (adding `adminAction()`), and `src/proxy.ts` so JWE session tokens encode `userId`, `role`, and the user's password hash fingerprint, and `getSession()` validates against the active `User` record and binds the user context; verify with unit tests in `src/lib/auth/session.test.ts` and `src/proxy.test.ts`.
- [x] 2.3 Update `/login` (`src/app/login/login-form.tsx`, `src/app/login/actions.ts`) to accept `identifier` (email/username) + `password`, and add `/login/invite` for one-time invite token password setup; verify with tests in `src/app/login/login-form.test.tsx` and `src/app/login/actions.test.ts`.

## 3. Per-User Background Jobs, Integrations & Data Export/Import

- [x] 3.1 Update background job queueing and execution (`src/lib/jobs/runner.ts`), Gmail/Calendar account storage (`src/lib/google/account.ts`, `src/lib/google/sync.ts`), Job Agent schedule (`src/lib/agent/schedule.ts`), Startups schedule (`src/lib/startups/schedule.ts`), and Claude MCP OAuth (`src/lib/connector/oauth.ts`) to bind and run per `userId`; verify with their respective `.db.test.ts` suites.
- [x] 3.2 Scope user data export and import (`src/lib/data-export.ts`, `src/lib/data-import.ts`) to the signed-in user's records and settings while keeping disk backups (`src/lib/backup-schedule.ts`) admin-only; verify with `src/lib/data-export.db.test.ts` and `src/lib/data-import.db.test.ts`.

## 4. BYOK, Global Keys & Automatic Runtime Failover

- [x] 4.1 Update `src/lib/settings.ts` and `src/lib/settings-data.ts` to separate user-scoped settings (`loadSettings()`, `saveSettings()`) from instance-scoped global settings (`loadGlobalSettings()`, `saveGlobalSettings()` using `userId = ""`); verify with `src/lib/settings.test.ts`.
- [x] 4.2 Update `src/lib/ai/config.ts` and `src/lib/ai/index.ts` to resolve an ordered credential chain (`[primary, secondary]`) honoring `User.allowGlobalKeys` and effective `keyPreference` (`USER_FIRST` vs `GLOBAL_FIRST`), and implement `FailoverAIProvider` to automatically retry once with the secondary key when the primary fails with `auth`, `rate-limited`, `busy`, `unreachable`, or `provider` errors; verify with unit tests in `src/lib/ai/config.test.ts` and `src/lib/ai/providers.test.ts`.
- [x] 4.3 Update `src/lib/job-search/config.ts` and `src/lib/job-search/find.ts` to resolve ordered job-search credentials honoring `allowGlobalKeys` and `keyPreference`, and automatically retry `askSource()` / `fullText()` with the secondary key on `auth`, `quota`, or `unavailable` errors; verify with unit tests in `src/lib/job-search/config.test.ts` and `src/lib/job-search/index.test.ts`.

## 5. Admin Management UI & User Settings Adjustments

- [x] 5.1 Implement Admin server actions (`src/app/(app)/admin/actions.ts`) to list users, create/invite users (direct password or one-time invite link), toggle `allowGlobalKeys` and `keyPreference`, enable/disable/delete users (protecting the last active admin), reset passwords, set/clear a user's BYOK keys, and update global AI/job-search keys and global `keyPreference`; verify with `src/app/(app)/admin/actions.db.test.ts`.
- [x] 5.2 Build the Admin UI screen (`src/app/(app)/admin/page.tsx`) and sidebar navigation link (visible only when `session.role === "ADMIN"`), and hide instance-only sections (backups, updates, telemetry) from non-admin users in `src/app/(app)/settings/page.tsx`; verify with component and route tests.

## 6. End-to-End Verification

- [x] 6.1 Run `yarn typecheck`, `yarn lint`, and `yarn test` across the full test suite and verify all unit and database integration tests pass.
