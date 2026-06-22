import * as os from 'os';
import * as path from 'path';
import type { Browser, Page } from 'puppeteer';
import axios from 'axios';
import { PendingSession } from '../interfaces/scraper.interfaces';
import { launchBrowser, serializeCookies, getUserChromeDataDir } from '../helpers/browser.helpers';

const pendingSessions = new Map<string, PendingSession>();

// Keep browsers alive from login so we can reuse them for scraping without re-injecting cookies
const liveBrowsers = new Map<string, { browser: Browser; page: Page }>();

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

      // Do NOT clear cookies or localStorage — Airtable's bot detection uses these as trust
      // signals. Clearing them makes the browser look like a fresh bot, which triggers the
      // "Press and hold" CAPTCHA challenge on every attempt.
      //
      // Instead, navigate to /login and read the outcome:
      //   • Redirected away → an active session exists; reuse those cookies directly.
      //   • Still on /login  → no valid session; proceed with email+password below.

      // Navigate homepage first — jumping cold to /login is a bot signal.
      await page.goto('https://airtable.com', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 800));

      await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2', timeout: 40000 });

      // Log where we landed — helps detect Cloudflare / verify pages
      let pageTitle = await page.title();
      let pageUrl = page.url();
      console.log(`[Auth] Loaded — title: "${pageTitle}"  url: ${pageUrl}`);

      // If /login redirected us to the dashboard, a live session is still active.
      // Reuse those cookies — scraping always uses the same account, so this is safe.
      // This avoids unnecessary re-authentication and eliminates the main trigger for
      // repeated CAPTCHA challenges.
      if (!pageUrl.includes('/login') && !pageUrl.includes('/verify') && !pageUrl.includes('captcha')) {
        console.log('[Auth] Active session detected — reusing existing cookies (skipping re-login)');
        const cookies = await page.cookies();
        const cookieStr = serializeCookies(cookies);
        liveBrowsers.set(sessionId, { browser, page });
        onStatusChange('running');
        return cookieStr;
      }

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
          // CAPTCHA challenge (DataDome "Press and hold") — headless browser can't solve it.
          //
          // Strategy: relaunch visibly using the USER'S REAL Chrome profile.
          // Their profile has an existing Airtable session + DataDome trust history
          // from real browsing, so DataDome is far less likely to challenge it.
          // If already logged in, the browser navigates straight to the dashboard
          // and we extract cookies without any user interaction at all.
          //
          // If the real profile is locked (Chrome already running), fall back to temp.
          console.log('[Auth] CAPTCHA detected — relaunching Chrome in visible mode');
          await browser.close();

          const userChromeDir = getUserChromeDataDir();
          let captchaProfileDir = path.join(os.tmpdir(), `sred-captcha-${Date.now()}`);

          if (userChromeDir) {
            console.log('[Auth] Attempting to use real Chrome profile (may already have Airtable session):', userChromeDir);
            try {
              browser = await launchBrowser({ headless: false, profileDir: userChromeDir });
              captchaProfileDir = userChromeDir;
              console.log('[Auth] Real Chrome profile loaded successfully');
            } catch (profileErr: any) {
              console.log('[Auth] Real Chrome profile unavailable (Chrome may be running) — using temp profile:', profileErr.message);
              browser = await launchBrowser({ headless: false, profileDir: captchaProfileDir });
            }
          } else {
            browser = await launchBrowser({ headless: false, profileDir: captchaProfileDir });
          }

          page = await browser.newPage();
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          );
          await page.setViewport({ width: 1280, height: 900 });

          const loginNav = await page.goto('https://airtable.com/login', { waitUntil: 'networkidle2', timeout: 40000 });
          const loginStatus = loginNav?.status() ?? 0;

          // 403 = DataDome has blocked this IP entirely — no amount of browser interaction will help.
          if (loginStatus === 403) {
            await browser.close();
            throw new Error(
              'Your IP address has been temporarily blocked by Airtable\'s security system. ' +
              'Please wait 20–30 minutes and try again. Avoid retrying during the cool-down — ' +
              'each failed attempt extends the block.',
            );
          }

          onStatusChange('awaiting_captcha');

          // ── Check if the real profile was already logged in ──────────────────
          // If the profile had an active Airtable session, /login redirects to dashboard.
          const afterLoginUrl = page.url();
          if (!afterLoginUrl.includes('/login') && !afterLoginUrl.includes('/verify') && !afterLoginUrl.includes('captcha')) {
            console.log('[Auth] Real Chrome profile already authenticated — extracting cookies');
            const cookies = await page.cookies();
            const cookieStr = serializeCookies(cookies);
            liveBrowsers.set(sessionId, { browser, page });
            onStatusChange('running');
            return cookieStr;
          }

          // Poll every 600 ms for up to 3 minutes.
          // After DataDome "Press and hold" passes, Airtable renders the email form
          // on the SAME /login URL (SPA navigation) — we can't rely on URL change alone.
          // Scan ALL frames (not just main document) because Airtable's login form
          // can be inside an iframe, making querySelectorAll on the top frame return 0 inputs.
          const CAPTCHA_DEADLINE = Date.now() + 180000;
          let captchaOutcome: 'authenticated' | 'email_form' | 'code_form' | 'timeout' = 'timeout';

          while (Date.now() < CAPTCHA_DEADLINE) {
            try {
              const currentUrl = page.url();

              // Navigated fully away from login/verify → already authenticated
              if (!currentUrl.includes('/login') && !currentUrl.includes('/verify') && !currentUrl.includes('captcha')) {
                captchaOutcome = 'authenticated';
                break;
              }

              // Scan ALL frames — login form may live inside an iframe (e.g. after DataDome dismiss)
              const formState = { hasEmail: false, hasCode: false, hasText: false, inputCount: 0 };
              for (const frame of page.frames()) {
                try {
                  const frameResult = await frame.evaluate(() => {
                    const isVisible = (el: Element) => {
                      const s = window.getComputedStyle(el);
                      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && (el as HTMLElement).offsetParent !== null;
                    };
                    const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
                    const hasEmail = inputs.some((i) =>
                      i.type === 'email' || i.name === 'email' || i.autocomplete === 'email' ||
                      i.autocomplete === 'username' || /email/i.test(i.placeholder) || /email/i.test(i.name),
                    );
                    const hasCode = !hasEmail && inputs.some((i) =>
                      i.type === 'number' || i.type === 'tel' ||
                      /code|otp|pin|digit|token/i.test(i.name + ' ' + i.placeholder),
                    );
                    const hasText = !hasEmail && !hasCode && inputs.some((i) => i.type === 'text');
                    return { hasEmail, hasCode, hasText, inputCount: inputs.length };
                  });
                  formState.inputCount += frameResult.inputCount;
                  if (frameResult.hasEmail) formState.hasEmail = true;
                  if (frameResult.hasCode)  formState.hasCode  = true;
                  if (frameResult.hasText)  formState.hasText  = true;
                } catch { /* cross-origin or mid-navigation frame — skip */ }
              }

              console.log(`[Auth] CAPTCHA poll — url: ${currentUrl}  inputs: ${JSON.stringify(formState)}`);

              if (formState.hasEmail || formState.hasText) { captchaOutcome = 'email_form'; break; }
              if (formState.hasCode) { captchaOutcome = 'code_form'; break; }
            } catch (_e) { /* page mid-navigation — retry next tick */ }

            await new Promise((r) => setTimeout(r, 600));
          }

          if (captchaOutcome === 'timeout') {
            await browser.close();
            throw new Error('CAPTCHA verification timed out — please try again');
          }

          if (captchaOutcome === 'authenticated') {
            console.log('[Auth] Authenticated after CAPTCHA solve — extracting cookies');
            const cookies = await page.cookies();
            const cookieStr = serializeCookies(cookies);
            liveBrowsers.set(sessionId, { browser, page });
            onStatusChange('running');
            return cookieStr;
          }

          if (captchaOutcome === 'code_form') {
            console.log('[Auth] Code entry required after CAPTCHA — awaiting MFA input');
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
          // captchaOutcome === 'email_form' → fall through to email+password login below
        }
      }
      // ── End device verification ────────────────────────────────────────────

      // After a CAPTCHA solve or device-verification redirect the page is still transitioning.
      // Wait for any pending navigation to settle before inspecting the page state.
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1200));

      // Detect where we landed after the verification/CAPTCHA flow.
      const postVerifyUrl = page.url();
      const postVerifyTitle = await page.title();
      console.log(`[Auth] Post-verify state — url: ${postVerifyUrl}  title: "${postVerifyTitle}"`);

      // Already logged in (CAPTCHA solved and Airtable considered us authenticated)?
      if (!postVerifyUrl.includes('/login') && !postVerifyUrl.includes('/verify') && !postVerifyUrl.includes('/signup')) {
        console.log('[Auth] Already authenticated after verification — extracting cookies');
        const cookies = await page.cookies();
        const cookieStr = serializeCookies(cookies);
        liveBrowsers.set(sessionId, { browser, page });
        onStatusChange('running');
        return cookieStr;
      }

      // Landed on another verify page (Airtable sometimes chains verification steps)?
      // Click "Send code" and treat as MFA.
      if (postVerifyUrl.includes('/verify') || /verify/i.test(postVerifyTitle)) {
        console.log('[Auth] Chained verify page — clicking Send code and awaiting MFA input');
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
          const btn = btns.find((b) => /send|continue|next|verify|email/i.test(b.textContent ?? '')) ?? btns[0];
          if (btn) btn.click();
        }).catch(() => null);
        await new Promise((r) => setTimeout(r, 2500));
        onStatusChange('awaiting_mfa');
        return await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            browser.close();
            pendingSessions.delete(sessionId);
            reject(new Error('Verification timeout — session expired'));
          }, 300000);
          pendingSessions.set(sessionId, { browser, page, resolve, reject, timer, postVerificationCredentials: { email, password } });
        });
      }

      // Poll for the email input — robust against mid-navigation DOM resets.
      // Promise.race + waitForSelector fails here because any navigation event causes
      // an immediate rejection before the new page finishes loading.
      // Instead, poll page.$() every 600ms until the field appears or 25s elapses.
      const EMAIL_SELECTORS = [
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="work" i]',
        'input[data-fieldname*="email" i]',
      ];
      let emailSelector: string | null = null;
      const pollDeadline = Date.now() + 25000;
      while (!emailSelector && Date.now() < pollDeadline) {
        for (const sel of EMAIL_SELECTORS) {
          try {
            const el = await page.$(sel);
            if (el) { emailSelector = sel; break; }
          } catch { /* page may be mid-navigation — try again on next tick */ }
        }
        if (!emailSelector) await new Promise((r) => setTimeout(r, 600));
      }

      if (!emailSelector) {
        const finalUrl = page.url();
        const inputs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input')).map((el) => ({
            name: (el as HTMLInputElement).name,
            type: (el as HTMLInputElement).type,
            placeholder: (el as HTMLInputElement).placeholder,
            id: el.id,
          })),
        ).catch(() => [] as any[]);
        await page.screenshot({ path: 'auth-debug.png', fullPage: true }).catch(() => null);
        console.error('[Auth] Email field not found after 25s. URL:', finalUrl, 'Inputs:', JSON.stringify(inputs));
        throw new Error(`Email field not found after 25s. URL: ${finalUrl}. Inputs: ${JSON.stringify(inputs)}`);
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
   * Open a browser page logged into Airtable using the persistent chrome-profile.
   * The profile stores the full Airtable session (including __Host- cookies) on disk,
   * so no explicit cookie injection is needed — the browser is already authenticated
   * as long as the session hasn't expired.
   *
   * NOTE: document.cookie cannot set __Host- prefixed cookies (browser blocks it).
   * Puppeteer page.setCookie() could do it via CDP but we'd need the full Cookie
   * objects (with domain/path/httpOnly), not the serialised name=value string.
   * Relying on the chrome-profile is simpler and avoids that complexity entirely.
   */
  async openAirtablePage(_cookies: string): Promise<{ browser: Browser; page: Page }> {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    // Warm up the browser on Airtable's origin — profile cookies load automatically.
    await page.goto('https://airtable.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    // Discovered via Airtable network inspection and experimentation in the browser:
    //   GET /v0.3/row/{recordId}/readRowActivitiesAndComments
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

};
