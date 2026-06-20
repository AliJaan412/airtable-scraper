import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { AirtableBase, AirtableTable, AirtableRecord, ConnectionStatus } from '../models';

@Injectable({ providedIn: 'root' })
export class AirtableService {
  private readonly api = inject(ApiService);

  getStatus(): Observable<ConnectionStatus> {
    return this.api.get<ConnectionStatus>('/airtable/status').pipe(map((r) => r.data));
  }

  getAuthorizeUrl(): Observable<string> {
    return this.api.get<{ url: string }>('/airtable/oauth/authorize').pipe(map((r) => r.data.url));
  }

  disconnect(): Observable<void> {
    return this.api.post<void>('/airtable/disconnect').pipe(map(() => undefined));
  }

  syncAll(): Observable<Record<string, number>> {
    return this.api.post<Record<string, number>>('/airtable/sync').pipe(map((r) => r.data));
  }

  syncBases(): Observable<{ synced: number }> {
    return this.api.post<{ synced: number }>('/airtable/sync/bases').pipe(map((r) => r.data));
  }

  syncTables(baseId: string): Observable<{ synced: number }> {
    return this.api.post<{ synced: number }>(`/airtable/sync/tables/${baseId}`).pipe(map((r) => r.data));
  }

  syncRecords(baseId: string, tableId: string): Observable<{ synced: number }> {
    return this.api.post<{ synced: number }>(`/airtable/sync/records/${baseId}/${tableId}`).pipe(map((r) => r.data));
  }

  getBases(): Observable<AirtableBase[]> {
    return this.api.get<AirtableBase[]>('/airtable/bases').pipe(map((r) => r.data));
  }

  getTables(baseId?: string): Observable<AirtableTable[]> {
    return this.api.get<AirtableTable[]>('/airtable/tables', baseId ? { baseId } : {}).pipe(map((r) => r.data));
  }

  getRecords(filter: Record<string, any> = {}, page = 1, pageSize = 100): Observable<any> {
    return this.api.get<AirtableRecord[]>('/airtable/records', { ...filter, page, pageSize });
  }

  getUsers(): Observable<any[]> {
    return this.api.get<any[]>('/airtable/users').pipe(map((r) => r.data));
  }
}
