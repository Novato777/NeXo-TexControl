// Compras a proveedores y cuentas por pagar.
import { eq, sql } from 'drizzle-orm';
import { addDays, formatCOP, formatQty, todayISO, type PaymentMethod, type PurchaseCreateInput } from '@nexo/shared';
import type { Executor } from '../db/client';
import { payablePayments, payables, products, purchaseItems, purchases, suppliers, variants } from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthUser } from '../lib/auth';
import { nextNumber } from '../lib/counters';
import { badRequest, notFound } from '../lib/errors';
import { addCashMovement } from './cash';
import { getVariant, moveStock, round3 } from './inventory';
import { assertMoneyRange } from './orders';

type Opts = { at?: string; sessionId?: number | null };

export async function createPayable(
  tx: Executor,
  input: {
    supplierId?: number | null;
    purchaseId?: number | null;
    category: string;
    concept: string;
    amount: number;
    dueDate: string;
    issueDate?: string;
    notes?: string | null;
  },
  user: AuthUser,
  opts: Opts = {},
) {
  const number = await nextNumber(tx, 'cxp', 'CXP');
  const [p] = await tx
    .insert(payables)
    .values({
      number,
      supplierId: input.supplierId ?? null,
      purchaseId: input.purchaseId ?? null,
      category: input.category,
      concept: input.concept,
      amount: input.amount,
      issueDate: input.issueDate ?? todayISO(),
      dueDate: input.dueDate,
      notes: input.notes ?? null,
      createdBy: user.id,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  return p;
}

export async function payPayable(
  tx: Executor,
  payableId: number,
  input: { amount: number; method: PaymentMethod; reference?: string | null },
  user: AuthUser,
  opts: Opts = {},
) {
  const [p] = await tx.select().from(payables).where(eq(payables.id, payableId)).for('update');
  if (!p) throw notFound('La cuenta por pagar');
  if (p.cancelled) throw badRequest('Esta cuenta fue anulada.');
  const balance = p.amount - p.paid;
  if (balance <= 0) throw badRequest('Esta cuenta ya está pagada.');
  if (input.amount > balance) {
    throw badRequest(`El pago (${formatCOP(input.amount)}) supera el saldo (${formatCOP(balance)}).`, { amount: `Máximo ${formatCOP(balance)}` });
  }
  let supplierName = '';
  if (p.supplierId) {
    const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, p.supplierId));
    supplierName = s ? ` a ${s.name}` : '';
  }
  const mov = await addCashMovement(tx, {
    type: 'egreso',
    category: p.category,
    concept: `Pago${supplierName}: ${p.concept}`,
    amount: input.amount,
    method: input.method,
    reference: p.number,
    refType: 'cuenta_por_pagar',
    refId: p.id,
    userId: user.id,
    at: opts.at,
    sessionId: opts.sessionId,
  });
  await tx.insert(payablePayments).values({
    payableId: p.id,
    amount: input.amount,
    method: input.method,
    reference: input.reference ?? null,
    cashMovementId: mov.id,
    userId: user.id,
    ...(opts.at ? { createdAt: opts.at } : {}),
  });
  await tx
    .update(payables)
    .set({ paid: sql`${payables.paid} + ${input.amount}` })
    .where(eq(payables.id, p.id));
}

export async function createPurchase(tx: Executor, input: PurchaseCreateInput, user: AuthUser, opts: Opts = {}) {
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) throw badRequest('Selecciona un proveedor válido.');
  const lines = [];
  for (const it of input.items) {
    const { label, p } = await getVariant(tx, it.variantId);
    if (p.type === 'servicio') throw badRequest(`"${label}" es un servicio y no se recibe en bodega.`);
    lines.push({ variantId: it.variantId, description: label, quantity: it.quantity, unitCost: it.unitCost });
  }
  const subtotal = Math.round(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
  assertMoneyRange(subtotal);
  if (input.discount > subtotal) throw badRequest('El descuento no puede superar el valor de la compra.');
  const total = subtotal - input.discount;
  if (input.payNow && input.payNow.amount > total) throw badRequest('El pago no puede superar el total de la compra.');
  const number = await nextNumber(tx, 'compra', 'OC');
  const dueDate = input.dueDate ?? addDays(input.date, supplier.paymentTermDays || 0);
  const [purchase] = await tx
    .insert(purchases)
    .values({
      number,
      supplierId: supplier.id,
      status: 'pedida',
      date: input.date,
      dueDate,
      subtotal,
      discount: input.discount,
      total,
      notes: input.notes,
      createdBy: user.id,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  await tx.insert(purchaseItems).values(lines.map((l) => ({ ...l, purchaseId: purchase.id })));
  const payable = await createPayable(
    tx,
    {
      supplierId: supplier.id,
      purchaseId: purchase.id,
      category: 'Compra de materiales',
      concept: `Compra ${number}`,
      amount: total,
      dueDate,
      issueDate: input.date,
    },
    user,
    opts,
  );
  if (input.payNow) await payPayable(tx, payable.id, input.payNow, user, opts);
  await audit(tx, user, {
    at: opts.at,
    action: 'compra_creada',
    entity: 'compra',
    entityId: purchase.id,
    reference: number,
    summary: `Compra ${number} a ${supplier.name} por ${formatCOP(total)}`,
  });
  return purchase;
}

export async function receivePurchase(
  tx: Executor,
  purchaseId: number,
  input: { lines: { itemId: number; quantity: number }[]; note?: string | null; closeShort?: boolean },
  user: AuthUser,
  opts: Opts = {},
) {
  const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for('update');
  if (!purchase) throw notFound('La compra');
  if (purchase.status === 'recibida' || purchase.status === 'cancelada') throw badRequest('Esta compra ya está cerrada.');
  const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, purchaseId));
  const parts: string[] = [];
  for (const l of input.lines) {
    if (l.quantity <= 0) continue;
    const it = items.find((i) => i.id === l.itemId);
    if (!it) throw badRequest('Ese material no pertenece a la compra.');
    const pending = round3(Number(it.quantity) - Number(it.qtyReceived));
    if (l.quantity > pending + 0.0001) throw badRequest(`De "${it.description}" solo faltan ${formatQty(pending)} por recibir.`);
    await moveStock(tx, {
      variantId: it.variantId,
      quantity: l.quantity,
      type: 'entrada_compra',
      reason: `Recepción de la compra ${purchase.number}`,
      reference: purchase.number,
      refType: 'compra',
      refId: purchase.id,
      unitCost: it.unitCost,
      userId: user.id,
      at: opts.at,
    });
    await tx
      .update(purchaseItems)
      .set({ qtyReceived: round3(Number(it.qtyReceived) + l.quantity) })
      .where(eq(purchaseItems.id, it.id));
    it.qtyReceived = round3(Number(it.qtyReceived) + l.quantity);
    // Último costo de compra queda como costo de referencia del material.
    const [v] = await tx.select().from(variants).where(eq(variants.id, it.variantId));
    await tx.update(products).set({ cost: it.unitCost }).where(eq(products.id, v.productId));
    parts.push(`${formatQty(l.quantity)} de ${it.description}`);
  }
  if (!parts.length) throw badRequest('Escribe cuánto llegó de al menos un material.');
  const complete = items.every((i) => Number(i.qtyReceived) >= Number(i.quantity) - 0.0001);
  const status = complete || input.closeShort ? 'recibida' : 'recibida_parcial';
  await tx
    .update(purchases)
    .set({ status, receivedAt: opts.at ?? new Date().toISOString() })
    .where(eq(purchases.id, purchaseId));
  const shortNote =
    !complete && input.closeShort
      ? ` Cerrada con faltantes: ${items
          .filter((i) => Number(i.qtyReceived) < Number(i.quantity))
          .map((i) => `${formatQty(Number(i.quantity) - Number(i.qtyReceived))} de ${i.description}`)
          .join(', ')}.`
      : '';
  await audit(tx, user, {
    at: opts.at,
    action: 'compra_recibida',
    entity: 'compra',
    entityId: purchaseId,
    reference: purchase.number,
    summary: `Recepción ${complete ? 'completa' : 'parcial'} de ${purchase.number}: ${parts.join('; ')}.${shortNote}${input.note ? ` Nota: ${input.note}` : ''}`,
  });
  return { status };
}
