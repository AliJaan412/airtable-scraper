import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'localDate', standalone: true })
export class LocalDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined, format: 'date' | 'datetime' | 'time' = 'datetime'): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);

    const opts: Intl.DateTimeFormatOptions = format === 'date'
      ? { year: 'numeric', month: 'short', day: '2-digit' }
      : format === 'time'
      ? { hour: '2-digit', minute: '2-digit', hour12: true }
      : { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true };

    return d.toLocaleString('en-AU', opts);
  }
}
