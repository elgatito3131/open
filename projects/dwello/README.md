# Dwello — a property ledger you can inspect

An original learning rebuild of a property-management application, using **React, Node.js, Express, and PostgreSQL**. Start in an illustrated neighborhood and click an apartment window to open its paperwork. Create a lease or record a rent receipt on a focused ledger page, then return to the building. Every successful change is stored in PostgreSQL.

All seed names, addresses, payments, and organizations are fictional. This is newly written demonstration code, not a recovered historical Dwello product or evidence of earlier business claims.

![Dwello local demonstration](docs/preview.png)

## Run locally

Requirements: Node.js 22.12+ and PostgreSQL with the standard `btree_gist` extension. The repository helper uses PostgreSQL 18. The repository's Frontier sibling also uses `pgvector`; Dwello itself does not use vectors.

From this directory:

```sh
npm ci
./scripts/start.sh
```

Open **http://127.0.0.1:4200**. The Express API runs on **127.0.0.1:4201**. The script starts the repository's isolated local database using `../../scripts/postgres.sh`; it then reads credentials from ignored `../../.runtime/database.env`. It does not configure a system login service.

To use another local database:

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE'
npm run dev
```

Startup creates the schema and seeds an empty ledger. It preserves an existing ledger. The database role must be able to create tables and `btree_gist`, or an administrator must provision that extension first. Do not point this demo at a production database.

For a built frontend served by Express alone:

```sh
npm run build
npm start
```

Then open http://127.0.0.1:4201. Set `DATABASE_URL` first, or source the shared environment and export `DATABASE_URL="$DWELLO_DATABASE_URL"` in your terminal. Neither credentials nor database files belong in Git.

## Try the complete path

1. Open the October 2026 ledger. Select vacant unit **102** or **202**.
2. Add a fictional tenant, email, whole-month lease dates, and rent. Example: October 1, 2026–September 30, 2027.
3. Save. React posts to Express; the server validates inputs and commits a tenant and lease in one transaction.
4. Record a payment for that lease. A receipt appears and its balance changes.
5. Reload the browser. Both records remain because PostgreSQL stores them.
6. Open **How it works** for the request explanation and optional source. Replay the recorded steps and read the SQL and values that actually ran. Return to the same unit or building when finished.

The trace is an explanation of completed server work, not a network packet animation or live debugger. Replaying/resetting the trace does not replay or undo the database change.

## Build, follow, read

**Build the project:** start with `schema.sql`, then read validation, service operations, HTTP routes, and React components. The data model is:

```text
properties ──< units ──< leases >── tenants
                            │
                            └──< payments
```

**Follow execution:** a lease form posts JSON to `POST /api/leases`. The service validates it, locks the unit, inserts a tenant, inserts a lease, commits, and returns IDs. React reloads the persisted ledger. On failure before commit, the transaction rolls back both inserts.

**Read source:** `server/validation.js` defines accepted inputs. `server/service.js` executes parameterized SQL. `schema.sql` defines the integrity rules. `server/app.js` translates results/errors into HTTP responses. `client/src/App.jsx` handles user input and renders the result. The source endpoint exposes only these five known files.

## API

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/health` | Database connectivity |
| GET | `/api/ledger?month=2026-10` | Units with their lease, tenant, receipts, and balance |
| POST | `/api/leases` | Atomic tenant + lease creation |
| POST | `/api/payments` | A persisted rent receipt |
| GET | `/api/source?file=server/service.js` | Allowlisted source text |

Successful ledger/write responses contain `{ data, trace }`. Errors contain `{ error: { code, message }, trace }`. Monetary API values are integer cents, avoiding floating-point currency arithmetic. Input errors use 400; missing resources 404; duplicate emails, overlapping leases, and excess payments 409.

## Test

```sh
./scripts/test.sh
npm run build
```

The integration suite uses the real database in a unique temporary schema, then removes that schema. It does not reset the interactive ledger. Checks cover persisted creation through a fresh database connection, overlap rollback without orphan tenants, duplicate/malformed input, two concurrent payments racing for the same balance, direct database overpayment rejection, source allowlisting, and rejected cross-origin writes.

## Deliberate limits

- One local property and workspace; no login, tenant accounts, deployment, or multi-organization authorization.
- Whole calendar-month leases with inclusive end dates. No proration, deposits, refunds, fees, renewals, or receipt editing.
- Payments are recorded receipts, not bank transfers. No external payment service is contacted.
- A new lease creates a new tenant; an existing tenant's renewal is a future feature.
- PostgreSQL foreign keys and a range exclusion constraint prevent invalid references and overlapping leases. A lease row lock and database trigger prevent concurrent overpayment.
- The server binds to loopback and rejects browser writes from unrelated origins. This is a local learning application, not a production SaaS security model.

Next independent exercise: add a renewal endpoint that reuses an existing tenant and creates a new, non-overlapping lease without overwriting history.

Primary documentation: [React state](https://react.dev/learn/state-a-components-memory), [Express error handling](https://expressjs.com/en/guide/error-handling.html), [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL range constraints](https://www.postgresql.org/docs/current/rangetypes.html).
