// Utilidades de fecha. Zona horaria del negocio: America/Bogota (UTC-5, sin horario de verano).
import type { ReceivableStatus } from './constants';

export const BUSINESS_TZ = 'America/Bogota';

/** Fecha YYYY-MM-DD en la zona del negocio. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function toISODate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  // en-CA produce formato YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Diferencia en días (b - a) entre fechas YYYY-MM-DD. */
export function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const date = s.length === 10 ? new Date(s + 'T12:00:00-05:00') : new Date(s);
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BUSINESS_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BUSINESS_TZ,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Texto amable: "hoy", "mañana", "hace 3 días", "en 5 días". */
export function relativeDay(iso: string | null | undefined, today = todayISO()): string {
  if (!iso) return '—';
  const n = diffDays(today, iso.slice(0, 10));
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  if (n > 1) return `en ${n} días`;
  return `hace ${-n} días`;
}

/** Clasificación de una cuenta por cobrar o pagar según vencimiento y saldo. */
export function receivableStatus(balance: number, dueDate: string | null, today = todayISO()): ReceivableStatus {
  if (balance <= 0) return 'pagado';
  if (!dueDate) return 'vigente';
  const days = diffDays(today, dueDate);
  if (days < 0) return 'vencido';
  if (days <= 7) return 'por_vencer';
  return 'vigente';
}

export type PeriodPreset = 'hoy' | '7d' | 'mes' | '30d' | '90d' | 'anio' | 'custom';

export function presetRange(preset: PeriodPreset, today = todayISO()): { from: string; to: string } {
  switch (preset) {
    case 'hoy':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'mes':
      return { from: today.slice(0, 8) + '01', to: today };
    case 'anio':
      return { from: today.slice(0, 5) + '01-01', to: today };
    default:
      return { from: addDays(today, -29), to: today };
  }
}
