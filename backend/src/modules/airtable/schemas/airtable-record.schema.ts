import { Schema, model, Document } from 'mongoose';

export interface IAirtableRecord extends Document {
  organizationId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, any>;
  createdTime: Date;
  syncedAt: Date;
}

const AirtableRecordSchema = new Schema<IAirtableRecord>(
  {
    organizationId: { type: String, required: true, index: true },
    baseId: { type: String, required: true, index: true },
    tableId: { type: String, required: true, index: true },
    recordId: { type: String, required: true },
    fields: { type: Schema.Types.Mixed, required: true },
    createdTime: { type: Date },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AirtableRecordSchema.index({ organizationId: 1, baseId: 1, tableId: 1, recordId: 1 }, { unique: true });
AirtableRecordSchema.index({ organizationId: 1, tableId: 1 });

export const AirtableRecordModel = model<IAirtableRecord>(
  'AirtableRecord',
  AirtableRecordSchema,
  'airtable_records',
);
