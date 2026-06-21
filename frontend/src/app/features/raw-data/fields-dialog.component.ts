import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface FieldsDialogData {
  title: string;
  value: any;
}

/** Flatten any value into a list of { key, value } display rows */
function toRows(value: any): Array<{ key: string; display: string; isObject: boolean }> {
  if (Array.isArray(value)) {
    return value.map((item, i) => ({
      key: String(i + 1),
      display: typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '—'),
      isObject: typeof item === 'object' && item !== null,
    }));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([k, v]) => ({
      key: k,
      display: v === null || v === undefined
        ? '—'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v),
      isObject: typeof v === 'object' && v !== null,
    }));
  }

  return [{ key: 'Value', display: String(value ?? '—'), isObject: false }];
}

/** If value is array of objects, split into one section per item */
function toSections(value: any): Array<{ heading: string; rows: ReturnType<typeof toRows> }> {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
    return value.map((item, i) => ({
      heading: item?.name ?? item?.title ?? item?.label ?? `Item ${i + 1}`,
      rows: toRows(item),
    }));
  }
  return [{ heading: '', rows: toRows(value) }];
}

@Component({
  selector: 'app-fields-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, MatButtonModule],
  template: `
    <div class="dlg-header">
      <span class="dlg-title">{{ data.title }}</span>
      <button class="dlg-close" (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <div class="dlg-body">
      @for (section of sections; track $index) {
        @if (section.heading) {
          <div class="section-heading">{{ section.heading }}</div>
        }
        <table class="kv-table">
          <tbody>
            @for (row of section.rows; track $index) {
              <tr>
                <td class="kv-key">{{ row.key }}</td>
                <td class="kv-val" [class.kv-val--json]="row.isObject">{{ row.display }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .dlg-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--clr-border);
    }
    .dlg-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--clr-text);
      text-transform: capitalize;
    }
    .dlg-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--clr-text-muted);
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 4px;
      &:hover { background: var(--clr-border-light); }
    }

    .dlg-body {
      padding: 16px 20px;
      max-height: 60vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .section-heading {
      font-size: 12px;
      font-weight: 700;
      color: var(--clr-primary-dark);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--clr-primary-light);
    }

    .kv-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .kv-table tr {
      border-bottom: 1px solid var(--clr-border-light);
      &:last-child { border-bottom: none; }
      &:hover td { background: var(--clr-primary-subtle); }
    }
    .kv-key {
      padding: 8px 12px 8px 0;
      color: var(--clr-text-muted);
      font-weight: 500;
      white-space: nowrap;
      width: 35%;
      vertical-align: top;
    }
    .kv-val {
      padding: 8px 0;
      color: var(--clr-text);
      word-break: break-word;
    }
    .kv-val--json {
      font-family: monospace;
      font-size: 11px;
      color: var(--clr-text-muted);
      background: var(--clr-surface-alt);
      padding: 4px 8px;
      border-radius: 4px;
    }
  `],
})
export class FieldsDialogComponent {
  readonly sections: ReturnType<typeof toSections>;

  constructor(
    public dialogRef: MatDialogRef<FieldsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FieldsDialogData,
  ) {
    this.sections = toSections(data.value);
  }

  close(): void {
    this.dialogRef.close();
  }
}
