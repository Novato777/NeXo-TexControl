// Reglas de inventario:
// - Toda variación de stock pasa por moveStock (deja movimiento con motivo, usuario, referencia y saldo).
// - No se permite stock negativo.
// - Disponible = stock físico - reservado. Las reservas son por pedido y no mueven stock físico.
import { and, eq, sql } from 'drizzle-orm';
import { formatQty, type MovementType } from '@nexo/shared';
import type { Executor } from '../db/client';
import { inventoryMovements, products, stockReservations, variants } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';

export function variantName(p: { name: string }, v: { size: string | null; color: string | null }) {
  const extra = [v.size && `Talla ${v.size}`, v.color].filter(Boolean).join(' · ');
  return extra ? `${p.name} (${extra})` : p.name;
}

export async function getVariant(tx: Executor, variantId: number, lock = false) {
  const q = tx
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(variants.id, variantId));
  const [row] = lock ? await q.for('update', { of: variants }) : await q;
  if (!row) throw notFound('El producto seleccionado');
  return { ...row, label: variantName(row.p, row.v), unit: row.p.unit };
}

export interface MoveParams {
  variantId: number;
  quantity: number; // con signo
  type: MovementType;
  reason: string;
  reference?: string | null;
  refType?: string | null;
  refId?: number | null;
  userId?: number | null;
  unitCost?: number | null;
  at?: string;
  /** Solo para validar contra disponible (stock - reservado) en salidas que no consumen reserva. */
  checkAvailable?: boolean;
}

export async function moveStock(tx: Executor, p: MoveParams) {
  if (!p.quantity) return null;
  const { v, label, unit } = await getVariant(tx, p.variantId, true);
  const newStock = round3(Number(v.stock) + p.quantity);
  if (newStock < 0) {
    throw badRequest(
      `No hay suficiente "${label}". Hay ${formatQty(v.stock)} ${unit}(s) y se necesitan ${formatQty(-p.quantity)}.`,
    );
  }
  if (p.checkAvailable && p.quantity < 0) {
    const available = Number(v.stock) - Number(v.reserved);
    if (available + p.quantity < 0) {
      throw badRequest(
        `"${label}": solo hay ${formatQty(Math.max(available, 0))} disponible(s); el resto está separado para otros pedidos.`,
      );
    }
  }
  await tx.update(variants).set({ stock: newStock }).where(eq(variants.id, v.id));
  const [mov] = await tx
    .insert(inventoryMovements)
    .values({
      variantId: v.id,
      type: p.type,
      quantity: p.quantity,
      stockAfter: newStock,
      unitCost: p.unitCost ?? null,
      reason: p.reason,
      reference: p.reference ?? null,
      refType: p.refType ?? null,
      refId: p.refId ?? null,
      userId: p.userId ?? null,
      ...(p.at ? { createdAt: p.at } : {}),
    })
    .returning();
  return mov;
}

/** Reserva hasta `quantity` del disponible. Devuelve lo que realmente se reservó. */
export async function reserve(
  tx: Executor,
  p: { orderId: number; orderItemId: number; variantId: number; quantity: number; at?: string },
): Promise<number> {
  const { v } = await getVariant(tx, p.variantId, true);
  const available = Math.max(0, Number(v.stock) - Number(v.reserved));
  const q = Math.min(available, p.quantity);
  if (q <= 0) return 0;
  await tx
    .update(variants)
    .set({ reserved: sql`${variants.reserved} + ${q}` })
    .where(eq(variants.id, v.id));
  await tx.insert(stockReservations).values({
    orderId: p.orderId,
    orderItemId: p.orderItemId,
    variantId: p.variantId,
    quantity: q,
    ...(p.at ? { createdAt: p.at } : {}),
  });
  return q;
}

export async function reservedForItem(tx: Executor, orderItemId: number): Promise<number> {
  const [row] = await tx
    .select({ q: sql<string>`coalesce(sum(${stockReservations.quantity}), 0)` })
    .from(stockReservations)
    .where(and(eq(stockReservations.orderItemId, orderItemId), eq(stockReservations.active, true)));
  return Number(row?.q ?? 0);
}

/**
 * Libera reservas activas de un pedido (o de un ítem), hasta `limit` unidades.
 * Devuelve lo liberado.
 */
export async function releaseReservations(
  tx: Executor,
  p: { orderId: number; orderItemId?: number; limit?: number },
): Promise<number> {
  const rows = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.orderId, p.orderId),
        eq(stockReservations.active, true),
        p.orderItemId ? eq(stockReservations.orderItemId, p.orderItemId) : undefined,
      ),
    );
  let remaining = p.limit ?? Infinity;
  let released = 0;
  for (const r of rows) {
    if (remaining <= 0) break;
    const q = Math.min(Number(r.quantity), remaining);
    await tx
      .update(variants)
      .set({ reserved: sql`greatest(${variants.reserved} - ${q}, 0)` })
      .where(eq(variants.id, r.variantId));
    if (q >= Number(r.quantity)) {
      await tx.update(stockReservations).set({ active: false }).where(eq(stockReservations.id, r.id));
    } else {
      await tx
        .update(stockReservations)
        .set({ quantity: Number(r.quantity) - q })
        .where(eq(stockReservations.id, r.id));
    }
    remaining -= q;
    released += q;
  }
  return released;
}

export function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
