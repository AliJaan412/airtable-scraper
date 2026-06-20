import mongoose from 'mongoose';
import { RawDataService } from '../raw-data.service';

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connection: {
      db: {
        collection: jest.fn(),
      },
    },
  };
});

const mockedDb = mongoose.connection.db as jest.Mocked<any>;

beforeEach(() => {
  jest.clearAllMocks();
});

function buildCollection(docs: any[]) {
  const cursor = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), toArray: jest.fn().mockResolvedValue(docs) };
  cursor.sort.mockReturnValue(cursor);
  cursor.skip.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return {
    find: jest.fn().mockReturnValue(cursor),
    findOne: jest.fn().mockResolvedValue(docs[0] ?? null),
    countDocuments: jest.fn().mockResolvedValue(docs.length),
  };
}

describe('RawDataService.getAllowedCollections', () => {
  it('returns only allowed collections', () => {
    const cols = RawDataService.getAllowedCollections();
    expect(cols).toContain('airtable_bases');
    expect(cols).toContain('airtable_records');
    expect(cols).toContain('airtable_changelogs');
    expect(cols).not.toContain('users');
  });
});

describe('RawDataService.query', () => {
  it('throws for disallowed collections', async () => {
    await expect(
      RawDataService.query({ organizationId: 'org1', collection: 'users' }),
    ).rejects.toThrow('not accessible');
  });

  it('returns paginated results and dynamic fields', async () => {
    const docs = [
      { _id: '1', organizationId: 'org1', name: 'Base A', baseId: 'b1' },
    ];
    const col = buildCollection(docs);
    mockedDb.collection.mockReturnValue(col);

    const result = await RawDataService.query({
      organizationId: 'org1',
      collection: 'airtable_bases',
      page: 1,
      pageSize: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.fields).toContain('name');
  });

  it('applies search regex across string fields', async () => {
    const docs = [{ _id: '1', organizationId: 'org1', name: 'My Base' }];
    const col = buildCollection(docs);
    mockedDb.collection.mockReturnValue(col);

    await RawDataService.query({
      organizationId: 'org1',
      collection: 'airtable_bases',
      search: 'My',
    });

    const [queryArg] = col.find.mock.calls[0];
    expect(queryArg.$or).toBeDefined();
  });

  it('always scopes query by organizationId', async () => {
    const col = buildCollection([]);
    mockedDb.collection.mockReturnValue(col);

    await RawDataService.query({ organizationId: 'tenant-xyz', collection: 'airtable_bases' });

    const [queryArg] = col.find.mock.calls[0];
    expect(queryArg.organizationId).toBe('tenant-xyz');
  });
});

describe('RawDataService.getCollectionSchema', () => {
  it('throws for disallowed collection', async () => {
    await expect(
      RawDataService.getCollectionSchema('org1', 'secret_table'),
    ).rejects.toThrow('not accessible');
  });

  it('returns field names from sample document', async () => {
    const col = buildCollection([{ _id: '1', organizationId: 'org1', name: 'Base A', baseId: 'b1', __v: 0 }]);
    mockedDb.collection.mockReturnValue(col);

    const fields = await RawDataService.getCollectionSchema('org1', 'airtable_bases');

    expect(fields).toContain('name');
    expect(fields).not.toContain('__v');
  });

  it('returns empty array when no sample document exists', async () => {
    const col = buildCollection([]);
    mockedDb.collection.mockReturnValue(col);

    const fields = await RawDataService.getCollectionSchema('org1', 'airtable_bases');

    expect(fields).toEqual([]);
  });
});
