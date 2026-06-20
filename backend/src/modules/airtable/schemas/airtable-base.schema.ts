import { Schema, model, Document } from 'mongoose';

export interface IAirtableBase extends Document {
  organizationId: string;
  baseId: string;
  name: string;
  permissionLevel: string;
  rawData: Record<string, any>;
  syncedAt: Date;
}

const AirtableBaseSchema = new Schema<IAirtableBase>(
  {
    organizationId: { type: String, required: true, index: true },
    baseId: { type: String, required: true },
    name: { type: String, required: true },
    permissionLevel: { type: String },
    rawData: { type: Schema.Types.Mixed },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AirtableBaseSchema.index({ organizationId: 1, baseId: 1 }, { unique: true });

export const AirtableBaseModel = model<IAirtableBase>(
  'AirtableBase',
  AirtableBaseSchema,
  'airtable_bases',
);
