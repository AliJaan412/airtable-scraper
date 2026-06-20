import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: Record<string, any>;
}

export function sendSuccess<T>(res: Response, data: T, meta?: Record<string, any>, statusCode = 200): void {
  const response: ApiResponse<T> = { success: true, data };
  if (meta) response.meta = meta;
  res.status(statusCode).json(response);
}

export function sendError(res: Response, message: string, statusCode = 500, error?: string): void {
  const response: ApiResponse = { success: false, message, error };
  res.status(statusCode).json(response);
}
