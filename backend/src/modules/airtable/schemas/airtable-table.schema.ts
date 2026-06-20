import { Schema, model, Document } from 'mongoose';

export interface IAirtableTable extends Document {
  organizationId: string;
  baseId: string;
  tableId: string;
  name: string;
  primaryFieldId: string;
  fields: any[];
  views: any[];
  rawData: Record<string, any>;
  syncedAt: Date;
}

const AirtableTableSchema = new Schema<IAirtableTable>(
  {
    organizationId: { type: String, required: true, index: true },
    baseId: { type: String, required: true, index: true },
    tableId: { type: String, required: true },
    name: { type: String, required: true },
    primaryFieldId: { type: String },
    fields: [Schema.Types.Mixed],
    views: [Schema.Types.Mixed],
    rawData: { type: Schema.Types.Mixed },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AirtableTableSchema.index({ organizationId: 1, baseId: 1, tableId: 1 }, { unique: true });

export const AirtableTableModel = model<IAirtableTable>(
  'AirtableTable',
  AirtableTableSchema,
  'airtable_tables',
);
