import { Request, Response } from 'express';
import { ScraperService } from '../services/scraper.service';
import { enqueueScraperJob } from '../queues/scraper.queue';
import { sendSuccess, sendError } from '../../../common/response';

export const ScraperController = {
  async startAuth(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const { email, password } = req.body;
      if (!email || !password) { sendError(res, 'email and password are required', 400); return; }
      const result = await ScraperService.initiateAuth(organizationId, email, password);
      sendSuccess(res, result);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async submitMfa(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, mfaCode } = req.body;
      if (!sessionId || !mfaCode) { sendError(res, 'sessionId and mfaCode are required', 400); return; }
      await ScraperService.submitMfa(sessionId, mfaCode);
      sendSuccess(res, { authenticated: true });
    } catch (err: any) {
      sendError(res, err.message, 400);
    }
  },

  async validateCookies(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.body;
      if (!sessionId) { sendError(res, 'sessionId is required', 400); return; }
      const result = await ScraperService.validateCookies(sessionId);
      sendSuccess(res, result);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async runScraper(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const { sessionId } = req.body;
      if (!sessionId) { sendError(res, 'sessionId is required', 400); return; }

      await ScraperService.markRunning(sessionId);
      const jobId = await enqueueScraperJob(organizationId, sessionId);
      sendSuccess(res, { started: true, sessionId, jobId });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const session = await ScraperService.getSession(req.params.sessionId);
      if (!session) { sendError(res, 'Session not found', 404); return; }
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
  },

  async getLatestSession(req: Request, res: Response): Promise<void> {
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
  },

  async getChangelogs(req: Request, res: Response): Promise<void> {
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
  },

  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const stats = await ScraperService.getStats(organizationId);
      sendSuccess(res, stats);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async debugRecord(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.query as Record<string, string>;
      if (!sessionId) { sendError(res, 'sessionId is required', 400); return; }

      const session = await ScraperService.getSession(sessionId);
      if (!session) { sendError(res, 'Session not found', 404); return; }

      const organizationId = (req as any).organizationId;
      const raw = await ScraperService.debugOneRecord(organizationId, sessionId);
      res.json(raw);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async debugDiscover(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.query as Record<string, string>;
      if (!sessionId) { sendError(res, 'sessionId is required', 400); return; }

      const session = await ScraperService.getSession(sessionId);
      if (!session) { sendError(res, 'Session not found', 404); return; }

      const organizationId = (req as any).organizationId;
      const result = await ScraperService.discoverActivityEndpoint(organizationId, sessionId);
      sendSuccess(res, result);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },
};
