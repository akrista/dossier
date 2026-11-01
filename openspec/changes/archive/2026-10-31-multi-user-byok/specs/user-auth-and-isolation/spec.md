# Spec Delta

## Purpose

Provides multi-user authentication (`ADMIN` and `USER` roles), initial administrator bootstrapping, one-time invite acceptance, and strict per-user data isolation across Dossier's database, background jobs, and external integrations.

## ADDED Requirements

### Requirement: Multi-user credential authentication
The system SHALL authenticate users on `/login` using a unique case-insensitive identifier (email or username) and password, issuing an encrypted session cookie tied to that user's ID, role, and password hash fingerprint.

#### Scenario: Valid user sign-in
- **WHEN** an active user submits a matching identifier and password on `/login`
- **THEN** the system sets an encrypted session cookie carrying the user's `userId`, `role`, and password fingerprint, resets login throttle counters for the IP, and redirects to the requested page or dashboard

#### Scenario: Disabled or non-existent user sign-in
- **WHEN** a visitor submits credentials for a disabled user, a non-existent identifier, or an incorrect password
- **THEN** the system increments the login throttle counter and returns the generic invalid-credentials error without revealing whether the account exists

#### Scenario: Password change invalidates prior sessions
- **WHEN** a user's password hash changes (by the user or by an administrator) or the user account is disabled
- **THEN** any previously issued session cookie for that user is rejected on subsequent requests and redirects the visitor to `/login`

### Requirement: Initial administrator bootstrap and migration
The system SHALL automatically provision an initial `ADMIN` user from `DOSSIER_PASSWORD` (and `DOSSIER_ADMIN_EMAIL`, defaulting to `"admin"`) when no users exist, and SHALL assign any pre-existing single-tenant data to that administrator.

#### Scenario: First startup on an empty or migrating database
- **WHEN** the server starts or runs migrations and the `User` table has no rows
- **THEN** the system creates an active `ADMIN` user with `allowGlobalKeys = true` using `DOSSIER_PASSWORD` and assigns existing unscoped profile, application, theme, setting, and integration rows to that user

### Requirement: One-time invite link onboarding
The system SHALL allow aninvited user with a valid, unexpired invite token to set their password and sign in without public self-registration.

#### Scenario: Accepting a valid invite token
- **WHEN** a visitor opens `/login/invite?token=<token>` with a valid, unexpired token and submits a new password
- **THEN** the system saves the user's password hash, clears the invite token so it cannot be reused, and starts an authenticated session

#### Scenario: Expired or invalid invite token
- **WHEN** a visitor opens or submits an expired or unknown invite token
- **THEN** the system refuses password setup and displays an error instructing them to ask an administrator for a new invite link

### Requirement: Strict per-user data isolation
The system SHALL isolate all user-owned profile, application, document, job-search, agent, startup, Google, Claude connector, background job, and user-setting records by `userId` so each user can only read, modify, export, or import their own data, while keeping built-in themes (`builtIn = true`) readable by all authenticated users.

#### Scenario: User queries or mutates data
- **WHEN** an authenticated user views pages, runs Server Actions, connects Gmail/Calendar, uses the Claude MCP connector, or exports/imports data
- **THEN** only records belonging to that user's `userId` (plus shared built-in themes) are returned or modified

#### Scenario: Background schedules execute per user
- **WHEN** background schedules run (job runner, Gmail inbox sync, daily job agent, startups refresh)
- **THEN** each task executes within the owning user's context using that user's profile, settings, and key resolution rules
