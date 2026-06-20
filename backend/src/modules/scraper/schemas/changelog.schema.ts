import { Schema, model, Document } from 'mongoose';

export interface IChangelog extends Document {
  organizationId: string;
  uuid: string;
  issueId: string;
  baseId: string;
  tableId: string;
  columnType: string;
  oldValue: string | null;
  newValue: string | null;
  createdDate: Date;
  authoredBy: string;
  rawActivity: Record<string, any>;
  createdAt: Date;
}

const ChangelogSchema = new Schema<IChangelog>(
  {
    organizationId: { type: String, required: true, index: true },
    uuid: { type: String, required: true },
    issueId: { type: String, required: true, index: true },
    baseId: { type: String, required: true, index: true },
    tableId: { type: String, required: true, index: true },
    columnType: { type: String, required: true, index: true },
    oldValue: { type: String, default: null },
    newValue: { type: String, default: null },
    createdDate: { type: Date, required: true },
    authoredBy: { type: String },
    rawActivity: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

ChangelogSchema.index({ organizationId: 1, issueId: 1, uuid: 1 }, { unique: true });
ChangelogSchema.index({ organizationId: 1, columnType: 1 });
ChangelogSchema.index({ organizationId: 1, createdDate: -1 });

export const ChangelogModel = model<IChangelog>(
  'Changelog',
  ChangelogSchema,
  'airtable_changelogs',
);
