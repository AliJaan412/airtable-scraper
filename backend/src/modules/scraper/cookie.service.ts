import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, Cookie } from 'puppeteer';
import axios from 'axios';

// Apply stealth plugin once at module load — patches navigator.webdriver, chrome runtime,
// plugin arrays, etc. so Cloudflare/Airtable bot detection doesn't block the login page.
puppeteerExtra.use(StealthPlugin());

interface PendingSession {
  browser: Browser;
  page: Page;
  resolve: (cookies: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  // Set when verification code step precedes the real login form
  postVerificationCredentials?: { email: string; password: string };
}

const pendingSessions = new Map<string, PendingSession>();

// Keep browsers alive from login so we can reuse them for scraping without re-injecting cookies
const liveBrowsers = new Map<string, { browser: Browser; page: Page }>();

async function launchBrowser(opts: { headless?: boolean } = {}): Promise<Browser> {
  const { headless = true } = opts;
  // Use a persistent user-data-dir so Chrome looks like a real installed browser
  // (not a fresh throwaway profile Cloudflare recognises as a bot).
  const path = await import('path');
  const fs = await import('fs');
  const profileDir = path.default.resolve(__dirname, '../../../../chrome-profile');
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir: profileDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--window-size=1280,900',
      '--lang=en-US,en',
    ],
  });

  return browser;
}

function serializeCookies(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export const CookieService = {
  /**
   * Start an authentication session. Returns sessionId immediately.
   * If MFA is needed, status becomes 'awaiting_mfa' and the caller must call submitMfa.
   */
  async startAuth(
    sessionId: string,
    email: string,
    password: string,
    onStatusChange: (status: string) => void,
  ): Promise<string> {
    let browser = await launchBrowser();
    let page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 1280, height: 900 });

    try {
      onStatusChange('authenticating');

      // Navigate homepage first — jumping cold to /login is a bot signal.
      // Real browsers always load the root domain before the auth page.
      await page.goto('https://airtable.com', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1200));

      await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2', timeout: 40000 });

      // Log where we landed — helps detect Cloudflare or verification pages
      const pageTitle = await page.title();
      const pageUrl = page.url();
      console.log(`[Auth] Loaded — title: "${pageTitle}"  url: ${pageUrl}`);

      // ── Device verification ("Verify it's you") ────────────────────────────
      // Airtable shows this when the browser profile is new/unrecognised.
      // Two possible outcomes after clicking the button:
      //   A) A CODE input appears  → suspend as MFA so user can enter the emailed code
      //   B) The LOGIN FORM appears → fall through and do email+password below
      if (/verify/i.test(pageTitle)) {
        console.log('[Auth] Device verification page detected');
        await page.screenshot({ path: 'auth-verify.png', fullPage: true }).catch(() => null);

        // Click "Send code" / "Continue" — whichever button is present
        const clickedBtn = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
          const sendBtn = btns.find((b) => /send|continue|next|verify|email/i.test(b.textContent ?? ''));
          const target = sendBtn ?? btns[0];
          if (target) { target.click(); return target.textContent?.trim() ?? '(unknown)'; }
          return null;
        }).catch(() => null);
        console.log(`[Auth] Clicked verification button: "${clickedBtn}"`);

        await new Promise((r) => setTimeout(r, 2500));

        // Log what inputs appeared so we can decide how to proceed
        const inputsAfter = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input')).map((el: any) => ({
            type: el.type, name: el.name, placeholder: el.placeholder,
          })),
        ).catch(() => [] as any[]);
        console.log('[Auth] Inputs after verification click:', JSON.stringify(inputsAfter));

        // Detect whether a CODE field or the LOGIN FORM appeared
        const hasEmailField = inputsAfter.some((i: any) =>
          i.type === 'email' || i.name === 'email' || /email/i.test(i.placeholder ?? ''),
        );
        const hasCodeField = !hasEmailField && inputsAfter.some((i: any) =>
          i.type === 'text' || i.type === 'number' || i.type === 'tel' ||
          /code|otp|token|pin/i.test(i.name ?? '') || /code|otp|digit/i.test(i.placeholder ?? ''),
        );

        if (hasEmailField) {
          // Outcome B: verification button navigated straight to the login form.
          // Fall through — the email+password flow below will handle it.
          console.log('[Auth] Verification navigated to login form — proceeding with normal login');
        } else if (hasCodeField) {
          // Outcome A: a code-entry field appeared — user must enter the emailed code.
          console.log('[Auth] Verification code field detected — awaiting user input');
          onStatusChange('awaiting_mfa');
          return await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              browser.close();
              pendingSessions.delete(sessionId);
              reject(new Error('Verification timeout — session expired'));
            }, 300000);
            pendingSessions.set(sessionId, {
              browser, page, resolve, reject, timer,
              postVerificationCredentials: { email, password },
            });
          });
        } else {
          // CAPTCHA challenge (e.g. hCaptcha) — headless browser can't solve it.
          // Re-launch visibly so the user can solve it manually on this machine.
          console.log('[Auth] CAPTCHA detected — relaunching Chrome in visible mode for manual solve');
          await browser.close();
          browser = await launchBrowser({ headless: false });
          page = await browser.newPage();
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          );
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2', timeout: 40000 });
          onStatusChange('awaiting_captcha');

          // Wait up to 3 minutes for the user to solve the challenge
          await page.waitForFunction(
            `() => document.querySelectorAll('input').length > 0`,
            { timeout: 180000 },
          ).catch(async () => {
            await browser.close();
            throw new Error('CAPTCHA verification timed out — please try again');
          });

          // Determine what appeared: a code field (email verification) or the login form
          const postCaptchaInputs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('input')).map((el: any) => ({
              type: el.type, name: el.name, placeholder: el.placeholder,
            })),
          ).catch(() => [] as any[]);

          const hasCodeAfterCaptcha = postCaptchaInputs.some((i: any) =>
            /code|otp|token|pin/i.test(i.name ?? '') ||
            /code|otp|digit/i.test(i.placeholder ?? '') ||
            i.type === 'number' || i.type === 'tel',
          );

          if (hasCodeAfterCaptcha) {
            onStatusChange('awaiting_mfa');
            return await new Promise<string>((resolve, reject) => {
              const timer = setTimeout(() => {
                browser.close();
                pendingSessions.delete(sessionId);
                reject(new Error('Verification timeout — session expired'));
              }, 300000);
              pendingSessions.set(sessionId, {
                browser, page, resolve, reject, timer,
                postVerificationCredentials: { email, password },
              });
            });
          }
          // Otherwise fall through — login form is visible, continue below
        }
      }
      // ── End device verification ────────────────────────────────────────────

      // Wait up to 15s for ANY input (also covers the fall-through from verification above)
      await page.waitForFunction(
        `() => document.querySelectorAll('input').length > 0`,
        { timeout: 15000 },
      ).catch(async () => {
        await page.screenshot({ path: 'auth-debug.png', fullPage: true }).catch(() => null);
        const html = await page.content().catch(() => '');
        console.error('[Auth] No inputs after 15s. Check auth-debug.png. Page excerpt:', html.slice(0, 800));
        throw new Error(`Login page rendered no inputs — check auth-debug.png in backend/ folder. Title: "${pageTitle}"`);
      });

      // Email field — try every known selector variant
      const emailSelectors = [
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="work" i]',
        'input[data-fieldname*="email" i]',
      ];
      let emailSelector: string | null = null;
      for (const sel of emailSelectors) {
        const found = await page.$(sel);
        if (found) { emailSelector = sel; break; }
      }
      if (!emailSelector) {
        const inputs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input')).map((el) => ({
            name: (el as HTMLInputElement).name,
            type: (el as HTMLInputElement).type,
            placeholder: (el as HTMLInputElement).placeholder,
            id: el.id,
            class: el.className.slice(0, 60),
          })),
        );
        await page.screenshot({ path: 'auth-debug.png', fullPage: true }).catch(() => null);
        console.error('[Auth] No email selector matched. Inputs:', JSON.stringify(inputs, null, 2));
        throw new Error(`Email field not found. Inputs on page: ${JSON.stringify(inputs)}`);
      }

      console.log(`[Auth] Using email selector: ${emailSelector}`);
      await page.type(emailSelector, email, { delay: 50 });

      // Click continue to proceed to password step
      const continueBtn = await page.$('button[type="submit"]');
      if (continueBtn) await continueBtn.click();

      // Wait for password field — try multiple selectors as Airtable's login page varies
      const passwordSelector = await Promise.race([
        page.waitForSelector('input[type="password"]', { timeout: 12000 }).then(() => 'input[type="password"]'),
        page.waitForSelector('input[name="password"]', { timeout: 12000 }).then(() => 'input[name="password"]'),
        page.waitForSelector('input[autocomplete="current-password"]', { timeout: 12000 }).then(() => 'input[autocomplete="current-password"]'),
      ]).catch(() => null);

      if (!passwordSelector) throw new Error('Password field not found — Airtable login page may have changed');
      await page.type(passwordSelector, password, { delay: 50 });

      // Register navigation listener BEFORE submitting — if the page loads
      // before waitForNavigation is called the event is missed and times out.
      const postLoginNav = page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 })
        .catch(() => null);

      // Submit login form
      await page.keyboard.press('Enter');

      // Check for MFA prompt
      try {
        await page.waitForSelector('input[name="mfaCode"], input[placeholder*="code"], input[placeholder*="Code"]', {
          timeout: 5000,
        });

        // MFA required — suspend here and wait for code
        onStatusChange('awaiting_mfa');

        return await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            browser.close();
            pendingSessions.delete(sessionId);
            reject(new Error('MFA timeout — session expired'));
          }, 300000); // 5 min timeout

          pendingSessions.set(sessionId, { browser, page, resolve, reject, timer });
        });
      } catch {
        // No MFA — wait for the navigation we pre-registered above
      }

      await postLoginNav;

      const cookies = await page.cookies();
      const cookieStr = serializeCookies(cookies);

      // Keep browser alive — reuse for revision history scraping
      liveBrowsers.set(sessionId, { browser, page });

      onStatusChange('running');
      return cookieStr;
    } catch (err) {
      await browser.close();
      throw err;
    }
  },

  async submitMfa(sessionId: string, mfaCode: string): Promise<string> {
    const session = pendingSessions.get(sessionId);
    if (!session) throw new Error('Session not found or expired');

    const { browser, page, resolve, reject, timer, postVerificationCredentials } = session;
    clearTimeout(timer);
    pendingSessions.delete(sessionId);

    try {
      // Enter the code into whatever input is currently visible
      // (device-verification code OR login MFA code — same UI treatment)
      const input = await page.$('input[name="mfaCode"], input[placeholder*="code" i], input[type="text"], input[type="number"]');
      if (!input) throw new Error('Code input field not found');

      await input.type(mfaCode, { delay: 50 });

      const navPromise = page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 })
        .catch(() => null);

      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) await submitBtn.click();
      else await page.keyboard.press('Enter');

      await Promise.race([
        navPromise,
        page.waitForFunction(
          `() => !document.querySelector('input[type="text"], input[type="number"], input[name="mfaCode"]')`,
          { timeout: 35000 },
        ).catch(() => null),
        new Promise<void>((r) => setTimeout(r, 8000)),
      ]);

      await new Promise((r) => setTimeout(r, 2000));

      // ── Post-verification: complete the email+password login ────────────────
      // If this was a device-verification step (not real MFA), the page now
      // shows the standard Airtable login form.  Complete it automatically with
      // the credentials that were stored when verification started.
      if (postVerificationCredentials) {
        console.log('[Auth] Verification done — completing email+password login');
        const { email, password } = postVerificationCredentials;

        // Wait for email field
        const emailSel = await Promise.race([
          page.waitForSelector('input[name="email"]', { timeout: 10000 }).then(() => 'input[name="email"]'),
          page.waitForSelector('input[type="email"]', { timeout: 10000 }).then(() => 'input[type="email"]'),
          page.waitForSelector('input[autocomplete="email"]', { timeout: 10000 }).then(() => 'input[autocomplete="email"]'),
        ]).catch(() => null);

        if (!emailSel) throw new Error('Login form not found after device verification — check if the code was correct');

        await page.type(emailSel, email, { delay: 50 });
        const continueBtn = await page.$('button[type="submit"]');
        if (continueBtn) await continueBtn.click();

        const pwdSel = await Promise.race([
          page.waitForSelector('input[type="password"]', { timeout: 12000 }).then(() => 'input[type="password"]'),
          page.waitForSelector('input[name="password"]', { timeout: 12000 }).then(() => 'input[name="password"]'),
        ]).catch(() => null);

        if (!pwdSel) throw new Error('Password field not found after entering email');

        await page.type(pwdSel, password, { delay: 50 });

        const postLoginNav = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => null);
        await page.keyboard.press('Enter');

        // Check for MFA after password submission
        try {
          await page.waitForSelector('input[name="mfaCode"], input[placeholder*="code" i]', { timeout: 5000 });
          // MFA required after verification+login — suspend again
          // Re-queue as a normal MFA session (no postVerificationCredentials this time)
          return await new Promise<string>((res, rej) => {
            const t = setTimeout(() => { browser.close(); rej(new Error('MFA timeout')); }, 300000);
            pendingSessions.set(sessionId, { browser, page, resolve: res, reject: rej, timer: t });
          });
        } catch {
          // No MFA — wait for navigation
        }

        await postLoginNav;
        await new Promise((r) => setTimeout(r, 2000));

        const afterUrl = page.url();
        if (afterUrl.includes('/login')) throw new Error('Login failed after device verification — check credentials');
      } else {
        // Normal MFA path — verify we left the login/MFA page
        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('mfa')) {
          throw new Error('MFA verification failed — please check your code and try again');
        }
      }
      // ── End post-verification ───────────────────────────────────────────────

      const cookies = await page.cookies();
      const cookieStr = serializeCookies(cookies);

      liveBrowsers.set(sessionId, { browser, page });

      resolve(cookieStr);
      return cookieStr;
    } catch (err: any) {
      await browser.close();
      reject(err);
      throw err;
    }
  },

  /**
   * Discover the exact URL Airtable uses for /readRowActivitiesAndComments by:
   * 1. Navigating to the base/table in a live browser (real __Host- cookies present)
   * 2. Intercepting ALL network responses via Puppeteer's response event
   * 3. Clicking the first expandable record row to trigger the activity API call
   * 4. Returning every API call observed plus the first one that matched the endpoint
   *
   * Call this once from the debug endpoint to get the correct base URL path, then
   * hard-code that path in fetchRevisionHistoryInPage.
   */
  async discoverActivityEndpoint(
    page: Page,
    baseId: string,
    tableId: string,
  ): Promise<{ discovered: string | null; allApiCalls: string[] }> {
    const allApiCalls: string[] = [];
    let discovered: string | null = null;

    const listener = async (response: any) => {
      const url: string = response.url();
      if (!url.includes('airtable.com')) return;

      const status: number = response.status();
      // Capture every non-asset API call (skip JS/CSS/images)
      if (/\/(v0|api|ajax|meta|table|row|record|activity|comment)/i.test(url) && status < 500) {
        let preview = '';
        try { preview = (await response.text()).slice(0, 120); } catch { /* body consumed */ }
        allApiCalls.push(`[${status}] ${url}  =>  ${preview}`);
        // Tag it if it looks like the activity endpoint
        if (/activit|comment|readRow/i.test(url) && status < 400) {
          discovered = url;
        }
      }
    };

    page.on('response', listener);

    try {
      // Navigate to the table so Airtable loads and fires its initial API calls
      await page.goto(`https://airtable.com/${baseId}/${tableId}`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await new Promise((r) => setTimeout(r, 3000));

      // Step 1: click the first row-expand button to open the record detail panel
      const expandSelectors = [
        '[aria-label="Expand record"]',
        '[data-testid="expand-record"]',
        'button[class*="expandRecord"]',
        'button[class*="ExpandRecord"]',
        '[class*="rowExpand"]',
        '[class*="expandRow"]',
        'tr[class*="dataRow"] button:not([type="checkbox"])',
      ];
      let expanded = false;
      for (const sel of expandSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.hover();
            await new Promise((r) => setTimeout(r, 500));
            await btn.click();
            await new Promise((r) => setTimeout(r, 3000));
            console.log(`[Discovery] Opened record with selector: ${sel}`);
            expanded = true;
            break;
          }
        } catch { /* try next */ }
      }

      if (expanded) {
        // Step 2: click the "All comments" / "Revision history" dropdown to switch to revision history
        // Airtable uses a dropdown at the top of the right panel to toggle between views
        const dropdownSelectors = [
          '[aria-label="All comments"]',
          'button[class*="commentsFeedHeader"]',
          '[class*="feedDropdown"]',
          '[class*="commentsFeed"] button',
          // Generic: any button/div that contains the text "All comments" or "comments"
        ];
        for (const sel of dropdownSelectors) {
          try {
            const btn = await page.$(sel);
            if (btn) {
              await btn.click();
              await new Promise((r) => setTimeout(r, 1000));
              console.log(`[Discovery] Opened dropdown with selector: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }

        // Step 3: look for a "Revision history" menu item and click it
        const historySelectors = [
          '[aria-label="Revision history"]',
          '[role="menuitem"][aria-label*="history" i]',
          '[role="menuitem"][aria-label*="revision" i]',
          '[role="option"][aria-label*="history" i]',
        ];
        for (const sel of historySelectors) {
          try {
            const item = await page.$(sel);
            if (item) {
              await item.click();
              await new Promise((r) => setTimeout(r, 3000)); // wait for revision history API call
              console.log(`[Discovery] Clicked revision history with selector: ${sel}`);
              break;
            }
          } catch { /* try next */ }
        }

        // Also try clicking any visible menu item whose text contains "history" or "revision"
        try {
          await page.evaluate(() => {
            // @ts-ignore
            const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], li'));
            const match = items.find((el: any) => /history|revision/i.test(el.textContent));
            if (match) (match as any).click();
          });
          await new Promise((r) => setTimeout(r, 3000));
        } catch { /* ignore */ }
      }

      // Extra wait for all async API responses to settle
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      page.off('response', listener);
    }

    return { discovered, allApiCalls };
  },

  /**
   * Return the live browser/page kept from login, if still alive.
   * Removes it from the map so the caller owns lifecycle (must close when done).
   */
  takeLiveBrowser(sessionId: string): { browser: Browser; page: Page } | null {
    const entry = liveBrowsers.get(sessionId);
    if (entry) {
      liveBrowsers.delete(sessionId);
      return entry;
    }
    return null;
  },

  async validateCookies(cookies: string): Promise<boolean> {
    try {
      const response = await axios.get('https://airtable.com/api/v0.3/workspace/list', {
        headers: {
          Cookie: cookies,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        },
        validateStatus: (s) => s < 500,
        timeout: 10000,
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  },

  /**
   * Open a persistent browser page logged into Airtable.
   * Used to share one browser across all records in a scrape run.
   */
  async openAirtablePage(cookies: string): Promise<{ browser: Browser; page: Page }> {
    const browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );

    // Navigate to Airtable home first (establishes origin)
    await page.goto('https://airtable.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Inject cookies via JS — avoids Puppeteer setCookie restrictions on __Host- prefixed cookies
    await page.evaluate((cookieStr: string) => {
      cookieStr.split(';').forEach((pair) => {
        const trimmed = pair.trim();
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — runs in browser context
        if (trimmed) document.cookie = trimmed + '; path=/; secure; SameSite=Lax';
      });
    }, cookies);

    return { browser, page };
  },

  /**
   * Fetch revision history for one record.
   *
   * Strategy:
   * 1. Set up a Puppeteer response listener — capture ANY airtable.com API call that returns
   *    activity/comment data while the page loads (passive interception).
   * 2. Navigate to the base so Airtable's React app boots with real __Host- cookies.
   * 3. In parallel, fire fetch() calls with every known endpoint variation from inside the
   *    browser so the real session cookies are sent automatically.
   * 4. Return whichever source produced data first; fall back to '[]' and log all URLs
   *    that responded so the caller can see what Airtable actually exposes.
   */
  async fetchRevisionHistoryInPage(
    page: Page,
    baseId: string,
    tableId: string,
    recordId: string,
    options: { navigate?: boolean } = {},
  ): Promise<string> {
    // ── Phase 1: passive interception ──────────────────────────────────────
    let intercepted: string | null = null;
    const interceptedUrls: string[] = [];

    const responseListener = async (response: any) => {
      const url: string = response.url();
      if (!url.includes('airtable.com')) return;
      // Only care about API-looking paths that could contain activities
      if (!/\/(v0|api|ajax)\//i.test(url)) return;
      try {
        const text: string = await response.text();
        interceptedUrls.push(`${response.status()} ${url}`);
        if (
          text.length > 10 &&
          (url.toLowerCase().includes('activit') || url.toLowerCase().includes('comment') || text.includes(recordId))
        ) {
          intercepted = text;
        }
      } catch { /* body already consumed */ }
    };

    page.on('response', responseListener);

    // ── Phase 2: navigate to base (boots app + sets cookies) ───────────────
    if (options.navigate !== false) {
      const currentUrl = page.url();
      if (!currentUrl.includes(baseId)) {
        await page.goto(`https://airtable.com/${baseId}/${tableId}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        // Wait for Airtable's React app to initialize its API context.
        // The CSRF meta tag is populated by the app after boot — if we fetch
        // before it appears, Airtable rejects the request with 401 "Login expired".
        await page.waitForFunction(
          `() => !!document.querySelector('meta[name="airtable-csrf-token"]')?.content`,
          { timeout: 10000 },
        ).catch(() => null); // Some Airtable pages omit it — proceed regardless
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // ── Phase 3: fetch using the confirmed endpoint URL ───────────────────
    // Discovered via discoverActivityEndpoint:
    //   GET /v0.3/row/{recordId}/readRowComments
    //   with stringifiedObjectParams JSON including shouldIncludeOnlyRowLevelComments:false
    const fetchResult = await page.evaluate(
      async (params: { baseId: string; tableId: string; recordId: string }) => {
        // @ts-ignore — runs in browser context
        const csrf: string = (document.querySelector('meta[name="airtable-csrf-token"]') as any)?.content ?? '';

        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Airtable-Application-Id': params.baseId,
          // @ts-ignore
          'X-Time-Zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
          // @ts-ignore
          'X-User-Locale': navigator.language || 'en-US',
        };
        if (csrf) headers['X-Airtable-Csrf'] = csrf;

        // Generate a request ID matching Airtable's format: req + 13 alphanumeric chars
        const requestId = 'req' + Math.random().toString(36).slice(2).padEnd(13, '0').slice(0, 13);

        const stringifiedObjectParams = encodeURIComponent(JSON.stringify({
          limit: 50,
          offsetV2: null,
          shouldReturnDeserializedActivityItems: true,
          shouldIncludeRowActivityOrCommentUserObjById: true,
        }));

        const url = `/v0.3/row/${params.recordId}/readRowActivitiesAndComments?stringifiedObjectParams=${stringifiedObjectParams}&requestId=${requestId}`;

        try {
          const res = await fetch(url, { credentials: 'include', headers });
          const text = await res.text();
          if (res.ok) return JSON.stringify({ __url: url, __data: text });
          return JSON.stringify({ __error: res.status, __url: url, __body: text.slice(0, 400) });
        } catch (e: any) {
          return JSON.stringify({ __error: 'fetch-threw', __msg: (e as any).message });
        }
      },
      { baseId, tableId, recordId },
    );

    page.off('response', responseListener);

    // ── Phase 4: return result (intercepted passive data wins if present) ──
    if (intercepted) return intercepted;

    try {
      const parsed = JSON.parse(fetchResult);
      if (parsed?.__error !== undefined) {
        const body = String(parsed.__body ?? parsed.__msg ?? '');
        console.warn(`[Scraper] ${recordId} → HTTP ${parsed.__error}  ${parsed.__url ?? ''}  ${body.slice(0, 120)}`);
        // Auth failures mean the session is broken for ALL records — throw so
        // the caller can abort the entire run instead of silently processing
        // 200 records that will all return 401 and be counted as "processed".
        if (parsed.__error === 401 || parsed.__error === 403) {
          let detail = '';
          try { detail = JSON.parse(body)?.errorMessage ?? JSON.parse(body)?.error?.message ?? ''; } catch { /* ignore */ }
          throw new Error(`AUTH_EXPIRED: ${detail || 'Login expired — please re-authenticate'}`);
        }
        return '[]';
      }
      // Unwrap { __url, __data } envelope written by the fetch loop above
      if (parsed?.__url && parsed?.__data !== undefined) {
        return parsed.__data as string;
      }
    } catch (e: any) {
      // Re-throw auth errors — only swallow genuine JSON.parse failures
      if (e?.message?.startsWith('AUTH_EXPIRED:')) throw e;
      /* fetchResult is raw text — pass through */
    }

    return fetchResult || '[]';
  },

  // Keep the old signature for backward compat — opens a fresh browser each call (debug only)
  async fetchRevisionHistory(
    cookies: string,
    baseId: string,
    tableId: string,
    recordId: string,
  ): Promise<string> {
    const { browser, page } = await this.openAirtablePage(cookies);
    try {
      const result = await this.fetchRevisionHistoryInPage(page, baseId, tableId, recordId);
      await browser.close();
      return result;
    } catch (err) {
      await browser.close();
      throw err;
    }
  },
};
