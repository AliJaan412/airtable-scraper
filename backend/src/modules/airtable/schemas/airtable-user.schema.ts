import { Schema, model, Document } from 'mongoose';

export interface IAirtableUser extends Document {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  scimEnabled: boolean;
  rawData: Record<string, any>;
  syncedAt: Date;
}

const AirtableUserSchema = new Schema<IAirtableUser>(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    scimEnabled: { type: Boolean, default: false },
    rawData: { type: Schema.Types.Mixed },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AirtableUserSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const AirtableUserModel = model<IAirtableUser>(
  'AirtableUser',
  AirtableUserSchema,
  'airtable_users',
);
