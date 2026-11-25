import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { counters } from '../db/schema';

/** Devuelve el siguiente consecutivo legible (PED-0001). Se ejecuta dentro de la transacción. */
export async function nextNumber(tx: Executor, key: string, prefix: string, pad = 4): Promise<string> {
  const [row] = await tx
    .insert(counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${prefix}-${String(row.value).padStart(pad, '0')}`;
}
