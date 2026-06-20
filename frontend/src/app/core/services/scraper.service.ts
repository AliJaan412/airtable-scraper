import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { ScraperSession } from '../models';

@Injectable({ providedIn: 'root' })
export class ScraperService {
  private readonly api = inject(ApiService);

  startAuth(email: string, password: string): Observable<{ sessionId: string; requiresMfa: boolean }> {
    return this.api.post<{ sessionId: string; requiresMfa: boolean }>('/scraper/auth/start', { email, password }).pipe(map((r) => r.data));
  }

  submitMfa(sessionId: string, mfaCode: string): Observable<{ authenticated: boolean }> {
    return this.api.post<{ authenticated: boolean }>('/scraper/auth/mfa', { sessionId, mfaCode }).pipe(map((r) => r.data));
  }

  validateCookies(sessionId: string): Observable<{ valid: boolean }> {
    return this.api.post<{ valid: boolean }>('/scraper/auth/validate', { sessionId }).pipe(map((r) => r.data));
  }

  runScraper(sessionId: string): Observable<{ started: boolean }> {
    return this.api.post<{ started: boolean }>('/scraper/run', { sessionId }).pipe(map((r) => r.data));
  }

  getSession(sessionId: string): Observable<ScraperSession> {
    return this.api.get<ScraperSession>(`/scraper/session/${sessionId}`).pipe(map((r) => r.data));
  }

  getLatestSession(): Observable<ScraperSession | null> {
    return this.api.get<ScraperSession | null>('/scraper/session/org/latest').pipe(map((r) => r.data));
  }

  getChangelogs(filter: Record<string, any> = {}, page = 1, pageSize = 100): Observable<any> {
    return this.api.get<any[]>('/scraper/changelogs', { ...filter, page, pageSize });
  }

  getStats(): Observable<{ total: number; byType: { status: number; assignee: number } }> {
    return this.api.get<{ total: number; byType: { status: number; assignee: number } }>('/scraper/stats').pipe(map((r) => r.data));
  }
}
