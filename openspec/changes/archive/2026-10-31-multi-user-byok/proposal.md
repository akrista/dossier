# Proposal

## Why

Dossier currently operates as a single-tenant installation backed by one global password (`DOSSIER_PASSWORD`), a single shared database namespace, and global API keys. Adding multi-user authentication, per-user data isolation, Bring Your Own Key (BYOK) with configurable global-key failover, and an Admin management console allows multiple users to share one Dossier deployment safely while giving the operator full control over user access and AI/job-search API costs.

## What Changes

- **BREAKING**: Replace single-password sign-in (`/login`) with credential-based authentication (`username`/`email` + password) backed by a `User` model (`ADMIN` and `USER` roles), while automatically bootstrapping the initial `ADMIN` user from `DOSSIER_PASSWORD` (and optional `DOSSIER_ADMIN_EMAIL`) and assigning existing single-tenant records to that admin.
- Isolate user-owned data (`ProfileField`, `Skill`, `Language`, `Experience`, `Project`, `Education`, `Publication`, `Reference`, `Fact`, custom `Theme`, `Application`, `Posting`, `PostingScore`, `PostingSearch`, `AgentCandidate`, `Startup`, `StartupBlock`, `GoogleAccount`, `EmailMessage`, `ClaudePaste`, `Job`, and user-level `Setting` rows) per `userId` via request/job-scoped context and centralized Prisma scoping so upstream merges from `main` into `master` stay low-conflict.
- Split settings and encrypted API keys (`apiKeyEnc`, `jsearchKeyEnc`, `adzunaKeyEnc`) into **user-scoped BYOK settings** and **instance-scoped Admin global settings**.
- Introduce per-user global key authorization (`User.allowGlobalKeys`) and key priority (`keyPreference`: `USER_FIRST` vs `GLOBAL_FIRST`) with automatic runtime failover: when a user is allowed to use global keys, Dossier tries the preferred key first (e.g., the user's BYOK credits) and automatically falls back to the secondary key (e.g., the Admin's global key) if the primary key is unset or fails with auth/quota/rate-limit/unavailable errors.
- Add an **Admin management area** (`/admin` or Settings → Users & Keys) where `ADMIN` users can create users (with direct password or one-time invite/setup token), enable/disable/delete accounts, reset passwords, toggle `allowGlobalKeys`, set or clear a specific user's BYOK keys, and configure global fallback keys and `keyPreference`.
- Restrict instance-level operations (nightly disk backups, release update checks, usage telemetry consent, global OAuth client credentials) to `ADMIN` users.

## Capabilities

### New Capabilities
- `user-auth-and-isolation`: Multi-user accounts (`ADMIN` and `USER` roles), session tokens carrying `userId` and password fingerprint, initial admin bootstrap, one-time invite/password setup links, and per-user data isolation across web requests, background jobs, Gmail/Calendar sync, Claude MCP connector, and data export/import.
- `key-management-and-failover`: Per-user BYOK storage for AI and job-search providers, Admin global key storage, per-user `allowGlobalKeys` enforcement, `USER_FIRST` / `GLOBAL_FIRST` priority configuration, and automatic runtime failover between user and global keys.
- `admin-management`: Admin UI and server actions for user lifecycle management (create/invite, disable/enable, delete, password reset), per-user `allowGlobalKeys` and BYOK key overrides, and global key / failover policy configuration.

### Modified Capabilities

None (no existing specs in `openspec/specs/`).

## Impact

- **Database Schema (`prisma/schema.prisma`)**: New `User` model (`id`, `email`, `name`, `passwordHash`, `role`, `allowGlobalKeys`, `keyPreference`, `disabledAt`, `inviteTokenHash`, `inviteExpiresAt`, timestamps); `userId` scoping on user-owned tables and `Setting` (`@@id([userId, key])` with `userId = ""` reserved for global instance settings).
- **Authentication & Context (`src/lib/auth/`, `src/proxy.ts`, `src/lib/action.ts`, `src/lib/prisma.ts`)**: Session token payload includes `userId` and `role`; `AsyncLocalStorage` context binds `userId` for Server Actions, route handlers, and background schedules; centralized Prisma client extension/proxy injects `userId` filters automatically.
- **AI & Job Search (`src/lib/ai/`, `src/lib/job-search/`)**: Config resolution produces an ordered candidate list `[primary, secondary]` based on `allowGlobalKeys` and `keyPreference`, with automatic retry on failover-eligible errors (`401`, `402`, `403`, `429`, `503`, unreachable).
- **UI (`src/app/login/`, `src/app/(app)/settings/`, `src/app/(app)/admin/`)**: Updated sign-in form with identifier + password, invite acceptance screen, user settings scoped to own BYOK keys, and new Admin screen for managing users, keys, and instance settings.
