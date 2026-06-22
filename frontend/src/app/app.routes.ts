import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'airtable-data',
    pathMatch: 'full',
  },
  {
    path: 'airtable-data',
    loadComponent: () =>
      import('./features/airtable-data/airtable-data.component').then((m) => m.AirtableDataComponent),
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
    redirectTo: 'airtable-data',
  },
];
