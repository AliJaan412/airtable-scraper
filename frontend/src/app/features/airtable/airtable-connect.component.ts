import { Component, OnInit, OnDestroy, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Store } from '@ngxs/store';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AirtableState } from '../../store/airtable/airtable.state';
import { AirtableActions } from '../../store/airtable/airtable.actions';

@Component({
  selector: 'app-airtable-connect',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="page">

      <!-- Page header -->
      <div class="page-header">
        <h1 class="page-heading">
          <mat-icon class="heading-icon">cloud_sync</mat-icon>
          Airtable Integration
        </h1>
        <p class="page-sub">Connect and sync your Airtable workspace to the local database.</p>
      </div>

      <!-- Connection status card -->
      <div class="card" [class.card--expired]="status()?.isExpired">
        <div class="connection-row">
          <div class="connection-left">
            <div
              class="status-dot"
              [class.status-dot--on]="status()?.connected && !status()?.isExpired"
              [class.status-dot--expired]="status()?.isExpired"
            ></div>
            <div>
              <div class="connection-title">
                @if (status()?.isExpired) {
                  Token Expired
                } @else if (status()?.connected) {
                  Connected to Airtable
                } @else {
                  Not connected
                }
              </div>
              @if (status()?.connected && !status()?.isExpired) {
                <div class="connection-sub">Expires {{ status()?.expiresAt | date:'mediumDate' }}</div>
              } @else if (status()?.isExpired) {
                <div class="connection-sub connection-sub--expired">
                  <mat-icon class="sub-icon">warning_amber</mat-icon>
                  Expired {{ status()?.expiresAt | date:'mediumDate' }} — reconnect to restore access
                </div>
              } @else {
                <div class="connection-sub">Connect your account to start syncing data</div>
              }
            </div>
          </div>
          <div class="connection-right">
            @if (!status()?.connected) {
              <button class="btn btn--primary" (click)="connect()" [disabled]="loading()">
                @if (loading()) {
                  <mat-spinner diameter="16" class="btn-spinner"></mat-spinner>
                } @else {
                  <mat-icon>link</mat-icon>
                }
                Connect Airtable
              </button>
            } @else if (status()?.isExpired) {
              <button class="btn btn--warn" (click)="connect()" [disabled]="loading()">
                @if (loading()) {
                  <mat-spinner diameter="16" class="btn-spinner"></mat-spinner>
                } @else {
                  <mat-icon>refresh</mat-icon>
                }
                Reconnect
              </button>
            } @else {
              <button class="btn btn--danger" (click)="disconnect()" [disabled]="loading()">
                <mat-icon>link_off</mat-icon>
                Disconnect
              </button>
            }
          </div>
        </div>
      </div>

      @if (status()?.connected) {
        @if (status()?.isExpired) {
          <div class="card expired-notice">
            <mat-icon class="expired-notice-icon">lock_clock</mat-icon>
            <div>
              <div class="expired-notice-title">Sync unavailable — token expired</div>
              <div class="expired-notice-sub">Your Airtable access token has expired. Click <strong>Reconnect</strong> above to restore access and resume syncing.</div>
            </div>
          </div>
        }
      }

      @if (status()?.connected && !status()?.isExpired) {

        <!-- Sync card -->
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Data Sync</div>
              <div class="card-sub">Pull all Airtable data into the local database</div>
              @if (!syncing()) {
                <div class="last-synced-label">
                  <mat-icon class="last-synced-icon">schedule</mat-icon>
                  {{ lastSyncedLabel() }}
                </div>
              }
            </div>
            <button class="btn btn--primary" (click)="syncAll()" [disabled]="syncing()">
              @if (syncing()) {
                <mat-spinner diameter="16" class="btn-spinner"></mat-spinner>
                Syncing...
              } @else {
                <mat-icon>cloud_download</mat-icon>
                Sync All
              }
            </button>
          </div>

          @if (syncResults()) {
            <div class="stats-grid">
              @for (item of syncResultItems(); track item.key) {
                <div class="stat-card">
                  <div class="stat-icon-wrap">
                    <mat-icon class="stat-icon">{{ item.icon }}</mat-icon>
                  </div>
                  <div>
                    <div class="stat-value">{{ item.count }}</div>
                    <div class="stat-label">{{ item.label }}</div>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="hint-text">Run Sync All to import your Airtable bases, tables, tickets, and users.</p>
          }
        </div>

        <!-- Bases card -->
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Bases (Projects)</div>
              <div class="card-sub">{{ bases().length }} base{{ bases().length !== 1 ? 's' : '' }} synced</div>
            </div>
            <button class="icon-btn" (click)="refreshBases()" title="Refresh">
              <mat-icon>refresh</mat-icon>
            </button>
          </div>

          @if (bases().length === 0) {
            <p class="hint-text">No bases found. Run Sync All to import your bases.</p>
          } @else {
            <div class="bases-list">
              @for (base of bases(); track base.baseId) {
                <div class="base-row">
                  <mat-icon class="base-icon">folder_open</mat-icon>
                  <div class="base-info">
                    <div class="base-name">{{ base.name }}</div>
                    <div class="base-id">{{ base.baseId }}</div>
                  </div>
                  <span class="perm-badge">{{ base.permissionLevel }}</span>
                </div>
              }
            </div>
          }
        </div>

      }
    </div>
  `,
  styles: [`
    .page {
      padding: 28px 24px;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Header */
    .page-header { margin-bottom: 4px; }
    .page-heading {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 22px;
      font-weight: 700;
      color: var(--clr-text);
      margin: 0 0 6px;
    }
    .heading-icon { color: var(--clr-primary); font-size: 26px; width: 26px; height: 26px; }
    .page-sub { color: var(--clr-text-muted); font-size: 14px; margin: 0; }

    /* Cards */
    .card {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
      border-radius: 10px;
      padding: 22px 24px;
    }
    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .card-title { font-size: 15px; font-weight: 600; color: var(--clr-text); margin: 0 0 4px; }
    .card-sub { font-size: 13px; color: var(--clr-text-muted); }
    .last-synced-label {
      display: flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--clr-text-muted); margin-top: 6px;
    }
    .last-synced-icon { font-size: 14px; width: 14px; height: 14px; }

    /* Connection row */
    .connection-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .connection-left { display: flex; align-items: center; gap: 16px; }
    .status-dot {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #cbd5e1;
      flex-shrink: 0;
    }
    .status-dot--on {
      background: var(--clr-success);
      box-shadow: 0 0 0 4px rgba(5,150,105,0.15);
    }
    .connection-title { font-size: 15px; font-weight: 600; color: var(--clr-text); }
    .connection-sub { font-size: 13px; color: var(--clr-text-muted); margin-top: 3px; }

    /* Badges */
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 500;
      padding: 1px 7px;
      border-radius: 4px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .badge--warn { background: var(--clr-danger-bg); color: var(--clr-danger); }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      border-radius: 7px;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      border: 1.5px solid transparent;
      transition: opacity 0.15s, background 0.15s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn--primary { background: var(--clr-primary); color: var(--clr-navy); font-weight: 600; }
    .btn--primary:not(:disabled):hover { background: var(--clr-primary-dark); color: white; }
    .btn--danger { background: var(--clr-surface); color: var(--clr-danger); border-color: var(--clr-danger-border); }
    .btn--danger:not(:disabled):hover { background: var(--clr-danger-bg); }
    .btn-spinner { display: inline-block; }

    .icon-btn {
      all: unset;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 6px;
      color: var(--clr-text-muted);
      transition: background 0.15s, color 0.15s;
    }
    .icon-btn:hover { background: var(--clr-primary-light); color: var(--clr-primary-dark); }

    /* Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .stat-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      background: var(--clr-surface-alt);
      border: 1px solid var(--clr-border);
      border-radius: 8px;
    }
    .stat-icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--clr-primary-light);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .stat-icon { color: var(--clr-primary-dark); font-size: 20px; width: 20px; height: 20px; }
    .stat-value { font-size: 22px; font-weight: 700; color: var(--clr-text); line-height: 1; }
    .stat-label { font-size: 12px; color: var(--clr-text-muted); margin-top: 4px; }

    /* Bases list */
    .bases-list { display: flex; flex-direction: column; }
    .base-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--clr-border-light);
    }
    .base-row:last-child { border-bottom: none; }
    .base-icon { color: var(--clr-text-muted); font-size: 20px; width: 20px; height: 20px; }
    .base-info { flex: 1; min-width: 0; }
    .base-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--clr-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .base-id { font-size: 11px; color: var(--clr-text-muted); font-family: monospace; margin-top: 2px; }
    .perm-badge {
      font-size: 11px;
      font-weight: 500;
      color: var(--clr-primary-dark);
      background: var(--clr-primary-light);
      border-radius: 4px;
      padding: 3px 8px;
      white-space: nowrap;
    }

    .hint-text { color: var(--clr-text-muted); font-size: 14px; margin: 4px 0 0; }

    /* Expired state */
    .status-dot--expired {
      background: var(--clr-orange);
      box-shadow: 0 0 0 4px rgba(249,115,22,0.15);
    }
    .connection-sub--expired {
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--clr-orange-dark);
      font-size: 13px;
      margin-top: 3px;
    }
    .sub-icon { font-size: 15px; width: 15px; height: 15px; vertical-align: middle; }
    .card--expired { border-color: var(--clr-orange-border); background: var(--clr-orange-bg); }
    .btn--warn {
      background: var(--clr-surface);
      color: var(--clr-orange-dark);
      border-color: var(--clr-orange-border);
    }
    .btn--warn:not(:disabled):hover { background: var(--clr-orange-bg); }
    .expired-notice {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      background: var(--clr-orange-bg);
      border-color: var(--clr-orange-border);
    }
    .expired-notice-icon {
      color: var(--clr-orange);
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .expired-notice-title { font-size: 14px; font-weight: 600; color: #9a3412; margin-bottom: 4px; }
    .expired-notice-sub { font-size: 13px; color: var(--clr-orange-dark); line-height: 1.5; }

    /* Responsive */
    @media (max-width: 700px) {
      .page { padding: 16px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .connection-row { flex-direction: column; align-items: flex-start; }
    }
    @media (max-width: 440px) {
      .stats-grid { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class AirtableConnectComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private syncPoller?: ReturnType<typeof setInterval>;

  readonly status = toSignal(this.store.select(AirtableState.status));
  readonly bases = toSignal(this.store.select(AirtableState.bases), { initialValue: [] });
  readonly loading = toSignal(this.store.select(AirtableState.loading), { initialValue: false });
  readonly syncing = toSignal(this.store.select(AirtableState.syncing), { initialValue: false });
  readonly syncResults = toSignal(this.store.select(AirtableState.syncResults));
  readonly lastSyncedAt = toSignal(this.store.select(AirtableState.lastSyncedAt));

  lastSyncedLabel(): string {
    const ts = this.lastSyncedAt();
    if (!ts) return 'Never synced';
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return 'Last synced just now';
    if (diff < 3600) return `Last synced ${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `Last synced ${Math.floor(diff / 3600)}h ago`;
    return `Last synced ${Math.floor(diff / 86400)}d ago`;
  }

  syncResultItems() {
    const r = this.syncResults();
    if (!r) return [];
    return [
      { key: 'bases',   label: 'Bases',   count: r['bases']   ?? 0, icon: 'folder' },
      { key: 'tables',  label: 'Tables',  count: r['tables']  ?? 0, icon: 'table_chart' },
      { key: 'records', label: 'Tickets', count: r['records'] ?? 0, icon: 'article' },
      { key: 'users',   label: 'Users',   count: r['users']   ?? 0, icon: 'group' },
    ];
  }

  ngOnInit(): void {
    this.checkCallback();
    this.store.dispatch(new AirtableActions.LoadStatus())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.autoSyncIfStale(); });
    this.store.dispatch(new AirtableActions.LoadBases());
    this.store.dispatch(new AirtableActions.LoadSyncCounts());
  }

  ngOnDestroy(): void {
    this.clearSyncPoller();
  }

  private startSyncPoller(): void {
    this.clearSyncPoller();
    this.syncPoller = setInterval(() => {
      this.store.dispatch(new AirtableActions.CheckSyncStatus())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (!this.syncing()) {
            this.clearSyncPoller();
            const results = this.syncResults();
            if (results && results['records'] !== undefined) {
              this.snackBar.open(`Sync complete! ${results['records']} tickets synced.`, 'Close', { duration: 5000 });
              this.store.dispatch(new AirtableActions.LoadBases());
            }
          }
        });
    }, 3000);
  }

  private clearSyncPoller(): void {
    if (this.syncPoller) {
      clearInterval(this.syncPoller);
      this.syncPoller = undefined;
    }
  }

  private autoSyncIfStale(): void {
    const status = this.status();
    if (!status?.connected || status?.isExpired) return;
    const lastSynced = status.lastSyncedAt;
    if (!lastSynced) return; // never synced — user must do it manually first
    const ageMinutes = (Date.now() - new Date(lastSynced).getTime()) / 60000;
    if (ageMinutes > 30) {
      this.store.dispatch(new AirtableActions.SyncAll());
    }
  }

  private checkCallback(): void {
    const params = this.route.snapshot.queryParams;
    if (params['connected'] === 'true') {
      this.snackBar.open('Airtable connected successfully!', 'Close', { duration: 4000 });
      this.store.dispatch(new AirtableActions.ClearCache());
      this.router.navigate([], { queryParams: {} });
    } else if (params['error']) {
      this.snackBar.open(`Connection failed: ${params['error']}`, 'Close', { duration: 6000 });
      this.router.navigate([], { queryParams: {} });
    }
  }

  connect(): void {
    this.store.dispatch(new AirtableActions.Connect());
  }

  disconnect(): void {
    this.store.dispatch(new AirtableActions.Disconnect());
    this.snackBar.open('Disconnected from Airtable', 'Close', { duration: 3000 });
  }

  syncAll(): void {
    this.store.dispatch(new AirtableActions.SyncAll())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.snackBar.open('Sync started — running in background', 'Close', { duration: 4000 });
        this.startSyncPoller();
      });
  }

  refreshBases(): void {
    this.store.dispatch(new AirtableActions.ClearCache());
    this.store.dispatch(new AirtableActions.LoadBases());
  }
}
