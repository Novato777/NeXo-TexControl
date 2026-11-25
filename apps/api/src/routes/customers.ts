import { Router } from 'express';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { customerSchema, receivableStatus } from '@nexo/shared';
import { intQuery } from '../lib/security';
import { db } from '../db/client';
import { customers, deliveries, orders, payments } from '../db/schema';
import { audit } from '../lib/audit';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { badRequest, idParam, notFound, parse } from '../lib/errors';

export const customersRouter = Router();
customersRouter.use(requireModule('clientes', 'pedidos', 'cartera', 'marketing'));

const statsSubquery = () =>
  db
  .select({
    customerId: orders.customerId,
    ordersCount: sql<number>`count(*)::int`.as('orders_count'),
    totalBought: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} not in ('borrador','cancelado')), 0)::int`.as('total_bought'),
    balance: sql<number>`coalesce(sum(${orders.total} - ${orders.paid}) filter (where ${orders.status} not in ('borrador','cancelado')), 0)::int`.as('balance'),
    lastPurchase: sql<string | null>`max(${orders.orderDate})`.as('last_purchase'),
  })
  .from(orders)
  .groupBy(orders.customerId)
  .as('stats');

customersRouter.get('/', async (req, res) => {
  const stats = statsSubquery();
  const q = String(req.query.q ?? '').trim();
  const type = String(req.query.type ?? '');
  const tag = String(req.query.tag ?? '');
  const withBalance = req.query.withBalance === 'true';
  const archived = req.query.archived === 'true';
  const digits = q.replace(/\D/g, '');
  const rows = await db
    .select({
      c: customers,
      ordersCount: sql<number>`coalesce(${stats.ordersCount}, 0)`,
      totalBought: sql<number>`coalesce(${stats.totalBought}, 0)`,
      balance: sql<number>`coalesce(${stats.balance}, 0)`,
      lastPurchase: stats.lastPurchase,
    })
    .from(customers)
    .leftJoin(stats, eq(stats.customerId, customers.id))
    .where(
      and(
        eq(customers.archived, archived),
        q
          ? or(
              ilike(customers.name, `%${q}%`),
              ilike(customers.document, `%${q}%`),
              digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined,
              ilike(customers.email, `%${q}%`),
            )
          : undefined,
        type ? eq(customers.type, type) : undefined,
        tag ? sql`${customers.tags} ? ${tag}` : undefined,
        withBalance ? sql`coalesce(${stats.balance}, 0) > 0` : undefined,
      ),
    )
    .orderBy(customers.name)
    .limit(intQuery(req.query.limit, 500, 1, 1000));
  res.json(rows.map((r) => ({ ...r.c, ordersCount: Number(r.ordersCount), totalBought: Number(r.totalBought), balance: Number(r.balance), lastPurchase: r.lastPurchase })));
});

customersRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw notFound('El cliente');
  const ords = await db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.id));
  const pays = await db
    .select({ p: payments, orderNumber: orders.number })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(payments.customerId, id))
    .orderBy(desc(payments.id));
  const dels = await db
    .select({ d: deliveries, orderNumber: orders.number })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .where(eq(orders.customerId, id))
    .orderBy(desc(deliveries.id));
  const valid = ords.filter((o) => !['borrador', 'cancelado'].includes(o.status));
  const balance = valid.reduce((a, o) => a + (o.total - o.paid), 0);
  const timeline = [
    ...ords.map((o) => ({
      at: o.createdAt,
      kind: 'pedido',
      text: `${o.kind === 'venta' ? 'Compra en mostrador' : 'Pedido'} ${o.number} por $${o.total.toLocaleString('es-CO')}`,
      ref: o.id,
    })),
    ...pays.map((p) => ({
      at: p.p.createdAt,
      kind: 'pago',
      text: `${p.p.amount < 0 ? 'Reverso de pago' : 'Pago'} ${p.p.number} de $${Math.abs(p.p.amount).toLocaleString('es-CO')}${p.orderNumber ? ` (${p.orderNumber})` : ''}`,
      ref: p.p.orderId,
    })),
    ...dels.map((d) => ({ at: d.d.createdAt, kind: 'entrega', text: `Entrega ${d.d.number} del pedido ${d.orderNumber}`, ref: d.d.orderId })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 60);
  res.json({
    customer: c,
    summary: {
      ordersCount: valid.length,
      totalBought: valid.reduce((a, o) => a + o.total, 0),
      balance,
      lastPurchase: ords[0]?.orderDate ?? null,
      averageTicket: valid.length ? Math.round(valid.reduce((a, o) => a + o.total, 0) / valid.length) : 0,
    },
    orders: ords.map((o) => ({ ...o, balance: o.total - o.paid, receivable: o.total > o.paid && !['borrador', 'cancelado'].includes(o.status) ? receivableStatus(o.total - o.paid, o.dueDate) : null })),
    payments: pays.map((p) => ({ ...p.p, orderNumber: p.orderNumber })),
    timeline,
  });
});

customersRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'cliente.editar');
  const input = parse(customerSchema, req.body);
  if (input.document) {
    const [dup] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.document, input.document));
    if (dup) throw badRequest(`Ya existe un cliente con ese documento: ${dup.name}.`, { document: 'Documento repetido.' });
  }
  const created = await db.transaction(async (tx) => {
    const [c] = await tx.insert(customers).values({ ...input, whatsapp: input.whatsapp ?? input.phone }).returning();
    await audit(tx, user, { action: 'cliente_creado', entity: 'cliente', entityId: c.id, summary: `Cliente ${c.name} creado` });
    return c;
  });
  res.status(201).json(created);
});

customersRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'cliente.editar');
  const id = idParam(req.params.id);
  const input = parse(customerSchema, req.body);
  const updated = await db.transaction(async (tx) => {
    const [c] = await tx.update(customers).set(input).where(eq(customers.id, id)).returning();
    if (!c) throw notFound('El cliente');
    await audit(tx, user, { action: 'cliente_editado', entity: 'cliente', entityId: id, summary: `Datos del cliente ${c.name} actualizados` });
    return c;
  });
  res.json(updated);
});

customersRouter.post('/:id/archive', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'cliente.editar');
  const id = idParam(req.params.id);
  const archived = Boolean(req.body?.archived ?? true);
  await db.transaction(async (tx) => {
    const [c] = await tx.update(customers).set({ archived }).where(eq(customers.id, id)).returning();
    if (!c) throw notFound('El cliente');
    await audit(tx, user, { action: archived ? 'cliente_archivado' : 'cliente_restaurado', entity: 'cliente', entityId: id, summary: `Cliente ${c.name} ${archived ? 'archivado' : 'restaurado'}` });
  });
  res.json({ ok: true });
});
