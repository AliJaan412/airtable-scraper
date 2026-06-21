import { Component, OnInit, OnDestroy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgChartsModule } from 'ag-charts-angular';
import type { AgChartOptions } from 'ag-charts-community';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { interval, Subject, takeUntil } from 'rxjs';
import { Store } from '@ngxs/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ScraperState } from '../../store/scraper/scraper.state';
import { ScraperActions } from '../../store/scraper/scraper.actions';
import type { ChangelogStats } from '../../store/scraper/scraper.state';

@Component({
  selector: 'app-scraper',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    AgChartsModule,
  ],
  templateUrl: './scraper.component.html',
  styleUrl: './scraper.component.scss',
})
export class ScraperComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroy$ = new Subject<void>();

  email = '';
  password = '';
  mfaCode = '';
  showPassword = false;

  readonly session    = toSignal(this.store.select(ScraperState.session));
  readonly authLoading = toSignal(this.store.select(ScraperState.authLoading), { initialValue: false });
  readonly mfaLoading  = toSignal(this.store.select(ScraperState.mfaLoading), { initialValue: false });
  readonly error       = toSignal(this.store.select(ScraperState.error));
  readonly stats       = toSignal(this.store.select(ScraperState.stats));

  readonly chartOptions = computed<AgChartOptions>(() => {
    const s = this.stats();
    // Double-cast needed: AgChartOptions is a wide union and TypeScript's
    // discriminant narrowing struggles with object literals against it.
    return {
      data: [
        { label: 'Status Changes',   count: s?.byType.status   ?? 0 },
        { label: 'Assignee Changes', count: s?.byType.assignee ?? 0 },
      ],
      series: [{
        type: 'donut',
        calloutLabelKey: 'label',
        angleKey: 'count',
        innerRadiusRatio: 0.72,
        fills: ['#04BCF3', '#029AC8'],
        strokes: ['#ffffff'],
        strokeWidth: 2,
      }],
      legend: { enabled: true, position: 'bottom' },
      background: { fill: 'transparent' },
      padding: { top: 4, bottom: 4 },
    } as unknown as AgChartOptions;
  });

  private statsRefreshedForSession = '';

  ngOnInit(): void {
    this.store.dispatch(new ScraperActions.LoadLatestSession());
    this.store.dispatch(new ScraperActions.LoadStats());

    interval(3000).pipe(takeUntil(this.destroy$)).subscribe(() => {
      const s = this.session();
      const pollingStatuses = ['running', 'authenticating', 'awaiting_captcha', 'awaiting_mfa'];
      if (s?.sessionId && pollingStatuses.includes(s.status ?? '')) {
        this.store.dispatch(new ScraperActions.RefreshSession(s.sessionId));
      }
      // Refresh stats once when scraping finishes
      if (s?.status === 'completed' && this.statsRefreshedForSession !== s.sessionId) {
        this.statsRefreshedForSession = s.sessionId;
        this.store.dispatch(new ScraperActions.LoadStats());
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isAuthenticated(): boolean {
    const s = this.session();
    return !!s && (s.status === 'idle' || s.status === 'running' || s.status === 'completed');
  }

  isAuthExpired(): boolean {
    const s = this.session();
    if (!s || s.status !== 'failed') return false;
    const err = (s.error ?? '').toLowerCase();
    return err.includes('expired') || err.includes('re-authenticate') || err.includes('cookie') || err.includes('auth_expired');
  }

  progressPct(): number {
    const s = this.session();
    if (!s?.progress?.total) return 0;
    const attempted = (s.progress.processed ?? 0) + (s.progress.failed ?? 0);
    return Math.round((attempted / s.progress.total) * 100);
  }

  progressAttempted(): number {
    const s = this.session();
    return (s?.progress?.processed ?? 0) + (s?.progress?.failed ?? 0);
  }

  startAuth(): void {
    if (!this.email || !this.password) return;
    this.store.dispatch(new ScraperActions.StartAuth(this.email, this.password))
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const s = this.session();
        if (s?.status === 'awaiting_mfa') {
          this.snackBar.open('MFA required — enter your code below', 'Close', { duration: 5000 });
        } else if (s) {
          this.snackBar.open('Authentication started — waiting for browser…', 'Close', { duration: 3000 });
        }
      });
  }

  submitMfa(): void {
    const s = this.session();
    if (!s?.sessionId || !this.mfaCode) return;
    this.store.dispatch(new ScraperActions.SubmitMfa(s.sessionId, this.mfaCode))
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.mfaCode = '';
        this.snackBar.open('MFA verified — cookies extracted!', 'Close', { duration: 3000 });
      });
  }

  validateCookies(): void {
    const s = this.session();
    if (!s?.sessionId) return;
    this.store.dispatch(new ScraperActions.ValidateCookies(s.sessionId))
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const err = this.error();
        if (err) {
          this.snackBar.open(`Validation failed: ${err}`, 'Close', { duration: 6000 });
        } else {
          this.snackBar.open('Cookies validated!', 'Close', { duration: 3000 });
        }
      });
  }

  runScraper(): void {
    const s = this.session();
    if (!s?.sessionId) return;
    this.store.dispatch(new ScraperActions.RunScraper(s.sessionId))
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.snackBar.open('Scraping job queued — auto-retries on failure!', 'Close', { duration: 3000 });
      });
  }

  resetSession(): void {
    this.store.dispatch(new ScraperActions.ResetSession());
    this.mfaCode = '';
  }
}
