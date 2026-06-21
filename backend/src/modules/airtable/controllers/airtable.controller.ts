import { Request, Response } from 'express';
import { AirtableService } from '../services/airtable.service';
import { enqueueAirtableSyncJob, getAirtableSyncStatus } from '../queues/airtable.queue';
import { sendSuccess, sendError } from '../../../common/response';
import { config } from '../../../config';

export const AirtableController = {
  async initiateOAuth(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const { url, state, codeVerifier } = AirtableService.initiateOAuth(organizationId);
      await AirtableService.saveOAuthState(organizationId, state, codeVerifier);
      sendSuccess(res, { url });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async handleOAuthCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state, error } = req.query as Record<string, string>;
      if (error) {
        res.redirect(`${config.frontendUrl}/integrations/airtable?error=${encodeURIComponent(error)}`);
        return;
      }
      await AirtableService.exchangeCode(code, state);
      res.redirect(`${config.frontendUrl}/integrations/airtable?connected=true`);
    } catch (err: any) {
      res.redirect(`${config.frontendUrl}/integrations/airtable?error=${encodeURIComponent(err.message)}`);
    }
  },

  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const status = await AirtableService.getConnectionStatus(organizationId);
      sendSuccess(res, status);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async disconnect(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      await AirtableService.disconnect(organizationId);
      sendSuccess(res, { disconnected: true });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async syncAll(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const jobId = await enqueueAirtableSyncJob(organizationId);
      sendSuccess(res, { jobId, message: 'Sync queued' }, undefined, 202);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async getSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const status = await getAirtableSyncStatus(organizationId);
      sendSuccess(res, status ?? { state: 'idle' });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async getSyncCounts(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const counts = await AirtableService.getCounts(organizationId);
      sendSuccess(res, counts);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async syncBases(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const count = await AirtableService.syncBases(organizationId);
      sendSuccess(res, { synced: count });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async syncTables(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const count = await AirtableService.syncTables(organizationId, req.params.baseId);
      sendSuccess(res, { synced: count });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async syncRecords(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const count = await AirtableService.syncRecords(organizationId, req.params.baseId, req.params.tableId);
      sendSuccess(res, { synced: count });
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async getBases(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const bases = await AirtableService.getBases(organizationId);
      sendSuccess(res, bases);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },

  async getTables(req: Request, res: Response): Promise<void> {
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
  },

  async getRecords(req: Request, res: Response): Promise<void> {
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
  },

  async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const users = await AirtableService.getUsers(organizationId);
      sendSuccess(res, users);
    } catch (err: any) {
      sendError(res, err.message);
    }
  },
};
