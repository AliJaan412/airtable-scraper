import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  navOpen = signal(window.innerWidth > 768);

  navItems: NavItem[] = [
    { label: 'Raw Data',              icon: 'table_chart',    route: '/raw-data' },
    { label: 'Airtable Integration',  icon: 'cloud_sync',     route: '/integrations/airtable' },
    { label: 'Scraper',               icon: 'manage_search',  route: '/scraper' },
  ];
}
