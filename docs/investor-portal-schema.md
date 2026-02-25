# Investor Portal schema (JSON datastore migration)

This project uses a JSON datastore (`storage/data.json` by default), so the investor portal migration is implemented as runtime shape migration in `loadDB()` and `ensureInvestorTables()`.

Added collections:
- `investorProfiles` (maps `investor_profiles`)
- `investorLogins` (maps `investor_logins`)
- `investorPermissions` (maps `investor_permissions`)
- `investorCashflows` (maps `investor_cashflows`)
- `investorValuations` (maps `investor_valuations`)
- `investorInvites` (maps `investor_invites`)
- `investorSessions` (separate investor auth sessions)

Indexes/constraints are enforced in application logic:
- one login per investor profile (`investorProfileId` uniqueness)
- unique login email
- unique valuation per (`investorProfileId`, `valuationDate`)
- investor ownership checks (`masterUserId`)
