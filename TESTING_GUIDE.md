# Sred.io — Airtable Integration Testing Guide

> **Date:** 2026-06-19  
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

Expected: server starts on `http://localhost:3000`, Swagger UI at `http://localhost:3000/api-docs`.

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
6. Verify: browser is redirected back to your app (`AIRTABLE_REDIRECT_URI`), e.g. `http://localhost:4200/airtable/callback`.
7. Verify: the UI shows a **"Connected"** status or success toast — no error screen.

### A-3. Confirm Tokens Stored in MongoDB

```bash
mongosh
use sred
db.airtableconnections.findOne()
```

Expected: document with `accessToken`, `refreshToken`, `expiresAt` fields, and **no** plaintext secrets echoed in logs.

### A-4. Fetch Projects (Bases) — `GET /meta/bases`

```bash
curl http://localhost:3000/api/airtable/bases
```

Expected:
- HTTP 200
- JSON array of base objects (`id`, `name`, `permissionLevel`)
- Same data visible in the UI bases list / dropdown

Verify in MongoDB:
```bash
db.airtablebases.find().count()   # must be > 0
```

### A-5. Fetch Tables — `GET /meta/bases/:baseId/tables`

1. Pick a `baseId` from the bases returned above.
2. Call:

```bash
curl http://localhost:3000/api/airtable/bases/<baseId>/tables
```

Expected:
- HTTP 200
- JSON array with `id`, `name`, `fields` for each table.

Verify in MongoDB:
```bash
db.airtabletables.find({ baseId: "<baseId>" }).count()   # must be > 0
```

### A-6. Fetch Tickets (Records/Pages) with Pagination — `GET /:baseId/:tableId`

1. Pick a `tableId` from step A-5.
2. Call:

```bash
curl "http://localhost:3000/api/airtable/bases/<baseId>/tables/<tableId>/records"
```

Expected:
- HTTP 200
- All records returned (not just the first 100 page — pagination must be followed)
- If the table has >100 rows, verify total stored count exceeds 100:

```bash
db.airtablerecords.find({ tableId: "<tableId>" }).count()   # > 100 if table is large
```

### A-7. Fetch Users — `GET /Users`

```bash
curl http://localhost:3000/api/airtable/users
```

Expected:
- HTTP 200
- JSON array of user objects.

Verify in MongoDB:
```bash
db.airtableusers.find().count()   # must be > 0
```

---

## Part B — Cookie Scraping & Revision History

### B-1. Trigger Cookie Retrieval (No MFA)

1. In the frontend, navigate to the **Scraper** or **Revision History** section.
2. Enter your Airtable **email** and **password**.
3. Click **Get Cookies / Authenticate**.
4. Verify: UI shows **"Cookies retrieved successfully"** (or equivalent status).

Check backend logs — should show Puppeteer launching, logging in, cookies extracted.

### B-2. Validate Cookies

```bash
curl http://localhost:3000/api/scraper/validate-cookies
```

Expected: `{ "valid": true }` response.

Alternate via UI: a **Check Cookie Status** button/indicator should show green/valid.

### B-3. Trigger Cookie Retrieval with MFA

1. Enable MFA on your Airtable account (if not already), OR use a test account that has MFA.
2. In the frontend, begin the cookie retrieval flow.
3. When prompted, enter the **6-digit MFA code** into the MFA input field that appears.
4. Click **Submit MFA**.
5. Verify: cookies are retrieved successfully despite MFA being required.

### B-4. Test Expired Cookie Handling

1. Manually expire or invalidate stored cookies (simplest: delete the `scraperssessions` document in MongoDB, or wait for expiry).

```bash
db.scrapersessions.deleteMany({})
```

2. Trigger a revision history fetch (see B-5).
3. Verify: the system **automatically re-authenticates** (fetches new cookies) without crashing.
4. Check logs for: "Cookies expired — re-authenticating" or equivalent.

### B-5. Fetch Revision History for a Single Ticket

```bash
curl -X POST http://localhost:3000/api/scraper/fetch-changelog \
  -H "Content-Type: application/json" \
  -d '{ "recordId": "<airtable_record_id>" }'
```

Expected:
- HTTP 200 or 202 (queued)
- Response contains parsed changelog entries in the format:

```json
{
  "recordId": "recXXX",
  "changes": [
    {
      "timestamp": "2026-01-15T10:30:00Z",
      "field": "Status",
      "from": "In Progress",
      "to": "Done",
      "changedBy": "Jane Doe"
    }
  ]
}
```

Only **Assignee** and **Status** changes should be present (other field changes filtered out).

Verify in MongoDB:
```bash
db.changelogs.findOne({ recordId: "<airtable_record_id>" })
```

### B-6. Verify HTML Parsing

1. Check one stored changelog document.
2. Confirm all fields are properly parsed (no raw HTML strings in the document).
3. Confirm `timestamp` is ISO 8601 format.
4. Confirm `field` values are `"Status"` or `"Assignee"` only.

### B-7. Bulk Revision History — 200 Tickets Test

1. Ensure at least 200 records are stored from step A-6.
2. Trigger the bulk scraping job:

```bash
curl -X POST http://localhost:3000/api/scraper/fetch-all-changelogs
```

Or via the UI: **Fetch All Revision Histories** button.

3. Monitor progress (BullMQ queue processing — check Redis):

```bash
redis-cli
KEYS bull:*
```

4. Wait for completion (this may take several minutes for 200 records).
5. Verify final count:

```bash
db.changelogs.countDocuments()   # should be >= 200
```

6. Spot-check 5 random records to confirm data quality:

```bash
db.changelogs.aggregate([{ $sample: { size: 5 } }])
```

Each document should have at least one `changes` entry with `field` equal to `"Status"` or `"Assignee"`.

---

## Part C — Frontend UI (AG Grid)

### C-1. Active Integrations Dropdown

1. Open `http://localhost:4200` and navigate to the data grid / dashboard view.
2. Click the **Active Integrations** dropdown.
3. Verify **Airtable** appears as an option.
4. Select **Airtable**.
5. Verify: the Entity dropdown populates with available collections.

### C-2. Entity (Collection) Dropdown

1. With Airtable selected, click the **Entity** dropdown.
2. Verify: the list shows the MongoDB collections synced from Airtable (e.g., bases, tables, records, users, changelogs).
3. Select a collection (e.g., **Records**).
4. Verify: the AG Grid loads and displays data from that collection.

### C-3. Dynamic Column Rendering

1. With a collection selected, verify the AG Grid column headers are generated **dynamically** from the collection's fields — not hardcoded.
2. Switch to a different collection (e.g., **Users**).
3. Verify: columns change to reflect the new collection's schema.
4. Switch back — columns should revert correctly.

### C-4. Search Functionality

1. With data loaded in the grid, type a keyword into the **Search** input box.
2. Verify: the grid filters rows in real-time to show only rows containing the keyword.
3. Clear the search box.
4. Verify: all rows return.
5. Test with a keyword that matches zero rows — grid should show an empty state message, not an error.

### C-5. Column Sorting

1. Click on any column header.
2. Verify: rows sort **ascending** on first click.
3. Click the same column header again.
4. Verify: rows sort **descending**.
5. Click a third time (or click another column).
6. Verify: sort resets or shifts to the new column.

### C-6. Column Filtering

1. Hover over a column header and click the **filter icon** (AG Grid built-in).
2. Enter a filter value.
3. Verify: grid rows update to match the filter.
4. Apply filters on two different columns simultaneously.
5. Verify: both filters combine correctly (AND logic).
6. Clear all filters.
7. Verify: full data set is restored.

### C-7. Revision History Column / View

1. Select the **Changelogs** or **Revision History** entity in the Entity dropdown.
2. Verify: columns include `recordId`, `field`, `from`, `to`, `changedBy`, `timestamp` (or equivalent).
3. Sort by `timestamp` descending — most recent changes should appear first.
4. Filter by `field = "Status"` — only status changes should be visible.
5. Filter by `field = "Assignee"` — only assignee changes should be visible.

### C-8. UI Polish Checks

| Check | Pass Criteria |
|---|---|
| Loading spinner shown while data fetches | Visible spinner, grid empty until load completes |
| Empty state | Friendly message when no data, not a blank/broken grid |
| Error state | Toast or banner if API call fails, no unhandled JS errors in console |
| Responsive layout | No horizontal scroll on the page body at 1280px width |
| No hardcoded tenant data or API URLs in page source | Inspect → Sources; no secrets visible |

---

## End-to-End Smoke Test (Run Last)

Run this sequence in one continuous flow to validate the full integration:

1. **Disconnect** Airtable (revoke/remove stored token from the UI if the feature exists).
2. Re-connect via OAuth (A-1 → A-2).
3. Fetch all data: bases → tables → records (200+) → users (A-4 → A-7).
4. Retrieve cookies with MFA (B-3).
5. Run bulk changelog fetch for 200 records (B-7).
6. Open the AG Grid, select Airtable → Records, search and filter (C-1 → C-6).
7. Switch to Changelogs entity, filter by Status, sort by timestamp (C-7).

Expected: zero unhandled errors in both browser console and backend logs throughout.

---

## Quick Reference — Useful MongoDB Queries

```bash
# Record counts per collection
db.airtablebases.countDocuments()
db.airtabletables.countDocuments()
db.airtablerecords.countDocuments()
db.airtableusers.countDocuments()
db.changelogs.countDocuments()

# Check changelogs have only Status/Assignee changes
db.changelogs.find({ "changes.field": { $nin: ["Status", "Assignee"] } }).count()
# Expected: 0

# Sample changelog entry
db.changelogs.findOne({}, { changes: 1 })
```

---

## Quick Reference — Key API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/airtable/bases` | List all Airtable bases |
| `GET` | `/api/airtable/bases/:id/tables` | List tables in a base |
| `GET` | `/api/airtable/bases/:id/tables/:tid/records` | Fetch all records (paginated) |
| `GET` | `/api/airtable/users` | Fetch Airtable users |
| `GET` | `/api/scraper/validate-cookies` | Check cookie validity |
| `POST` | `/api/scraper/fetch-changelog` | Fetch revision history for one record |
| `POST` | `/api/scraper/fetch-all-changelogs` | Bulk fetch revision history (200+ records) |
