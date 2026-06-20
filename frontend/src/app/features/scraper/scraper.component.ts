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
  template: `
    <div class="page">

      <!-- Page header -->
      <div class="page-header">
        <h1 class="page-heading">
          <mat-icon class="heading-icon">manage_search</mat-icon>
          Revision History Scraper
        </h1>
        <p class="page-sub">
          Automatically retrieves Airtable session cookies, then fetches and stores revision history
          (status &amp; assignee changes) for all synced tickets.
        </p>
      </div>

      <div class="two-col">

        <!-- ── Steps column ───────────────────────────────── -->
        <div class="steps-col">

          <!-- Step 1: Authenticate -->
          <div class="step-card" [class.step-card--expired]="isAuthExpired()">
            <div class="step-header">
              <div
                class="step-badge"
                [class.step-badge--done]="isAuthenticated()"
                [class.step-badge--expired]="isAuthExpired()"
              >
                @if (isAuthenticated()) {
                  <mat-icon class="badge-icon">check</mat-icon>
                } @else if (isAuthExpired()) {
                  <mat-icon class="badge-icon">warning_amber</mat-icon>
                } @else {
                  1
                }
              </div>
              <div class="step-heading">
                <div class="step-title">Authenticate</div>
                <div class="step-sub">
                  @if (isAuthExpired()) {
                    Session expired — re-enter credentials to restart
                  } @else {
                    Enter your Airtable credentials to retrieve session cookies
                  }
                </div>
              </div>
            </div>

            <div class="step-body">
              @if (!session() || session()?.status === 'idle' || session()?.status === 'failed') {
                @if (isAuthExpired()) {
                  <div class="status-banner status-banner--expired">
                    <mat-icon>lock_clock</mat-icon>
                    <div>
                      <strong>Session expired</strong>
                      <div class="banner-sub">{{ session()?.error }}</div>
                    </div>
                  </div>
                }
                <div class="form-stack">
                  <mat-form-field appearance="outline" class="w-full">
                    <mat-label>Airtable Email</mat-label>
                    <input matInput type="email" [(ngModel)]="email" placeholder="jane@example.com" />
                    <mat-icon matPrefix>email</mat-icon>
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="w-full">
                    <mat-label>Password</mat-label>
                    <input matInput [type]="showPassword ? 'text' : 'password'" [(ngModel)]="password" />
                    <mat-icon matPrefix>lock</mat-icon>
                    <button matSuffix mat-icon-button (click)="showPassword = !showPassword" type="button">
                      <mat-icon>{{ showPassword ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                  </mat-form-field>
                  @if (session()?.status === 'failed' && !isAuthExpired()) {
                    <div class="alert alert--error">
                      <mat-icon>error_outline</mat-icon>
                      {{ session()?.error }}
                    </div>
                  }
                </div>
              } @else if (session()?.status === 'authenticating') {
                <div class="status-banner status-banner--info">
                  <mat-spinner diameter="18"></mat-spinner>
                  <span>Launching browser and logging in&hellip;</span>
                </div>
              } @else if (session()?.status === 'awaiting_captcha') {
                <div class="status-banner status-banner--warn">
                  <mat-icon>open_in_new</mat-icon>
                  <span>A Chrome window opened on this machine &mdash; solve the verification challenge and login will continue automatically.</span>
                </div>
              } @else {
                <div class="status-banner status-banner--success">
                  <mat-icon>check_circle</mat-icon>
                  <div>
                    <strong>Authenticated</strong>
                    @if (session()?.cookiesValidatedAt) {
                      <div class="banner-sub">
                        Cookies validated {{ session()?.cookiesValidatedAt | date:'short' }}
                      </div>
                    }
                  </div>
                </div>
              }
            </div>

            <div class="step-footer">
              @if (!session() || session()?.status === 'idle' || session()?.status === 'failed') {
                <button
                  class="btn w-full"
                  [class.btn--primary]="!isAuthExpired()"
                  [class.btn--warn]="isAuthExpired()"
                  (click)="startAuth()"
                  [disabled]="!email || !password || authLoading()"
                >
                  <mat-icon>{{ isAuthExpired() ? 'refresh' : 'fingerprint' }}</mat-icon>
                  {{ isAuthExpired() ? 'Re-authenticate' : 'Start Authentication' }}
                </button>
              } @else if (session()?.status === 'awaiting_mfa' || session()?.status === 'awaiting_captcha' || session()?.status === 'running' || session()?.status === 'completed') {
                <div class="btn-row">
                  <button class="btn btn--danger" (click)="resetSession()">
                    <mat-icon>restart_alt</mat-icon>
                    Reset
                  </button>
                  @if (session()?.status !== 'awaiting_mfa' && session()?.status !== 'awaiting_captcha') {
                    <button class="btn btn--outline" (click)="validateCookies()" [disabled]="!session()?.sessionId">
                      <mat-icon>verified</mat-icon>
                      Validate Cookies
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Step 2: MFA -->
          @if (session()?.status === 'awaiting_mfa') {
            <div class="step-card step-card--mfa">
              <div class="step-header">
                <div class="step-badge step-badge--warn">2</div>
                <div class="step-heading">
                  <div class="step-title">MFA Required</div>
                  <div class="step-sub">Enter the code from your authenticator app</div>
                </div>
              </div>
              <div class="step-body">
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>MFA Code</mat-label>
                  <input matInput [(ngModel)]="mfaCode" placeholder="000000" maxlength="8" />
                  <mat-icon matPrefix>security</mat-icon>
                </mat-form-field>
              </div>
              <div class="step-footer">
                <button class="btn btn--accent w-full" (click)="submitMfa()" [disabled]="!mfaCode || mfaLoading()">
                  <mat-icon>send</mat-icon>
                  Submit Code
                </button>
              </div>
            </div>
          }

          <!-- Step 2b: CAPTCHA verification -->
          @if (session()?.status === 'awaiting_captcha') {
            <div class="step-card step-card--mfa">
              <div class="step-header">
                <div class="step-badge step-badge--warn">2</div>
                <div class="step-heading">
                  <div class="step-title">Complete Verification</div>
                  <div class="step-sub">Solve the security challenge in the Chrome window</div>
                </div>
              </div>
              <div class="step-body">
                <div class="alert alert--warn">
                  <mat-icon>security</mat-icon>
                  A Chrome window opened on this machine. Complete the CAPTCHA or click "Send code" in that window &mdash; login will resume automatically once verified.
                </div>
              </div>
            </div>
          }

          <!-- Step 3: Run Scraper -->
          @if (session() && (session()?.status === 'idle' || session()?.status === 'running' || session()?.status === 'completed')) {
            <div class="step-card">
              <div class="step-header">
                <div
                  class="step-badge"
                  [class.step-badge--active]="session()?.status === 'running'"
                  [class.step-badge--done]="session()?.status === 'completed'"
                >
                  @if (session()?.status === 'completed') {
                    <mat-icon class="badge-icon">check</mat-icon>
                  } @else {
                    3
                  }
                </div>
                <div class="step-heading">
                  <div class="step-title">Run Scraper</div>
                  <div class="step-sub">Fetch revision history for all synced tickets</div>
                </div>
              </div>

              <div class="step-body">
                @if (session()?.status === 'running') {
                  <div class="progress-wrap">
                    <div class="progress-info">
                      <span>{{ session()?.progress?.processed }} / {{ session()?.progress?.total }} tickets</span>
                      @if ((session()?.progress?.failed ?? 0) > 0) {
                        <span class="fail-count">· {{ session()?.progress?.failed }} failed</span>
                      }
                      <span class="pct">{{ progressPct() }}%</span>
                    </div>
                    <mat-progress-bar mode="determinate" [value]="progressPct()"></mat-progress-bar>
                  </div>
                } @else if (session()?.status === 'completed') {
                  <div class="status-banner status-banner--success">
                    <mat-icon>task_alt</mat-icon>
                    <div>
                      <strong>Scraping complete!</strong>
                      <div class="banner-sub">
                        {{ session()?.progress?.processed }} tickets processed
                        @if ((session()?.progress?.failed ?? 0) > 0) {
                          · {{ session()?.progress?.failed }} failed
                        }
                      </div>
                    </div>
                  </div>
                } @else {
                  <p class="hint-text">Ready to scrape. Cookies must be validated before starting.</p>
                }
              </div>

              <div class="step-footer">
                @if (session()?.status !== 'running') {
                  <button
                    class="btn btn--primary w-full"
                    (click)="runScraper()"
                  >
                    <mat-icon>{{ session()?.status === 'completed' ? 'replay' : 'play_arrow' }}</mat-icon>
                    {{ session()?.status === 'completed' ? 'Run Again' : 'Start Scraping' }}
                  </button>
                } @else {
                  <button class="btn btn--outline w-full" disabled>
                    <mat-icon>hourglass_empty</mat-icon>
                    Running&hellip;
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <!-- ── Info column ─────────────────────────────────── -->
        <div class="info-col">

          <div class="info-card">
            <div class="info-card-header">
              <mat-icon class="info-icon">info</mat-icon>
              <span>How it works</span>
            </div>
            <ol class="how-list">
              <li>Puppeteer opens a headless browser and logs into Airtable</li>
              <li>If MFA is enabled, enter your code in the form</li>
              <li>Session cookies are extracted and validated</li>
              <li>The scraper job is queued with automatic retry on failure</li>
              <li>Status and assignee changes are parsed and stored</li>
            </ol>
            <div class="note-row">
              <mat-icon class="note-icon">shield</mat-icon>
              <span>Credentials are used only to obtain cookies and are never stored.</span>
            </div>
          </div>

          <!-- Changelog Stats Chart -->
          <div class="stats-card">
            <div class="stats-card-header">
              <mat-icon class="stats-icon">bar_chart</mat-icon>
              <span>Changelog Statistics</span>
            </div>
            @if ((stats()?.total ?? 0) > 0) {
              <div class="stats-total">
                <span class="stats-num">{{ stats()?.total }}</span>
                <span class="stats-lbl">total changes tracked</span>
              </div>
              <div class="stats-breakdown">
                <div class="stats-type stats-type--status">
                  <span class="stats-type-dot"></span>
                  <span>Status</span>
                  <strong>{{ stats()?.byType?.status ?? 0 }}</strong>
                </div>
                <div class="stats-type stats-type--assignee">
                  <span class="stats-type-dot"></span>
                  <span>Assignee</span>
                  <strong>{{ stats()?.byType?.assignee ?? 0 }}</strong>
                </div>
              </div>
              <ag-charts [options]="chartOptions()" style="height: 210px; display: block;"></ag-charts>
            } @else {
              <div class="stats-empty">
                <mat-icon>donut_large</mat-icon>
                <span>No changelogs yet — run the scraper to populate data</span>
              </div>
            }
          </div>

          @if (session()) {
            <div class="session-card">
              <div class="session-header">
                <mat-icon>receipt_long</mat-icon>
                <div>
                  <div class="session-title">Session</div>
                  <div class="session-id">{{ session()?.sessionId?.slice(0, 8) }}&hellip;</div>
                </div>
              </div>
              <div class="session-rows">
                <div class="session-row">
                  <span class="session-key">Status</span>
                  <span class="status-pill status-pill--{{ session()?.status }}">
                    {{ session()?.status }}
                  </span>
                </div>
                <div class="session-row">
                  <span class="session-key">Started</span>
                  <span>{{ (session()?.startedAt | date:'short') || '—' }}</span>
                </div>
                <div class="session-row">
                  <span class="session-key">Completed</span>
                  <span>{{ (session()?.completedAt | date:'short') || '—' }}</span>
                </div>
                <div class="session-row">
                  <span class="session-key">Cookies</span>
                  <mat-icon [style.color]="session()?.cookiesValidatedAt ? '#22c55e' : '#94a3b8'" class="cookie-icon">
                    {{ session()?.cookiesValidatedAt ? 'check_circle' : 'cancel' }}
                  </mat-icon>
                </div>
              </div>
            </div>
          }

        </div>
      </div>
    </div>
  `,
  styles: [`
    .page {
      padding: 28px 24px;
      max-width: 1020px;
    }

    /* Header */
    .page-header { margin-bottom: 22px; }
    .page-heading {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 22px;
      font-weight: 700;
      color: var(--clr-text);
      margin: 0 0 7px;
    }
    .heading-icon { color: var(--clr-primary); font-size: 26px; width: 26px; height: 26px; }
    .page-sub { color: var(--clr-text-muted); font-size: 14px; margin: 0; max-width: 640px; line-height: 1.6; }

    /* Layout */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 16px;
      align-items: start;
    }
    .steps-col, .info-col {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Step cards */
    .step-card {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .step-card--mfa     { border: 2px solid var(--clr-warn); }
    .step-card--expired { border: 2px solid var(--clr-orange-border); background: var(--clr-orange-bg); }

    .step-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 18px 20px 0;
    }
    .step-badge {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--clr-primary);
      color: var(--clr-navy);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .step-badge--warn    { background: var(--clr-warn);    color: white; }
    .step-badge--active  { background: var(--clr-success); color: white; }
    .step-badge--done    { background: var(--clr-success); color: white; }
    .step-badge--expired { background: var(--clr-orange);  color: white; }
    .badge-icon { font-size: 16px; width: 16px; height: 16px; }

    .step-heading { flex: 1; }
    .step-title { font-size: 15px; font-weight: 600; color: var(--clr-text); }
    .step-sub { font-size: 12px; color: var(--clr-text-muted); margin-top: 3px; }

    .step-body { padding: 14px 20px 8px; }
    .step-footer { padding: 0 20px 18px; }

    /* Forms */
    .form-stack { display: flex; flex-direction: column; gap: 0; }
    .w-full { width: 100%; }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 10px 18px;
      border-radius: 7px;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      border: 1.5px solid transparent;
      transition: opacity 0.15s, background 0.15s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn--primary { background: var(--clr-primary); color: var(--clr-navy); font-weight: 600; }
    .btn--primary:not(:disabled):hover { background: var(--clr-primary-dark); color: white; }
    .btn--accent { background: var(--clr-primary-dark); color: white; }
    .btn--accent:not(:disabled):hover { background: var(--clr-navy-mid); }
    .btn--danger { background: var(--clr-surface); color: var(--clr-danger); border-color: var(--clr-danger-border); }
    .btn--danger:not(:disabled):hover { background: var(--clr-danger-bg); }
    .btn--outline { background: var(--clr-surface); color: var(--clr-text-mid); border-color: var(--clr-border); }
    .btn--outline:not(:disabled):hover { background: var(--clr-primary-subtle); }
    .btn--warn { background: var(--clr-surface); color: var(--clr-orange-dark); border-color: var(--clr-orange-border); }
    .btn--warn:not(:disabled):hover { background: var(--clr-orange-bg); }

    .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }

    /* Status banners */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 13px 15px;
      border-radius: 8px;
      font-size: 14px;
    }
    .status-banner--info {
      background: var(--clr-primary-light);
      color: var(--clr-primary-dark);
    }
    .status-banner--success {
      background: var(--clr-success-bg);
      color: var(--clr-success);
    }
    .status-banner--success mat-icon { color: var(--clr-success); font-size: 22px; width: 22px; height: 22px; }
    .status-banner--expired {
      background: var(--clr-orange-bg);
      color: #9a3412;
      margin-bottom: 12px;
    }
    .status-banner--expired mat-icon { color: var(--clr-orange); font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
    .status-banner--warn {
      background: var(--clr-warn-bg);
      color: #b45309;
    }
    .status-banner--warn mat-icon { color: #b45309; font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
    .banner-sub { font-size: 12px; margin-top: 2px; opacity: 0.8; }

    .alert {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 7px;
      font-size: 13px;
      color: var(--clr-danger);
      background: var(--clr-danger-bg);
    }
    .alert mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .alert--warn { color: #b45309; background: var(--clr-warn-bg); }

    /* Progress */
    .progress-wrap { display: flex; flex-direction: column; gap: 10px; }
    .progress-info {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--clr-text-mid);
    }
    .fail-count { color: var(--clr-danger); }
    .pct { margin-left: auto; font-weight: 700; color: var(--clr-text); font-size: 14px; }

    .hint-text { color: var(--clr-text-muted); font-size: 13.5px; margin: 4px 0 0; }

    /* Info card */
    .info-card {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 10px;
      padding: 20px;
    }
    .info-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--clr-text);
      margin-bottom: 14px;
    }
    .info-icon { color: var(--clr-primary); font-size: 20px; width: 20px; height: 20px; }
    .how-list {
      padding-left: 18px;
      color: var(--clr-text-mid);
      font-size: 13px;
      line-height: 2;
      margin: 0 0 16px;
    }
    .note-row {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      padding-top: 14px;
      border-top: 1px solid var(--clr-border-light);
      font-size: 12px;
      color: var(--clr-text-muted);
      line-height: 1.5;
    }
    .note-icon { font-size: 15px; width: 15px; height: 15px; color: var(--clr-text-muted); flex-shrink: 0; margin-top: 1px; }

    /* Session card */
    .session-card {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .session-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: var(--clr-primary-subtle);
      border-bottom: 1px solid var(--clr-border);
    }
    .session-header mat-icon { color: var(--clr-primary-dark); font-size: 20px; }
    .session-title { font-size: 13px; font-weight: 600; color: var(--clr-text); }
    .session-id { font-size: 11px; color: var(--clr-text-muted); font-family: monospace; margin-top: 1px; }

    .session-rows { padding: 2px 0; }
    .session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 16px;
      font-size: 13px;
      color: var(--clr-text);
      border-bottom: 1px solid var(--clr-border-light);
    }
    .session-row:last-child { border-bottom: none; }
    .session-key { color: var(--clr-text-muted); }
    .cookie-icon { font-size: 18px; width: 18px; height: 18px; }

    /* Status pill */
    .status-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 4px;
      text-transform: capitalize;
    }
    .status-pill--running       { background: var(--clr-orange-bg);    color: var(--clr-orange-dark); }
    .status-pill--completed     { background: var(--clr-success-bg);   color: var(--clr-success); }
    .status-pill--failed        { background: var(--clr-danger-bg);    color: var(--clr-danger); }
    .status-pill--idle          { background: var(--clr-primary-light); color: var(--clr-primary-dark); }
    .status-pill--authenticating{ background: var(--clr-primary-light); color: var(--clr-primary-dark); }
    .status-pill--awaiting_mfa      { background: var(--clr-warn-bg);      color: #b45309; }
    .status-pill--awaiting_captcha  { background: var(--clr-warn-bg);      color: #b45309; }

    /* Stats chart card */
    .stats-card {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .stats-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--clr-text);
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--clr-border-light);
    }
    .stats-icon { color: var(--clr-primary); font-size: 20px; width: 20px; height: 20px; }

    .stats-total {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 12px 16px 4px;
    }
    .stats-num { font-size: 28px; font-weight: 700; color: var(--clr-text); line-height: 1; }
    .stats-lbl { font-size: 12px; color: var(--clr-text-muted); }

    .stats-breakdown {
      display: flex;
      gap: 16px;
      padding: 4px 16px 0;
    }
    .stats-type {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--clr-text-mid);
    }
    .stats-type strong { color: var(--clr-text); }
    .stats-type-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .stats-type--status .stats-type-dot   { background: var(--clr-primary); }
    .stats-type--assignee .stats-type-dot { background: var(--clr-primary-dark); }

    .stats-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 28px 16px;
      color: var(--clr-text-muted);
      font-size: 12px;
      text-align: center;
    }
    .stats-empty mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }

    /* Responsive */
    @media (max-width: 780px) {
      .two-col { grid-template-columns: 1fr; }
      .page { padding: 16px; }
    }
  `],
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
    return Math.round((s.progress.processed / s.progress.total) * 100);
  }

  startAuth(): void {
    if (!this.email || !this.password) return;
    this.store.dispatch(new ScraperActions.StartAuth(this.email, this.password)).subscribe(() => {
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
    this.store.dispatch(new ScraperActions.SubmitMfa(s.sessionId, this.mfaCode)).subscribe(() => {
      this.mfaCode = '';
      this.snackBar.open('MFA verified — cookies extracted!', 'Close', { duration: 3000 });
    });
  }

  validateCookies(): void {
    const s = this.session();
    if (!s?.sessionId) return;
    this.store.dispatch(new ScraperActions.ValidateCookies(s.sessionId)).subscribe(() => {
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
    this.store.dispatch(new ScraperActions.RunScraper(s.sessionId)).subscribe(() => {
      this.snackBar.open('Scraping job queued — auto-retries on failure!', 'Close', { duration: 3000 });
    });
  }

  resetSession(): void {
    this.store.dispatch(new ScraperActions.ResetSession());
    this.mfaCode = '';
  }
}
