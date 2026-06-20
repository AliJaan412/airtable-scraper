import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'raw-data',
    pathMatch: 'full',
  },
  {
    path: 'raw-data',
    loadComponent: () =>
      import('./features/raw-data/raw-data.component').then((m) => m.RawDataComponent),
  },
  {
    path: 'integrations/airtable',
    loadComponent: () =>
      import('./features/airtable/airtable-connect.component').then((m) => m.AirtableConnectComponent),
  },
  {
    path: 'scraper',
    loadComponent: () =>
      import('./features/scraper/scraper.component').then((m) => m.ScraperComponent),
  },
  {
    path: '**',
    redirectTo: 'raw-data',
  },
];
