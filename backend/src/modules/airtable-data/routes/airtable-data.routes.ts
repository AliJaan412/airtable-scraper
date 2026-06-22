import { Router } from 'express';
import { AirtableDataController } from '../controllers/airtable-data.controller';

const router = Router();

/**
 * @swagger
 * /api/airtable-data/collections:
 *   get:
 *     summary: List available collections
 *     description: >
 *       Returns the names of all MongoDB collections that can be queried via `POST /api/airtable-data/query`.
 *       Any other collection name will be rejected with a 400 error.
 *       Available collections: airtable_bases, airtable_tables, airtable_records, airtable_users, airtable_changelogs, scraper_sessions.
 *     tags: [AirtableData]
 *     responses:
 *       200:
 *         description: List of allowed collection names
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { type: string }
 *                   example: ["airtable_bases", "airtable_tables", "airtable_records", "airtable_users", "airtable_changelogs", "scraper_sessions"]
 */
router.get('/collections', AirtableDataController.getCollections);

/**
 * @swagger
 * /api/airtable-data/schema/{collection}:
 *   get:
 *     summary: Get field names for a collection
 *     description: >
 *       Samples up to 100 documents from the collection (scoped to the current organization)
 *       and returns all unique top-level field names found.
 *       Used by the frontend to build AG Grid column headers dynamically without hardcoding schemas.
 *     tags: [AirtableData]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *       - in: path
 *         name: collection
 *         required: true
 *         schema:
 *           type: string
 *           enum: [airtable_bases, airtable_tables, airtable_records, airtable_users, airtable_changelogs, scraper_sessions]
 *           example: airtable_changelogs
 *         description: Collection name — must be one of the allowed collections
 *     responses:
 *       200:
 *         description: Array of field names present in the collection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { type: string }
 *                   example: ["_id", "organizationId", "issueId", "baseId", "tableId", "columnType", "oldValue", "newValue", "authoredBy", "createdDate"]
 *       400:
 *         description: Invalid or disallowed collection name
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/schema/:collection', AirtableDataController.getSchema);

/**
 * @swagger
 * /api/airtable-data/query:
 *   post:
 *     summary: Query any collection with search, filter, sort, and pagination
 *     description: >
 *       Unified data access endpoint used by the frontend data explorer.
 *       Reads from MongoDB — does NOT call the Airtable API directly.
 *       All results are scoped to the current organization via the `X-Organization-Id` header.
 *       Supports:
 *       - Full-text search across all string fields (`search`)
 *       - Exact-match field filters (`filters` object)
 *       - Sort by any field (`sortField` + `sortOrder`)
 *       - Cursor-based pagination (`page` + `pageSize`, max 500)
 *       The response `_meta.fields` array lists the field names present in the returned documents
 *       — the frontend uses this to build column headers dynamically.
 *     tags: [AirtableData]
 *     parameters:
 *       - $ref: '#/components/parameters/OrgId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [collection]
 *             properties:
 *               collection:
 *                 type: string
 *                 enum: [airtable_bases, airtable_tables, airtable_records, airtable_users, airtable_changelogs, scraper_sessions]
 *                 example: airtable_changelogs
 *                 description: The MongoDB collection to query
 *               search:
 *                 type: string
 *                 example: "Jane Doe"
 *                 description: Optional — full-text search across all string fields
 *               page:
 *                 type: integer
 *                 default: 1
 *                 example: 1
 *               pageSize:
 *                 type: integer
 *                 default: 100
 *                 example: 50
 *                 description: Number of documents per page. Maximum 500.
 *               sortField:
 *                 type: string
 *                 example: createdDate
 *                 description: Field name to sort by
 *               sortOrder:
 *                 type: string
 *                 enum: [asc, desc]
 *                 example: desc
 *               filters:
 *                 type: object
 *                 description: Key-value pairs applied as exact-match MongoDB filters
 *                 example:
 *                   columnType: "Assignee"
 *                   baseId: "appXXXXXXXXXXXXXX"
 *     responses:
 *       200:
 *         description: Query results with pagination metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { type: object }
 *                   description: Array of matching documents
 *                 _meta:
 *                   type: object
 *                   properties:
 *                     page: { type: integer, example: 1 }
 *                     pageSize: { type: integer, example: 50 }
 *                     total: { type: integer, example: 231 }
 *                     totalPages: { type: integer, example: 5 }
 *                     fields:
 *                       type: array
 *                       items: { type: string }
 *                       description: Field names present in the returned documents
 *                       example: ["columnType", "oldValue", "newValue", "authoredBy", "createdDate"]
 *       400:
 *         description: Missing collection or invalid request
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/query', AirtableDataController.query);

export default router;
