import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { ApiResponse } from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly baseUrl = environment.apiUrl;

  private headers(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'X-Organization-Id': environment.organizationId,
    });
  }

  get<T>(path: string, params?: Record<string, any>): Observable<ApiResponse<T>> {
    return this.http.get<ApiResponse<T>>(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      params,
    });
  }

  post<T>(path: string, body: any = {}): Observable<ApiResponse<T>> {
    return this.http.post<ApiResponse<T>>(`${this.baseUrl}${path}`, body, {
      headers: this.headers(),
    });
  }

  delete<T>(path: string): Observable<ApiResponse<T>> {
    return this.http.delete<ApiResponse<T>>(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
  }
}
