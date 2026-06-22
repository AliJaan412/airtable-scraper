import { ColDef } from 'ag-grid-community';

export const HIDDEN_FIELDS = new Set([
  '__v', 'organizationId', 'cookies', 'diffRowHtml', 'password', 'rawData',
  'createdAt', 'updatedAt', 'syncedAt', 'cookiesValidatedAt', 'startedAt', 'completedAt',
]);

// ── Header ─────────────────────────────────────────────────────────────────

export function formatHeader(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ── Cell rendering ──────────────────────────────────────────────────────────

const EXPAND_BADGE =
  '<span style="flex-shrink:0;margin-left:8px;padding:1px 7px;border-radius:4px;' +
  'font-size:11px;font-weight:500;color:#029AC8;background:#e0f7fe;' +
  'border:1px solid #b3ecfa;white-space:nowrap;line-height:20px;vertical-align:middle">View ↗</span>';

function wrapClickable(content: string): string {
  return (
    '<span style="display:flex;align-items:center;flex:1;min-width:0;overflow:hidden;white-space:nowrap;height:100%">' +
    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    content +
    '</span>' +
    EXPAND_BADGE +
    '</span>'
  );
}

function statusClass(value: string): string {
  const v = (value || '').toLowerCase();
  if (v === 'open') return 'status-open';
  if (v.includes('progress') || v.includes('running')) return 'status-in-progress';
  if (v === 'closed' || v === 'completed') return 'status-closed';
  return 'status-default';
}

export function formatCell(value: any, field: string): string {
  if (value === null || value === undefined) return '<span style="color:#9e9e9e">—</span>';

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span style="color:#9e9e9e">—</span>';
    const names = value
      .map((item: any) => item?.name ?? item?.label ?? item?.title ?? null)
      .filter(Boolean);
    if (names.length > 0) {
      const MAX = 3;
      const shown = names.slice(0, MAX).join(', ');
      const more =
        names.length > MAX
          ? `<span style="color:#9e9e9e;font-size:11px"> +${names.length - MAX} more</span>`
          : '';
      return wrapClickable(`<span style="font-size:12px">${shown}${more}</span>`);
    }
    return wrapClickable(
      `<span style="font-size:12px;color:#555">${value.length} item${value.length !== 1 ? 's' : ''}</span>`,
    );
  }

  if (typeof value === 'object' && 'processed' in value && 'total' in value) {
    const { processed, total, failed } = value;
    const failPart =
      failed > 0 ? ` <span style="color:#c62828;font-size:11px">(${failed} failed)</span>` : '';
    return `<span style="font-weight:600">${processed} / ${total}</span>${failPart}`;
  }

  if (typeof value === 'object') {
    const pairs = Object.entries(value)
      .filter(([, v]) => typeof v !== 'object')
      .slice(0, 3)
      .map(([k, v]) => `<span style="color:#9e9e9e;font-size:10px">${k}:</span> ${v}`)
      .join('  ');
    return wrapClickable(pairs || `<span style="font-size:11px;color:#555">[object]</span>`);
  }

  if (
    field.toLowerCase().includes('date') ||
    field.toLowerCase().includes('time') ||
    field.toLowerCase().includes('at')
  ) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }

  if (field === 'status') {
    return `<span class="chip ${statusClass(value)}">${value}</span>`;
  }

  if (field === 'columnType') {
    const cls =
      value === 'status' ? 'chip-blue' : value === 'priority' ? 'chip-amber' : 'chip-purple';
    return `<span class="chip ${cls}">${value}</span>`;
  }

  return String(value);
}

// ── Column definitions ──────────────────────────────────────────────────────

export function buildColDefs(fields: string[]): ColDef[] {
  return fields
    .filter((f) => !HIDDEN_FIELDS.has(f))
    .map((field) => {
      const def: ColDef = {
        field,
        headerName: formatHeader(field),
        cellRenderer: (params: any) => formatCell(params.value, field),
      };

      if (field === '_id') { def.maxWidth = 130; def.pinned = 'left'; }
      if (field === 'columnType') { def.maxWidth = 120; }
      if (field === 'newValue' || field === 'oldValue') { def.minWidth = 130; def.maxWidth = 200; }
      if (field === 'authoredBy') { def.minWidth = 130; def.maxWidth = 200; }
      if (field === 'status') { def.maxWidth = 130; }
      if (field === 'fields' || field === 'views') { def.minWidth = 200; def.maxWidth = 320; }
      if (field === 'progress') { def.maxWidth = 130; }
      if (field.toLowerCase().includes('id') && field !== '_id') { def.maxWidth = 180; }

      def.cellStyle = (params: any) => {
        const v = params.value;
        const isClickable =
          v !== null && v !== undefined && (typeof v === 'object' || Array.isArray(v));
        return {
          cursor: isClickable ? 'pointer' : 'default',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: isClickable ? 'clip' : 'ellipsis',
        };
      };

      return def;
    });
}
