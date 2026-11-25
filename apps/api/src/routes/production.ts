import { Router } from 'express';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import {
  productionConsumeSchema,
  productionCreateSchema,
  productionFinishSchema,
  productionIncidentSchema,
  productionProgressSchema,
  productionStageSchema,
  todayISO,
} from '@nexo/shared';
import { db } from '../db/client';
import { customers, orders, productionEvents, productionItems, productionOrders, users } from '../db/schema';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { idParam, parse } from '../lib/errors';
import {
  createProductionOrder,
  finishProductionOrder,
  getProductionOrder,
  getStages,
  materialsStatus,
  missingMaterialsByOrder,
  moveStage,
  progressOf,
  registerConsumption,
  registerIncident,
  registerProgress,
} from '../services/production';

export const productionRouter = Router();
productionRouter.use(requireModule('produccion', 'pedidos', 'inventario'));

async function listOrders(statuses: string[], q = '') {
  const stages = await getStages(db);
  const rows = await db
    .select({ po: productionOrders, orderNumber: orders.number, promisedDate: orders.promisedDate, customerName: customers.name })
    .from(productionOrders)
    .leftJoin(orders, eq(orders.id, productionOrders.orderId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(inArray(productionOrders.status, statuses), q ? or(ilike(productionOrders.number, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(orders.number, `%${q}%`)) : undefined))
    .orderBy(asc(productionOrders.targetDate), asc(productionOrders.id));
  const ids = rows.map((r) => r.po.id);
  const items = ids.length ? await db.select().from(productionItems).where(inArray(productionItems.productionOrderId, ids)) : [];
  const incidents = ids.length
    ? await db.select().from(productionEvents).where(and(inArray(productionEvents.productionOrderId, ids), eq(productionEvents.type, 'incidencia')))
    : [];
  const missingMap = await missingMaterialsByOrder(db, rows.filter((r) => r.po.status === 'pendiente' || r.po.status === 'en_proceso').map((r) => r.po.id));
  const today = todayISO();
  return rows.map((r) => {
    const its = items.filter((i) => i.productionOrderId === r.po.id);
    const units = its.reduce((a, i) => a + i.quantity, 0);
    const done = its.reduce((a, i) => a + i.qtyDone, 0);
    return {
      ...r.po,
      orderNumber: r.orderNumber,
      customerName: r.customerName ?? (r.po.orderId ? null : 'Producción para bodega'),
      promisedDate: r.promisedDate,
      units,
      done,
      summary: its.map((i) => `${i.quantity} × ${i.description}`).slice(0, 3).join(', ') + (its.length > 3 ? ` y ${its.length - 3} más` : ''),
      progress: progressOf(stages.indexOf(r.po.stage), stages.length, done, units, r.po.status),
      late: r.po.status !== 'terminada' && r.po.targetDate < today,
      missingMaterials: missingMap.get(r.po.id) ?? [],
      incidents: incidents.filter((e) => e.productionOrderId === r.po.id).length,
    };
  });
}

productionRouter.get('/stages', async (_req, res) => res.json(await getStages(db)));

productionRouter.get('/', async (req, res) => {
  const status = String(req.query.status ?? 'activas');
  const statuses = status === 'activas' ? ['pendiente', 'en_proceso'] : status === 'todas' ? ['pendiente', 'en_proceso', 'terminada', 'cancelada'] : status.split(',');
  res.json(await listOrders(statuses, String(req.query.q ?? '').trim()));
});

productionRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const po = await getProductionOrder(db, id);
  const stages = await getStages(db);
  const items = await db.select().from(productionItems).where(eq(productionItems.productionOrderId, id)).orderBy(asc(productionItems.id));
  const materials = await materialsStatus(db, id);
  const events = await db
    .select({ e: productionEvents, userName: users.name })
    .from(productionEvents)
    .leftJoin(users, eq(users.id, productionEvents.userId))
    .where(eq(productionEvents.productionOrderId, id))
    .orderBy(desc(productionEvents.createdAt), desc(productionEvents.id));
  const [order] = po.orderId
    ? await db.select({ id: orders.id, number: orders.number, status: orders.status, promisedDate: orders.promisedDate, customerName: customers.name }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.id, po.orderId))
    : [null];
  const units = items.reduce((a, i) => a + i.quantity, 0);
  const done = items.reduce((a, i) => a + i.qtyDone, 0);
  res.json({
    order: { ...po, late: po.status !== 'terminada' && po.targetDate < todayISO(), units, done, progress: progressOf(stages.indexOf(po.stage), stages.length, done, units, po.status) },
    stages,
    items,
    materials,
    events: events.map((e) => ({ ...e.e, userName: e.userName ?? 'Sistema' })),
    salesOrder: order,
  });
});

productionRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  if (req.body?.orderId) assertCan(user, 'pedido.editar', 'Para enviar un pedido a producción necesitas permiso de Ventas o del administrador.');
  else assertCan(user, 'produccion.gestionar');
  const input = parse(productionCreateSchema, req.body);
  const po = await db.transaction((tx) => createProductionOrder(tx, input, user));
  res.status(201).json(po);
});

productionRouter.post('/:id/stage', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'produccion.gestionar');
  const input = parse(productionStageSchema, req.body);
  await db.transaction((tx) => moveStage(tx, idParam(req.params.id), input.stage, input.note, user));
  res.json({ ok: true });
});

productionRouter.post('/:id/consume', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'produccion.gestionar');
  const input = parse(productionConsumeSchema, req.body);
  await db.transaction((tx) => registerConsumption(tx, idParam(req.params.id), input.lines, user));
  res.json({ ok: true });
});

productionRouter.post('/:id/progress', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'produccion.gestionar');
  const input = parse(productionProgressSchema, req.body);
  await db.transaction((tx) => registerProgress(tx, idParam(req.params.id), input.lines, user));
  res.json({ ok: true });
});

productionRouter.post('/:id/incident', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'produccion.gestionar');
  const input = parse(productionIncidentSchema, req.body);
  await db.transaction((tx) => registerIncident(tx, idParam(req.params.id), input.type, input.detail, user));
  res.status(201).json({ ok: true });
});

productionRouter.post('/:id/finish', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'produccion.gestionar');
  const input = parse(productionFinishSchema, req.body);
  const result = await db.transaction((tx) => finishProductionOrder(tx, idParam(req.params.id), input, user));
  res.json(result);
});
