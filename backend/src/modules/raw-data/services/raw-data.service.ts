import mongoose from 'mongoose';

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

const ALLOWED_COLLECTIONS = [
  'airtable_bases',
  'airtable_tables',
  'airtable_records',
  'airtable_users',
  'airtable_changelogs',
  'scraper_sessions',
];

async function discoverStringFields(col: any, organizationId: string): Promise<string[]> {
  const sample = await col.findOne({ organizationId });
  if (!sample) return [];

  const fields: string[] = [];

  for (const [key, val] of Object.entries(sample)) {
    if (key === '_id' || key === '__v') continue;

    if (typeof val === 'string') {
      fields.push(key);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      // One level deep — catches nested objects like `fields.Name`, `fields.Status` in airtable_records
      for (const [nestedKey, nestedVal] of Object.entries(val as object)) {
        if (typeof nestedVal === 'string') {
          fields.push(`${key}.${nestedKey}`);
        }
      }
    }
  }

  return fields;
}

export const RawDataService = {
  getAllowedCollections(): string[] {
    return ALLOWED_COLLECTIONS;
  },

  async query(params: RawDataQuery): Promise<{ data: any[]; total: number; fields: string[] }> {
    const { organizationId, collection, search, page = 1, pageSize = 100, sortField, sortOrder, filters } = params;

    if (!ALLOWED_COLLECTIONS.includes(collection)) {
      throw new Error(`Collection "${collection}" is not accessible`);
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const col = db.collection(collection);

    // Always scope by organizationId
    const query: Record<string, any> = { organizationId };

    // Apply extra filters
    if (filters && typeof filters === 'object') {
      for (const [key, val] of Object.entries(filters)) {
        if (key && val !== undefined && val !== null && val !== '') {
          query[key] = val;
        }
      }
    }

    // Full-text search — discover string fields dynamically from a document
    if (search && search.trim()) {
      const searchFields = await discoverStringFields(col, organizationId);
      if (searchFields.length > 0) {
        const regex = { $regex: search.trim(), $options: 'i' };
        query.$or = searchFields.map((field) => ({ [field]: regex }));
      }
    }

    // Sort
    const sort: Record<string, 1 | -1> = {};
    if (sortField) {
      sort[sortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sort['createdAt'] = -1;
    }

    const [data, total] = await Promise.all([
      col.find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      col.countDocuments(query),
    ]);

    // Derive fields dynamically from the first document
    const fields = data.length > 0 ? Object.keys(data[0]).filter((k) => k !== '__v') : [];

    return { data, total, fields };
  },

  async getCollectionSchema(organizationId: string, collection: string): Promise<string[]> {
    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error('Collection not accessible');

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database not connected');

    const sample = await db.collection(collection).findOne({ organizationId });
    if (!sample) return [];
    return Object.keys(sample).filter((k) => k !== '__v');
  },
};
