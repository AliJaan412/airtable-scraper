import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef,
  GridReadyEvent,
  GridApi,
  CellClickedEvent,
  ModuleRegistry,
  AllCommunityModule,
} from 'ag-grid-community';
import { FieldsDialogComponent } from './fields-dialog.component';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { FormControl } from '@angular/forms';

import { RawDataService } from '../../core/services/raw-data.service';
import { COLLECTION_LABELS } from '../../core/models';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-raw-data',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule,
    AgGridAngular,
    FieldsDialogComponent,
  ],
  template: `
    <div class="page-container">
      <!-- Toolbar -->
      <mat-card class="toolbar-card">
        <mat-card-content>
          <div class="toolbar-row">
            <!-- Integration selector -->
            <mat-form-field appearance="outline" class="field-sm">
              <mat-label>Active Integrations</mat-label>
              <mat-select [(ngModel)]="selectedIntegration" (ngModelChange)="onIntegrationChange()">
                @for (integration of integrations; track integration.value) {
                  <mat-option [value]="integration.value">
                    <mat-icon class="inline-icon">{{ integration.icon }}</mat-icon>
                    {{ integration.label }}
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!-- Entity (collection) selector -->
            <mat-form-field appearance="outline" class="field-md">
              <mat-label>Entity</mat-label>
              <mat-select
                [(ngModel)]="selectedCollection"
                (ngModelChange)="onCollectionChange()"
                [disabled]="!selectedIntegration"
              >
                @for (col of collections(); track col) {
                  <mat-option [value]="col">{{ collectionLabel(col) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!-- Search -->
            <mat-form-field appearance="outline" class="field-lg">
              <mat-label>Search</mat-label>
              <input matInput [formControl]="searchControl" placeholder="Search across all columns..." />
              <mat-icon matPrefix>search</mat-icon>
              @if (searchControl.value) {
                <button matSuffix mat-icon-button (click)="clearSearch()">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </mat-form-field>

            <div class="spacer"></div>

            <!-- Controls -->
            <button mat-stroked-button (click)="refresh()" [disabled]="loading() || !selectedCollection">
              <mat-icon>refresh</mat-icon>
              Refresh
            </button>

            <button mat-stroked-button color="warn" (click)="clearFilters()" [disabled]="!selectedCollection">
              <mat-icon>filter_alt_off</mat-icon>
              Clear
            </button>
          </div>

          <!-- Status row -->
          <div class="status-row">
            @if (selectedCollection) {
              <span class="count-label">
                {{ totalRows() | number }} total records
                @if (pageInfo().totalPages > 1) {
                  &nbsp;· Page {{ pageInfo().page }} of {{ pageInfo().totalPages }}
                }
              </span>
            }
            @if (loading()) {
              <mat-progress-bar mode="indeterminate" class="progress-bar"></mat-progress-bar>
            }
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Grid -->
      <div class="grid-container">
        @if (!selectedCollection) {
          <div class="empty-state">
            <mat-icon>table_chart</mat-icon>
            <p>Select an integration and entity to view data</p>
          </div>
        } @else if (columnDefs().length === 0 && !loading()) {
          <div class="empty-state">
            <mat-icon>inbox</mat-icon>
            <p>No data found for <strong>{{ collectionLabel(selectedCollection) }}</strong></p>
          </div>
        } @else {
          <ag-grid-angular
            class="ag-theme-material"
            style="width: 100%; height: 100%"
            [columnDefs]="columnDefs()"
            [rowData]="rowData()"
            [defaultColDef]="defaultColDef"
            [autoSizeStrategy]="autoSizeStrategy"
            [pagination]="true"
            [paginationPageSize]="pageSize"
            [paginationPageSizeSelector]="[25, 50, 100, 200]"
            [suppressPaginationPanel]="false"
            [animateRows]="true"
            [enableCellTextSelection]="true"
            (gridReady)="onGridReady($event)"
            (cellClicked)="onCellClicked($event)"
            (paginationChanged)="onPaginationChanged($event)"
            (sortChanged)="onSortChanged($event)"
            (filterChanged)="onFilterChanged()"
          />
        }
      </div>
    </div>
  `,
  styles: [`
    .page-container {
      padding: 16px;
      height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: hidden;
    }
    .toolbar-card {
      flex-shrink: 0;
    }
    .toolbar-card mat-card-content {
      padding-bottom: 0 !important;
    }
    .toolbar-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .field-sm { min-width: 160px; }
    .field-md { min-width: 200px; }
    .field-lg { flex: 1; min-width: 240px; }
    .spacer { flex: 1; }
    .inline-icon {
      font-size: 18px;
      vertical-align: middle;
      margin-right: 4px;
    }
    .status-row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 24px;
      margin-top: 4px;
    }
    .count-label {
      font-size: 12px;
      color: var(--clr-text-muted);
    }
    .progress-bar {
      flex: 1;
      height: 2px;
    }
    .grid-container {
      flex: 1;
      min-height: 0;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(4,188,243,0.08);
      background: var(--clr-surface);
      border: 1px solid var(--clr-border);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--clr-text-muted);
      gap: 8px;
    }
    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--clr-primary);
      opacity: 0.4;
    }
    .empty-state p {
      font-size: 16px;
      margin: 0;
    }
  `],
})
export class RawDataComponent implements OnInit, OnDestroy {
  private readonly rawDataSvc = inject(RawDataService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly destroy$ = new Subject<void>();

  readonly collectionLabels = COLLECTION_LABELS;

  // State signals
  collections = signal<string[]>([]);
  columnDefs = signal<ColDef[]>([]);
  rowData = signal<any[]>([]);
  loading = signal(false);
  totalRows = signal(0);
  pageInfo = signal({ page: 1, pageSize: 100, totalPages: 1 });

  selectedIntegration = 'airtable';
  selectedCollection = '';
  pageSize = 500; // load 500 rows at once; AG Grid paginates them client-side

  searchControl = new FormControl('');

  private gridApi?: GridApi;
  private currentSort: { field?: string; order?: 'asc' | 'desc' } = {};

  integrations = [
    { value: 'airtable', label: 'Airtable', icon: 'cloud' },
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 80,
    floatingFilter: true,
    filterParams: { buttons: ['reset'] },
    cellStyle: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    tooltipValueGetter: (p: any) => {
      const v = p.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    },
  };

  autoSizeStrategy = { type: 'fitCellContents' as const };

  ngOnInit(): void {
    this.loadCollections();

    this.searchControl.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.fetchData());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  collectionLabel(col: string): string {
    return COLLECTION_LABELS[col] || col;
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
  }

  onCellClicked(event: CellClickedEvent): void {
    const value = event.value;
    if (value === null || value === undefined) return;
    if (typeof value !== 'object' && !Array.isArray(value)) return;

    this.dialog.open(FieldsDialogComponent, {
      data: { title: event.colDef.headerName ?? event.column.getId(), value },
      width: '520px',
      maxHeight: '80vh',
      panelClass: 'fields-dialog-panel',
    });
  }

  onIntegrationChange(): void {
    this.selectedCollection = '';
    this.columnDefs.set([]);
    this.rowData.set([]);
    this.loadCollections();
  }

  onCollectionChange(): void {
    this.pageInfo.set({ page: 1, pageSize: this.pageSize, totalPages: 1 });
    this.fetchData();
  }

  onPaginationChanged(_event: any): void {
    // AG Grid handles pagination of the currently loaded rows client-side.
    // Server-side page fetching is triggered only by onCollectionChange(), search, and sort.
  }

  onSortChanged(event: any): void {
    const sortModel = event.api.getColumnState().find((c: any) => c.sort);
    if (sortModel) {
      this.currentSort = { field: sortModel.colId, order: sortModel.sort as 'asc' | 'desc' };
    } else {
      this.currentSort = {};
    }
    this.fetchData();
  }

  onFilterChanged(): void {
    // AG Grid client-side filter is already applied; no server call needed
  }

  refresh(): void {
    this.fetchData();
  }

  clearSearch(): void {
    this.searchControl.setValue('');
  }

  clearFilters(): void {
    this.searchControl.setValue('');
    this.gridApi?.setFilterModel(null);
    this.currentSort = {};
    this.fetchData();
  }

  private loadCollections(): void {
    this.rawDataSvc.getCollections().pipe(takeUntil(this.destroy$)).subscribe({
      next: (cols) => this.collections.set(cols),
      error: () => this.showError('Failed to load collections'),
    });
  }

  private fetchData(): void {
    if (!this.selectedCollection) return;

    this.loading.set(true);

    const params = {
      collection: this.selectedCollection,
      search: this.searchControl.value || undefined,
      page: this.pageInfo().page,
      pageSize: this.pageSize,
      sortField: this.currentSort.field,
      sortOrder: this.currentSort.order,
    };

    this.rawDataSvc.query(params).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        const fields: string[] = response.meta?.['fields'] || [];
        const data: any[] = response.data || [];

        this.rowData.set(data);
        this.totalRows.set(response.meta?.total || data.length);
        this.pageInfo.update((p) => ({
          ...p,
          totalPages: response.meta?.totalPages || 1,
        }));

        if (fields.length > 0) {
          this.columnDefs.set(this.buildColDefs(fields));
        } else if (data.length > 0) {
          this.columnDefs.set(this.buildColDefs(Object.keys(data[0])));
        }

        this.loading.set(false);
        // Re-size after every data load so switching collections always fits content
        setTimeout(() => this.gridApi?.autoSizeAllColumns(), 50);
      },
      error: (err) => {
        this.loading.set(false);
        this.showError(err?.error?.message || 'Failed to load data');
      },
    });
  }

  private buildColDefs(fields: string[]): ColDef[] {
    // Fields to hide — either sensitive, redundant, or not useful in the grid
    const hiddenFields = new Set(['__v', 'organizationId', 'cookies', 'diffRowHtml', 'password', 'rawData']);

    return fields
      .filter((f) => !hiddenFields.has(f))
      .map((field) => {
        const def: ColDef = {
          field,
          headerName: this.formatHeader(field),
          cellRenderer: (params: any) => this.formatCell(params.value, field),
        };

        if (field === '_id') { def.maxWidth = 130; def.pinned = 'left'; }
        if (field === 'columnType') { def.maxWidth = 120; }
        if (field === 'newValue' || field === 'oldValue') { def.minWidth = 130; def.maxWidth = 200; }
        if (field === 'authoredBy') { def.minWidth = 130; def.maxWidth = 200; }
        if (field === 'status') { def.maxWidth = 130; }
        if (field === 'fields' || field === 'views') {
          def.minWidth = 200;
          def.maxWidth = 320;
          def.cellStyle = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' };
        }
        if (field === 'progress') { def.maxWidth = 130; }
        if (field.toLowerCase().includes('id') && field !== '_id') { def.maxWidth = 180; }

        return def;
      });
  }

  private formatHeader(field: string): string {
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  private formatCell(value: any, field: string): string {
    if (value === null || value === undefined) return '<span style="color:#9e9e9e">—</span>';

    // ── Array of named objects (fields, views, choices…) ──────────────────────
    if (Array.isArray(value)) {

      if (value.length === 0) return '<span style="color:#9e9e9e">—</span>';
      const names = value
        .map((item: any) => item?.name ?? item?.label ?? item?.title ?? null)
        .filter(Boolean);
      if (names.length > 0) {
        const MAX = 3;
        const shown = names.slice(0, MAX).join(', ');
        const more = names.length > MAX ? ` <span style="color:#9e9e9e;font-size:11px">+${names.length - MAX} more</span>` : '';
        return `<span style="font-size:12px">${shown}${more}</span>`;
      }
      return `<span style="font-size:11px;color:#555;background:#f5f5f5;padding:2px 6px;border-radius:4px">${value.length} items</span>`;
    }

    // ── Progress object {total, processed, failed} ─────────────────────────
    if (typeof value === 'object' && 'processed' in value && 'total' in value) {
      const { processed, total, failed } = value;
      const failPart = failed > 0
        ? ` <span style="color:#c62828;font-size:11px">(${failed} failed)</span>`
        : '';
      return `<span style="font-weight:600">${processed} / ${total}</span>${failPart}`;
    }

    // ── Other plain objects — show key: value pairs truncated ──────────────
    if (typeof value === 'object') {
      const pairs = Object.entries(value)
        .filter(([, v]) => typeof v !== 'object')
        .slice(0, 3)
        .map(([k, v]) => `<span style="color:#9e9e9e;font-size:10px">${k}:</span> ${v}`)
        .join('  ');
      return pairs || `<span style="font-size:11px;color:#555;background:#f5f5f5;padding:2px 6px;border-radius:4px">[object]</span>`;
    }

    // ── Date fields ────────────────────────────────────────────────────────
    if (field.toLowerCase().includes('date') || field.toLowerCase().includes('time') || field.toLowerCase().includes('at')) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
      }
    }

    // ── Status chip ────────────────────────────────────────────────────────
    if (field === 'status') {
      const cls = this.statusClass(value);
      return `<span class="status-chip ${cls}">${value}</span>`;
    }

    // ── Column type badge ──────────────────────────────────────────────────
    if (field === 'columnType') {
      const color = value === 'status' ? '#1976d2' : '#7b1fa2';
      return `<span style="font-size:11px;font-weight:600;color:${color};background:${color}18;padding:2px 8px;border-radius:10px">${value}</span>`;
    }

    return String(value);
  }

  private statusClass(value: string): string {
    const v = (value || '').toLowerCase();
    if (v === 'open') return 'status-open';
    if (v.includes('progress') || v.includes('running')) return 'status-in-progress';
    if (v === 'closed' || v === 'completed') return 'status-closed';
    return 'status-default';
  }

  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: 'error-snack' });
  }
}
