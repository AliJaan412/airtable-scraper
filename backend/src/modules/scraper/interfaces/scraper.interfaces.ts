import type { Browser, Page } from 'puppeteer';

export interface PendingSession {
  browser: Browser;
  page: Page;
  resolve: (cookies: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  /** Set when a device-verification step precedes the real login form */
  postVerificationCredentials?: { email: string; password: string };
}
