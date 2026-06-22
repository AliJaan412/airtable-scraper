import type { AgChartOptions } from 'ag-charts-community';
import type { ScraperSession } from '../../../core/models';
import type { ChangelogStats } from '../../../store/scraper/scraper.state';

export function isAuthenticated(session: ScraperSession | undefined | null): boolean {
  return !!session && (session.status === 'idle' || session.status === 'running' || session.status === 'completed');
}

export function isAuthExpired(session: ScraperSession | undefined | null): boolean {
  if (!session || session.status !== 'failed') return false;
  const err = (session.error ?? '').toLowerCase();
  return err.includes('expired') || err.includes('re-authenticate') || err.includes('cookie') || err.includes('auth_expired');
}

export function progressPct(session: ScraperSession | undefined | null): number {
  if (!session?.progress?.total) return 0;
  const attempted = (session.progress.processed ?? 0) + (session.progress.failed ?? 0);
  return Math.round((attempted / session.progress.total) * 100);
}

export function progressAttempted(session: ScraperSession | undefined | null): number {
  return (session?.progress?.processed ?? 0) + (session?.progress?.failed ?? 0);
}

export function buildChartOptions(stats: ChangelogStats | undefined | null): AgChartOptions {
  return {
    data: [
      { label: 'Status Changes',   count: stats?.byType.status   ?? 0 },
      { label: 'Assignee Changes', count: stats?.byType.assignee ?? 0 },
    ],
    series: [{
      type: 'donut',
      calloutLabelKey: 'label',
      angleKey: 'count',
      innerRadiusRatio: 0.72,
      fills: ['#04BCF3', '#029AC8'],
      strokes: ['#ffffff'],
      strokeWidth: 2,
    }],
    legend: { enabled: true, position: 'bottom' },
    background: { fill: 'transparent' },
    padding: { top: 4, bottom: 4 },
  } as unknown as AgChartOptions;
}
