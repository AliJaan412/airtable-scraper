import axios from 'axios';
import * as cacheModule from '../../../common/cache';

jest.mock('axios');
jest.mock('../../../common/cache', () => ({
  cache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), delPattern: jest.fn() },
}));

// Factory mocks so the module-level `repo` singleton uses our mock functions
const mockGetConnection = jest.fn();
const mockDeleteConnection = jest.fn();
const mockSaveOAuthState = jest.fn();
const mockGetConnectionByState = jest.fn();
const mockUpsertConnection = jest.fn();
const mockUpsertBase = jest.fn();
const mockGetBases = jest.fn();
const mockUpsertTable = jest.fn();
const mockGetTables = jest.fn();
const mockGetAllTables = jest.fn();
const mockUpsertRecord = jest.fn();
const mockGetRecords = jest.fn();
const mockGetRecordsByTable = jest.fn();
const mockUpsertUser = jest.fn();
const mockGetUsers = jest.fn();

jest.mock('../repositories/airtable.repository', () => ({
  AirtableRepository: jest.fn().mockImplementation(() => ({
    getConnection: mockGetConnection,
    deleteConnection: mockDeleteConnection,
    saveOAuthState: mockSaveOAuthState,
    getConnectionByState: mockGetConnectionByState,
    upsertConnection: mockUpsertConnection,
    upsertBase: mockUpsertBase,
    getBases: mockGetBases,
    upsertTable: mockUpsertTable,
    getTables: mockGetTables,
    getAllTables: mockGetAllTables,
    upsertRecord: mockUpsertRecord,
    getRecords: mockGetRecords,
    getRecordsByTable: mockGetRecordsByTable,
    upsertUser: mockUpsertUser,
    getUsers: mockGetUsers,
  })),
}));

// Import AFTER mocks are registered
import { AirtableService } from '../services/airtable.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockCache = (cacheModule as any).cache as jest.Mocked<typeof cacheModule.cache>;

const ORG_ID = 'test-org';

const mockConnection = {
  organizationId: ORG_ID,
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: new Date(Date.now() + 3_600_000),
  scope: 'data.records:read',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.get.mockResolvedValue(null);
  mockCache.set.mockResolvedValue(undefined);
  mockCache.del.mockResolvedValue(undefined);
  mockCache.delPattern.mockResolvedValue(undefined);
});

describe('AirtableService.getConnectionStatus', () => {
  it('returns cached value when present', async () => {
    const cached = { connected: true, isExpired: false };
    mockCache.get.mockResolvedValueOnce(cached);

    const result = await AirtableService.getConnectionStatus(ORG_ID);

    expect(result).toEqual(cached);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('returns { connected: false } when no connection exists', async () => {
    mockGetConnection.mockResolvedValue(null);

    const result = await AirtableService.getConnectionStatus(ORG_ID);

    expect(result).toEqual({ connected: false });
    expect(mockCache.set).toHaveBeenCalledWith(`airtable:status:${ORG_ID}`, { connected: false }, 300);
  });

  it('returns connected status and caches it', async () => {
    mockGetConnection.mockResolvedValue(mockConnection);

    const result = await AirtableService.getConnectionStatus(ORG_ID);

    expect(result.connected).toBe(true);
    expect(result.isExpired).toBe(false);
    expect(mockCache.set).toHaveBeenCalled();
  });
});

describe('AirtableService.disconnect', () => {
  it('deletes connection and clears cache', async () => {
    mockDeleteConnection.mockResolvedValue(undefined);

    await AirtableService.disconnect(ORG_ID);

    expect(mockDeleteConnection).toHaveBeenCalledWith(ORG_ID);
    expect(mockCache.delPattern).toHaveBeenCalledWith(`airtable:*:${ORG_ID}`);
  });
});

describe('AirtableService.syncBases', () => {
  it('fetches bases, upserts each, and clears cache', async () => {
    mockGetConnection.mockResolvedValue(mockConnection);
    mockUpsertBase.mockResolvedValue({});
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: {
        bases: [
          { id: 'appBase1', name: 'Base 1', permissionLevel: 'create' },
          { id: 'appBase2', name: 'Base 2', permissionLevel: 'read' },
        ],
      },
    });

    const count = await AirtableService.syncBases(ORG_ID);

    expect(count).toBe(2);
    expect(mockUpsertBase).toHaveBeenCalledTimes(2);
    expect(mockCache.del).toHaveBeenCalledWith(`airtable:bases:${ORG_ID}`);
  });
});

describe('AirtableService — 429 retry', () => {
  it('retries on 429 and succeeds on second attempt', async () => {
    mockGetConnection.mockResolvedValue(mockConnection);
    mockUpsertBase.mockResolvedValue({});

    const rateLimitError = { response: { status: 429, headers: { 'retry-after': '0' } } };
    const successResponse = { data: { bases: [{ id: 'b1', name: 'B', permissionLevel: 'create' }] } };

    mockedAxios.get = jest.fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResponse);

    const count = await AirtableService.syncBases(ORG_ID);

    expect(count).toBe(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});

describe('AirtableService.initiateOAuth', () => {
  it('returns url, state, and codeVerifier', () => {
    const result = AirtableService.initiateOAuth(ORG_ID);

    expect(result.url).toContain('airtable.com/oauth2');
    expect(result.state).toHaveLength(32);
    expect(result.codeVerifier).toBeDefined();
  });
});
