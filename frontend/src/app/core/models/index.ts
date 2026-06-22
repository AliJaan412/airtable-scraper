export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    fields?: string[];
  };
}

export interface AirtableBase {
  _id: string;
  organizationId: string;
  baseId: string;
  name: string;
  permissionLevel: string;
  syncedAt: string;
}

export interface AirtableTable {
  _id: string;
  organizationId: string;
  baseId: string;
  tableId: string;
  name: string;
  fields: TableField[];
}

export interface TableField {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface AirtableRecord {
  _id: string;
  organizationId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, any>;
  createdTime: string;
}

export interface Changelog {
  _id: string;
  organizationId: string;
  uuid: string;
  issueId: string;
  baseId: string;
  tableId: string;
  columnType: string;
  oldValue: string | null;
  newValue: string | null;
  createdDate: string;
  authoredBy: string;
}

export interface ConnectionStatus {
  connected: boolean;
  expiresAt?: string;
  scope?: string;
  isExpired?: boolean;
  lastSyncedAt?: string;
}

export interface ScraperSession {
  sessionId: string;
  status: 'idle' | 'authenticating' | 'awaiting_mfa' | 'awaiting_captcha' | 'running' | 'completed' | 'failed';
  progress: { total: number; processed: number; failed: number };
  error?: string;
  startedAt?: string;
  completedAt?: string;
  cookiesValidatedAt?: string;
}

export interface AirtableDataQueryResult {
  data: any[];
  fields: string[];
  total: number;
}

export type Integration = 'airtable';

export const COLLECTION_LABELS: Record<string, string> = {
  airtable_bases: 'Bases',
  airtable_tables: 'Tables',
  airtable_records: 'Tickets',
  airtable_users: 'Users',
  airtable_changelogs: 'Changelogs',
  scraper_sessions: 'Scraper Sessions',
};
