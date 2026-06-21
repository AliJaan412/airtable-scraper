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
  templateUrl: './airtable-connect.component.html',
  styleUrl: './airtable-connect.component.scss',
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
    if (!lastSynced) return;
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
