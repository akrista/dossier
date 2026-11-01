# key-management-and-failover Specification

## Purpose

Governs how AI provider keys and job-search API keys are stored per user (BYOK) and globally (Admin), how per-user global key permission (`allowGlobalKeys`) and priority (`USER_FIRST` vs `GLOBAL_FIRST`) are evaluated, and how requests automatically fail over between user and global keys.

## Requirements

### Requirement: Per-user BYOK key storage
The system SHALL allow every authenticated user to configure, test, and remove their own encrypted AI provider key (`apiKeyEnc`) and job-search keys (`jsearchKeyEnc`, `adzunaKeyEnc`, `adzunaAppId`) in Settings without exposing or altering any other user's keys or the global keys.

#### Scenario: User saves their own API key
- **WHEN** a user saves an AI provider key or job-search key in Settings
- **THEN** the system encrypts the key with `DOSSIER_SECRET` and stores it in that user's own settings scope

### Requirement: Per-user global key authorization (`allowGlobalKeys`)
The system SHALL enforce the user's `allowGlobalKeys` flag when resolving AI and job-search credentials. When `allowGlobalKeys` is `false`, the user SHALL NOT use global Admin keys or `DOSSIER_AI_*` / `DOSSIER_JSEARCH_KEY` / `DOSSIER_ADZUNA_KEY` environment keys.

#### Scenario: User with `allowGlobalKeys = false` has no BYOK key
- **WHEN** a user with `allowGlobalKeys = false` has not configured their own key and triggers an AI task or paid job-search query
- **THEN** the system blocks the call and prompts the user to configure their own API key in Settings

#### Scenario: User with `allowGlobalKeys = false` has a BYOK key
- **WHEN** a user with `allowGlobalKeys = false` has configured their own key and triggers an AI task or job-search query
- **THEN** the system executes the request using only the user's own key and does not fall back to global keys if the request fails

### Requirement: Configurable key preference and automatic failover
When `allowGlobalKeys` is `true`, the system SHALL order available user and global credentials according to the effective `keyPreference` (`USER_FIRST` or `GLOBAL_FIRST`), use the secondary credential when the primary is unset, and automatically retry once with the secondary credential when the primary fails due to auth (`401`/`402`/`403`), quota (`429`), or upstream unavailability (`503`/unreachable).

#### Scenario: `USER_FIRST` uses user BYOK key then fails over to global key
- **WHEN** a user has `allowGlobalKeys = true`, effective preference `USER_FIRST`, a configured BYOK key, and a configured global key, and the user's BYOK key fails with an auth, quota (`429`), or provider error
- **THEN** the system retries the AI or job-search request using the global key and returns the result if the global key succeeds

#### Scenario: `GLOBAL_FIRST` uses global key then fails over to user BYOK key
- **WHEN** a user has `allowGlobalKeys = true`, effective preference `GLOBAL_FIRST`, a configured global key, and a configured BYOK key, and the global key fails with an auth, quota (`429`), or provider error
- **THEN** the system retries the request using the user's BYOK key and returns the result if the user's key succeeds

#### Scenario: `USER_FIRST` with no user BYOK key falls back to global key immediately
- **WHEN** a user has `allowGlobalKeys = true`, effective preference `USER_FIRST`, no BYOK key configured, and a global key is configured
- **THEN** the system executes the request directly with the global key

### Requirement: Key resolution transparency in user settings
The system SHALL display a clear notice in `Settings → AI provider` and `Settings → Job search` indicating whether the signed-in user is required to provide their own BYOK key (`allowGlobalKeys = false`) or is permitted to use server global keys (`allowGlobalKeys = true`), including whether a personal BYOK key is currently saved and the active failover priority (`USER_FIRST` vs `GLOBAL_FIRST`).

#### Scenario: User with `allowGlobalKeys = true` views AI or Job Search settings
- **WHEN** an authenticated user with `allowGlobalKeys = true` visits `Settings → AI provider` or `Settings → Job search`
- **THEN** the page displays a notice explaining their active key priority (`USER_FIRST` or `GLOBAL_FIRST`) and whether requests currently use their personal key, the server's global key, or automatic failover between both
