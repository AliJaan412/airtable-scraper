import { Schema, model, Document } from 'mongoose';

export interface IAirtableConnection extends Document {
  organizationId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: Date;
  scope: string;
  codeVerifier?: string;
  state?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AirtableConnectionSchema = new Schema<IAirtableConnection>(
  {
    organizationId: { type: String, required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenType: { type: String, default: 'Bearer' },
    expiresAt: { type: Date, required: true },
    scope: { type: String },
    codeVerifier: { type: String },
    state: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

AirtableConnectionSchema.index({ organizationId: 1 }, { unique: true });

export const AirtableConnectionModel = model<IAirtableConnection>(
  'AirtableConnection',
  AirtableConnectionSchema,
  'airtable_connections',
);
