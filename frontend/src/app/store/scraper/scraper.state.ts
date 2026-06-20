import { inject } from '@angular/core';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { tap, catchError, switchMap } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { ScraperService } from '../../core/services/scraper.service';
import { ScraperSession } from '../../core/models';
import { ScraperActions } from './scraper.actions';

export interface ChangelogStats {
  total: number;
  byType: { status: number; assignee: number };
}

export interface ScraperStateModel {
  session: ScraperSession | null;
  sessionLoaded: boolean;
  authLoading: boolean;
  mfaLoading: boolean;
  error: string | null;
  stats: ChangelogStats | null;
}

const defaults: ScraperStateModel = {
  session: null,
  sessionLoaded: false,
  authLoading: false,
  mfaLoading: false,
  error: null,
  stats: null,
};

@State<ScraperStateModel>({
  name: 'scraper',
  defaults,
})
export class ScraperState {
  private readonly scraperSvc = inject(ScraperService);

  @Selector()
  static session(state: ScraperStateModel): ScraperSession | null {
    return state.session;
  }

  @Selector()
  static authLoading(state: ScraperStateModel): boolean {
    return state.authLoading;
  }

  @Selector()
  static mfaLoading(state: ScraperStateModel): boolean {
    return state.mfaLoading;
  }

  @Selector()
  static error(state: ScraperStateModel): string | null {
    return state.error;
  }

  @Selector()
  static stats(state: ScraperStateModel): ChangelogStats | null {
    return state.stats;
  }

  @Action(ScraperActions.LoadLatestSession)
  loadLatestSession(ctx: StateContext<ScraperStateModel>) {
    if (ctx.getState().sessionLoaded) return;

    return this.scraperSvc.getLatestSession().pipe(
      tap((session) => ctx.patchState({ session, sessionLoaded: true })),
      catchError((err) => {
        ctx.patchState({ sessionLoaded: true, error: err?.error?.message || 'Failed to load session' });
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.RefreshSession)
  refreshSession(ctx: StateContext<ScraperStateModel>, { sessionId }: ScraperActions.RefreshSession) {
    return this.scraperSvc.getSession(sessionId).pipe(
      tap((session) => ctx.patchState({ session })),
      catchError((err) => {
        const msg: string = err?.error?.message || '';
        if (msg.toLowerCase().includes('not found') || err?.status === 404) {
          // Session was deleted externally — stop polling and reset to auth form
          ctx.patchState({ session: null, sessionLoaded: false });
        }
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.StartAuth)
  startAuth(ctx: StateContext<ScraperStateModel>, { email, password }: ScraperActions.StartAuth) {
    ctx.patchState({ authLoading: true, error: null });
    return this.scraperSvc.startAuth(email, password).pipe(
      tap((result) => {
        const session: ScraperSession = {
          sessionId: result.sessionId,
          status: result.requiresMfa ? 'awaiting_mfa' : 'authenticating',
          progress: { total: 0, processed: 0, failed: 0 },
        };
        ctx.patchState({ session, authLoading: false, sessionLoaded: true });
      }),
      catchError((err) => {
        ctx.patchState({ authLoading: false, error: err?.error?.message || 'Authentication failed' });
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.SubmitMfa)
  submitMfa(ctx: StateContext<ScraperStateModel>, { sessionId, mfaCode }: ScraperActions.SubmitMfa) {
    ctx.patchState({ mfaLoading: true, error: null });
    return this.scraperSvc.submitMfa(sessionId, mfaCode).pipe(
      tap(() => {
        const current = ctx.getState().session;
        ctx.patchState({
          mfaLoading: false,
          session: current ? { ...current, status: 'idle' } : current,
        });
      }),
      catchError((err) => {
        ctx.patchState({ mfaLoading: false, error: err?.error?.message || 'MFA failed' });
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.ValidateCookies)
  validateCookies(ctx: StateContext<ScraperStateModel>, { sessionId }: ScraperActions.ValidateCookies) {
    ctx.patchState({ error: null });
    return this.scraperSvc.validateCookies(sessionId).pipe(
      switchMap(() => this.scraperSvc.getSession(sessionId)),
      tap((session) => ctx.patchState({ session })),
      catchError((err) => {
        ctx.patchState({ error: err?.error?.message || 'Cookie validation failed' });
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.RunScraper)
  runScraper(ctx: StateContext<ScraperStateModel>, { sessionId }: ScraperActions.RunScraper) {
    return this.scraperSvc.runScraper(sessionId).pipe(
      tap(() => {
        const current = ctx.getState().session;
        ctx.patchState({
          session: current
            ? { ...current, status: 'running', progress: { total: 0, processed: 0, failed: 0 } }
            : current,
        });
      }),
      catchError((err) => {
        ctx.patchState({ error: err?.error?.message || 'Failed to start scraper' });
        return EMPTY;
      }),
    );
  }

  @Action(ScraperActions.ResetSession)
  resetSession(ctx: StateContext<ScraperStateModel>) {
    ctx.patchState({ session: null, sessionLoaded: false, error: null });
  }

  @Action(ScraperActions.LoadStats)
  loadStats(ctx: StateContext<ScraperStateModel>) {
    return this.scraperSvc.getStats().pipe(
      tap((stats) => ctx.patchState({ stats })),
      catchError(() => EMPTY),
    );
  }
}
