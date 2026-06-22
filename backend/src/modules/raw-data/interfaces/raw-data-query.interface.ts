export interface RawDataQuery {
  organizationId: string;
  collection: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, any>;
}
