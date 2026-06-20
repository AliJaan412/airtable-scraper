import { CookieService } from '../cookie.service';
import * as parser from '../changelog.parser';

jest.mock('../cookie.service');
jest.mock('../changelog.parser');

// Factory mocks for module-level singletons
const mockGetSession = jest.fn();
const mockUpsertSession = jest.fn();
const mockUpdateSessionStatus = jest.fn();
const mockIncrementProgress = jest.fn();
const mockBulkUpsertChangelogs = jest.fn();
const mockGetLatestSession = jest.fn();
const mockGetChangelogs = jest.fn();

const mockGetBases = jest.fn();
const mockGetTables = jest.fn();
const mockGetRecordsByTable = jest.fn();

jest.mock('../scraper.repository', () => ({
  ScraperRepository: jest.fn().mockImplementation(() => ({
    getSession: mockGetSession,
    upsertSession: mockUpsertSession,
    updateSessionStatus: mockUpdateSessionStatus,
    incrementProgress: mockIncrementProgress,
    bulkUpsertChangelogs: mockBulkUpsertChangelogs,
    getLatestSession: mockGetLatestSession,
    getChangelogs: mockGetChangelogs,
  })),
}));

jest.mock('../../airtable/airtable.repository', () => ({
  AirtableRepository: jest.fn().mockImplementation(() => ({
    getBases: mockGetBases,
    getTables: mockGetTables,
    getRecordsByTable: mockGetRecordsByTable,
  })),
}));

// Import AFTER mocks are registered
import { ScraperService } from '../scraper.service';

const MockedCookieService = CookieService as jest.Mocked<typeof CookieService>;
const mockedParser = parser as jest.Mocked<typeof parser>;

const ORG_ID = 'test-org';
const SESSION_ID = 'session-abc-123';
const COOKIES = 'airtable_session=abc; airtable_user=xyz';

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsertSession.mockResolvedValue({});
  mockUpdateSessionStatus.mockResolvedValue(undefined);
  mockIncrementProgress.mockResolvedValue(undefined);
  mockBulkUpsertChangelogs.mockResolvedValue(1);
});

describe('ScraperService.validateCookies', () => {
  it('marks session valid when cookies check out', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, cookies: COOKIES, status: 'idle' });
    MockedCookieService.validateCookies = jest.fn().mockResolvedValue(true);

    const result = await ScraperService.validateCookies(SESSION_ID);

    expect(result.valid).toBe(true);
    expect(mockUpsertSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ cookiesValidatedAt: expect.any(Date) }),
    );
  });

  it('marks session failed when cookies are invalid', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, cookies: COOKIES, status: 'idle' });
    MockedCookieService.validateCookies = jest.fn().mockResolvedValue(false);

    const result = await ScraperService.validateCookies(SESSION_ID);

    expect(result.valid).toBe(false);
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      SESSION_ID,
      'failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('throws when session does not exist', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(ScraperService.validateCookies(SESSION_ID)).rejects.toThrow('Session not found');
  });
});

describe('ScraperService.submitMfa', () => {
  it('stores cookies and sets status to idle on success', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, status: 'awaiting_mfa' });
    MockedCookieService.submitMfa = jest.fn().mockResolvedValue(COOKIES);

    await ScraperService.submitMfa(SESSION_ID, '123456');

    expect(mockUpsertSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ cookies: COOKIES, status: 'idle' }),
    );
  });

  it('throws when session is not awaiting MFA', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, status: 'idle' });

    await expect(ScraperService.submitMfa(SESSION_ID, '123456')).rejects.toThrow('not awaiting MFA');
  });

  it('throws when session does not exist', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(ScraperService.submitMfa(SESSION_ID, '123456')).rejects.toThrow('Session not found');
  });
});

describe('ScraperService.runScraper', () => {
  it('throws when session has no cookies', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, status: 'idle', cookies: null });

    await expect(ScraperService.runScraper(ORG_ID, SESSION_ID)).rejects.toThrow('No cookies available');
  });

  it('throws when cookies are expired', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, cookies: COOKIES, status: 'idle' });
    MockedCookieService.validateCookies = jest.fn().mockResolvedValue(false);

    await expect(ScraperService.runScraper(ORG_ID, SESSION_ID)).rejects.toThrow('Cookies expired');
  });

  it('processes records and marks session completed', async () => {
    mockGetSession.mockResolvedValue({ sessionId: SESSION_ID, cookies: COOKIES, status: 'running' });
    MockedCookieService.validateCookies = jest.fn().mockResolvedValue(true);
    mockGetBases.mockResolvedValue([{ baseId: 'base1' }]);
    mockGetTables.mockResolvedValue([{ tableId: 'tbl1' }]);
    mockGetRecordsByTable.mockResolvedValue([{ recordId: 'rec1' }]);
    MockedCookieService.fetchRevisionHistory = jest.fn().mockResolvedValue('<html></html>');
    mockedParser.parseActivities = jest.fn().mockReturnValue([]);

    await ScraperService.runScraper(ORG_ID, SESSION_ID);

    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      SESSION_ID,
      'completed',
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );
  });
});
