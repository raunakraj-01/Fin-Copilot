# Accounts and business isolation

Owners and accountants register and sign in with email and a password of 15–128 characters. A new business belongs to its creator. Business lists come from server membership records; a browser profile, supplied role or business ID does not grant access.

## Permissions

| Action | Owner | Invited accountant |
| --- | --- | --- |
| View this business's records and forecasts | Yes | Yes |
| Import, match payments, maintain records and promises, use/save planning analyses | Yes | Yes |
| Delete records or saved analyses | Yes | No |
| Change business settings and reserves | Yes | No |
| Invite/remove accountants | Yes | No |
| Configure integrations, telemetry consent, messaging and payment offers | Yes | No |

Under Setup & Import → Business access, the owner creates an invitation for an accountant's exact email and shares the link privately. Invitations expire after 48 hours, are single-use, and can be revoked. The accountant signs in with that email before accepting. Removal blocks subsequent API requests even when the accountant still has a valid login session. There is one owner per business; ownership transfer is not exposed through the API.

## Existing businesses

Existing ownerless businesses are locked. They are never automatically assigned to the first account that signs in. A trusted administrator with database access must verify ownership and run, from the repository root:

```powershell
cd server
node scripts/assign-business-owner.mjs <workspaceId> <registered-owner-email>
```

Use the same `MONGODB_URI` as the running server. The account must already exist. The script assigns only an ownerless business and refuses to transfer one already owned. Restarting or seeding does not grant HTTP access to these records. Sample data is loaded into a newly created, owned business through the app.

## Sessions and API enforcement

- Passwords use independently salted scrypt hashes (N=32768, r=8, p=3). Raw passwords and session tokens are not stored in the database.
- Random 256-bit opaque sessions have an absolute eight-hour lifetime. Cookies are HttpOnly, SameSite=Strict and host-only. Production uses a Secure `__Host-` cookie and requires HTTPS.
- Mutating session requests require a session-bound `X-CSRF-Token`; supplied browser origins must exactly match `CLIENT_ORIGIN`. The CSRF value stays in frontend memory. Authentication and business responses use `Cache-Control: no-store`.
- Logout revokes the session in the database. `POST /api/auth/password` accepts `currentPassword` and `newPassword`, revokes all old sessions and returns a new session. Disabled users and removed members fail subsequent authorization checks.
- Login, registration and password-change attempts have persisted rate limits. Behind a reverse proxy, configure a trusted edge rate limiter; the app deliberately does not trust arbitrary forwarded IP headers.
- A central gate protects every business API family before controllers or upload parsers run. Membership is checked on each request. Child records are also queried within the authorized business. Another business's URL or child ID cannot grant access.
- Health and account creation/login are public. Razorpay webhooks authenticate with their provider signature. Integration APIs authenticate with the separate credentials described below. Unknown routes return 404.

## Integration migration

Legacy shared `FEATURE_ADMIN_TOKEN`, `TALLY_SYNC_TOKEN`, `OBSERVATION_TOKEN` and `FOLLOWUP_AUTOMATION_TOKEN` values no longer grant access. Demo/local flags do not bypass login.

Owners enroll a sync device in Operations and create an automation credential under Business access. Credentials are shown once, stored as hashes, scoped to one business and one purpose, and can be revoked. Sync credentials allow only that business's sync batches and consent-gated observations. Automation credentials allow only that business's follow-up claims, dispatch validation and acknowledgements; sending also requires `FOLLOWUP_ALLOW_SEND=1`. They cannot access ordinary financial APIs. Existing workers must be configured with newly issued credentials. Cross-business pooled reliability scoring is disabled; observations are read only within the authorized business.

For deployment set `NODE_ENV=production`, `CLIENT_ORIGIN` to the exact HTTPS browser origin, and a private `MONGODB_URI`. Serve frontend and API on the same site (the default production frontend calls `/api`). Protect database and worker credentials separately. Docker includes the ownership-assignment script and sample fixtures.

## Current limits

This implementation does not provide MFA, email verification, a forgotten-password email flow, an account-management UI for changing passwords, ownership transfer or a security audit log. Invitation possession plus the matching signed-in email is required; account email ownership is not independently verified. Administrators should establish their recovery process before onboarding real businesses. These controls have automated regression coverage; they are not a substitute for an independent production security review.

Implementation references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [Node crypto](https://nodejs.org/api/crypto.html).
