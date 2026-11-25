import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  formatCOP,
  formatDate,
  orderCreateSchema,
  orderStatusChangeSchema,
  orderUpdateSchema,
  paymentSchema,
  quickSaleSchema,
  receivableStatus,
  reversePaymentSchema,
  deliverySchema,
  seesMoney,
  todayISO,
  type OrderStatus,
} from '@nexo/shared';
import { dateQuery, idQuery, intQuery } from '../lib/security';
import { db } from '../db/client';
import {
  customers,
  deliveries,
  messageTemplates,
  orderEvents,
  orderItems,
  orders,
  payments,
  productionItems,
  productionOrders,
  settings,
  users,
} from '../db/schema';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { badRequest, idParam, notFound, parse } from '../lib/errors';
import {
  addOrderEvent,
  changeOrderStatus,
  createOrder,
  needsProduction,
  orderShortages,
  quickSale,
  registerDelivery,
  registerPayment,
  reversePayment,
} from '../services/orders';
import { getStages, progressOf } from '../services/production';

export const ordersRouter = Router();
ordersRouter.use(requireModule('pedidos', 'entregas', 'caja', 'cartera'));

const ACTIVE: OrderStatus[] = ['pendiente', 'confirmado', 'en_produccion', 'listo'];

function maskMoney<T extends Record<string, unknown>>(role: Parameters<typeof seesMoney>[0], row: T): T {
  if (seesMoney(role)) return row;
  const copy: Record<string, unknown> = { ...row };
  for (const k of ['total', 'paid', 'balance', 'subtotal', 'discount']) if (k in copy) copy[k] = null;
  return copy as T;
}

// ---------------------------------------------------------------- lista
ordersRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const q = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '');
  const kind = String(req.query.kind ?? 'pedido');
  const from = dateQuery(req.query.from, '') || null;
  const to = dateQuery(req.query.to, '') || null;
  const customerId = idQuery(req.query.customerId);
  const view = String(req.query.view ?? ''); // activos | atrasados | hoy | con_saldo
  const sort = String(req.query.sort ?? 'reciente');
  const limit = intQuery(req.query.limit, 50, 1, 200);
  const offset = intQuery(req.query.offset, 0, 0, 1_000_000);
  const today = todayISO();
  const where = and(
    kind === 'todos' ? undefined : eq(orders.kind, kind),
    status ? inArray(orders.status, status.split(',')) : undefined,
    customerId ? eq(orders.customerId, customerId) : undefined,
    from ? gte(orders.orderDate, from) : undefined,
    to ? lte(orders.orderDate, to) : undefined,
    q ? or(ilike(orders.number, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q.replace(/\D/g, '') || q}%`), ilike(customers.document, `%${q}%`)) : undefined,
    view === 'activos' ? inArray(orders.status, ACTIVE) : undefined,
    view === 'atrasados' ? and(inArray(orders.status, ACTIVE), lt(orders.promisedDate, today)) : undefined,
    view === 'hoy' ? and(inArray(orders.status, ACTIVE), eq(orders.promisedDate, today)) : undefined,
    view === 'con_saldo' ? and(notInArray(orders.status, ['borrador', 'cancelado']), sql`${orders.total} > ${orders.paid}`) : undefined,
  );
  const orderBy =
    sort === 'entrega' ? [asc(orders.promisedDate), desc(orders.id)] : sort === 'valor' ? [desc(orders.total)] : [desc(orders.createdAt), desc(orders.id)];
  const rows = await db
    .select({
      o: orders,
      customerName: customers.name,
      customerPhone: customers.phone,
      units: sql<number>`(select coalesce(sum(quantity),0)::int from order_items oi where oi.order_id = ${orders.id})`,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(where);
  res.json({
    total: count.n,
    hasMore: rows.length > limit,
    rows: rows.slice(0, limit).map((r) =>
      maskMoney(user.role, {
        ...r.o,
        customerName: r.customerName ?? 'Venta de mostrador',
        customerPhone: r.customerPhone,
        units: r.units,
        balance: r.o.total - r.o.paid,
        overdue: ACTIVE.includes(r.o.status as OrderStatus) && !!r.o.promisedDate && r.o.promisedDate < today,
      }),
    ),
  });
});

// ---------------------------------------------------------------- tablero (Kanban)
ordersRouter.get('/board', async (req, res) => {
  const user = currentUser(req);
  const today = todayISO();
  const rows = await db
    .select({
      o: orders,
      customerName: customers.name,
      units: sql<number>`(select coalesce(sum(quantity),0)::int from order_items oi where oi.order_id = ${orders.id})`,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.kind, 'pedido'), inArray(orders.status, ['borrador', ...ACTIVE])))
    .orderBy(asc(orders.promisedDate));
  res.json(
    rows.map((r) =>
      maskMoney(user.role, {
        ...r.o,
        customerName: r.customerName,
        units: r.units,
        balance: r.o.total - r.o.paid,
        overdue: ACTIVE.includes(r.o.status as OrderStatus) && !!r.o.promisedDate && r.o.promisedDate < today,
      }),
    ),
  );
});

// ---------------------------------------------------------------- recibo de pago
ordersRouter.get('/payments/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [row] = await db
    .select({ p: payments, orderNumber: orders.number, orderTotal: orders.total, orderPaid: orders.paid, customerName: customers.name, customerDoc: customers.document, userName: users.name })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, payments.userId))
    .where(eq(payments.id, id));
  if (!row) throw notFound('El pago');
  res.json({ ...row.p, orderNumber: row.orderNumber, orderBalance: row.orderTotal != null ? row.orderTotal - (row.orderPaid ?? 0) : null, customerName: row.customerName ?? 'Cliente de mostrador', customerDoc: row.customerDoc, userName: row.userName });
});

ordersRouter.post('/payments/:id/reverse', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pago.reversar', 'Reversar pagos requiere permiso de Caja/Finanzas o del administrador.');
  const id = idParam(req.params.id);
  const { reason } = parse(reversePaymentSchema, req.body);
  await db.transaction((tx) => reversePayment(tx, id, reason, user));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- venta rápida
ordersRouter.post('/quick-sale', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'venta.registrar');
  const input = parse(quickSaleSchema, req.body);
  const order = await db.transaction((tx) => quickSale(tx, input, user));
  res.status(201).json(order);
});

// ---------------------------------------------------------------- detalle
ordersRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = idParam(req.params.id);
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) throw notFound('El pedido');
  const [customer] = o.customerId ? await db.select().from(customers).where(eq(customers.id, o.customerId)) : [null];
  const shortages = await orderShortages(db, id);
  const pays = await db.select({ p: payments, userName: users.name }).from(payments).leftJoin(users, eq(users.id, payments.userId)).where(eq(payments.orderId, id)).orderBy(asc(payments.id));
  const events = await db.select({ e: orderEvents, userName: users.name }).from(orderEvents).leftJoin(users, eq(users.id, orderEvents.userId)).where(eq(orderEvents.orderId, id)).orderBy(desc(orderEvents.createdAt), desc(orderEvents.id));
  const pos = await db.select().from(productionOrders).where(eq(productionOrders.orderId, id)).orderBy(asc(productionOrders.id));
  const stages = await getStages(db);
  const poItems = pos.length ? await db.select().from(productionItems).where(inArray(productionItems.productionOrderId, pos.map((p) => p.id))) : [];
  const dels = await db.select().from(deliveries).where(eq(deliveries.orderId, id)).orderBy(asc(deliveries.id));
  const [creator] = o.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, o.createdBy)) : [null];
  const today = todayISO();
  const balance = o.total - o.paid;
  const money = seesMoney(user.role);
  // Unidades que ya están en órdenes de producción abiertas (no se deben volver a enviar).
  const activePoIds = pos.filter((p) => p.status === 'pendiente' || p.status === 'en_proceso').map((p) => p.id);
  const inProd = new Map<number, number>();
  for (const it of poItems) if (activePoIds.includes(it.productionOrderId) && it.orderItemId) inProd.set(it.orderItemId, (inProd.get(it.orderItemId) ?? 0) + it.quantity - it.qtyDone);
  const toProduce = shortages.map((s) => ({ id: s.item.id, inProduction: Math.min(s.missing, inProd.get(s.item.id) ?? 0), pending: Math.max(0, s.missing - (inProd.get(s.item.id) ?? 0)) }));
  res.json({
    order: maskMoney(user.role, {
      ...o,
      balance,
      overdue: ACTIVE.includes(o.status as OrderStatus) && !!o.promisedDate && o.promisedDate < today,
      receivable: balance > 0 && !['borrador', 'cancelado'].includes(o.status) ? receivableStatus(balance, o.dueDate) : null,
      createdByName: creator?.name ?? null,
    }),
    customer,
    items: shortages.map((s) => ({
      ...s.item,
      unitPrice: money ? s.item.unitPrice : null,
      lineTotal: money ? s.item.lineTotal : null,
      unitCost: money ? s.item.unitCost : null,
      reserved: s.reserved,
      missing: s.missing,
      inProduction: toProduce.find((t) => t.id === s.item.id)!.inProduction,
      toProduce: toProduce.find((t) => t.id === s.item.id)!.pending,
      custom: s.custom,
    })),
    payments: money ? pays.map((p) => ({ ...p.p, userName: p.userName })) : [],
    events: events.map((e) => ({ ...e.e, userName: e.userName ?? 'Sistema' })),
    production: pos.map((p) => {
      const its = poItems.filter((i) => i.productionOrderId === p.id);
      const total = its.reduce((a, i) => a + i.quantity, 0);
      const done = its.reduce((a, i) => a + i.qtyDone, 0);
      return { ...p, units: total, done, progress: progressOf(stages.indexOf(p.stage), stages.length, done, total, p.status) };
    }),
    deliveries: dels,
    canProduce: ['confirmado', 'en_produccion'].includes(o.status) && toProduce.some((t) => t.pending > 0),
    pendingUnits: toProduce.reduce((a, t) => a + t.pending, 0),
  });
});

// ---------------------------------------------------------------- mensajes (plantillas WhatsApp — solo copiar/abrir)
ordersRouter.get('/:id/message', async (req, res) => {
  const id = idParam(req.params.id);
  const key = String(req.query.template ?? 'recibido');
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) throw notFound('El pedido');
  const [c] = o.customerId ? await db.select().from(customers).where(eq(customers.id, o.customerId)) : [null];
  const [t] = await db.select().from(messageTemplates).where(eq(messageTemplates.key, key));
  if (!t) throw notFound('La plantilla');
  const [s] = await db.select().from(settings).limit(1);
  const [po] = await db.select().from(productionOrders).where(and(eq(productionOrders.orderId, id), ne(productionOrders.status, 'cancelada'))).orderBy(desc(productionOrders.id)).limit(1);
  const text = t.body
    .replaceAll('{cliente}', c?.name.split(' ')[0] ?? 'cliente')
    .replaceAll('{pedido}', o.number)
    .replaceAll('{total}', formatCOP(o.total))
    .replaceAll('{saldo}', formatCOP(o.total - o.paid))
    .replaceAll('{fecha}', formatDate(key === 'cobro' ? o.dueDate : o.promisedDate))
    .replaceAll('{etapa}', po?.stage.toLowerCase() ?? 'preparación')
    .replaceAll('{empresa}', s?.companyName ?? '');
  const phone = (c?.whatsapp ?? c?.phone ?? '').replace(/\D/g, '');
  res.json({ text, phone, whatsappUrl: phone ? `https://wa.me/57${phone.slice(-10)}?text=${encodeURIComponent(text)}` : null });
});

// ---------------------------------------------------------------- crear / editar / estados
ordersRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pedido.crear');
  const input = parse(orderCreateSchema, req.body);
  const order = await db.transaction((tx) => createOrder(tx, input, user));
  res.status(201).json(order);
});

ordersRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pedido.editar');
  const id = idParam(req.params.id);
  const input = parse(orderUpdateSchema, req.body);
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!o) throw notFound('El pedido');
    if (['entregado', 'cancelado'].includes(o.status)) throw badRequest('Un pedido entregado o cancelado ya no se puede editar.');
    const changes: string[] = [];
    if (input.promisedDate && input.promisedDate !== o.promisedDate) changes.push(`fecha de entrega ${formatDate(o.promisedDate)} → ${formatDate(input.promisedDate)}`);
    if (input.priority && input.priority !== o.priority) changes.push(`prioridad ${o.priority} → ${input.priority}`);
    if (input.dueDate !== undefined && input.dueDate !== o.dueDate) changes.push(`vencimiento del saldo → ${formatDate(input.dueDate)}`);
    await tx
      .update(orders)
      .set({
        ...(input.promisedDate ? { promisedDate: input.promisedDate } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.deliveryMethod ? { deliveryMethod: input.deliveryMethod } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        deliveryAddress: input.deliveryAddress ?? o.deliveryAddress,
        notes: input.notes ?? o.notes,
      })
      .where(eq(orders.id, id));
    await addOrderEvent(tx, id, 'nota', changes.length ? `Pedido editado: ${changes.join('; ')}` : 'Datos del pedido actualizados', user.id);
  });
  res.json({ ok: true });
});

ordersRouter.post('/:id/status', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pedido.editar');
  const id = idParam(req.params.id);
  const input = parse(orderStatusChangeSchema, req.body);
  const order = await db.transaction((tx) =>
    changeOrderStatus(tx, id, input.status, user, { reason: input.reason, refundPayments: Boolean(req.body?.refundPayments) }),
  );
  res.json(order);
});

ordersRouter.post('/:id/notes', async (req, res) => {
  const user = currentUser(req);
  const id = idParam(req.params.id);
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw badRequest('Escribe la nota.');
  await addOrderEvent(db, id, 'nota', text, user.id);
  res.status(201).json({ ok: true });
});

ordersRouter.post('/:id/payments', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pago.registrar');
  const id = idParam(req.params.id);
  const input = parse(paymentSchema, req.body);
  const pay = await db.transaction((tx) => registerPayment(tx, { ...input, orderId: id, notes: input.notes ?? 'Abono' }, user));
  res.status(201).json(pay);
});

ordersRouter.post('/:id/deliveries', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'entrega.registrar');
  const id = idParam(req.params.id);
  const input = parse(deliverySchema, req.body);
  const del = await db.transaction((tx) => registerDelivery(tx, id, input, user));
  res.status(201).json(del);
});

