# SQL Database Tool

The **SQL Database** tool (`type: "sql"`) lets events and workflows query SQL
databases, pass fetched rows to the next workflow step via Unified I/O, and use
Cronium variables and inputs in queries — safely.

One tool covers every supported engine. A **dialect** selector on the credential
form picks the engine, and execution dispatches to a per-dialect driver adapter.

**Supported today:** PostgreSQL, MySQL. (Snowflake is planned; the adapter
interface already accommodates it.)

## Connecting a database

Add a credential under **Tools → SQL Database**:

| Field                   | Notes                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| **Database Type**       | `PostgreSQL` or `MySQL`.                                                                         |
| **Host** / **Port**     | Port defaults to 5432 (Postgres) / 3306 (MySQL) if left blank.                                   |
| **Database**            | The database/schema to connect to.                                                               |
| **User** / **Password** | Use a **least-privilege** user — read-only for query-only workflows.                             |
| **SSL Mode**            | `disable`, `require` (encrypt, no CA check), or `verify-full` (validate the server certificate). |

Credentials are encrypted at rest (AES-256-GCM). The password is never returned
to the browser, and editing other fields keeps the stored password (submit it
blank to leave it unchanged).

Use **Test Connection** to verify before saving; it runs a lightweight
`SELECT version()`.

## Actions

### Run Query

Runs a **read-only** statement (`SELECT` / `WITH` / `EXPLAIN` / `SHOW`) and
returns the rows. This action **produces output**: its result becomes the next
workflow step's `cronium.input()`.

Result shape:

```json
{
  "columns": ["id", "email"],
  "rows": [{ "id": 42, "email": "a@b.com" }],
  "rowCount": 1
}
```

Parameters:

- **query** — SQL using `:named` placeholders for values (edited in a SQL code
  editor).
- **params** — optional JSON object mapping placeholder names to values (may be
  templates; see below). Leave blank if the query has no placeholders.
- **maxRows** — optional row limit (default **10,000**). If the query returns
  more, the action **fails** rather than returning a shortened result.

The **statement timeout** comes from the event's **Timeout** setting (in Event
Settings) — there is no separate per-action timeout.

Run Query rejects any statement that isn't read-only, and rejects multiple
(stacked) statements — so a "read" node can never mutate data.

### Execute Statement

Runs a single write statement (`INSERT` / `UPDATE` / `DELETE` / DDL) and returns
`{ "rowCount": <affected> }`. It does **not** produce Unified I/O output, and it
runs **once** (never retried — a partially-applied write must not be re-sent).

## Using values, variables, and inputs safely

The safe, default mechanism is **bound parameters**. Write `:named` placeholders
in the query and put the values in **params**; Cronium binds them through the
driver, so user data is never concatenated into SQL (no injection).

```
query:  SELECT * FROM orders WHERE customer_id = :cid AND status = :status
params: { "cid": "{{cronium.input.customerId}}", "status": "active" }
```

Parameter **values** may contain Cronium templates — `{{cronium.input.*}}`,
`{{cronium.getVariables.*}}` — which Cronium renders before binding. The query
text itself should contain only `:placeholders`, not `{{...}}`; parameters and
identifiers cannot be swapped for bound values, so keep untrusted data in
`params`.

## Passing rows to the next event (Unified I/O)

A **Run Query** node's result is handed to the next workflow event exactly like a
script's `cronium.output()`. Downstream, read it via `cronium.input()`:

```python
# next event, Python
data = cronium.input()      # { "columns": [...], "rows": [...], "rowCount": N }
for row in data["rows"]:
    print(row["email"])
```

Or reference it in another tool action's parameters with
`{{cronium.input.rows}}`.

## Large result sets and bulk ETL

Data passed between events travels through Unified I/O: the payload is held in
the app's memory, written to `job.result` (jsonb), and served to the next step.
It is sized for handing a **modest result** to the next step — not for bulk
transfer. Two limits apply to Run Query:

- **Row limit** — `maxRows` (default 10,000). Exceeding it **fails the action**
  instead of returning a truncated result, so a job can never look successful
  while quietly dropping rows. Add a `LIMIT`, or raise `maxRows`.
- **Size limit** — the result must fit the **5 MB** Unified I/O payload limit
  (the same limit a script's `cronium.output()` gets). Raising `maxRows` past
  what fits in 5 MB will fail on size instead.

Run Query **streams** the result (a server-side cursor on Postgres, a row stream
on MySQL) and stops as soon as either limit is hit, so a `SELECT` over a huge
table fails fast on the limit rather than pulling the table into the app's
memory first. Peak memory is bounded by the size limit no matter how large the
result set would have been.

Roughly, 5 MB is on the order of tens of thousands of narrow rows. That covers
report-sized reads. For a genuine ETL, don't move the rows through Cronium at
all — pick whichever fits:

**1. Server-side, zero transfer (best when source and target are the same
database, or reachable via FDW/dblink).** Let the database do the work; no rows
enter Cronium, so there is no practical size limit:

```sql
-- Execute Statement
INSERT INTO analytics.orders_daily (id, total, day)
SELECT id, total, date_trunc('day', created_at)
FROM public.orders
WHERE created_at >= :since;
```

**2. A Script event that streams (best for cross-system ETL).** A Python/Node
script event runs in its own container, so it can stream millions of rows with a
server-side cursor and write them to the destination in batches, without holding
the whole result in memory or passing it between events:

```python
# Python script event — streams in batches, never materializes the full result
import psycopg
with psycopg.connect(SOURCE_DSN) as src, psycopg.connect(TARGET_DSN) as dst:
    with src.cursor(name="etl") as cur:      # server-side cursor
        cur.itersize = 5000
        for row in cur.execute("SELECT id, total FROM orders"):
            ...  # write to dst in batches
```

Rule of thumb: use **Run Query** when the next step needs to _see_ the rows; use
**Execute Statement** or a **Script event** when the rows just need to _move_.

## Security notes

- **Least privilege is the real backstop.** Connect with a restricted database
  user; a read-only role makes Run Query workflows safe by construction.
- **Read-only guard.** Run Query parses the leading keyword and refuses writes
  and stacked statements; use Execute Statement for writes.
- **Bound parameters** are the default and prevent injection; keep untrusted
  values in `params`, not spliced into the query text.
- **Transport.** Prefer `verify-full` where you can validate the server
  certificate; `require` still encrypts.
- **Connection targets.** Like HTTP events, the SQL tool connects to
  user-configured hosts and does not allowlist them — connecting to your own
  internal databases is the point (single-tenant / operator-is-author model).
- **Resource limits.** A row limit (`maxRows`, default 10,000 — exceeding it
  fails rather than truncating), the 5 MB Unified I/O payload limit, and the
  event's Timeout (applied as the SQL statement timeout and as an overall cap on
  the action) bound memory and the payload. See "Large result sets and bulk ETL"
  above. Values with imprecise types (`BIGINT`, `DECIMAL`), dates, and binary are
  returned JSON-safe (numbers as strings, dates as ISO strings, blobs as base64).
