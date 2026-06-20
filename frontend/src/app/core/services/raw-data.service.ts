import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import { ApiResponse } from '../models';

export interface QueryParams {
  collection: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class RawDataService {
  private readonly api = inject(ApiService);

  getCollections(): Observable<string[]> {
    return this.api.get<string[]>('/raw-data/collections').pipe(map((r) => r.data));
  }

  getSchema(collection: string): Observable<string[]> {
    return this.api.get<string[]>(`/raw-data/schema/${collection}`).pipe(map((r) => r.data));
  }

  query(params: QueryParams): Observable<ApiResponse<any[]>> {
    return this.api.post<any[]>('/raw-data/query', params);
  }
}
