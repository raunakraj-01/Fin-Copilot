# Verify the configured MongoDB database

The normal development server uses `MONGODB_URI` from `server/.env`. An Atlas URI starts with `mongodb+srv://` and points to a `mongodb.net` cluster. `npm run demo` uses a separate temporary database and cannot verify Atlas.

From the repository root:

```powershell
npm run db:check
npm run db:check -- --write-test
```

The first command checks connectivity, authentication, ping and discovered replica-set member status. It does not create application records. It does not print the connection string, database credentials or business data.

The second command writes to the configured database. It creates a random temporary account and business, saves an invoice through the real HTTP API, updates it to a partial payment, disconnects from MongoDB, reconnects, signs in again and checks persisted amounts and the forecast. It also checks that anonymous callers cannot read the invoice. It removes its own account, sessions, business and invoice in a finally block, including on assertion failures. Ordinary authentication rate-limit records expire normally; normal app initialization can create missing collections/indexes. It does not edit existing business records. Do not repeatedly run it in a loop: registration/login rate limits still apply. If the process is forcibly terminated or the network becomes unavailable, inspect the temporary db-check account/business before retrying.

Connection and request timeouts are bounded. Certificate validation remains enabled. The checker refuses the common insecure TLS bypass settings rather than treating a bypassed connection as a successful verification.

## Verification on 5 November 2026

The previously reported all-node server-selection failure was not reproduced during the new checks. Three fresh authenticated connections reached the primary. The full authenticated API save/update/reconnect/read/forecast test passed against the existing Atlas URI; test data was removed.

Two discovered members still rejected TLS handshakes with `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, including direct IPv4 and TLS 1.2 checks. The primary accepted TLS and ordinary reads/writes. This is partial connectivity, not proof of healthy replica-set failover. No connection-string, password, IP allowlist, certificate-verification or cluster setting was changed, and the cause of the earlier total failure has not been established.

Follow-up after the user activated Atlas: a fresh check discovered all three members with **zero unavailable members**. The full API save, partial-payment update, reconnect/login, persisted read, forecast and anonymous-access checks passed again, and temporary records were removed. The previously observed TLS member failures were absent in this check. This verifies current connectivity and persistence; failover was not deliberately triggered.

For the remaining member connectivity issue, inspect Atlas cluster health and project Network Access. Verify the current client public IP has a narrow allowed entry and that the network/firewall permits the cluster members on port 27017. If the same member errors remain after those checks, test from another trusted network and contact Atlas support with the TLS error and timestamp. Do not pin the application to the currently reachable primary or disable TLS verification as a workaround. See [MongoDB's connection troubleshooting guide](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

## Use normal development mode

```powershell
# Terminal 1, repository root
npm run dev

# Terminal 2
cd client
npm run dev
```

Open http://localhost:5173. Configure `CLIENT_ORIGIN=http://localhost:5173` for this setup. Register your own account and create a business to enter fabricated data. Old ownerless businesses stay locked until a trusted administrator follows [the ownership assignment steps](AUTHENTICATION.md); a working database connection does not grant access to those records.
