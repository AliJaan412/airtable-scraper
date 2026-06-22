export interface SyncResultItem {
  key: string;
  label: string;
  count: number;
  icon: string;
}

export function lastSyncedLabel(ts: string | undefined | null): string {
  if (!ts) return 'Never synced';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'Last synced just now';
  if (diff < 3600) return `Last synced ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `Last synced ${Math.floor(diff / 3600)}h ago`;
  return `Last synced ${Math.floor(diff / 86400)}d ago`;
}

export function syncResultItems(r: Record<string, unknown> | undefined | null): SyncResultItem[] {
  if (!r) return [];
  return [
    { key: 'bases',   label: 'Bases',   count: (r['bases']   as number) ?? 0, icon: 'folder' },
    { key: 'tables',  label: 'Tables',  count: (r['tables']  as number) ?? 0, icon: 'table_chart' },
    { key: 'records', label: 'Tickets', count: (r['records'] as number) ?? 0, icon: 'article' },
    { key: 'users',   label: 'Users',   count: (r['users']   as number) ?? 0, icon: 'group' },
  ];
}
