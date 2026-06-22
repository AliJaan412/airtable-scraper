import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
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
import { FieldsDialogComponent } from './fields-dialog/fields-dialog.component';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { FormControl } from '@angular/forms';

import { AirtableDataService } from '../../core/services/airtable-data.service';
import { COLLECTION_LABELS } from '../../core/models';
import { buildColDefs } from './helpers/grid.helpers';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-airtable-data',
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
  ],
  templateUrl: './airtable-data.component.html',
  styleUrl: './airtable-data.component.scss',
})
export class AirtableDataComponent implements OnInit, OnDestroy {
  private readonly airtableDataSvc = inject(AirtableDataService);
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
  pageSize = 100;
  readonly pageSizeOptions = [25, 50, 100, 200];

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
    flex: 1,
    minWidth: 80,
    floatingFilter: true,
    filterParams: { buttons: ['reset'] },
    cellStyle: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
    tooltipValueGetter: (p: any) => {
      const v = p.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    },
  };


  ngOnInit(): void {
    this.loadCollections();

    this.searchControl.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.pageInfo.update((p) => ({ ...p, page: 1 }));
      this.fetchData();
    });
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

  onPageSizeChange(newSize: number): void {
    this.pageSize = newSize;
    this.pageInfo.update((p) => ({ ...p, page: 1, pageSize: newSize }));
    this.fetchData();
  }

  goToPage(page: number): void {
    const { totalPages } = this.pageInfo();
    if (page < 1 || page > totalPages) return;
    this.pageInfo.update((p) => ({ ...p, page }));
    this.fetchData();
  }

  onSortChanged(event: any): void {
    const sortModel = event.api.getColumnState().find((c: any) => c.sort);
    if (sortModel) {
      this.currentSort = { field: sortModel.colId, order: sortModel.sort as 'asc' | 'desc' };
    } else {
      this.currentSort = {};
    }
    this.pageInfo.update((p) => ({ ...p, page: 1 }));
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
    this.pageInfo.update((p) => ({ ...p, page: 1 }));
    this.fetchData();
  }

  private loadCollections(): void {
    this.airtableDataSvc.getCollections().pipe(takeUntil(this.destroy$)).subscribe({
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

    this.airtableDataSvc.query(params).pipe(takeUntil(this.destroy$)).subscribe({
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
          this.columnDefs.set(buildColDefs(fields));
        } else if (data.length > 0) {
          this.columnDefs.set(buildColDefs(Object.keys(data[0])));
        }

        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.showError(err?.error?.message || 'Failed to load data');
      },
    });
  }

  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: 'error-snack' });
  }
}
