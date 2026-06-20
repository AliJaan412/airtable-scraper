import { Router, Request, Response } from 'express';
import { RawDataService } from './raw-data.service';
import { sendSuccess, sendError } from '../../common/response';

const router = Router();

/**
 * @swagger
 * /api/raw-data/collections:
 *   get:
 *     summary: List available collections
 *     description: >
 *       Returns the names of all MongoDB collections that can be queried via `POST /api/raw-data/query`.
 *       Any other collection name will be rejected with a 400 error.
 *       Available collections: airtable_bases, airtable_tables, airtable_records, airtable_users, airtable_changelogs, scraper_sessions.
 *     tags: [RawData]
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
router.get('/collections', (_req: Request, res: Response) => {
  sendSuccess(res, RawDataService.getAllowedCollections());
});

/**
 * @swagger
 * /api/raw-data/schema/{collection}:
 *   get:
 *     summary: Get field names for a collection
 *     description: >
 *       Samples up to 100 documents from the collection (scoped to the current organization)
 *       and returns all unique top-level field names found.
 *       Used by the frontend to build AG Grid column headers dynamically without hardcoding schemas.
 *     tags: [RawData]
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
router.get('/schema/:collection', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const fields = await RawDataService.getCollectionSchema(organizationId, req.params.collection);
    sendSuccess(res, fields);
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
});

/**
 * @swagger
 * /api/raw-data/query:
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
 *     tags: [RawData]
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
 *           examples:
 *             All changelogs newest first:
 *               value:
 *                 collection: airtable_changelogs
 *                 page: 1
 *                 pageSize: 50
 *                 sortField: createdDate
 *                 sortOrder: desc
 *             Filter Assignee changes only:
 *               value:
 *                 collection: airtable_changelogs
 *                 filters:
 *                   columnType: "Assignee"
 *                 page: 1
 *                 pageSize: 100
 *             Search records by keyword:
 *               value:
 *                 collection: airtable_records
 *                 search: "Sprint 12"
 *                 filters:
 *                   tableId: "tblXXXXXXXXXXXXXX"
 *                 page: 1
 *                 pageSize: 100
 *             List all bases:
 *               value:
 *                 collection: airtable_bases
 *                 page: 1
 *                 pageSize: 50
 *             List all users:
 *               value:
 *                 collection: airtable_users
 *                 page: 1
 *                 pageSize: 100
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
router.post('/query', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const {
      collection,
      search,
      page = 1,
      pageSize = 100,
      sortField,
      sortOrder,
      filters,
    } = req.body;

    if (!collection) return sendError(res, 'collection is required', 400);

    const result = await RawDataService.query({
      organizationId,
      collection,
      search,
      page: Number(page),
      pageSize: Math.min(Number(pageSize), 500),
      sortField,
      sortOrder,
      filters,
    });

    sendSuccess(res, result.data, {
      page: Number(page),
      pageSize: Number(pageSize),
      total: result.total,
      totalPages: Math.ceil(result.total / Number(pageSize)),
      fields: result.fields,
    });
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
});

export default router;
