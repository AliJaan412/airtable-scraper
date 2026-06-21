import { Router } from 'express';
import { ScraperController } from '../controllers/scraper.controller';

const router = Router();

/**
 * @swagger
 * /api/scraper/auth/start:
 *   post:
 *     summary: Start Airtable cookie authentication
 *     description: >
 *       Launches a headless Puppeteer browser, clears any stale session cookies via CDP,
 *       navigates to airtable.com/login, and enters the provided credentials.
 *       Returns a `sessionId` to use in subsequent calls.
 *       If MFA is enabled on the Airtable account, the session status becomes `awaiting_mfa`
 *       — submit the TOTP code via `POST /api/scraper/auth/mfa`.
 *     tags: [Scraper]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *                 description: Airtable account email
 *               password:
 *                 type: string
 *                 example: "YourPassword123!"
 *                 description: Airtable account password
 *     responses:
 *       200:
 *         description: Authentication started — check `status` to know if MFA is required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       example: "550e8400-e29b-41d4-a716-446655440000"
 *                       description: Save this — pass it to all subsequent scraper endpoints
 *                     status:
 *                       type: string
 *                       enum: [authenticating, awaiting_mfa, idle]
 *                       example: awaiting_mfa
 *       400:
 *         description: Missing email or password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Puppeteer browser error or Airtable login failure
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/auth/start', ScraperController.startAuth);

/**
 * @swagger
 * /api/scraper/auth/mfa:
 *   post:
 *     summary: Submit MFA code to complete authentication
 *     description: >
 *       When `POST /api/scraper/auth/start` returns `status: "awaiting_mfa"`,
 *       submit the 6-digit TOTP code from your authenticator app here.
 *       The browser session completes login and cookies are stored for scraping.
 *     tags: [Scraper]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, mfaCode]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: Session ID returned from `POST /api/scraper/auth/start`
 *               mfaCode:
 *                 type: string
 *                 example: "123456"
 *                 description: 6-digit TOTP code from your authenticator app
 *     responses:
 *       200:
 *         description: MFA accepted — authentication complete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     authenticated: { type: boolean, example: true }
 *       400:
 *         description: Missing sessionId or mfaCode, or invalid MFA code
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/auth/mfa', ScraperController.submitMfa);

/**
 * @swagger
 * /api/scraper/auth/validate:
 *   post:
 *     summary: Validate stored session cookies are still active
 *     description: >
 *       Makes a lightweight authenticated request to Airtable using the stored session cookies.
 *       Returns `{ valid: true }` if the cookies work, or `{ valid: false }` if they have expired.
 *       Call this before starting a scraping job to confirm the session is healthy.
 *     tags: [Scraper]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: Session ID returned from `POST /api/scraper/auth/start`
 *     responses:
 *       200:
 *         description: Cookie validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid: { type: boolean, example: true }
 *                     reason:
 *                       type: string
 *                       nullable: true
 *                       example: "Session cookies are valid"
 *       400:
 *         description: Missing sessionId
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Server error during validation
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/auth/validate', ScraperController.validateCookies);

/**
 * @swagger
 * /api/scraper/run:
 *   post:
 *     summary: Start bulk revision history scraping job
 *     description: >
 *       Enqueues a BullMQ job that iterates all synced Airtable records and scrapes
 *       the revision history page for each one using the stored session cookies.
 *       The job runs in the background — poll `GET /api/scraper/session/{sessionId}` for progress.
 *       Returns immediately with `{ started: true, sessionId, jobId }`.
 *       Results are stored in the `airtable_changelogs` MongoDB collection.
 *     tags: [Scraper]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: Session ID from a successfully authenticated `POST /api/scraper/auth/start`
 *     responses:
 *       200:
 *         description: Scraping job enqueued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     started: { type: boolean, example: true }
 *                     sessionId: { type: string, example: "550e8400-e29b-41d4-a716-446655440000" }
 *                     jobId: { type: string, example: "42" }
 *       400:
 *         description: Missing sessionId
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Failed to enqueue job (Redis not available)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/run', ScraperController.runScraper);

/**
 * @swagger
 * /api/scraper/session/org/latest:
 *   get:
 *     summary: Get the most recent session for the organization
 *     description: >
 *       Returns the latest `scraper_sessions` document for the current organization,
 *       regardless of status. Useful on page load to check if a session already exists
 *       so the UI can resume monitoring rather than re-authenticating.
 *       Returns `null` in `data` if no session has ever been created.
 *     tags: [Scraper]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Latest session or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   nullable: true
 *                   type: object
 *                   properties:
 *                     sessionId: { type: string }
 *                     status: { type: string, enum: [idle, authenticating, awaiting_mfa, running, completed, failed] }
 *                     progress:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         processed: { type: integer }
 *                         failed: { type: integer }
 *                     startedAt: { type: string, format: date-time, nullable: true }
 *                     completedAt: { type: string, format: date-time, nullable: true }
 *                     cookiesValidatedAt: { type: string, format: date-time, nullable: true }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/session/org/latest', ScraperController.getLatestSession);

/**
 * @swagger
 * /api/scraper/session/{sessionId}:
 *   get:
 *     summary: Get scraping session status and progress
 *     description: >
 *       Returns the current state of a scraper session.
 *       Poll this endpoint while the scraping job is running to track progress.
 *       Status lifecycle: `idle` → `authenticating` → `awaiting_mfa` (if MFA) → `running` → `completed` | `failed`.
 *     tags: [Scraper]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string, example: "550e8400-e29b-41d4-a716-446655440000" }
 *         description: Session ID to look up
 *     responses:
 *       200:
 *         description: Session details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId: { type: string }
 *                     status:
 *                       type: string
 *                       enum: [idle, authenticating, awaiting_mfa, awaiting_captcha, running, completed, failed]
 *                       example: running
 *                     progress:
 *                       type: object
 *                       properties:
 *                         total: { type: integer, example: 247 }
 *                         processed: { type: integer, example: 120 }
 *                         failed: { type: integer, example: 2 }
 *                     startedAt: { type: string, format: date-time, nullable: true }
 *                     completedAt: { type: string, format: date-time, nullable: true }
 *                     cookiesValidatedAt: { type: string, format: date-time, nullable: true }
 *                     error: { type: string, nullable: true }
 *       404:
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/session/:sessionId', ScraperController.getSession);

/**
 * @swagger
 * /api/scraper/changelogs:
 *   get:
 *     summary: Get parsed changelogs with filtering and pagination
 *     description: >
 *       Returns revision history entries parsed from Airtable HTML by the scraper.
 *       Each document represents one field change: who changed what, from what to what, and when.
 *       Supports filtering by record ID, base, table, or column type (e.g. "Assignee", "Status").
 *     tags: [Scraper]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: query
 *         name: issueId
 *         schema: { type: string, example: recXXXXXXXXXXXXXX }
 *         description: Filter to a specific Airtable record ID
 *       - in: query
 *         name: baseId
 *         schema: { type: string, example: appXXXXXXXXXXXXXX }
 *         description: Filter to a specific base
 *       - in: query
 *         name: tableId
 *         schema: { type: string, example: tblXXXXXXXXXXXXXX }
 *         description: Filter to a specific table
 *       - in: query
 *         name: columnType
 *         schema: { type: string, example: Assignee }
 *         description: "Filter to a specific field type (e.g. Assignee, Status)"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, example: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100, example: 50 }
 *     responses:
 *       200:
 *         description: Paginated changelogs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       issueId: { type: string, example: recXXXXXXXXXXXXXX }
 *                       baseId: { type: string, example: appXXXXXXXXXXXXXX }
 *                       tableId: { type: string, example: tblXXXXXXXXXXXXXX }
 *                       columnType: { type: string, example: Assignee }
 *                       oldValue: { type: string, nullable: true, example: "Jane Doe" }
 *                       newValue: { type: string, nullable: true, example: "John Smith" }
 *                       authoredBy: { type: string, example: "Alice" }
 *                       createdDate: { type: string, format: date-time }
 *                 _meta:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/changelogs', ScraperController.getChangelogs);

/**
 * @swagger
 * /api/scraper/stats:
 *   get:
 *     summary: Get changelog statistics grouped by column type
 *     description: Returns total changelog counts grouped by `columnType` (e.g. Assignee, Status) plus a `total` key. Useful for a quick summary of what has been scraped.
 *     tags: [Scraper]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Aggregated stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   additionalProperties: { type: integer }
 *                   example: { "Assignee": 142, "Status": 89, "total": 231 }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/stats', ScraperController.getStats);

/**
 * @swagger
 * /api/scraper/debug/record:
 *   get:
 *     summary: Fetch raw revision history for one record (debug)
 *     description: >
 *       Uses stored session cookies to fetch and return the raw Airtable revision history
 *       response for the first synced record in the organization.
 *       Returns raw JSON directly (not wrapped in the standard success envelope).
 *       Use this to inspect the HTML structure when debugging the changelog parser.
 *     tags: [Scraper]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string, example: "550e8400-e29b-41d4-a716-446655440000" }
 *         description: Active session ID with valid cookies
 *     responses:
 *       200:
 *         description: Raw revision history data from Airtable
 *       400:
 *         description: Missing sessionId or session not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/debug/record', ScraperController.debugRecord);

/**
 * @swagger
 * /api/scraper/debug/discover:
 *   get:
 *     summary: Discover Airtable activity endpoint URL via CDP interception
 *     description: >
 *       Uses Chrome DevTools Protocol to intercept live network requests and discover
 *       the actual Airtable internal activity API endpoint URL and headers.
 *       Use this when the revision history URL changes between Airtable versions.
 *     tags: [Scraper]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string, example: "550e8400-e29b-41d4-a716-446655440000" }
 *         description: Active session ID with valid cookies
 *     responses:
 *       200:
 *         description: Discovered endpoint URL and captured headers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   description: Captured URL and request headers from Airtable network traffic
 *       400:
 *         description: Missing sessionId or session not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/debug/discover', ScraperController.debugDiscover);

export default router;
