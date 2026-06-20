import { inject } from '@angular/core';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { tap, catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { AirtableService } from '../../core/services/airtable.service';
import { ConnectionStatus, AirtableBase } from '../../core/models';
import { AirtableActions } from './airtable.actions';

export interface AirtableStateModel {
  status: ConnectionStatus | null;
  bases: AirtableBase[];
  syncResults: Record<string, number> | null;
  statusLoaded: boolean;
  basesLoaded: boolean;
  loading: boolean;
  syncing: boolean;
  error: string | null;
}

const defaults: AirtableStateModel = {
  status: null,
  bases: [],
  syncResults: null,
  statusLoaded: false,
  basesLoaded: false,
  loading: false,
  syncing: false,
  error: null,
};

@State<AirtableStateModel>({
  name: 'airtable',
  defaults,
})
export class AirtableState {
  private readonly airtableSvc = inject(AirtableService);

  @Selector()
  static status(state: AirtableStateModel): ConnectionStatus | null {
    return state.status;
  }

  @Selector()
  static bases(state: AirtableStateModel): AirtableBase[] {
    return state.bases;
  }

  @Selector()
  static loading(state: AirtableStateModel): boolean {
    return state.loading;
  }

  @Selector()
  static syncing(state: AirtableStateModel): boolean {
    return state.syncing;
  }

  @Selector()
  static syncResults(state: AirtableStateModel): Record<string, number> | null {
    return state.syncResults;
  }

  @Selector()
  static isConnected(state: AirtableStateModel): boolean {
    return state.status?.connected === true;
  }

  @Action(AirtableActions.LoadStatus)
  loadStatus(ctx: StateContext<AirtableStateModel>) {
    // Skip if already loaded — prevents duplicate API calls on repeated navigation
    if (ctx.getState().statusLoaded) return;

    ctx.patchState({ loading: true, error: null });
    return this.airtableSvc.getStatus().pipe(
      tap((status) => {
        ctx.patchState({ status, statusLoaded: true, loading: false });
      }),
      catchError(() => {
        ctx.patchState({ status: { connected: false }, statusLoaded: true, loading: false });
        return EMPTY;
      }),
    );
  }

  @Action(AirtableActions.LoadBases)
  loadBases(ctx: StateContext<AirtableStateModel>) {
    if (ctx.getState().basesLoaded) return;

    return this.airtableSvc.getBases().pipe(
      tap((bases) => ctx.patchState({ bases, basesLoaded: true })),
      catchError((err) => {
        ctx.patchState({ error: err?.error?.message || 'Failed to load bases' });
        return EMPTY;
      }),
    );
  }

  @Action(AirtableActions.Connect)
  connect(ctx: StateContext<AirtableStateModel>) {
    ctx.patchState({ loading: true, error: null });
    return this.airtableSvc.getAuthorizeUrl().pipe(
      tap((url) => {
        ctx.patchState({ loading: false });
        window.location.href = url;
      }),
      catchError((err) => {
        ctx.patchState({ loading: false, error: err?.error?.message || 'Failed to start Airtable connection' });
        return EMPTY;
      }),
    );
  }

  @Action(AirtableActions.Disconnect)
  disconnect(ctx: StateContext<AirtableStateModel>) {
    ctx.patchState({ loading: true, error: null });
    return this.airtableSvc.disconnect().pipe(
      tap(() => {
        ctx.patchState({
          ...defaults,
          // Keep statusLoaded true so we don't re-fetch, status shows disconnected
          status: { connected: false },
          statusLoaded: true,
        });
      }),
      catchError((err) => {
        ctx.patchState({ loading: false, error: err?.error?.message || 'Failed to disconnect' });
        return EMPTY;
      }),
    );
  }

  @Action(AirtableActions.SyncAll)
  syncAll(ctx: StateContext<AirtableStateModel>) {
    ctx.patchState({ syncing: true, error: null });
    return this.airtableSvc.syncAll().pipe(
      tap((results) => {
        // After a sync the bases cache is stale — force a refresh next load
        ctx.patchState({ syncing: false, syncResults: results, basesLoaded: false });
      }),
      catchError((err) => {
        ctx.patchState({ syncing: false, error: err?.error?.message || 'Sync failed — check your connection' });
        return EMPTY;
      }),
    );
  }

  @Action(AirtableActions.ClearCache)
  clearCache(ctx: StateContext<AirtableStateModel>) {
    ctx.patchState({ statusLoaded: false, basesLoaded: false });
  }
}
