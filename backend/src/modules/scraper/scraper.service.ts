import { v4 as uuidv4 } from 'uuid';
import { CookieService } from './cookie.service';
import { ScraperRepository } from './scraper.repository';
import { AirtableRepository } from '../airtable/airtable.repository';
import { parseActivities } from './changelog.parser';

const scraperRepo = new ScraperRepository();
const airtableRepo = new AirtableRepository();

// 3 parallel requests per batch with 1s gap ≈ 3 req/sec — safe under Airtable's scraping tolerance
const BATCH_SIZE = 3;
const DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const ScraperService = {
  async initiateAuth(
    organizationId: string,
    email: string,
    password: string,
  ): Promise<{ sessionId: string; requiresMfa: boolean }> {
    const sessionId = uuidv4();

    await scraperRepo.upsertSession(sessionId, {
      organizationId,
      status: 'authenticating',
      email,
      startedAt: new Date(),
      progress: { total: 0, processed: 0, failed: 0 },
    });

    let requiresMfa = false;

    // Run auth in background — don't await to allow MFA interaction
    const authPromise = CookieService.startAuth(sessionId, email, password, async (status) => {
      if (status === 'awaiting_mfa') {
        requiresMfa = true;
        await scraperRepo.updateSessionStatus(sessionId, 'awaiting_mfa');
      } else if (status === 'awaiting_captcha') {
        await scraperRepo.updateSessionStatus(sessionId, 'awaiting_captcha');
      } else if (status === 'running') {
        await scraperRepo.updateSessionStatus(sessionId, 'running');
      }
    });

    // Give Puppeteer 3 seconds to determine if MFA is required
    await sleep(3000);

    const session = await scraperRepo.getSession(sessionId);
    if (session?.status === 'awaiting_mfa') {
      requiresMfa = true;
    } else {
      // Auth may complete without MFA — store cookies when done
      authPromise
        .then(async (cookies) => {
          await scraperRepo.upsertSession(sessionId, {
            cookies,
            cookiesValidatedAt: new Date(),
            status: 'idle',
          });
        })
        .catch(async (err) => {
          await scraperRepo.updateSessionStatus(sessionId, 'failed', { error: err.message });
        });
    }

    return { sessionId, requiresMfa };
  },

  async submitMfa(sessionId: string, mfaCode: string): Promise<void> {
    const session = await scraperRepo.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'awaiting_mfa') throw new Error('Session is not awaiting MFA');

    try {
      const cookies = await CookieService.submitMfa(sessionId, mfaCode);
      await scraperRepo.upsertSession(sessionId, {
        cookies,
        cookiesValidatedAt: new Date(),
        status: 'idle',
      });
    } catch (err: any) {
      await scraperRepo.updateSessionStatus(sessionId, 'failed', { error: err.message });
      throw err;
    }
  },

  async validateCookies(sessionId: string): Promise<{ valid: boolean }> {
    const session = await scraperRepo.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const valid = await CookieService.validateCookies(session.cookies);

    if (valid) {
      await scraperRepo.upsertSession(sessionId, { cookiesValidatedAt: new Date() });
    } else {
      await scraperRepo.updateSessionStatus(sessionId, 'failed', {
        error: 'Cookies are invalid or expired',
      });
    }

    return { valid };
  },

  async runScraper(organizationId: string, sessionId: string): Promise<void> {
    const session = await scraperRepo.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (!session.cookies) throw new Error('No cookies available — authenticate first');

    // Validate cookies before starting
    const valid = await CookieService.validateCookies(session.cookies);
    if (!valid) throw new Error('Cookies expired — please re-authenticate');

    // Get all records across all tables
    const bases = await airtableRepo.getBases(organizationId);
    const allRecords: Array<{ baseId: string; tableId: string; recordId: string }> = [];

    for (const base of bases) {
      const tables = await airtableRepo.getTables(organizationId, base.baseId);
      for (const table of tables) {
        const records = await airtableRepo.getRecordsByTable(organizationId, base.baseId, table.tableId);
        for (const record of records) {
          allRecords.push({ baseId: base.baseId, tableId: table.tableId, recordId: record.recordId });
        }
      }
    }

    await scraperRepo.updateSessionStatus(sessionId, 'running', {
      progress: { total: allRecords.length, processed: 0, failed: 0 },
    });

    // Re-use the browser kept alive from login — mandatory, because __Host- cookies
    // are bound to the live browser and cannot be re-injected into a fresh one.
    // If the live browser is gone (e.g. backend restarted), fail immediately so the
    // user gets a clear prompt to re-authenticate instead of 200 silent 401s.
    let browser: any;
    let page: any;
    try {
      const live = CookieService.takeLiveBrowser(sessionId);
      if (!live) {
        await scraperRepo.updateSessionStatus(sessionId, 'failed', {
          error: 'Browser session lost — __Host- cookies require a live browser. Please re-authenticate.',
        });
        return;
      }
      ({ browser, page } = live);
    } catch (err: any) {
      await scraperRepo.updateSessionStatus(sessionId, 'failed', { error: `Browser launch failed: ${err.message}` });
      return;
    }

    let abortReason: string | null = null;
    let browserDisconnected = false;

    browser.on('disconnected', () => {
      browserDisconnected = true;
      console.error('[Scraper] Browser disconnected unexpectedly');
    });

    // Pre-flight: verify the live browser can actually reach Airtable's internal API
    // before committing to scraping all records. Catches expired sessions immediately
    // so the user sees "re-authenticate" instead of "200 records processed (all failed)".
    if (allRecords.length > 0) {
      const probe = allRecords[0];
      try {
        const probeRaw = await CookieService.fetchRevisionHistoryInPage(page, probe.baseId, probe.tableId, probe.recordId);
        // If it threw AUTH_EXPIRED it was caught above; if it returned data, good.
        console.log(`[Scraper] Pre-flight OK — browser session is valid`);
        // Count the probe record's result so we don't double-process it
        const activities = parseActivities(probeRaw, probe.recordId, probe.baseId, probe.tableId);
        await scraperRepo.bulkUpsertChangelogs(organizationId, activities);
        await scraperRepo.incrementProgress(sessionId, 1, 0);
      } catch (err: any) {
        if (err?.message?.startsWith('AUTH_EXPIRED:')) {
          const detail = err.message.replace('AUTH_EXPIRED: ', '');
          await scraperRepo.updateSessionStatus(sessionId, 'failed', {
            error: `${detail} — please re-authenticate`,
          });
          try { await browser.close(); } catch { /* ignore */ }
          return;
        }
        // Non-auth error on probe record — log and continue (might be a transient issue)
        console.warn('[Scraper] Pre-flight probe failed (non-auth):', err?.message);
        await scraperRepo.incrementProgress(sessionId, 0, 1);
      }
    }

    // Skip the probe record in the main loop (already processed above)
    const recordsToProcess = allRecords.slice(allRecords.length > 0 ? 1 : 0);

    try {
      for (let i = 0; i < recordsToProcess.length; i += BATCH_SIZE) {
        if (abortReason) break;

        const latestSession = await scraperRepo.getSession(sessionId);
        if (!latestSession || latestSession.status === 'failed') break;

        // Re-validate cookies every 50 records
        if (i > 0 && i % 50 === 0) {
          const stillValid = await CookieService.validateCookies(latestSession.cookies);
          if (!stillValid) {
            abortReason = 'Cookies expired during scraping — please re-authenticate';
            break;
          }
        }

        const batch = recordsToProcess.slice(i, i + BATCH_SIZE);

        // Process batch sequentially within the shared page (avoid parallel page.evaluate races)
        for (const { baseId, tableId, recordId } of batch) {
          try {
            const raw = await CookieService.fetchRevisionHistoryInPage(page, baseId, tableId, recordId);
            const activities = parseActivities(raw, recordId, baseId, tableId);
            await scraperRepo.bulkUpsertChangelogs(organizationId, activities);
            await scraperRepo.incrementProgress(sessionId, 1, 0);
          } catch (err: any) {
            console.warn(`[Scraper] record ${recordId} failed:`, err?.message);
            // Auth failure: session cookies rejected by Airtable.
            // Every remaining record will also fail — abort immediately so the
            // user gets a clear error instead of "200 tickets processed" with
            // zero actual data.
            if (err?.message?.startsWith('AUTH_EXPIRED:')) {
              abortReason = err.message.replace('AUTH_EXPIRED: ', '');
              break;
            }
            await scraperRepo.incrementProgress(sessionId, 0, 1);
            // If Chrome died, every subsequent call will also fail — abort now
            if (browserDisconnected) {
              abortReason = 'Browser crashed during scraping — results are incomplete';
              break;
            }
          }
        }

        await sleep(DELAY_MS);
      }
    } finally {
      try { await browser.close(); } catch { /* ignore */ }
    }

    if (abortReason) {
      await scraperRepo.updateSessionStatus(sessionId, 'failed', { error: abortReason });
      return;
    }

    // If every record failed it indicates a systemic problem (lost __Host- cookies, etc.)
    const finalSession = await scraperRepo.getSession(sessionId);
    const prog = finalSession?.progress;
    if (prog && prog.total > 0 && prog.failed === prog.total) {
      await scraperRepo.updateSessionStatus(sessionId, 'failed', {
        error: `All ${prog.total} records failed — cookies may be incomplete (__Host- cookies lost on browser restart) or Chrome crashed`,
      });
      return;
    }

    await scraperRepo.updateSessionStatus(sessionId, 'completed', { completedAt: new Date() });
  },

  async getSession(sessionId: string) {
    return scraperRepo.getSession(sessionId);
  },

  async getLatestSession(organizationId: string) {
    return scraperRepo.getLatestSession(organizationId);
  },

  async debugOneRecord(organizationId: string, sessionId: string): Promise<any> {
    const bases = await airtableRepo.getBases(organizationId);
    if (!bases.length) throw new Error('No bases found');

    const tables = await airtableRepo.getTables(organizationId, bases[0].baseId);
    if (!tables.length) throw new Error('No tables found');

    const records = await airtableRepo.getRecordsByTable(organizationId, bases[0].baseId, tables[0].tableId);
    if (!records.length) throw new Error('No records found in MongoDB — sync first');

    const { baseId, tableId, recordId } = records[0];

    // Prefer the live browser (has real __Host- cookies) over a fresh session
    const live = CookieService.takeLiveBrowser(sessionId);
    let browser: any = null;
    let page: any;

    try {
      if (live) {
        browser = live.browser;
        page = live.page;
      } else {
        const session = await scraperRepo.getSession(sessionId);
        if (!session?.cookies) throw new Error('No cookies in session and no live browser');
        ({ browser, page } = await CookieService.openAirtablePage(session.cookies));
      }

      const raw = await CookieService.fetchRevisionHistoryInPage(page, baseId, tableId, recordId);
      return { recordId, baseId, tableId, raw: typeof raw === 'string' ? raw.slice(0, 3000) : raw };
    } catch (err: any) {
      return { recordId, baseId, tableId, error: err.message };
    } finally {
      if (live && browser) {
        // Put it back if we took it for debugging — scraper may still need it
        // Actually close it since this is debug-only
        try { await browser.close(); } catch { /* ignore */ }
      } else if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  },

  async discoverActivityEndpoint(organizationId: string, sessionId: string): Promise<any> {
    const bases = await airtableRepo.getBases(organizationId);
    if (!bases.length) throw new Error('No bases found — sync first');
    const tables = await airtableRepo.getTables(organizationId, bases[0].baseId);
    if (!tables.length) throw new Error('No tables found — sync first');

    const live = CookieService.takeLiveBrowser(sessionId);
    let browser: any = null;
    let page: any;

    try {
      if (live) {
        browser = live.browser;
        page = live.page;
      } else {
        const session = await scraperRepo.getSession(sessionId);
        if (!session?.cookies) throw new Error('No live browser and no cookies in session');
        ({ browser, page } = await CookieService.openAirtablePage(session.cookies));
      }

      const result = await CookieService.discoverActivityEndpoint(
        page,
        bases[0].baseId,
        tables[0].tableId,
      );

      console.log('[Discovery] Result:', JSON.stringify(result, null, 2));
      return result;
    } finally {
      if (browser) try { await browser.close(); } catch { /* ignore */ }
    }
  },

  async getChangelogs(
    organizationId: string,
    filter: Record<string, any>,
    page: number,
    pageSize: number,
  ) {
    return scraperRepo.getChangelogs(organizationId, filter, page, pageSize);
  },

  async getStats(organizationId: string) {
    return scraperRepo.getChangelogStats(organizationId);
  },
};
