import { Router, Request, Response } from 'express';
import { RawDataService } from './raw-data.service';
import { sendSuccess, sendError } from '../../common/response';

const router = Router();

/**
 * @swagger
 * /api/raw-data/collections:
 *   get:
 *     summary: List available collections
 *     tags: [RawData]
 */
router.get('/collections', (_req: Request, res: Response) => {
  sendSuccess(res, RawDataService.getAllowedCollections());
});

/**
 * @swagger
 * /api/raw-data/schema/{collection}:
 *   get:
 *     summary: Get field names for a collection
 *     tags: [RawData]
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
 *     summary: Query a collection with search, filter, sort, pagination
 *     tags: [RawData]
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
