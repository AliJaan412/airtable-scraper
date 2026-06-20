import { Router, Request, Response } from 'express';
import { ScraperService } from './scraper.service';
import { enqueueScraperJob } from './scraper.queue';
import { sendSuccess, sendError } from '../../common/response';

const router = Router();

/**
 * @swagger
 * /api/scraper/auth/start:
 *   post:
 *     summary: Start Airtable cookie authentication
 *     tags: [Scraper]
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
 *               password:
 *                 type: string
 */
router.post('/auth/start', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { email, password } = req.body;
    if (!email || !password) return sendError(res, 'email and password are required', 400);

    const result = await ScraperService.initiateAuth(organizationId, email, password);
    sendSuccess(res, result);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/auth/mfa:
 *   post:
 *     summary: Submit MFA code to complete authentication
 *     tags: [Scraper]
 */
router.post('/auth/mfa', async (req: Request, res: Response) => {
  try {
    const { sessionId, mfaCode } = req.body;
    if (!sessionId || !mfaCode) return sendError(res, 'sessionId and mfaCode are required', 400);

    await ScraperService.submitMfa(sessionId, mfaCode);
    sendSuccess(res, { authenticated: true });
  } catch (err: any) {
    sendError(res, err.message, 400);
  }
});

/**
 * @swagger
 * /api/scraper/auth/validate:
 *   post:
 *     summary: Validate stored cookies
 *     tags: [Scraper]
 */
router.post('/auth/validate', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return sendError(res, 'sessionId is required', 400);

    const result = await ScraperService.validateCookies(sessionId);
    sendSuccess(res, result);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/run:
 *   post:
 *     summary: Start revision history scraping job
 *     tags: [Scraper]
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { sessionId } = req.body;
    if (!sessionId) return sendError(res, 'sessionId is required', 400);

    const jobId = await enqueueScraperJob(organizationId, sessionId);
    sendSuccess(res, { started: true, sessionId, jobId });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/session/{sessionId}:
 *   get:
 *     summary: Get scraping session status
 *     tags: [Scraper]
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = await ScraperService.getSession(req.params.sessionId);
    if (!session) return sendError(res, 'Session not found', 404);
    sendSuccess(res, {
      sessionId: session.sessionId,
      status: session.status,
      progress: session.progress,
      error: session.error,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      cookiesValidatedAt: session.cookiesValidatedAt,
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/session/latest:
 *   get:
 *     summary: Get latest session for the organization
 *     tags: [Scraper]
 */
router.get('/session/org/latest', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const session = await ScraperService.getLatestSession(organizationId);
    sendSuccess(res, session
      ? {
          sessionId: session.sessionId,
          status: session.status,
          progress: session.progress,
          error: session.error,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          cookiesValidatedAt: session.cookiesValidatedAt,
        }
      : null);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/changelogs:
 *   get:
 *     summary: Get parsed changelogs
 *     tags: [Scraper]
 */
/**
 * @swagger
 * /api/scraper/debug/record:
 *   get:
 *     summary: Fetch raw revision history for one record (debug)
 *     tags: [Scraper]
 */
/**
 * @swagger
 * /api/scraper/debug/discover:
 *   get:
 *     summary: Discover the real Airtable activity endpoint URL by intercepting live network traffic
 *     tags: [Scraper]
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 */
router.get('/debug/discover', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query as Record<string, string>;
    if (!sessionId) return sendError(res, 'sessionId is required', 400);

    const session = await ScraperService.getSession(sessionId);
    if (!session) return sendError(res, 'Session not found', 404);

    const organizationId = (req as any).organizationId;
    const result = await ScraperService.discoverActivityEndpoint(organizationId, sessionId);
    sendSuccess(res, result);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

router.get('/debug/record', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query as Record<string, string>;
    if (!sessionId) return sendError(res, 'sessionId is required', 400);

    const session = await ScraperService.getSession(sessionId);
    if (!session) return sendError(res, 'Session not found', 404);

    const organizationId = (req as any).organizationId;
    const raw = await ScraperService.debugOneRecord(organizationId, sessionId);
    res.json(raw);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

/**
 * @swagger
 * /api/scraper/stats:
 *   get:
 *     summary: Get changelog statistics (totals by type)
 *     tags: [Scraper]
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const stats = await ScraperService.getStats(organizationId);
    sendSuccess(res, stats);
  } catch (err: any) {
    sendError(res, err.message);
  }
});

router.get('/changelogs', async (req: Request, res: Response) => {
  try {
    const organizationId = (req as any).organizationId;
    const { issueId, baseId, tableId, columnType, page = '1', pageSize = '100' } = req.query as Record<string, string>;

    const filter: Record<string, any> = {};
    if (issueId) filter.issueId = issueId;
    if (baseId) filter.baseId = baseId;
    if (tableId) filter.tableId = tableId;
    if (columnType) filter.columnType = columnType;

    const { changelogs, total } = await ScraperService.getChangelogs(
      organizationId,
      filter,
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );

    sendSuccess(res, changelogs, {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      total,
      totalPages: Math.ceil(total / parseInt(pageSize, 10)),
    });
  } catch (err: any) {
    sendError(res, err.message);
  }
});

export default router;
