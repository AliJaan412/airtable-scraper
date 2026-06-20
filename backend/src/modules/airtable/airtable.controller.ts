import { Router, Request, Response } from 'express';
import { AirtableService } from './airtable.service';
import { sendSuccess, sendError } from '../../common/response';
import { config } from '../../config';

const router = Router();

/**
 * @swagger
 * /api/airtable/oauth/authorize:
 *   get:
 *     summary: Initiate Airtable OAuth flow
 *     tags: [Airtable]
 */
router.get('/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { url, state, codeVerifier } = AirtableService.initiateOAuth(organizationId);
    await AirtableService.saveOAuthState(organizationId, state, codeVerifier);
    sendSuccess(res, { url });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/oauth/callback:
 *   get:
 *     summary: OAuth callback handler
 *     tags: [Airtable]
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) {
      return res.redirect(`${config.frontendUrl}/integrations/airtable?error=${encodeURIComponent(error)}`);
    }
    await AirtableService.exchangeCode(code, state);
    res.redirect(`${config.frontendUrl}/integrations/airtable?connected=true`);
  } catch (err: any) {
    res.redirect(`${config.frontendUrl}/integrations/airtable?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * @swagger
 * /api/airtable/status:
 *   get:
 *     summary: Get connection status
 *     tags: [Airtable]
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const status = await AirtableService.getConnectionStatus(organizationId);
    sendSuccess(res, status);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/disconnect:
 *   post:
 *     summary: Disconnect Airtable
 *     tags: [Airtable]
 */
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    await AirtableService.disconnect(organizationId);
    sendSuccess(res, { disconnected: true });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/sync:
 *   post:
 *     summary: Sync all Airtable data
 *     tags: [Airtable]
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const counts = await AirtableService.syncAll(organizationId);
    sendSuccess(res, counts, undefined, 200);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/sync/bases:
 *   post:
 *     summary: Sync bases only
 *     tags: [Airtable]
 */
router.post('/sync/bases', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const count = await AirtableService.syncBases(organizationId);
    sendSuccess(res, { synced: count });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/sync/tables/{baseId}:
 *   post:
 *     summary: Sync tables for a base
 *     tags: [Airtable]
 */
router.post('/sync/tables/:baseId', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const count = await AirtableService.syncTables(organizationId, req.params.baseId);
    sendSuccess(res, { synced: count });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/sync/records/{baseId}/{tableId}:
 *   post:
 *     summary: Sync records for a table
 *     tags: [Airtable]
 */
router.post('/sync/records/:baseId/:tableId', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const count = await AirtableService.syncRecords(organizationId, req.params.baseId, req.params.tableId);
    sendSuccess(res, { synced: count });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/bases:
 *   get:
 *     summary: Get all synced bases
 *     tags: [Airtable]
 */
router.get('/bases', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const bases = await AirtableService.getBases(organizationId);
    sendSuccess(res, bases);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/tables:
 *   get:
 *     summary: Get all synced tables
 *     tags: [Airtable]
 */
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { baseId } = req.query as { baseId?: string };
    const tables = baseId
      ? await AirtableService.getTables(organizationId, baseId)
      : await AirtableService.getAllTables(organizationId);
    sendSuccess(res, tables);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/records:
 *   get:
 *     summary: Get records with pagination
 *     tags: [Airtable]
 */
router.get('/records', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { baseId, tableId, page = '1', pageSize = '100' } = req.query as Record<string, string>;
    const filter: Record<string, any> = {};
    if (baseId) filter.baseId = baseId;
    if (tableId) filter.tableId = tableId;

    const { records, total } = await AirtableService.getRecords(
      organizationId,
      filter,
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );

    sendSuccess(res, records, {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      total,
      totalPages: Math.ceil(total / parseInt(pageSize, 10)),
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/airtable/users:
 *   get:
 *     summary: Get all synced users
 *     tags: [Airtable]
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const users = await AirtableService.getUsers(organizationId);
    sendSuccess(res, users);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

export default router;
