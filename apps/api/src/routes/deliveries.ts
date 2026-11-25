import { Router } from 'express';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { addDays, todayISO } from '@nexo/shared';
import { intQuery } from '../lib/security';
import { db } from '../db/client';
import { customers, deliveries, orders, users } from '../db/schema';
import { requireModule } from '../lib/auth';
import { idParam, notFound } from '../lib/errors';

export const deliveriesRouter = Router();
deliveriesRouter.use(requireModule('entregas', 'pedidos'));

/** Agenda de entregas: listos, programados próximos y atrasados, más historial reciente. */
deliveriesRouter.get('/', async (req, res) => {
  const today = todayISO();
  const horizon = addDays(today, intQuery(req.query.days, 14, 1, 90));
  const pending = await db
    .select({
      o: orders,
      customerName: customers.name,
      customerPhone: customers.phone,
      units: sql<number>`(select coalesce(sum(quantity - qty_delivered),0)::int from order_items oi where oi.order_id = ${orders.id})`,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.kind, 'pedido'), inArray(orders.status, ['confirmado', 'en_produccion', 'listo']), lte(orders.promisedDate, horizon)))
    .orderBy(asc(orders.promisedDate));
  const ready = await db
    .select({ o: orders, customerName: customers.name, customerPhone: customers.phone, units: sql<number>`(select coalesce(sum(quantity - qty_delivered),0)::int from order_items oi where oi.order_id = ${orders.id})` })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.kind, 'pedido'), eq(orders.status, 'listo')))
    .orderBy(asc(orders.promisedDate));
  const map = new Map<number, (typeof pending)[number]>();
  for (const r of [...pending, ...ready]) map.set(r.o.id, r);
  const agenda = [...map.values()]
    .map((r) => ({
      ...r.o,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      units: r.units,
      balance: r.o.total - r.o.paid,
      late: !!r.o.promisedDate && r.o.promisedDate < today,
      isToday: r.o.promisedDate === today,
    }))
    .sort((a, b) => (a.promisedDate ?? '').localeCompare(b.promisedDate ?? ''));
  const recent = await db
    .select({ d: deliveries, orderNumber: orders.number, customerName: customers.name, userName: users.name })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(users, eq(users.id, deliveries.userId))
    .orderBy(desc(deliveries.createdAt))
    .limit(30);
  res.json({ agenda, recent: recent.map((r) => ({ ...r.d, orderNumber: r.orderNumber, customerName: r.customerName, userName: r.userName })) });
});

deliveriesRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [row] = await db
    .select({ d: deliveries, o: orders, c: customers, userName: users.name })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(users, eq(users.id, deliveries.userId))
    .where(eq(deliveries.id, id));
  if (!row) throw notFound('La entrega');
  res.json({ ...row.d, order: row.o, customer: row.c, userName: row.userName });
});
