# Spec Delta

## ADDED Requirements

### Requirement: Key resolution transparency in user settings
The system SHALL display a clear notice in `Settings → AI provider` and `Settings → Job search` indicating whether the signed-in user is required to provide their own BYOK key (`allowGlobalKeys = false`) or is permitted to use server global keys (`allowGlobalKeys = true`), including whether a personal BYOK key is currently saved and the active failover priority (`USER_FIRST` vs `GLOBAL_FIRST`).

#### Scenario: User with `allowGlobalKeys = true` views AI or Job Search settings
- **WHEN** an authenticated user with `allowGlobalKeys = true` visits `Settings → AI provider` or `Settings → Job search`
- **THEN** the page displays a notice explaining their active key priority (`USER_FIRST` or `GLOBAL_FIRST`) and whether requests currently use their personal key, the server's global key, or automatic failover between both
