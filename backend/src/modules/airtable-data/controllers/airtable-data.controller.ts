import { Request, Response } from 'express';
import { AirtableDataService } from '../services/airtable-data.service';
import { sendSuccess, sendError } from '../../../common/response';

export const AirtableDataController = {
  getCollections(_req: Request, res: Response): void {
    sendSuccess(res, AirtableDataService.getAllowedCollections());
  },

  async getSchema(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).organizationId;
      const fields = await AirtableDataService.getCollectionSchema(organizationId, req.params.collection);
      sendSuccess(res, fields);
    } catch (err: any) {
      sendError(res, err.message, 400);
    }
  },

  async query(req: Request, res: Response): Promise<void> {
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

      if (!collection) { sendError(res, 'collection is required', 400); return; }

      const result = await AirtableDataService.query({
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
  },
};
