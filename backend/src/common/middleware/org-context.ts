import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

export function orgContext(req: Request, _res: Response, next: NextFunction): void {
  // In a real multi-tenant setup this would be derived from the JWT
  // For development we use the header or the default org
  (req as any).organizationId = req.headers['x-organization-id'] || config.defaultOrgId;
  next();
}
