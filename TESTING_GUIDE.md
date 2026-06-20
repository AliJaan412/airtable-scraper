# Sred.io — Airtable Integration Testing Guide

> **Date:** 2026-06-21
> **Stack:** Node 22 · Express · MongoDB · Angular 19 · AG Grid 33

---

## Prerequisites

| Requirement | Check |
|---|---|
| Node v22 installed | `node -v` → `v22.x.x` |
| MongoDB running locally | `mongosh` connects on `27017` |
| Redis running locally | `redis-cli ping` → `PONG` |
| `.env` file present in `backend/` | contains `MONGO_URI`, `REDIS_URL`, `AIRTABLE_CLIENT_ID`, `AIRTABLE_CLIENT_SECRET`, `AIRTABLE_REDIRECT_URI` |
| Airtable account with at least one base + 200+ records | logged in at airtable.com |

---

## 0. Start the Application

### 0.1 — Start the Backend

```bash
cd backend
npm install
npm run dev
```

Expected: server starts on `http://localhost:3000`, Swagger UI at **`http://localhost:3000/api/docs`**.

### 0.2 — Start the Frontend

```bash
cd frontend
npm install
npm start
```

Expected: Angular dev server starts on `http://localhost:4200`.

---

## Part A — OAuth Authentication & API Data Fetch

### A-1. Initiate OAuth Flow

1. Open `http://localhost:4200` in a browser.
2. Navigate to the **Airtable** integration section (sidebar or top nav).
3. Click **Connect Airtable** (or equivalent CTA button).
4. Verify: browser redirects to `https://airtable.com/oauth2/v1/authorize` with correct `client_id`, `redirect_uri`, and `scope` query params visible in the URL bar.

### A-2. Authorize and Receive Tokens

5. Log in to Airtable (if not already) and click **Allow access**.
6. Verify: browser is redirected back to your app (`AIRTABLE_REDIRECT_URI`), e.g. `http://localhost:4200/integrations/airtable?connected=true`.
7. Verify: the UI shows a **"Connected"** status — no error screen.

### A-3. Confirm Tokens Stored in MongoDB

```bash
mongosh
use sred
db.airtableconnections.findOne({}, { accessToken: 1, refreshToken: 1, expiresAt: 1, scope: 1, lastSyncedAt: 1 })
```

Expected: document with `accessToken`, `refreshToken`, `expiresAt`, and `scope` fields. No plaintext secrets in backend logs.

**Token behavior:**
- Access token expires after ~1 hour. The backend auto-refreshes it silently on the next status check.
- Refresh token lasts 60 days and resets on every successful use — active users never truly expire.
- `isExpired: true` is only returned to the UI when BOTH the access and refresh tokens are expired.

### A-4. Sync All Data and Confirm

Trigger a full sync from the UI (click **Sync All**) or via API:

```bash
curl -s -X POST http://localhost:3000/api/airtable/sync \
  -H "Content-Type: application/json" | jq '.data'
```

Expected response:
```json
{ "bases": 2, "tables": 8, "records": 247, "users": 4 }
```

After sync, `lastSyncedAt` is stamped on the connection and visible in the UI as "Last synced X minutes ago".

### A-5. Fetch Bases

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_bases","page":1,"pageSize":50}' | jq '._meta'
```

Expected:
- HTTP 200
- `_meta.total` > 0
- Each item has `baseId`, `name`, `permissionLevel`

### A-6. Fetch Tables

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_tables","page":1,"pageSize":50}' | jq '._meta.total'
```

To filter by a specific base, add a `filters` object:

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_tables","filters":{"baseId":"<baseId>"},"page":1,"pageSize":50}'
```

Expected:
- HTTP 200
- `_meta.total` > 0
- Each item has `tableId`, `name`, `fields` array

### A-7. Fetch Records with Pagination

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_records","filters":{"tableId":"<tableId>"},"page":1,"pageSize":100}'
```

To confirm pagination was followed during sync:

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_records","filters":{"tableId":"<tableId>"},"page":2,"pageSize":100}' \
  | jq '._meta'
```

Expected:
- `_meta.total` matches the full record count in Airtable (not capped at 100)
- `_meta.totalPages` > 1 if the table has more than 100 rows

### A-8. Fetch Users

```bash
curl -s -X POST http://localhost:3000/api/raw-data/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"airtable_users","page":1,"pageSize":50}' | jq '._meta.total'
```

Expected:
- HTTP 200
- `_meta.total` > 0
- Each item has `userId`, `name`, `email`

> **Note on user sources:** Enterprise plans use `/meta/users`. Pro/Business plans use whoami + per-base collaborators. Trial/Free plans extract users from collaborator-type field values in synced records (Tier 3 fallback — always works regardless of plan).

### A-9. Auto-Sync on Page Load (Data Freshness)

When data is stale (>30 minutes since `lastSyncedAt`), the frontend auto-triggers a sync on page load without any user action.

To test:
1. Connect and sync once.
2. Manually set `lastSyncedAt` to 31+ minutes ago in MongoDB:

```bash
db.airtableconnections.updateOne({}, { $set: { lastSyncedAt: new Date(Date.now() - 35 * 60 * 1000) } })
```

3. Reload the Airtable page in the frontend.
4. Verify: backend logs show a sync starting automatically (no button click required).

---

## Part B — Cookie Scraping & Revision History

### B-1. Start Cookie Authentication (No MFA)

1. In the frontend, navigate to the **Scraper** or **Revision History** section.
2. Enter your Airtable **email** and **password**.
3. Click **Authenticate** / **Get Cookies**.

Or via API:

```bash
curl -s -X POST http://localhost:3000/api/scraper/auth/start \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"YourPassword123!"}' | jq '.data'
```

Expected response:
```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "status": "idle" }
```

**Save the `sessionId`** — you need it for all subsequent scraper calls.

Check backend logs — should show Puppeteer launching, clearing stale cookies via CDP, navigating to Airtable login, cookies extracted.

### B-2. Validate Stored Cookies

```bash
curl -s -X POST http://localhost:3000/api/scraper/auth/validate \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<sessionId from B-1>"}' | jq '.data'
```

Expected: `{ "valid": true }` (or `{ "valid": false, "reason": "..." }` if cookies expired).

Alternate via UI: a **Check Cookie Status** indicator should show green/valid.

### B-3. Authentication with MFA

1. Use an Airtable account that has MFA enabled (TOTP authenticator app).
2. Start auth as in B-1 — the response will show `"status": "awaiting_mfa"`.
3. Submit the 6-digit TOTP code:

```bash
curl -s -X POST http://localhost:3000/api/scraper/auth/mfa \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<sessionId>","mfaCode":"123456"}' | jq '.data'
```

Expected: `{ "authenticated": true }`

4. Run validate (B-2) to confirm cookies are now stored.

### B-4. Test Expired Cookie Handling

1. Manually expire stored cookies by deleting the session:

```bash
mongosh
use sred
db.scraper_sessions.deleteMany({})
```

2. Attempt to start a scraping job (B-5) — the system should detect missing/invalid cookies and prompt re-authentication.
3. Verify: no unhandled crash; the error is surfaced cleanly in the UI or API response.

### B-5. Start the Bulk Scraping Job

After successful cookie validation (B-2), enqueue the scraping job:

```bash
curl -s -X POST http://localhost:3000/api/scraper/run \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<sessionId from B-1>"}' | jq '.data'
```

Expected:
```json
{ "started": true, "sessionId": "550e8400-...", "jobId": "1" }
```

The job is enqueued in BullMQ and runs in the background. It iterates every synced Airtable record and scrapes the revision history for each one. Results are stored in `airtable_changelogs`.

Or via the UI: click **Fetch All Revision Histories**.

### B-6. Monitor Scraping Progress

Poll the session status while the job is running:

```bash
curl -s http://localhost:3000/api/scraper/session/<sessionId> | jq '.data'
```

Expected while running:
```json
{
  "sessionId": "550e8400-...",
  "status": "running",
  "progress": { "total": 247, "processed": 80, "failed": 0 },
  "startedAt": "2026-06-21T08:00:00.000Z"
}
```

Expected when complete:
```json
{
  "status": "completed",
  "progress": { "total": 247, "processed": 247, "failed": 3 },
  "completedAt": "2026-06-21T08:12:00.000Z"
}
```

Monitor BullMQ queue in Redis:

```bash
redis-cli KEYS "bull:*"
```

### B-7. Verify Changelog Data — 200+ Tickets

1. Ensure at least 200 records were synced from step A-7.
2. After scraping completes (B-6), verify the total count:

```bash
mongosh
use sred
db.airtable_changelogs.countDocuments()   # should be > 0
```

3. Check overall stats:

```bash
curl -s http://localhost:3000/api/scraper/stats | jq '.data'
```

Expected: breakdown by `columnType`, e.g. `{ "Assignee": 142, "Status": 89, "total": 231 }`.

4. Spot-check 5 random changelog entries to confirm data quality:

```bash
db.airtable_changelogs.aggregate([{ $sample: { size: 5 } }])
```

Each document should have these fields: `issueId`, `baseId`, `tableId`, `columnType`, `oldValue`, `newValue`, `authoredBy`, `createdDate`.

Example document:
```json
{
  "issueId": "recXXXXXXXXXXXXXX",
  "columnType": "Assignee",
  "oldValue": "Jane Doe",
  "newValue": "John Smith",
  "authoredBy": "Alice",
  "createdDate": "2026-06-20T09:30:00.000Z"
}
```

5. Verify HTML parsing is clean — no raw HTML strings in stored documents:

```bash
db.airtable_changelogs.findOne({ newValue: /</ })   # should return null
```

### B-8. Verify HTML Parsing Quality

1. Check that `createdDate` is ISO 8601 format:

```bash
db.airtable_changelogs.findOne({}, { createdDate: 1 })
```

2. Confirm `oldValue` is correctly populated for Assignee changes (not null when a previous assignee existed):

```bash
db.airtable_changelogs.findOne({ columnType: "Assignee", oldValue: { $ne: null } })
```

3. Confirm Status changes have correct `newValue` (the status label, not a color class):

```bash
db.airtable_changelogs.find({ columnType: "Status" }).limit(5).toArray()
```

---

## Part C — Frontend UI (AG Grid Data Explorer)

### C-1. Active Integrations Dropdown

1. Open `http://localhost:4200` and navigate to the data grid / dashboard view.
2. Click the **Active Integrations** dropdown.
3. Verify **Airtable** appears as an option.
4. Select **Airtable**.
5. Verify: the Entity dropdown populates with available collections.

### C-2. Entity (Collection) Dropdown

1. With Airtable selected, click the **Entity** dropdown.
2. Verify: the list shows the synced MongoDB collections (Bases, Tables, Tickets, Users, Changelogs, Scraper Sessions).
3. Select a collection (e.g., **Tickets**).
4. Verify: the AG Grid loads and displays data from that collection.

### C-3. Dynamic Column Rendering

1. With a collection selected, verify AG Grid column headers are generated **dynamically** from the collection's field schema — not hardcoded.
2. Switch to a different collection (e.g., **Users**).
3. Verify: columns change to reflect the new collection's schema.
4. Switch back — columns should revert correctly.

### C-4. Search Functionality

1. With data loaded in the grid, type a keyword into the **Search** input box.
2. Verify: the grid filters rows to show only rows containing the keyword.
3. Clear the search box.
4. Verify: all rows return.
5. Test with a keyword that matches zero rows — grid should show an empty state message, not an error.

### C-5. Column Sorting

1. Click on any column header.
2. Verify: rows sort **ascending** on first click.
3. Click the same column header again.
4. Verify: rows sort **descending**.
5. Click another column — sort shifts to the new column.

### C-6. Column Filtering

1. Hover over a column header and click the **filter icon** (AG Grid built-in).
2. Enter a filter value.
3. Verify: grid rows update to match the filter.
4. Apply filters on two different columns simultaneously.
5. Verify: both filters combine correctly (AND logic).
6. Clear all filters — full data set is restored.

### C-7. Changelogs / Revision History View

1. Select the **Changelogs** entity in the Entity dropdown.
2. Verify: columns include `issueId`, `columnType`, `oldValue`, `newValue`, `authoredBy`, `createdDate`.
3. Sort by `createdDate` descending — most recent changes should appear first.
4. Filter by `columnType = "Status"` — only status changes should be visible.
5. Filter by `columnType = "Assignee"` — only assignee changes should be visible.
6. Verify `oldValue` is populated correctly for Assignee changes (not null when a prior assignee existed).

### C-8. Last Synced Label

1. After a successful sync, verify the Airtable connection card shows "Last synced X minutes ago".
2. The label updates immediately after clicking **Sync All** without a page refresh.
3. On page load (if data is stale >30 min), verify auto-sync triggers automatically and the label updates.

### C-9. UI Polish Checks

| Check | Pass Criteria |
|---|---|
| Loading spinner shown while data fetches | Visible spinner; grid empty until load completes |
| Empty state | Friendly message when no data, not a blank/broken grid |
| Error state | Toast or banner if API call fails; no unhandled JS errors in console |
| Responsive layout | No horizontal scroll on the page body at 1280px width |
| No hardcoded tenant data or API URLs in page source | Inspect → Sources; no secrets visible |

---

## End-to-End Smoke Test (Run Last)

Run this sequence in one continuous flow to validate the full integration:

1. **Disconnect** Airtable from the UI (removes stored token).
2. Re-connect via OAuth (A-1 → A-2).
3. Trigger full sync: bases → tables → records (200+) → users (A-4 → A-8).
4. Retrieve cookies with MFA (B-3).
5. Start bulk changelog scraping and wait for completion (B-5 → B-6).
6. Open the AG Grid, select Airtable → Tickets, search and filter (C-1 → C-6).
7. Switch to Changelogs entity, filter by Status, sort by createdDate descending (C-7).

Expected: zero unhandled errors in both browser console and backend logs throughout.

---

## Quick Reference — Useful MongoDB Queries

```javascript
// Record counts per collection
db.airtable_bases.countDocuments()
db.airtable_tables.countDocuments()
db.airtable_records.countDocuments()
db.airtable_users.countDocuments()
db.airtable_changelogs.countDocuments()
db.scraper_sessions.countDocuments()

// Check connection and last sync time
db.airtableconnections.findOne({}, { accessToken: 0, refreshToken: 0 })

// All Assignee changes
db.airtable_changelogs.find({ columnType: "Assignee" }).limit(5)

// All Status changes
db.airtable_changelogs.find({ columnType: "Status" }).limit(5)

// Changelogs where old value was not null
db.airtable_changelogs.find({ columnType: "Assignee", oldValue: { $ne: null } }).limit(5)

// Sample 5 random changelogs
db.airtable_changelogs.aggregate([{ $sample: { size: 5 } }])

// Latest scraper session
db.scraper_sessions.findOne({}, {}, { sort: { startedAt: -1 } })

// Count changelogs per field type
db.airtable_changelogs.aggregate([{ $group: { _id: "$columnType", count: { $sum: 1 } } }])
```

---

## Quick Reference — Key API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/airtable/oauth/authorize` | Get Airtable OAuth authorization URL |
| `GET` | `/api/airtable/status` | Check connection status + lastSyncedAt |
| `POST` | `/api/airtable/sync` | Full sync (bases → tables → records → users) |
| `POST` | `/api/airtable/sync/bases` | Sync bases only |
| `POST` | `/api/airtable/sync/tables/:baseId` | Sync tables for one base |
| `POST` | `/api/airtable/sync/records/:baseId/:tableId` | Sync records for one table |
| `GET` | `/api/airtable/bases` | Get all synced bases from MongoDB |
| `GET` | `/api/airtable/tables?baseId=` | Get all synced tables (filter by baseId) |
| `GET` | `/api/airtable/records?tableId=` | Get records with pagination |
| `GET` | `/api/airtable/users` | Get all synced users |
| `POST` | `/api/airtable/disconnect` | Disconnect and clear tokens |
| `POST` | `/api/scraper/auth/start` | Start Puppeteer auth (`{email, password}`) |
| `POST` | `/api/scraper/auth/mfa` | Submit MFA code (`{sessionId, mfaCode}`) |
| `POST` | `/api/scraper/auth/validate` | Validate stored cookies (`{sessionId}`) |
| `POST` | `/api/scraper/run` | Start bulk scraping job (`{sessionId}`) |
| `GET` | `/api/scraper/session/:sessionId` | Poll session progress |
| `GET` | `/api/scraper/session/org/latest` | Get latest session for the org |
| `GET` | `/api/scraper/changelogs` | Get parsed changelogs (filter: issueId, columnType…) |
| `GET` | `/api/scraper/stats` | Changelog counts by column type |
| `GET` | `/api/raw-data/collections` | List queryable MongoDB collections |
| `GET` | `/api/raw-data/schema/:collection` | Get field names for a collection |
| `POST` | `/api/raw-data/query` | Query any collection (search, filter, sort, paginate) |

Full interactive documentation at: **`http://localhost:3000/api/docs`**
