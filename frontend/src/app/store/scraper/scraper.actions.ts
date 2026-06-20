export namespace ScraperActions {
  export class LoadLatestSession {
    static readonly type = '[Scraper] Load Latest Session';
  }

  export class RefreshSession {
    static readonly type = '[Scraper] Refresh Session';
    constructor(public sessionId: string) {}
  }

  export class StartAuth {
    static readonly type = '[Scraper] Start Auth';
    constructor(public email: string, public password: string) {}
  }

  export class SubmitMfa {
    static readonly type = '[Scraper] Submit MFA';
    constructor(public sessionId: string, public mfaCode: string) {}
  }

  export class ValidateCookies {
    static readonly type = '[Scraper] Validate Cookies';
    constructor(public sessionId: string) {}
  }

  export class RunScraper {
    static readonly type = '[Scraper] Run Scraper';
    constructor(public sessionId: string) {}
  }

  export class ResetSession {
    static readonly type = '[Scraper] Reset Session';
  }

  export class LoadStats {
    static readonly type = '[Scraper] Load Stats';
  }
}
