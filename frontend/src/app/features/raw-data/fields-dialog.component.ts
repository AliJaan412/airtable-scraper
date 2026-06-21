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
  templateUrl: './fields-dialog.component.html',
  styleUrl: './fields-dialog.component.scss',
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
