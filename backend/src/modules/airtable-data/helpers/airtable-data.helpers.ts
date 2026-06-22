export const ALLOWED_COLLECTIONS: string[] = [
  'airtable_bases',
  'airtable_tables',
  'airtable_records',
  'airtable_users',
  'airtable_changelogs',
  'scraper_sessions',
];

/**
 * Discovers top-level and one-level-deep string fields from a sample document.
 * Used to build the $or clause for full-text regex search.
 */
export async function discoverStringFields(col: any, organizationId: string): Promise<string[]> {
  const sample = await col.findOne({ organizationId });
  if (!sample) return [];

  const fields: string[] = [];

  for (const [key, val] of Object.entries(sample)) {
    if (key === '_id' || key === '__v') continue;

    if (typeof val === 'string') {
      fields.push(key);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [nestedKey, nestedVal] of Object.entries(val as object)) {
        if (typeof nestedVal === 'string') {
          fields.push(`${key}.${nestedKey}`);
        }
      }
    }
  }

  return fields;
}
