# Design

## Context

Dossier is built on Next.js 16 (App Router, Server Actions), Prisma 7 with PostgreSQL, and stateless JWE session cookies (`src/lib/auth/session.ts`). Currently, all database tables are single-tenant without a `userId` column, `Setting` is a global key-value table (`key String @id`), and `prisma` is exported as a lazy `Proxy` in `src/lib/prisma.ts`.

A critical repository constraint: `main` tracks the upstream single-tenant repository, while `master` is our customized fork. Our multi-user design must minimize invasive edits across the 100+ existing Prisma queries in feature modules so upstream merges from `main` into `master` stay clean.

## Goals / Non-Goals

**Goals:**
- Multi-user authentication (`ADMIN` and `USER` roles) with automatic bootstrap of the initial `ADMIN` from `DOSSIER_PASSWORD` and zero-SMTP onboarding via admin-set passwords or one-time invite links.
- Transparent per-user data isolation using `AsyncLocalStorage` request/job context and centralized Prisma query interception in `src/lib/prisma.ts`.
- Flexible key management: per-user BYOK keys, Admin global keys, per-user `allowGlobalKeys` toggle, Admin-configurable `keyPreference` (`USER_FIRST` vs `GLOBAL_FIRST`), per-user BYOK overrides by Admin, and automatic runtime failover between primary and secondary keys.

**Non-Goals:**
- Outbound transactional email / SMTP server for invitations (deferred to a future iteration; invite URLs are copied by the Admin).
- Cross-user sharing of applications or profiles (each user has an isolated workspace).
- Billing/subscription payment gateway integration in this change.

## Decisions

### 1. Centralized Tenant Scoping via `AsyncLocalStorage` + Prisma Client Extension

- **Choice**: Store the active `{ userId, role }` context in a server-side `AsyncLocalStorage` (`src/lib/auth/user-context.ts`), populated automatically by:
  - `getSession()` / `verifySession()` in web requests and Server Actions (`src/lib/action.ts`),
  - Background job execution (`src/lib/jobs/runner.ts`, reading `job.userId`),
  - Per-user scheduled loops (Gmail sync, Job Agent, Startups refresh iterating over active users),
  - Claude MCP connector OAuth tokens (`src/lib/connector/oauth.ts`, embedding `userId` in the token payload).
  Wrap the Prisma client in `src/lib/prisma.ts` (`$extends`) so queries on tenant-scoped models automatically inject `userId` into `where`, `create`, `createMany`, `upsert`, `update`, and `delete` operations when a user context is active.
- **Why over rewriting every query**: Rewriting `prisma.application.*` and `prisma.profileField.*` across dozens of files would cause constant merge conflicts whenever pulling upstream changes from `main` into `master`. Intercepting at `src/lib/prisma.ts` keeps feature files virtually untouched.

### 2. Schema Changes & Composite Keys for Single-Row/Key-Value Models

- **Choice**:
  - Add `model User` with `id`, `email` (`@unique @db.Citext`), `name`, `passwordHash`, `role` (`ADMIN | USER`), `allowGlobalKeys` (`Boolean @default(false)`), `keyPreference` (`KeyPreference?` — null inherits global default), `disabledAt` (`DateTime?`), `inviteTokenHash` (`String? @unique`), `inviteExpiresAt` (`DateTime?`).
  - Change `ProfileField` PK from `key` to `@@id([userId, key])`.
  - Change `Setting` PK from `key` to `@@id([userId, key])`, where `userId = ""` stores global/instance settings (`INSTALL_SETTINGS`, global AI/job keys, global `keyPreference`) and `userId = "<user.id>"` stores per-user settings and BYOK keys.
  - Scope unique constraints on user-owned tables: `Skill` (`@@unique([userId, name])`), `Language` (`@@unique([userId, name])`), `Posting` (`@@unique([userId, source, externalId])`), `AgentCandidate` (`@@unique([userId, source, externalId])`, `@@unique([userId, dedupeKey])`), `PostingScore` (`@@id([userId, source, externalId])`), `Startup` (`@@unique([userId, source, externalId])`), `StartupBlock` (`@@id([userId, hash])`), `EmailMessage` (`@@unique([userId, gmailId])`).
  - Use `userId` as `GoogleAccount.id` (replacing the hardcoded `"google"` constant in `src/lib/google/account.ts`).
  - Keep `Theme` shared for `builtIn = true` (`userId String?`), and scoped to `userId` for custom themes.

```text
+-------------------------------------------------------------------+
| Setting Table: @@id([userId, key])                                |
+-------------------------------------------------------------------+
| userId = ""         -> Global Admin Keys, keyPreference, Backups  |
| userId = "<userId>" -> User BYOK Keys, Theme/Doc/Agent Prefs      |
+-------------------------------------------------------------------+
```

### 3. Ordered Key Resolution & Automatic Runtime Failover

- **Choice**:
  - Introduce `enum KeyPreference { USER_FIRST, GLOBAL_FIRST }` (defaulting to `USER_FIRST` globally).
  - In `src/lib/ai/config.ts` and `src/lib/job-search/config.ts`, add `loadAiConfigChain()` and `loadJobSearchConfigChain()` returning `[primary, secondary?]` based on:
    1. If `user.allowGlobalKeys === false`: only `[userConfig]` is returned (never global/env).
    2. If `user.allowGlobalKeys === true`: order `userConfig` and `globalConfig` (Admin DB global settings falling back to `DOSSIER_*` env vars) according to `user.keyPreference ?? globalSettings.keyPreference`. Omit any candidate that lacks a usable key/provider.
  - Wrap `getAiProvider()` in a `FailoverAIProvider` (`src/lib/ai/index.ts`) and wrap `askSource()` / `fullText()` (`src/lib/job-search/find.ts`):
    - Execute the call with `candidates[0]`.
    - If `candidates[0]` throws an `AiError` with `kind` in `{"auth", "rate-limited", "busy", "unreachable", "provider"}` (or `JobSearchError` with `problem` in `{"auth", "quota", "unavailable"}`) and `candidates[1]` exists, log the failover event and retry once with `candidates[1]`.

### 4. Stateless Session Cookie + Database User Check

- **Choice**: Keep the encrypted JWE session cookie (`src/lib/auth/session.ts`) and include `userId`, `role`, and `pwd` (a short HMAC fingerprint of the user's `passwordHash` or `inviteTokenHash`).
  - `src/proxy.ts` performs the fast stateless JWE decryption check at the edge.
  - `getSession()` verifies the JWE and checks the cached `User` row (confirming the user exists, `disabledAt === null`, and the `passwordHash` fingerprint still matches).

## Risks / Trade-offs

- **[Risk] Upstream `main` adds a new table or query** → **Mitigation**: Centralizing scoping in `src/lib/prisma.ts` means existing queries need no changes; only brand-new models added upstream need their model name registered in the tenant-scoped model list during a `main` → `master` merge.
- **[Risk] Background schedules running without a request cookie** → **Mitigation**: `runWithUser(userId, fn)` explicitly binds `AsyncLocalStorage` for each user in `runner.ts`, `google/sync.ts`, `agent/schedule.ts`, and `startups/schedule.ts`.
- **[Risk] Failover doubling latency when primary key is unreachable** → **Mitigation**: Only retry when a distinct secondary key is actually configured and usable, and immediately fail over on HTTP `401`/`402`/`403`/`429`/`503` without waiting for a second timeout.

## Migration Plan

1. **Prisma Migration**: Add `User` table and `userId` columns (initially nullable or defaulted during migration) to user-owned tables, update primary/unique keys (`ProfileField`, `Setting`, etc.).
2. **Bootstrap on Startup (`src/instrumentation.ts` & seed)**: Ensure `ensureInitialAdmin()` runs on server startup: if `User` count is `0`, create the initial `ADMIN` user (`email: env.DOSSIER_ADMIN_EMAIL ?? "admin"`, `passwordHash: env.DOSSIER_PASSWORD`, `allowGlobalKeys: true`) and claim any rows with `userId = ""` (except instance-wide settings).
3. **Rollback**: Database backups prior to migration can restore the single-tenant schema if needed.
