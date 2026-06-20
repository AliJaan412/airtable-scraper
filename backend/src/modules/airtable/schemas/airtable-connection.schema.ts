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
  createdAt: Date;
  updatedAt: Date;
}

const AirtableConnectionSchema = new Schema<IAirtableConnection>(
  {
    organizationId: { type: String, required: true, index: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    tokenType: { type: String, default: 'Bearer' },
    expiresAt: { type: Date, required: true },
    scope: { type: String },
    codeVerifier: { type: String },
    state: { type: String },
  },
  { timestamps: true },
);

AirtableConnectionSchema.index({ organizationId: 1 }, { unique: true });

export const AirtableConnectionModel = model<IAirtableConnection>(
  'AirtableConnection',
  AirtableConnectionSchema,
  'airtable_connections',
);
