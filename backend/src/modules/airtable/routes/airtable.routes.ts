import { Router } from 'express';
import { AirtableController } from '../controllers/airtable.controller';

const router = Router();

/**
 * @swagger
 * components:
 *   parameters:
 *     OrgId:
 *       in: header
 *       name: X-Organization-Id
 *       schema:
 *         type: string
 *         example: org_default
 *       description: "Organization identifier. Omit in dev — defaults to the configured default org."
 *   schemas:
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: "Something went wrong"
 *     SyncCounts:
 *       type: object
 *       properties:
 *         bases: { type: integer, example: 3 }
 *         tables: { type: integer, example: 12 }
 *         records: { type: integer, example: 874 }
 *         users: { type: integer, example: 5 }
 */

/**
 * @swagger
 * /api/airtable/oauth/authorize:
 *   get:
 *     summary: Initiate Airtable OAuth flow
 *     description: >
 *       Generates the Airtable authorization URL with a PKCE challenge and saves the
 *       OAuth state to MongoDB. Redirect the browser to the returned `url` to begin
 *       the Airtable consent screen.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Authorization URL generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       example: "https://airtable.com/oauth2/v1/authorize?client_id=abc&redirect_uri=..."
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/oauth/authorize', AirtableController.initiateOAuth);

/**
 * @swagger
 * /api/airtable/oauth/callback:
 *   get:
 *     summary: OAuth callback handler (browser redirect — do not call directly)
 *     description: >
 *       Airtable redirects the browser here after the user approves access.
 *       Exchanges the authorization code for access + refresh tokens and stores them in MongoDB.
 *       On success, redirects to the frontend with `?connected=true`.
 *       On failure, redirects with `?error=<message>`.
 *       **Do not call this endpoint manually** — it is driven by the Airtable OAuth consent flow.
 *     tags: [Airtable]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema: { type: string }
 *         description: Authorization code from Airtable
 *       - in: query
 *         name: state
 *         schema: { type: string }
 *         description: CSRF state token — must match what was saved during /authorize
 *       - in: query
 *         name: error
 *         schema: { type: string }
 *         description: Error code if the user denied access (e.g. "access_denied")
 *     responses:
 *       302:
 *         description: Redirects to frontend with `?connected=true` or `?error=<message>`
 */
router.get('/oauth/callback', AirtableController.handleOAuthCallback);

/**
 * @swagger
 * /api/airtable/status:
 *   get:
 *     summary: Get Airtable connection status
 *     description: >
 *       Returns whether the organization has a valid Airtable connection.
 *       If the access token is expired (every ~1 hour), it is silently refreshed using the refresh token.
 *       `isExpired: true` is only returned when both the access AND refresh tokens have expired
 *       (refresh tokens last 60 days and reset on every successful use, so active users never truly expire).
 *       `lastSyncedAt` is the ISO 8601 timestamp of the most recent successful full sync.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Connection status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     connected: { type: boolean, example: true }
 *                     isExpired: { type: boolean, example: false }
 *                     expiresAt: { type: string, format: date-time, example: "2026-06-21T15:00:00.000Z" }
 *                     scope: { type: string, example: "data.records:read schema.bases:read" }
 *                     lastSyncedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       example: "2026-06-21T08:00:00.000Z"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/status', AirtableController.getStatus);

/**
 * @swagger
 * /api/airtable/disconnect:
 *   post:
 *     summary: Disconnect Airtable
 *     description: Deletes stored tokens and clears all Redis cache for the organization. The user must re-authorize via OAuth to reconnect.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Disconnected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     disconnected: { type: boolean, example: true }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/disconnect', AirtableController.disconnect);

/**
 * @swagger
 * /api/airtable/sync:
 *   post:
 *     summary: Full sync — bases → tables → records → users
 *     description: >
 *       Runs a complete sync from the Airtable API into MongoDB in sequence:
 *       bases → tables for each base → records for each table → users.
 *       After completion, stamps `lastSyncedAt` on the connection and clears the status cache.
 *       This may take several minutes for large workspaces (Airtable rate-limit: ~4.5 req/sec).
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Sync complete — counts of synced items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/SyncCounts' }
 *       202:
 *         description: Sync job queued — returns jobId immediately
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId: { type: string }
 *                     message: { type: string, example: 'Sync queued' }
 *       500:
 *         description: Failed to enqueue sync job
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/sync', AirtableController.syncAll);

/**
 * @swagger
 * /api/airtable/sync/status:
 *   get:
 *     summary: Get sync job status
 *     description: Returns the current state of the sync job for this organisation (idle, waiting, active, completed, failed).
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Job state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     state: { type: string, example: 'active' }
 *                     result: { type: object }
 *                     failedReason: { type: string }
 */
router.get('/sync/status', AirtableController.getSyncStatus);

/**
 * @swagger
 * /api/airtable/sync/counts:
 *   get:
 *     summary: Get document counts for all synced collections
 *     description: Returns the number of bases, tables, records, and users stored in MongoDB for this organisation. Used by the frontend to show counts after a page refresh (NGXS state is in-memory only).
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Document counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/SyncCounts' }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/sync/counts', AirtableController.getSyncCounts);

/**
 * @swagger
 * /api/airtable/sync/bases:
 *   post:
 *     summary: Sync bases only
 *     description: Fetches all Airtable bases from `/meta/bases` and upserts them into the `airtable_bases` collection.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: Number of bases synced
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     synced: { type: integer, example: 3 }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/sync/bases', AirtableController.syncBases);

/**
 * @swagger
 * /api/airtable/sync/tables/{baseId}:
 *   post:
 *     summary: Sync tables for a specific base
 *     description: Fetches all tables from `/meta/bases/{baseId}/tables` and upserts them into `airtable_tables`.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: path
 *         name: baseId
 *         required: true
 *         schema: { type: string, example: appXXXXXXXXXXXXXX }
 *         description: Airtable base ID (starts with "app")
 *     responses:
 *       200:
 *         description: Number of tables synced
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     synced: { type: integer, example: 4 }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/sync/tables/:baseId', AirtableController.syncTables);

/**
 * @swagger
 * /api/airtable/sync/records/{baseId}/{tableId}:
 *   post:
 *     summary: Sync records for a specific table
 *     description: >
 *       Fetches all records from `/{baseId}/{tableId}` using offset-based pagination (100 per page)
 *       and upserts them into the `airtable_records` collection.
 *       Handles Airtable 429 rate limiting automatically with exponential backoff.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: path
 *         name: baseId
 *         required: true
 *         schema: { type: string, example: appXXXXXXXXXXXXXX }
 *         description: Airtable base ID (starts with "app")
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema: { type: string, example: tblXXXXXXXXXXXXXX }
 *         description: Airtable table ID (starts with "tbl")
 *     responses:
 *       200:
 *         description: Number of records synced
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     synced: { type: integer, example: 247 }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/sync/records/:baseId/:tableId', AirtableController.syncRecords);

/**
 * @swagger
 * /api/airtable/bases:
 *   get:
 *     summary: Get all synced bases
 *     description: Returns bases from MongoDB (the `airtable_bases` collection). Does NOT call the Airtable API. Results are cached in Redis for 2 minutes.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: List of bases
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
 *                       baseId: { type: string, example: appXXXXXXXXXXXXXX }
 *                       name: { type: string, example: "My Project Base" }
 *                       permissionLevel: { type: string, example: "create" }
 *                       organizationId: { type: string, example: org_default }
 *                       syncedAt: { type: string, format: date-time }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/bases', AirtableController.getBases);

/**
 * @swagger
 * /api/airtable/tables:
 *   get:
 *     summary: Get all synced tables (optionally filtered by base)
 *     description: Returns tables from the `airtable_tables` collection. Pass `baseId` to filter to one base; omit to get all tables across all bases.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: query
 *         name: baseId
 *         schema: { type: string, example: appXXXXXXXXXXXXXX }
 *         description: Optional — filter tables to this base ID
 *     responses:
 *       200:
 *         description: List of tables
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
 *                       tableId: { type: string, example: tblXXXXXXXXXXXXXX }
 *                       name: { type: string, example: "Tasks" }
 *                       baseId: { type: string, example: appXXXXXXXXXXXXXX }
 *                       fields:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id: { type: string }
 *                             name: { type: string }
 *                             type: { type: string, example: "singleLineText" }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/tables', AirtableController.getTables);

/**
 * @swagger
 * /api/airtable/records:
 *   get:
 *     summary: Get records with pagination
 *     description: >
 *       Returns records from the `airtable_records` collection.
 *       Filter by base and/or table. Defaults to page 1, pageSize 100.
 *       For flexible querying with search and sort, prefer `POST /api/airtable-data/query`.
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: query
 *         name: baseId
 *         schema: { type: string, example: appXXXXXXXXXXXXXX }
 *         description: Optional — filter to this base
 *       - in: query
 *         name: tableId
 *         schema: { type: string, example: tblXXXXXXXXXXXXXX }
 *         description: Optional — filter to this table
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, example: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100, example: 100 }
 *     responses:
 *       200:
 *         description: Paginated records
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
 *                       recordId: { type: string, example: recXXXXXXXXXXXXXX }
 *                       baseId: { type: string }
 *                       tableId: { type: string }
 *                       fields: { type: object, description: "Key-value map of Airtable field name to value" }
 *                       createdTime: { type: string, format: date-time }
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
router.get('/records', AirtableController.getRecords);

/**
 * @swagger
 * /api/airtable/users:
 *   get:
 *     summary: Get all synced users
 *     description: >
 *       Returns users from the `airtable_users` collection.
 *       Source depends on the Airtable plan:
 *       - Enterprise: `/meta/users` (full user list)
 *       - Pro/Business: whoami + per-base collaborators
 *       - Trial/Free: extracted from collaborator-type field values in synced records
 *     tags: [Airtable]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     responses:
 *       200:
 *         description: List of users
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
 *                       userId: { type: string, example: usrXXXXXXXXXXXXXX }
 *                       name: { type: string, example: "Jane Doe" }
 *                       email: { type: string, example: "jane@example.com" }
 *                       organizationId: { type: string }
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/users', AirtableController.getUsers);

export default router;
