// Caja: cada ingreso o egreso queda como movimiento. El efectivo exige una caja abierta.
import { and, desc, eq, sql } from 'drizzle-orm';
import { formatCOP, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@nexo/shared';
import type { Executor } from '../db/client';
import { cashMovements, cashSessions } from '../db/schema';
import { badRequest } from '../lib/errors';

export async function getOpenSession(tx: Executor) {
  const [s] = await tx
    .select()
    .from(cashSessions)
    .where(eq(cashSessions.status, 'abierta'))
    .orderBy(desc(cashSessions.id))
    .limit(1);
  return s ?? null;
}

export interface CashMoveParams {
  type: 'ingreso' | 'egreso';
  category: string;
  concept: string;
  amount: number;
  method: PaymentMethod | string;
  reference?: string | null;
  refType?: string | null;
  refId?: number | null;
  reversalOf?: number | null;
  userId?: number | null;
  at?: string;
  /** Para datos históricos importados: forzar sesión (o null = sin caja). */
  sessionId?: number | null;
}

export async function addCashMovement(tx: Executor, p: CashMoveParams) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw badRequest('El valor debe ser mayor que cero.');
  let sessionId: number | null;
  if (p.sessionId !== undefined) {
    sessionId = p.sessionId;
  } else {
    const open = await getOpenSession(tx);
    if (!open && p.method === 'efectivo') {
      throw badRequest('La caja está cerrada. Ábrela en "Caja" antes de recibir o entregar efectivo.');
    }
    sessionId = open?.id ?? null;
  }
  if (p.type === 'egreso' && p.method === 'efectivo' && sessionId) {
    const expected = await expectedCash(tx, sessionId);
    if (expected - p.amount < 0) {
      throw badRequest(
        `No hay suficiente efectivo en caja. Hay ${formatCOP(expected)} y se quieren sacar ${formatCOP(p.amount)}. ` +
          `Usa otro método de pago (${PAYMENT_METHOD_LABELS.transferencia.toLowerCase()}) o registra primero un ingreso.`,
      );
    }
  }
  const [mov] = await tx
    .insert(cashMovements)
    .values({
      sessionId,
      type: p.type,
      category: p.category,
      concept: p.concept,
      amount: p.amount,
      method: p.method,
      reference: p.reference ?? null,
      refType: p.refType ?? null,
      refId: p.refId ?? null,
      reversalOf: p.reversalOf ?? null,
      userId: p.userId ?? null,
      ...(p.at ? { createdAt: p.at } : {}),
    })
    .returning();
  return mov;
}

/** Resumen de una sesión: ingresos/egresos por método y efectivo esperado. */
export async function sessionSummary(tx: Executor, sessionId: number) {
  const rows = await tx
    .select({
      type: cashMovements.type,
      method: cashMovements.method,
      total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, sessionId))
    .groupBy(cashMovements.type, cashMovements.method);
  const [session] = await tx.select().from(cashSessions).where(eq(cashSessions.id, sessionId));
  let income = 0;
  let expense = 0;
  let cashIn = 0;
  let cashOut = 0;
  const byMethod: Record<string, { ingreso: number; egreso: number }> = {};
  for (const r of rows) {
    const t = Number(r.total);
    byMethod[r.method] ??= { ingreso: 0, egreso: 0 };
    byMethod[r.method][r.type as 'ingreso' | 'egreso'] += t;
    if (r.type === 'ingreso') income += t;
    else expense += t;
    if (r.method === 'efectivo') {
      if (r.type === 'ingreso') cashIn += t;
      else cashOut += t;
    }
  }
  const opening = session?.openingAmount ?? 0;
  return { income, expense, cashIn, cashOut, opening, expectedCash: opening + cashIn - cashOut, byMethod };
}

export async function expectedCash(tx: Executor, sessionId: number) {
  return (await sessionSummary(tx, sessionId)).expectedCash;
}

export async function hasOpenSession(tx: Executor) {
  const [r] = await tx
    .select({ n: sql<string>`count(*)` })
    .from(cashSessions)
    .where(and(eq(cashSessions.status, 'abierta')));
  return Number(r.n) > 0;
}
