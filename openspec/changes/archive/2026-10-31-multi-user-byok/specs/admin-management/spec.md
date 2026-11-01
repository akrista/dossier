# Spec Delta

## Purpose

Provides administrators (`role = ADMIN`) with an interface and server actions to manage user accounts, invitations, per-user key permissions and overrides, global API keys, key failover preferences, and instance-level settings.

## ADDED Requirements

### Requirement: Role-based access control for administration
The system SHALL restrict `/admin` routes, user/key management actions, and instance-level settings (nightly disk backups, release update checks, usage telemetry, and global Google OAuth client credentials) exclusively to authenticated users with `role = ADMIN`.

#### Scenario: Non-admin user accesses admin route or action
- **WHEN** an authenticated user with `role = USER` navigates to `/admin` or invokes an admin-only Server Action
- **THEN** the system denies access with a `403`/unauthorized error and does not expose user lists or global settings

### Requirement: Admin user lifecycle management
The system SHALL allow an `ADMIN` user to list all users, create a new user (setting an initial password or generating a one-time invite link), change a user's role, enable or disable a user account, reset a user's password/invite link, and delete a user account along with their isolated data. An administrator SHALL NOT be able to disable, demote, or delete the last active `ADMIN` account.

#### Scenario: Admin creates a user with an invite link or initial password
- **WHEN** an administrator creates a user with an email/username, role, `allowGlobalKeys` setting, and either a direct password or invite option
- **THEN** the system creates the `User` record and returns the one-time invite URL (if requested) for the administrator to share

#### Scenario: Protecting the last active administrator
- **WHEN** an administrator attempts to delete, disable, or demote the only remaining active `ADMIN` user
- **THEN** the system rejects the action with a clear error message

### Requirement: Admin management of global keys, priority policy, and per-user key overrides
The system SHALL allow an `ADMIN` user to configure global AI and job-search keys, set the instance default `keyPreference` (`USER_FIRST` or `GLOBAL_FIRST`), toggle `allowGlobalKeys` and per-user `keyPreference` for any user, and directly set or clear a specific user's BYOK AI or job-search keys without revealing stored plaintext keys.

#### Scenario: Admin configures global keys and `USER_FIRST` priority
- **WHEN** an administrator saves a global AI or job-search key and selects `USER_FIRST` as the key priority
- **THEN** users with `allowGlobalKeys = true` use their own BYOK key first and automatically fail over to the saved global key when their own key is absent or fails

#### Scenario: Admin sets or clears a specific user's BYOK key
- **WHEN** an administrator assigns or clears an AI or job-search key for a target user in the Admin panel
- **THEN** the target user's encrypted key setting is updated or removed, and the Admin UI reflects whether the user has a key configured without displaying the secret value
