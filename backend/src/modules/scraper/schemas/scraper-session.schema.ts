import { Schema, model, Document } from 'mongoose';

export type ScraperStatus = 'idle' | 'authenticating' | 'awaiting_mfa' | 'awaiting_captcha' | 'running' | 'completed' | 'failed';

export interface IScraperSession extends Document {
  organizationId: string;
  sessionId: string;
  status: ScraperStatus;
  cookies: string;
  cookiesValidatedAt?: Date;
  email?: string;
  progress: {
    total: number;
    processed: number;
    failed: number;
  };
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ScraperSessionSchema = new Schema<IScraperSession>(
  {
    organizationId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['idle', 'authenticating', 'awaiting_mfa', 'awaiting_captcha', 'running', 'completed', 'failed'],
      default: 'idle',
    },
    cookies: { type: String, default: '' },
    cookiesValidatedAt: { type: Date },
    email: { type: String },
    progress: {
      total: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

ScraperSessionSchema.index({ organizationId: 1, createdAt: -1 });

export const ScraperSessionModel = model<IScraperSession>(
  'ScraperSession',
  ScraperSessionSchema,
  'scraper_sessions',
);
