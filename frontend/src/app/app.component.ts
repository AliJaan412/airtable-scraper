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
  template: `
    <div class="shell">

      <!-- ── Top bar ───────────────────────────────────────────── -->
      <header class="topbar">
        <button class="hamburger" (click)="navOpen.set(!navOpen())">
          <mat-icon>{{ navOpen() ? 'close' : 'menu' }}</mat-icon>
        </button>
        <img src="https://sred.io/assets/img/logo.png" alt="Sred.io" class="topbar-logo" />
        <span class="topbar-fill"></span>
        <span class="topbar-caption">Airtable Integration Platform</span>
      </header>

      <!-- ── Body ─────────────────────────────────────────────── -->
      <div class="body">

        <!-- Sidebar -->
        <nav class="sidenav" [class.sidenav--closed]="!navOpen()">
          @for (item of navItems; track item.route) {
            <a
              class="nav-link"
              [routerLink]="item.route"
              routerLinkActive="nav-link--active"
              [routerLinkActiveOptions]="{ exact: false }"
            >
              <mat-icon class="nav-icon">{{ item.icon }}</mat-icon>
              <span class="nav-label">{{ item.label }}</span>
            </a>
          }
        </nav>

        <!-- Mobile overlay -->
        @if (navOpen()) {
          <div class="overlay" (click)="navOpen.set(false)"></div>
        }

        <!-- Page content -->
        <main class="content">
          <router-outlet />
        </main>

      </div>
    </div>
  `,
  styles: [`
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Topbar ─────────────────────────────────────────── */
    .topbar {
      display: flex;
      align-items: center;
      height: 56px;
      padding: 0 16px;
      gap: 12px;
      background: var(--clr-primary);
      flex-shrink: 0;
      z-index: 200;
      box-shadow: 0 2px 8px rgba(4,188,243,0.35);
    }
    .hamburger {
      all: unset;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 6px;
      color: white;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .hamburger:hover { background: rgba(255,255,255,0.2); }
    .hamburger mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .topbar-logo {
      height: 28px;
      width: auto;
      object-fit: contain;
      filter: brightness(0) invert(1);
      flex-shrink: 0;
    }
    .topbar-fill { flex: 1; }
    .topbar-caption {
      color: rgba(255,255,255,0.75);
      font-size: 12px;
      white-space: nowrap;
    }

    /* ── Body row ────────────────────────────────────────── */
    .body {
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    /* ── Sidebar ─────────────────────────────────────────── */
    .sidenav {
      width: 220px;
      background: var(--clr-surface);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      padding: 12px 8px;
      gap: 2px;
      overflow-y: auto;
      overflow-x: hidden;
      transition: width 0.2s ease, padding 0.2s ease;
      border-right: 1px solid var(--clr-border);
    }
    .sidenav--closed {
      width: 0;
      padding: 12px 0;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 13px;
      border-radius: 8px;
      text-decoration: none;
      color: var(--clr-text-mid);
      font-size: 13.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      transition: background 0.15s, color 0.15s;
    }
    .nav-link:hover {
      background: var(--clr-primary-light);
      color: var(--clr-primary-dark);
    }
    .nav-link:hover .nav-icon { color: var(--clr-primary-dark); }
    .nav-link--active {
      background: var(--clr-primary) !important;
      color: #ffffff !important;
      font-weight: 600;
    }
    .nav-link--active .nav-icon { color: #ffffff !important; }
    .nav-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
      flex-shrink: 0;
      color: var(--clr-text-muted);
      transition: color 0.15s;
    }
    .nav-label { flex: 1; }

    /* ── Mobile overlay ──────────────────────────────────── */
    .overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 50;
    }

    /* ── Main content ────────────────────────────────────── */
    .content {
      flex: 1;
      overflow-y: auto;
      background: var(--clr-bg);
      min-width: 0;
    }

    /* ── Responsive ──────────────────────────────────────── */
    @media (max-width: 768px) {
      .sidenav {
        position: fixed;
        top: 56px;
        left: 0;
        bottom: 0;
        z-index: 60;
        width: 240px;
        box-shadow: 4px 0 16px rgba(4,188,243,0.12);
        transition: transform 0.2s ease;
        transform: translateX(0);
        padding: 12px 8px;
      }
      .sidenav--closed {
        width: 240px;
        transform: translateX(-100%);
        padding: 12px 8px;
      }
      .overlay { display: block; }
      .topbar-caption { display: none; }
    }
  `],
})
export class AppComponent {
  navOpen = signal(window.innerWidth > 768);

  navItems: NavItem[] = [
    { label: 'Raw Data',              icon: 'table_chart',    route: '/raw-data' },
    { label: 'Airtable Integration',  icon: 'cloud_sync',     route: '/integrations/airtable' },
    { label: 'Scraper',               icon: 'manage_search',  route: '/scraper' },
  ];
}
