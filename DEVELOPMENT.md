# Sred.io — Development Log

This document records every significant problem encountered during the build, why it happened, and exactly how it was fixed. It is written so that anyone reading the codebase cold can understand the non-obvious decisions.

---

## Table of Contents

1. [nodemon Not Auto-Restarting the Server](#1-nodemon-not-auto-restarting-the-server)
2. [Scraper Returning 0 Changelogs](#2-scraper-returning-0-changelogs)
3. [`__Host-` Cookies Cannot Be Re-Injected into a New Browser](#3-__host--cookies-cannot-be-re-injected-into-a-new-browser)
4. [Live Browser Lost After Server Restart](#4-live-browser-lost-after-server-restart)
5. [Wrong Airtable Activity Endpoint URL](#5-wrong-airtable-activity-endpoint-url)
6. [`readRowComments` Returns No Field-Change Activity](#6-readrowcomments-returns-no-field-change-activity)
7. [Response Object Had the Wrong Key Name](#7-response-object-had-the-wrong-key-name)
8. [SyntaxError: Unexpected Token `||` in changelog.parser.ts](#8-syntaxerror-unexpected-token--in-changelogparserts)
9. [TypeScript Errors Inside `page.evaluate()` Callbacks](#9-typescript-errors-inside-pageevaluate-callbacks)
10. [AG Grid Cells Overflowing and Text Collapsing](#10-ag-grid-cells-overflowing-and-text-collapsing)
11. [Sensitive / Large Fields Appearing in the Grid](#11-sensitive--large-fields-appearing-in-the-grid)
12. ["200 Pages" Requirement — Terminology Confusion](#12-200-pages-requirement--terminology-confusion)
13. [Airtable API Pagination for 200+ Records](#13-airtable-api-pagination-for-200-records)
14. [Seed Script Was Making Automated Changes (Defeating the Test)](#14-seed-script-was-making-automated-changes-defeating-the-test)
15. [Entity Dropdown Called "Records" Instead of "Tickets"](#15-entity-dropdown-called-records-instead-of-tickets)
16. [UI Sidebar Text Not Clearly White / Layout Not Responsive](#16-ui-sidebar-text-not-clearly-white--layout-not-responsive)

---

## 1. nodemon Not Auto-Restarting the Server

### Problem
Every time a `.ts` file was changed the developer had to manually kill and restart the backend server with `ts-node src/server.ts`. There was no hot-reload.

### Why It Happened
The `package.json` `dev` script was pointing directly at `ts-node-dev`, but `ts-node-dev` was not installed in the project. The script silently failed to watch for changes.

### Fix
Created `backend/nodemon.json`:
```json
{
  "watch": ["src"],
  "ext": "ts,json",
  "ignore": ["src/**/*.spec.ts", "src/**/*.test.ts"],
  "exec": "ts-node --transpile-only src/server.ts"
}
```
Updated `backend/package.json`:
```json
"dev": "nodemon"
```
`--transpile-only` skips full type-checking on each restart, making reloads fast. Type errors are still caught by the IDE and the build step.

---

## 2. Scraper Returning 0 Changelogs

### Problem
After running the scraper against 200+ records, every record reported `raw = []` — the response body was empty. Zero changelogs were written to MongoDB.

### Why It Happened
There were three stacked bugs (each masked the next):

1. The URL used the record ID as a **query parameter** instead of a **path segment**.
2. The endpoint name itself was wrong (`readRowComments` instead of `readRowActivitiesAndComments`).
3. A required request parameter was missing (`shouldReturnDeserializedActivityItems: true`).

All three had to be fixed together before any data came back.

### Fix
Correct URL (record ID in the path):
```
/v0.3/row/{recordId}/readRowActivitiesAndComments
```
Correct query parameters:
```typescript
const stringifiedObjectParams = encodeURIComponent(JSON.stringify({
  limit: 50,
  offsetV2: null,
  shouldReturnDeserializedActivityItems: true,
  shouldIncludeRowActivityOrCommentUserObjById: true,
}));
```
These were discovered by opening Chrome DevTools → Network tab on a real Airtable session, opening a record's Revision History panel, and capturing the exact network request Airtable's own frontend makes.

---

## 3. `__Host-` Cookies Cannot Be Re-Injected into a New Browser

### Problem
The original approach was: log in once with Puppeteer, save the cookies to MongoDB, then inject those saved cookies into a fresh Puppeteer browser for every scraping run. This produced `403 Forbidden` errors on every request.

### Why It Happened
Airtable uses `__Host-` prefixed session cookies. The `__Host-` prefix is a browser security feature defined in RFC 6265bis:

- The cookie **must not** have a `Domain` attribute set.
- The cookie **must** come from the server — it cannot be created by client-side JavaScript or injected via `document.cookie`.
- Puppeteer's `page.setCookie()` method always sets a `domain` field internally, which **invalidates** any `__Host-` cookie.

So any cookie extracted from one browser session and injected into another one is silently rejected by the browser. The request goes through but Airtable's server treats it as unauthenticated.

### Fix
Kept the login browser **alive** throughout the entire scraping session instead of closing it after login. A module-level `Map` stores the live browser reference:

```typescript
// cookie.service.ts
const liveBrowsers = new Map<string, { browser: Browser; page: Page }>();
```

`startAuth()` stores the browser in the map instead of closing it. `runScraper()` retrieves it with `CookieService.takeLiveBrowser(sessionId)` and reuses the same authenticated page. The `__Host-` cookies stay valid because they live in the original browser context that received them from Airtable's server.

---

## 4. Live Browser Lost After Server Restart

### Problem
If the backend server was restarted (e.g., nodemon reload after a file save), the scraper would log `[Scraper] Live browser not found` and fall back to a fresh unauthenticated browser, causing the 403 issue again.

### Why It Happened
`liveBrowsers` is an in-memory JavaScript `Map`. When the Node.js process exits, the entire map is garbage-collected. Any session that was authenticated before the restart has no live browser after it.

### Fix
This is a known limitation of the architecture (no fix was applied — it is intentional). The correct workflow is:

1. Start the server.
2. Authenticate (this creates the live browser).
3. Run the scraper **in the same server session**.
4. Do not restart the server between authentication and scraping.

The fallback to `openAirtablePage(session.cookies)` is intentionally kept in the code but logged as a warning. It will not work for `__Host-` cookies but remains as a graceful degradation path for future cookie architectures.

---

## 5. Wrong Airtable Activity Endpoint URL

### Problem
Even after switching to the live browser, every request returned a `404 Not Found`.

### Why It Happened
The original URL format guessed from documentation was:
```
GET /v0.3/row/readRowActivitiesAndComments?rowId={recordId}
```
This is incorrect. Airtable's internal API puts the record ID **in the path**, not in the query string:
```
GET /v0.3/row/{recordId}/readRowActivitiesAndComments
```

The difference is subtle and not documented publicly — it was only visible by inspecting real network traffic.

### How the Correct URL Was Discovered
A `discoverActivityEndpoint` method was added to `cookie.service.ts`. It:
1. Sets up a `page.on('response', ...)` listener to intercept all API calls.
2. Navigates the live browser to the Airtable base.
3. Programmatically clicks "Expand record" and then "Revision History".
4. Captures every API URL that fires.
5. Returns the full list and the matched `readRowActivitiesAndComments` URL.

This revealed the correct path structure. The URL format was then hardcoded into `fetchRevisionHistoryInPage`.

---

## 6. `readRowComments` Returns No Field-Change Activity

### Problem
One intermediate attempt used `readRowComments` instead of `readRowActivitiesAndComments`. It returned a valid JSON response but `orderedCommentIds` was always `[]`.

### Why It Happened
`readRowComments` only returns **user-typed comments** (like messages people leave on a record). It does not return field-change events (Status changed from X to Y, Assignee changed).

Field-change events are a separate concept in Airtable called **row activities**. They come from `readRowActivitiesAndComments` with `shouldReturnDeserializedActivityItems: true`.

### Fix
Switched to `readRowActivitiesAndComments` permanently. The `readRowComments` path was kept in `changelog.parser.ts` as a legacy fallback parser (`parseReadRowCommentsResponse`) but is no longer called by the scraper.

---

## 7. Response Object Had the Wrong Key Name

### Problem
After getting a valid response from the correct endpoint, the parser was reading `response.orderedCommentIds` — which was `undefined`. No activities were parsed.

### Why It Happened
The response shape for `readRowActivitiesAndComments` is different from `readRowComments`:

| Endpoint | Activity array key | Detail map key |
|---|---|---|
| `readRowComments` | `orderedCommentIds` | `commentsById` |
| `readRowActivitiesAndComments` | `orderedActivityAndCommentIds` | `rowActivityInfoById` |

The parser was written for the comments endpoint and used the wrong keys.

### Fix
Updated `parseActivities` in `changelog.parser.ts` to detect which key is present and route accordingly:
```typescript
if ('orderedActivityAndCommentIds' in data) {
  return parseReadRowActivitiesResponse(data, issueId, baseId, tableId);
}
if ('commentsById' in data) {
  return parseReadRowCommentsResponse(data, issueId, baseId, tableId);
}
```

---

## 8. SyntaxError: Unexpected Token `||` in changelog.parser.ts

### Problem
The backend crashed on startup with:
```
SyntaxError: Unexpected token '||'
```
at `changelog.parser.ts:244`.

### Why It Happened
JavaScript operator precedence. The `??` (nullish coalescing) operator has lower precedence than `||` (logical OR), but mixing them without parentheses is a syntax error in strict mode:
```typescript
// WRONG — SyntaxError
const authoredBy = userObj.name ?? userObj.email ?? authorId || 'unknown';
```

### Fix
Added parentheses to make the grouping explicit:
```typescript
// CORRECT
const authoredBy = (userObj.name ?? userObj.email ?? authorId) || 'unknown';
```

---

## 9. TypeScript Errors Inside `page.evaluate()` Callbacks

### Problem
TypeScript reported errors on `document`, `HTMLMetaElement`, and other browser globals inside `page.evaluate(...)` callbacks.

### Why It Happened
The TypeScript `tsconfig.json` targets **Node.js**, so the DOM type definitions (`lib.dom.d.ts`) are not included. `document`, `window`, `HTMLElement`, etc. are unknown types in the Node.js compilation context, even though at runtime these callbacks execute inside a real browser (Chrome via Puppeteer).

### Fix
Added `// @ts-ignore` comments above each browser-global usage inside `page.evaluate()` callbacks. This is correct because:
- TypeScript is right that these types don't exist in the Node context.
- Puppeteer is also right that they will exist at runtime in the browser context.
- `@ts-ignore` suppresses the compile-time error without affecting runtime behaviour.

---

## 10. AG Grid Cells Overflowing and Text Collapsing

### Problem
In the Raw Data grid, long values (record IDs, JSON objects, long strings) overflowed their cells, causing text from one cell to visually overlap the next column. Some columns were so wide they pushed others off-screen.

### Why It Happened
AG Grid's default `defaultColDef` does not set `overflow: hidden` on cells. Long values simply render beyond the cell boundary in the DOM. Without `maxWidth` constraints, every column auto-sized to its content, causing wide variation.

### Fix
Updated `defaultColDef` in `raw-data.component.ts`:
```typescript
defaultColDef: ColDef = {
  cellStyle: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  tooltipValueGetter: (p) => typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value ?? ''),
  ...
};
```
Added specific `maxWidth` caps per field:
- `_id` → 130px (pinned left)
- `columnType` → 120px
- `newValue` / `oldValue` → 200px max
- Large JSON fields → 120px max

Enabled `autoSizeAllColumns()` on first data render so columns fit their content within those caps.

---

## 11. Sensitive / Large Fields Appearing in the Grid

### Problem
The Raw Data grid was showing columns like `cookies`, `password`, `diffRowHtml`, `rawActivity`, and `organizationId`. These are either sensitive data or very large JSON blobs that made the grid unreadable.

### Why It Happened
`buildColDefs()` was dynamically building columns from every key in the response object, with no filtering.

### Fix
Added two exclusion sets in `buildColDefs()`:

```typescript
// Hidden entirely
const hiddenFields = new Set(['__v', 'organizationId', 'cookies', 'diffRowHtml', 'password']);

// Shown as a [JSON] badge instead of raw content
const largeJsonFields = new Set(['rawActivity', 'fields', 'views', 'integrationInfo']);
```

Large JSON fields render a small grey `[JSON]` badge. Hovering shows the full JSON in a tooltip (via `tooltipValueGetter`). Sensitive fields are removed from the column list entirely.

---

## 12. "200 Pages" Requirement — Terminology Confusion

### Problem
The task requirements said *"test with at least 200 Pages"*. The seed script was written for 200 **records**. It was unclear whether these were the same thing.

### Why It Happened
The requirements document uses Airtable's terminology where the records endpoint is described as:
```
Tickets (pages): /{baseId}/{tableId}
```
"Pages" and "Tickets" both refer to individual **rows** in an Airtable table — the expand-record view opens each row as a full-page modal, hence "page". The word "records" is Airtable's API terminology for the same thing.

So: **1 page = 1 ticket = 1 record = 1 row**.

The seed script creating 200 records is correct. No change was needed to the count.

### Terminology Alignment
To match the requirements document language, the Entity dropdown label was updated from "Records" → **"Tickets"** in `COLLECTION_LABELS` (`frontend/src/app/core/models/index.ts`).

---

## 13. Airtable API Pagination for 200+ Records

### Problem
The question was raised: will syncing 200 records work, or does pagination need to be implemented?

### Why It Matters
Airtable's API returns a maximum of **100 records per request**. For 200 records, at least 2 API calls are required. If pagination is not handled, only the first 100 records get synced.

### Finding
The sync service (`airtable.service.ts`, `syncRecords` method) already implements Airtable's offset-based pagination correctly:

```typescript
do {
  const params: Record<string, any> = { pageSize: 100 };
  if (offset) params.offset = offset;

  const data = await airtableGet(organizationId, `/${baseId}/${tableId}`, params);
  // ... process records ...
  offset = data.offset;          // undefined when no more pages
} while (offset);
```

For 200 records this makes 2 API calls (100 + 100) automatically. No change was needed.

---

## 14. Seed Script Was Making Automated Changes (Defeating the Test)

### Problem
The original seed script had two phases:
1. Create 200 records with random Status and Priority.
2. Update 120 of those records — changing Status and adding Assignee.

Phase 2 existed to pre-populate revision history. But the requirement asks the developer to **manually** change Status and Assignee in the Airtable UI, so the scraper can be verified against real human-made changes.

### Why It Was Wrong
If Phase 2 runs, all the "revision history" is from a programmatic batch update. It would always succeed trivially — it does not test whether the scraper works against real user interactions in the Airtable UI.

### Fix
Phase 2 was completely removed from `backend/src/scripts/seed-airtable.ts`. The seed now only:
1. Creates 200 tickets with Title, Status, and Priority.
2. Exits with instructions to manually change fields in Airtable.

The workflow becomes:
```
npm run seed          → creates 200 tickets
(manual) open Airtable → change Status / Assignee on some tickets
Sync All in UI        → pulls records into MongoDB
Run Scraper           → fetches revision history for those manual changes
```

---

## 15. Entity Dropdown Called "Records" Instead of "Tickets"

### Problem
The Entity dropdown on the Raw Data page showed "Records". The requirements document uses the word "Tickets" for this entity.

### Why It Happened
The collection label map used "Records" — a generic Airtable API term — rather than the domain language in the spec.

### Fix
One-line change in `frontend/src/app/core/models/index.ts`:
```typescript
// Before
airtable_records: 'Records',

// After
airtable_records: 'Tickets',
```
The MongoDB collection name and API routes remain `airtable_records` internally. Only the display label changed.

---

## 16. UI Sidebar Text Not Clearly White / Layout Not Responsive

### Problem
Several UI issues were reported:
- Sidebar nav item text appeared grey/dim rather than clearly white.
- The sidebar did not have a toggle on mobile — it was always visible and covered content.
- The Airtable Integration and Scraper pages had too much empty space, inconsistent spacing, and a generic Material look.
- Cell text on the Raw Data page collapsed into neighbouring columns.

### Why They Happened

**Sidebar text colour**: Angular Material's `mat-list-item` component applies its own internal CSS specificity that overrides `color` set on the `<a>` element from outside. `rgba(255,255,255,0.8)` was set on the custom selector but Material's internal styles (`--mdc-list-list-item-label-text-color`) won the cascade.

**No mobile toggle**: The original `mat-sidenav` was set to `mode="side" opened` — always open, no responsive behaviour wired up.

**Page spacing**: All three pages were using Angular Material `mat-card` inside `mat-card` with default padding stacking, creating double-padded sections that looked bloated.

### Fix

**Sidebar**: Replaced `MatSidenavModule` + `mat-nav-list` entirely with plain `<nav>` and `<a>` elements styled with pure CSS. This eliminates Material's specificity override — the author has full control over all colours and states.

Key rules:
```css
.nav-link         { color: #94a3b8; }   /* dim grey by default */
.nav-link:hover   { color: #e2e8f0; }   /* near-white on hover */
.nav-link--active { color: #fff; background: #1d4ed8; } /* solid blue + white */
```

**Responsive toggle**: `navOpen = signal(window.innerWidth > 768)` — open by default on desktop, closed on mobile. A hamburger button toggles it. On mobile the sidebar uses `position: fixed` + `transform: translateX(-100%)` when closed, and a dark overlay closes it on tap.

**Airtable Integration / Scraper pages**: Replaced `mat-card` wrappers with plain `<div class="card">` with a single consistent padding of `22px 24px`, `1px solid #e2e8f0` border, and `border-radius: 10px`. Removed all double-nesting. Stat tiles use a 4-column CSS grid that collapses to 2 columns on mobile.

**AG Grid**: Row height increased to 40px, font to 14px, grid line colour darkened to `#e2e8f0` with column separators enabled — giving a clean spreadsheet appearance consistent with the requirements.

---

## Architecture Decisions

| Decision | Reason |
|---|---|
| Keep live Puppeteer browser in-memory (not serialised to DB) | `__Host-` cookies cannot survive browser context serialisation — they must stay in the browser that received them |
| BullMQ job queue in the same process as the HTTP server | The `liveBrowsers` Map must be accessible to the job worker; a separate worker process would not share in-memory state |
| `shouldReturnDeserializedActivityItems: true` required | Without this flag Airtable returns raw HTML-only activity blobs; with it the `diffRowHtml` field is included which is what the Cheerio parser reads |
| Cheerio for HTML parsing (not regex) | `diffRowHtml` contains nested spans with inline CSS class identifiers (`box-shadow: greenLight1`). A DOM tree walk is far more reliable than regex for this structure |
| Offset-based pagination loop in `syncRecords` | Airtable's REST API uses cursor-based pagination via an `offset` token in the response; a `do...while(offset)` loop is the correct pattern — not a page-number counter |
| Seed creates data only, no automated updates | The test requires verifying the scraper against real user-driven revision history, not scripted changes |
