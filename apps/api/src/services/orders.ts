// Pedidos, ventas rápidas, pagos de clientes y entregas.
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  addDays,
  can,
  LIMITS,
  canTransition,
  formatCOP,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  todayISO,
  type Customization,
  type OrderCreateInput,
  type OrderStatus,
  type PaymentMethod,
  type QuickSaleInput,
} from '@nexo/shared';
import type { Executor } from '../db/client';
import {
  customers,
  deliveries,
  orderEvents,
  orderItems,
  orders,
  payments,
  productionOrders,
  stockReservations,
} from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthUser } from '../lib/auth';
import { nextNumber } from '../lib/counters';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addCashMovement } from './cash';
import { getVariant, moveStock, releaseReservations, reserve, reservedForItem } from './inventory';

type Opts = { at?: string; sessionId?: number | null };

/** Un ítem personalizado (logo, bordado, nombres) siempre se fabrica: no toma stock existente. */
export function needsProduction(c: Customization | null | undefined | unknown): boolean {
  const x = (c ?? {}) as NonNullable<Customization>;
  return Boolean(x.logo || (x.technique && x.technique !== 'ninguna') || x.names);
}

export async function addOrderEvent(
  tx: Executor,
  orderId: number,
  type: string,
  summary: string,
  userId: number | null,
  at?: string,
) {
  await tx.insert(orderEvents).values({ orderId, type, summary, userId, ...(at ? { createdAt: at } : {}) });
}

export async function getOrder(tx: Executor, id: number, lock = false) {
  const q = tx.select().from(orders).where(eq(orders.id, id));
  const [o] = lock ? await q.for('update') : await q;
  if (!o) throw notFound('El pedido');
  return o;
}

/** Evita totales que no caben en la base de datos (y que nunca serían reales). */
export function assertMoneyRange(value: number) {
  if (!Number.isSafeInteger(value) || value > LIMITS.money) {
    throw badRequest(`El valor total (${formatCOP(value)}) supera el máximo permitido por venta o pedido. Divide la operación en varias.`);
  }
}

function checkDiscount(user: AuthUser, discount: number, subtotal: number) {
  if (discount > subtotal) throw badRequest('El descuento no puede ser mayor que el valor del pedido.');
  if (discount > 0 && !can(user.role, 'pedido.descuento') && discount > subtotal * 0.1) {
    throw forbidden('Tu usuario puede aplicar hasta 10% de descuento. Para más, pide autorización al administrador.');
  }
}

// ---------------------------------------------------------------- Crear pedido
export async function createOrder(tx: Executor, input: OrderCreateInput, user: AuthUser, opts: Opts & { orderDate?: string } = {}) {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
  if (!customer) throw badRequest('Selecciona un cliente válido.');
  const orderDate = opts.orderDate ?? todayISO();
  if (!opts.orderDate && input.promisedDate < orderDate) {
    throw badRequest('La fecha de entrega no puede ser anterior a hoy.', { promisedDate: 'Elige hoy o una fecha futura.' });
  }

  const lines = [];
  for (const it of input.items) {
    const { v, p, label } = await getVariant(tx, it.variantId);
    if (!p.active) throw badRequest(`"${label}" está archivado y no se puede vender.`);
    lines.push({
      variantId: v.id,
      description: label,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      unitCost: v.cost ?? p.cost,
      lineTotal: it.quantity * it.unitPrice,
      customization: it.customization ?? null,
      listPrice: v.price ?? p.price,
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  assertMoneyRange(subtotal);
  checkDiscount(user, input.discount, subtotal);
  const total = subtotal - input.discount;
  if (input.advance && input.advance.amount > total) {
    throw badRequest(`El anticipo (${formatCOP(input.advance.amount)}) no puede ser mayor que el total (${formatCOP(total)}).`);
  }

  const number = await nextNumber(tx, 'pedido', 'PED');
  const [order] = await tx
    .insert(orders)
    .values({
      number,
      kind: 'pedido',
      customerId: customer.id,
      status: input.status,
      priority: input.priority,
      orderDate,
      promisedDate: input.promisedDate,
      dueDate: input.dueDate ?? input.promisedDate,
      deliveryMethod: input.deliveryMethod,
      deliveryAddress: input.deliveryAddress ?? customer.address,
      notes: input.notes,
      subtotal,
      discount: input.discount,
      total,
      paid: 0,
      createdBy: user.id,
      confirmedAt: input.status === 'confirmado' ? (opts.at ?? new Date().toISOString()) : null,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();

  const insertedItems = await tx
    .insert(orderItems)
    .values(lines.map(({ listPrice: _lp, ...l }) => ({ ...l, orderId: order.id })))
    .returning();

  for (const l of lines) {
    if (l.unitPrice !== l.listPrice) {
      await audit(tx, user, {
    at: opts.at,
        action: 'precio_modificado',
        entity: 'pedido',
        entityId: order.id,
        reference: number,
        summary: `Precio de "${l.description}" cambiado de ${formatCOP(l.listPrice)} a ${formatCOP(l.unitPrice)}`,
        sensitive: true,
      });
    }
  }

  await addOrderEvent(tx, order.id, 'estado', `Pedido creado como "${ORDER_STATUS_LABELS[input.status]}"`, user.id, opts.at);
  if (input.status === 'confirmado') await reserveOrder(tx, order.id, insertedItems, opts.at);
  if (input.advance) {
    await registerPayment(
      tx,
      { orderId: order.id, amount: input.advance.amount, method: input.advance.method, reference: input.advance.reference, notes: 'Anticipo' },
      user,
      opts,
    );
  }
  await audit(tx, user, {
    at: opts.at,
    action: 'pedido_creado',
    entity: 'pedido',
    entityId: order.id,
    reference: number,
    summary: `Pedido ${number} para ${customer.name} por ${formatCOP(total)}`,
  });
  return getOrder(tx, order.id);
}

async function reserveOrder(tx: Executor, orderId: number, items: (typeof orderItems.$inferSelect)[], at?: string) {
  for (const it of items) {
    if (needsProduction(it.customization)) continue;
    const pending = it.quantity - it.qtyDelivered - (await reservedForItem(tx, it.id));
    if (pending > 0) await reserve(tx, { orderId, orderItemId: it.id, variantId: it.variantId, quantity: pending, at });
  }
}

/** Unidades que faltan (no separadas en bodega) por cada ítem. */
export async function orderShortages(tx: Executor, orderId: number) {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const out = [];
  for (const it of items) {
    const reserved = await reservedForItem(tx, it.id);
    const missing = Math.max(0, it.quantity - it.qtyDelivered - reserved);
    out.push({ item: it, reserved, missing, custom: needsProduction(it.customization) });
  }
  return out;
}

// ---------------------------------------------------------------- Cambiar estado
export async function changeOrderStatus(
  tx: Executor,
  orderId: number,
  to: OrderStatus,
  user: AuthUser,
  opts: Opts & { reason?: string | null; refundPayments?: boolean } = {},
) {
  const order = await getOrder(tx, orderId, true);
  const from = order.status as OrderStatus;
  if (to === 'entregado') throw badRequest('Para marcar como entregado usa el botón "Registrar entrega".');
  if (from === to) return order;
  if (!canTransition(from, to)) {
    throw badRequest(`Un pedido "${ORDER_STATUS_LABELS[from]}" no puede pasar a "${ORDER_STATUS_LABELS[to]}".`);
  }
  const patch: Partial<typeof orders.$inferInsert> = { status: to };

  if (to === 'cancelado') {
    if (!can(user.role, 'pedido.cancelar')) throw forbidden();
    if (!opts.reason) throw badRequest('Escribe el motivo de la cancelación.', { reason: 'El motivo es obligatorio.' });
    patch.cancelReason = opts.reason;
    await releaseReservations(tx, { orderId });
    await tx
      .update(productionOrders)
      .set({ status: 'cancelada' })
      .where(and(eq(productionOrders.orderId, orderId), inArray(productionOrders.status, ['pendiente', 'en_proceso'])));
    if (opts.refundPayments) {
      const pays = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.reversed, false), sql`${payments.amount} > 0`));
      for (const p of pays) await reversePayment(tx, p.id, `Cancelación del pedido: ${opts.reason}`, user, opts);
    }
    await audit(tx, user, {
    at: opts.at,
      action: 'pedido_cancelado',
      entity: 'pedido',
      entityId: orderId,
      reference: order.number,
      summary: `Pedido ${order.number} cancelado. Motivo: ${opts.reason}`,
      sensitive: true,
    });
  }

  if (to === 'confirmado') {
    patch.confirmedAt = opts.at ?? new Date().toISOString();
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await reserveOrder(tx, orderId, items, opts.at);
  }

  if (to === 'listo') {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await reserveOrder(tx, orderId, items.filter((i) => !needsProduction(i.customization)), opts.at);
    const short = (await orderShortages(tx, orderId)).filter((s) => s.missing > 0);
    if (short.length) {
      const list = short.map((s) => `${s.missing} × ${s.item.description}`).join(', ');
      throw badRequest(`Todavía faltan unidades por fabricar o recibir: ${list}. Termina la producción primero.`);
    }
    patch.readyAt = opts.at ?? new Date().toISOString();
  }

  if ((to === 'borrador' || to === 'pendiente') && from === 'confirmado') {
    await releaseReservations(tx, { orderId });
  }

  await tx.update(orders).set(patch).where(eq(orders.id, orderId));
  await addOrderEvent(
    tx,
    orderId,
    'estado',
    `Estado cambiado de "${ORDER_STATUS_LABELS[from]}" a "${ORDER_STATUS_LABELS[to]}"${opts.reason ? ` — ${opts.reason}` : ''}`,
    user.id,
    opts.at,
  );
  return getOrder(tx, orderId);
}

// ---------------------------------------------------------------- Pagos
export async function registerPayment(
  tx: Executor,
  p: {
    orderId?: number | null;
    customerId?: number | null;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
    notes?: string | null;
  },
  user: AuthUser,
  opts: Opts & { category?: string } = {},
) {
  let order: typeof orders.$inferSelect | null = null;
  if (p.orderId) {
    order = await getOrder(tx, p.orderId, true);
    if (order.status === 'cancelado') throw badRequest('No se pueden registrar pagos en un pedido cancelado.');
    const balance = order.total - order.paid;
    if (p.amount > balance) {
      throw badRequest(`El pago (${formatCOP(p.amount)}) es mayor que el saldo pendiente (${formatCOP(balance)}).`, {
        amount: `Máximo ${formatCOP(balance)}`,
      });
    }
    if (!opts.at) {
      // Protección contra doble clic / doble registro.
      const since = new Date(Date.now() - 20_000).toISOString();
      const [dup] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(eq(payments.orderId, order.id), eq(payments.amount, p.amount), eq(payments.method, p.method), gte(payments.createdAt, since)),
        )
        .limit(1);
      if (dup) throw conflict('Este mismo pago se registró hace unos segundos. Revisa el historial antes de repetirlo.');
    }
  }
  const number = await nextNumber(tx, 'recibo', 'REC');
  const kindLabel = order?.kind === 'venta' ? 'Venta' : 'Abono de cliente';
  const mov = await addCashMovement(tx, {
    type: 'ingreso',
    category: opts.category ?? kindLabel,
    concept: order ? `${p.notes ?? 'Pago'} ${order.number}` : (p.notes ?? 'Ingreso de cliente'),
    amount: p.amount,
    method: p.method,
    reference: number,
    refType: 'pago',
    userId: user.id,
    at: opts.at,
    sessionId: opts.sessionId,
  });
  const [pay] = await tx
    .insert(payments)
    .values({
      number,
      orderId: order?.id ?? null,
      customerId: order?.customerId ?? p.customerId ?? null,
      amount: p.amount,
      method: p.method,
      reference: p.reference ?? null,
      notes: p.notes ?? null,
      cashMovementId: mov.id,
      userId: user.id,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  if (order) {
    await tx
      .update(orders)
      .set({ paid: sql`${orders.paid} + ${p.amount}` })
      .where(eq(orders.id, order.id));
    await addOrderEvent(
      tx,
      order.id,
      'pago',
      `${p.notes ?? 'Pago'} de ${formatCOP(p.amount)} en ${PAYMENT_METHOD_LABELS[p.method].toLowerCase()} (recibo ${number})`,
      user.id,
      opts.at,
    );
  }
  return pay;
}

export async function reversePayment(tx: Executor, paymentId: number, reason: string, user: AuthUser, opts: Opts = {}) {
  const [pay] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
  if (!pay) throw notFound('El pago');
  if (pay.reversed || pay.amount < 0) throw badRequest('Este pago ya fue reversado.');
  const number = await nextNumber(tx, 'recibo', 'REC');
  const mov = await addCashMovement(tx, {
    type: 'egreso',
    category: 'Reverso de pago',
    concept: `Reverso del recibo ${pay.number}: ${reason}`,
    amount: pay.amount,
    method: pay.method,
    reference: number,
    refType: 'pago',
    reversalOf: pay.cashMovementId,
    userId: user.id,
    at: opts.at,
  });
  await tx.insert(payments).values({
    number,
    orderId: pay.orderId,
    customerId: pay.customerId,
    amount: -pay.amount,
    method: pay.method,
    notes: `Reverso: ${reason}`,
    reversalOf: pay.id,
    cashMovementId: mov.id,
    userId: user.id,
  });
  await tx.update(payments).set({ reversed: true }).where(eq(payments.id, pay.id));
  if (pay.orderId) {
    await tx
      .update(orders)
      .set({ paid: sql`${orders.paid} - ${pay.amount}` })
      .where(eq(orders.id, pay.orderId));
    await addOrderEvent(tx, pay.orderId, 'pago', `Pago ${pay.number} reversado (${formatCOP(pay.amount)}): ${reason}`, user.id);
  }
  await audit(tx, user, {
    at: opts.at,
    action: 'pago_reversado',
    entity: 'pago',
    entityId: pay.id,
    reference: pay.number,
    summary: `Reverso del recibo ${pay.number} por ${formatCOP(pay.amount)}. Motivo: ${reason}`,
    sensitive: true,
  });
}

// ---------------------------------------------------------------- Venta rápida
export async function quickSale(tx: Executor, input: QuickSaleInput, user: AuthUser, opts: Opts & { saleDate?: string } = {}) {
  const lines = [];
  for (const it of input.items) {
    const { v, p, label } = await getVariant(tx, it.variantId);
    if (p.type !== 'terminado') throw badRequest(`"${label}" no es un producto terminado para la venta.`);
    const available = Number(v.stock) - Number(v.reserved);
    if (it.quantity > available) {
      throw badRequest(`"${label}": solo hay ${Math.max(0, available)} disponible(s) para vender.`);
    }
    lines.push({
      variantId: v.id,
      description: label,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      unitCost: v.cost ?? p.cost,
      lineTotal: it.quantity * it.unitPrice,
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  assertMoneyRange(subtotal);
  checkDiscount(user, input.discount, subtotal);
  const total = subtotal - input.discount;
  const paidNow = input.payments.reduce((a, p) => a + p.amount, 0);
  if (paidNow > total) throw badRequest(`Los pagos (${formatCOP(paidNow)}) superan el total (${formatCOP(total)}).`);
  const balance = total - paidNow;
  let customer: typeof customers.$inferSelect | null = null;
  if (input.customerId) {
    [customer] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
  }
  if (balance > 0 && !customer) {
    throw badRequest('Para dejar saldo pendiente (venta a crédito) selecciona un cliente.', { customerId: 'Selecciona el cliente.' });
  }
  const saleDate = opts.saleDate ?? todayISO();
  const number = await nextNumber(tx, 'venta', 'VEN');
  const at = opts.at ?? new Date().toISOString();
  const [order] = await tx
    .insert(orders)
    .values({
      number,
      kind: 'venta',
      customerId: customer?.id ?? null,
      status: 'entregado',
      orderDate: saleDate,
      promisedDate: saleDate,
      dueDate: balance > 0 ? (input.dueDate ?? addDays(saleDate, customer?.creditDays || 30)) : null,
      notes: input.notes,
      subtotal,
      discount: input.discount,
      total,
      paid: 0,
      createdBy: user.id,
      confirmedAt: at,
      readyAt: at,
      deliveredAt: at,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  const items = await tx
    .insert(orderItems)
    .values(lines.map((l) => ({ ...l, orderId: order.id, qtyDelivered: l.quantity })))
    .returning();
  for (const it of items) {
    await moveStock(tx, {
      variantId: it.variantId,
      quantity: -it.quantity,
      type: 'salida_venta',
      reason: 'Venta en mostrador',
      reference: number,
      refType: 'pedido',
      refId: order.id,
      userId: user.id,
      at: opts.at,
      checkAvailable: true,
    });
  }
  await addOrderEvent(tx, order.id, 'estado', `Venta registrada${customer ? ` a ${customer.name}` : ' (mostrador)'}`, user.id, opts.at);
  for (const p of input.payments) {
    await registerPayment(tx, { orderId: order.id, amount: p.amount, method: p.method, reference: p.reference, notes: 'Pago de venta' }, user, {
      ...opts,
      category: 'Venta',
    });
  }
  return getOrder(tx, order.id);
}

// ---------------------------------------------------------------- Entregas
export async function registerDelivery(
  tx: Executor,
  orderId: number,
  input: { receivedBy: string; deliveredBy?: string | null; notes?: string | null; items: { orderItemId: number; quantity: number }[]; allowBalance: boolean },
  user: AuthUser,
  opts: Opts = {},
) {
  const order = await getOrder(tx, orderId, true);
  if (!['confirmado', 'en_produccion', 'listo'].includes(order.status)) {
    throw badRequest(`Un pedido "${ORDER_STATUS_LABELS[order.status as OrderStatus]}" no se puede entregar.`);
  }
  const lines = input.items.filter((l) => l.quantity > 0);
  if (!lines.length) throw badRequest('Indica cuántas unidades se entregan.');
  const balance = order.total - order.paid;
  if (balance > 0 && !input.allowBalance) {
    throw badRequest(`El pedido tiene saldo pendiente de ${formatCOP(balance)}. Cobra el saldo o autoriza la entrega con saldo.`);
  }
  if (balance > 0 && input.allowBalance && !can(user.role, 'entrega.con_saldo')) {
    throw forbidden('Entregar con saldo pendiente requiere autorización de Caja/Finanzas o del administrador.');
  }
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const number = await nextNumber(tx, 'entrega', 'ENT');
  const delivered: { orderItemId: number; quantity: number; description: string }[] = [];
  for (const l of lines) {
    const it = items.find((i) => i.id === l.orderItemId);
    if (!it) throw badRequest('Uno de los productos no pertenece a este pedido.');
    const pending = it.quantity - it.qtyDelivered;
    if (l.quantity > pending) throw badRequest(`De "${it.description}" solo quedan ${pending} unidades por entregar.`);
    const released = await releaseReservations(tx, { orderId, orderItemId: it.id, limit: l.quantity });
    await moveStock(tx, {
      variantId: it.variantId,
      quantity: -l.quantity,
      type: 'salida_venta',
      reason: `Entrega del pedido ${order.number}`,
      reference: number,
      refType: 'entrega',
      refId: orderId,
      userId: user.id,
      at: opts.at,
      checkAvailable: released < l.quantity,
    });
    await tx
      .update(orderItems)
      .set({ qtyDelivered: it.qtyDelivered + l.quantity })
      .where(eq(orderItems.id, it.id));
    it.qtyDelivered += l.quantity;
    delivered.push({ orderItemId: it.id, quantity: l.quantity, description: it.description });
  }
  const complete = items.every((i) => i.qtyDelivered >= i.quantity);
  const [del] = await tx
    .insert(deliveries)
    .values({
      number,
      orderId,
      receivedBy: input.receivedBy,
      deliveredBy: input.deliveredBy ?? user.name,
      notes: input.notes ?? null,
      partial: !complete,
      balanceAtDelivery: balance,
      items: delivered,
      userId: user.id,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  if (complete) {
    await tx
      .update(orders)
      .set({ status: 'entregado', deliveredAt: opts.at ?? new Date().toISOString() })
      .where(eq(orders.id, orderId));
  }
  await addOrderEvent(
    tx,
    orderId,
    'entrega',
    `${complete ? 'Entrega completa' : 'Entrega parcial'} ${number}: recibió ${input.receivedBy}` +
      (balance > 0 ? ` — saldo pendiente ${formatCOP(balance)}` : ''),
    user.id,
    opts.at,
  );
  if (balance > 0) {
    await audit(tx, user, {
    at: opts.at,
      action: 'entrega_con_saldo',
      entity: 'pedido',
      entityId: orderId,
      reference: order.number,
      summary: `Entrega ${number} autorizada con saldo pendiente de ${formatCOP(balance)}`,
      sensitive: true,
    });
  }
  return del;
}

export async function latestOrders(tx: Executor, limit = 5) {
  return tx.select().from(orders).orderBy(desc(orders.id)).limit(limit);
}

