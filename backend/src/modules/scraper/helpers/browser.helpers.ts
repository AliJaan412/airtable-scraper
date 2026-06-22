import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Cookie } from 'puppeteer';

// Apply stealth plugin once at module load — patches navigator.webdriver, chrome runtime,
// plugin arrays, etc. so Cloudflare/Airtable bot detection doesn't block the login page.
puppeteerExtra.use(StealthPlugin());

// Prefer the real system Chrome for visible windows — it has genuine canvas/WebGL
// fingerprints that pass Airtable's "Press and hold" bot detection.
// Puppeteer's bundled Chromium passes the interaction but fails the fingerprint check.
const SYSTEM_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function findSystemChrome(): string | undefined {
  return SYSTEM_CHROME_PATHS.find((p) => fs.existsSync(p));
}

/**
 * Return the user's real Chrome User Data directory, if it exists.
 * Using this as Puppeteer's userDataDir means the browser starts with existing
 * cookies (including any active Airtable session) and DataDome trust signals
 * built up from real browsing — so DataDome is far less likely to challenge it.
 */
export function getUserChromeDataDir(): string | undefined {
  const candidates = [
    // Windows
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data') : null,
    // macOS
    path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    // Linux
    path.join(os.homedir(), '.config', 'google-chrome'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p));
}

export async function launchBrowser(opts: { headless?: boolean; profileDir?: string } = {}): Promise<Browser> {
  const { headless = true } = opts;
  // Persistent user-data-dir makes Chrome look like a real installed browser.
  // Callers can override with a temp dir (e.g. for CAPTCHA solving) to get a
  // fresh identity not tainted by prior headless bot-detection fingerprints.
  const profileDir = opts.profileDir ?? path.resolve(__dirname, '../../../../chrome-profile');
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const launchOpts: Parameters<typeof puppeteerExtra.launch>[0] = {
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
      // Prevent the "restore previous session?" dialog when using a real profile
      '--no-restore-last-session',
      '--disable-session-crashed-bubble',
      // Suppress extension background activity that can interfere with automation
      '--disable-background-extensions',
    ],
  };

  // For visible windows, use the real system Chrome so fingerprints are genuine.
  // Puppeteer's bundled Chromium is detectable via canvas/WebGL even with stealth.
  if (!headless) {
    const systemChrome = findSystemChrome();
    if (systemChrome) {
      launchOpts.executablePath = systemChrome;
      console.log('[Browser] Using system Chrome for visible window:', systemChrome);
    }
  }

  return puppeteerExtra.launch(launchOpts);
}

export function serializeCookies(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
