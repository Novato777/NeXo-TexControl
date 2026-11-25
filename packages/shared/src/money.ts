// El dinero SIEMPRE se maneja en pesos colombianos enteros (sin decimales, sin float).

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatCOP(value: number | null | undefined): string {
  const v = Math.round(Number(value ?? 0));
  // Intl usa espacio duro; lo normalizamos para que se lea "$ 120.000"
  return copFormatter.format(v).replace(/ /g, ' ');
}

/** Convierte lo que el usuario escribe ("120.000", "$ 1.500.000") a entero. */
export function parseCOP(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Math.round(input);
  if (!input) return 0;
  const digits = String(input).replace(/[^\d-]/g, '');
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Formato de número con separador de miles para cantidades. */
export function formatQty(value: number | null | undefined, decimals = 2): string {
  const v = Number(value ?? 0);
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals }).format(v);
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** Margen bruto en % a partir de precio y costo. */
export function marginPct(price: number, cost: number): number {
  if (!price) return 0;
  return Math.round(((price - cost) / price) * 100);
}

/** Suma segura de enteros (evita arrastrar decimales). */
export function sumInt(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + Math.round(Number(v ?? 0)), 0);
}
