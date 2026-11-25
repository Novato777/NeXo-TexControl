import { Router } from 'express';
import { and, desc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { addDays, can, canAccess, diffDays, formatCOP, formatQty, ORDER_STATUS_LABELS, receivableStatus, seesMoney, todayISO, type OrderStatus } from '@nexo/shared';
import { dateQuery } from '../lib/security';
import { db } from '../db/client';
import { auditLogs, cashMovements, customers, orders, payables, productionItems, productionOrders, products, users, variants } from '../db/schema';
import { currentUser } from '../lib/auth';
import { getOpenSession, sessionSummary } from '../services/cash';
import { variantName } from '../services/inventory';
import { getStages, missingMaterialsByOrder, progressOf } from '../services/production';

export const dashboardRouter = Router();

const SOLD = notInArray(orders.status, ['borrador', 'cancelado', 'pendiente']);

async function salesBetween(from: string, to: string) {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.total}),0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(SOLD, gte(orders.orderDate, from), lte(orders.orderDate, to)));
  return r;
}

dashboardRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const money = seesMoney(user.role);
  const today = todayISO();
  let from = dateQuery(req.query.from, addDays(today, -6));
  let to = dateQuery(req.query.to, today);
  if (from > to) [from, to] = [to, from];
  if (diffDays(from, to) > 366) from = addDays(to, -366);
  const days = diffDays(from, to) + 1;
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);

  const [period, previous, salesToday, salesYesterday] = await Promise.all([salesBetween(from, to), salesBetween(prevFrom, prevTo), salesBetween(today, today), salesBetween(addDays(today, -1), addDays(today, -1))]);

  // Ventas por día (rellena días sin ventas)
  const byDayRows = await db
    .select({ day: orders.orderDate, total: sql<number>`coalesce(sum(${orders.total}),0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(SOLD, gte(orders.orderDate, from), lte(orders.orderDate, to)))
    .groupBy(orders.orderDate);
  const salesByDay = Array.from({ length: Math.min(days, 120) }, (_, i) => {
    const d = addDays(from, i);
    const r = byDayRows.find((x) => x.day === d);
    return { date: d, total: r?.total ?? 0, count: r?.count ?? 0 };
  });

  // Pedidos activos por estado
  const statusRows = await db
    .select({ status: orders.status, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.kind, 'pedido'), inArray(orders.status, ['borrador', 'pendiente', 'confirmado', 'en_produccion', 'listo'])))
    .groupBy(orders.status);
  const ACTIVE = ['pendiente', 'confirmado', 'en_produccion', 'listo'];
  const overdueOrders = await db
    .select({ id: orders.id, number: orders.number, promisedDate: orders.promisedDate, status: orders.status, customerName: customers.name })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.kind, 'pedido'), inArray(orders.status, ACTIVE), sql`${orders.promisedDate} < ${today}`));
  const deliveriesToday = await db
    .select({ id: orders.id, number: orders.number, status: orders.status, customerName: customers.name, balance: sql<number>`${orders.total} - ${orders.paid}` })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.kind, 'pedido'), inArray(orders.status, ACTIVE), eq(orders.promisedDate, today)));

  // Caja del día
  const open = await getOpenSession(db);
  const cash = open ? { open: true, number: open.number, ...(await sessionSummary(db, open.id)) } : { open: false };
  const [periodCash] = await db
    .select({
      income: sql<number>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.type}='ingreso'),0)::int`,
      expense: sql<number>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.type}='egreso'),0)::int`,
    })
    .from(cashMovements)
    .where(and(gte(cashMovements.createdAt, `${from}T00:00:00-05:00`), lte(cashMovements.createdAt, `${to}T23:59:59-05:00`)));

  // Stock bajo
  const stockRows = await db
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(products.active, true), inArray(products.type, ['terminado', 'materia_prima', 'insumo'])));
  const low = stockRows
    .filter(({ v, p }) => Number(v.stock) - Number(v.reserved) < Number(v.minStock ?? p.minStock))
    .map(({ v, p }) => ({ variantId: v.id, label: variantName(p, v), type: p.type, available: Number(v.stock) - Number(v.reserved), min: Number(v.minStock ?? p.minStock), unit: p.unit }));

  // Cartera
  const recv = await db
    .select({ id: orders.id, number: orders.number, total: orders.total, paid: orders.paid, dueDate: orders.dueDate, customerName: customers.name })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(notInArray(orders.status, ['borrador', 'cancelado']), sql`${orders.total} > ${orders.paid}`));
  const recvStatus = recv.map((r) => ({ ...r, balance: r.total - r.paid, st: receivableStatus(r.total - r.paid, r.dueDate) }));
  const receivables = {
    total: recvStatus.reduce((a, r) => a + r.balance, 0),
    overdue: recvStatus.filter((r) => r.st === 'vencido').reduce((a, r) => a + r.balance, 0),
    overdueCount: recvStatus.filter((r) => r.st === 'vencido').length,
    dueSoon: recvStatus.filter((r) => r.st === 'por_vencer').reduce((a, r) => a + r.balance, 0),
  };

  // Producción
  const stages = await getStages(db);
  const activePOs = await db.select().from(productionOrders).where(inArray(productionOrders.status, ['pendiente', 'en_proceso']));
  const poItems = activePOs.length ? await db.select().from(productionItems).where(inArray(productionItems.productionOrderId, activePOs.map((p) => p.id))) : [];
  const poProgress = activePOs.map((p) => {
    const its = poItems.filter((i) => i.productionOrderId === p.id);
    return progressOf(stages.indexOf(p.stage), stages.length, its.reduce((a, i) => a + i.qtyDone, 0), its.reduce((a, i) => a + i.quantity, 0), p.status);
  });
  const missingMap = await missingMaterialsByOrder(db, activePOs.map((p) => p.id));
  const blocked = activePOs.filter((p) => missingMap.has(p.id)).map((p) => ({ id: p.id, number: p.number, missing: missingMap.get(p.id)! }));

  // Cuentas por pagar próximas
  const payDue = await db
    .select()
    .from(payables)
    .where(and(eq(payables.cancelled, false), sql`${payables.amount} > ${payables.paid}`, lte(payables.dueDate, addDays(today, 5))));

  // Alertas priorizadas — cada una lleva a la acción que la resuelve
  type Alert = { level: 'alta' | 'media' | 'info'; title: string; detail: string; action: string; to: string; module: Parameters<typeof canAccess>[1] };
  const alerts: Alert[] = [];
  for (const o of overdueOrders.slice(0, 4)) {
    alerts.push({ level: 'alta', title: `Pedido ${o.number} atrasado`, detail: `${o.customerName ?? ''} · prometido ${-diffDays(today, o.promisedDate!)} día(s) atrás · ${ORDER_STATUS_LABELS[o.status as OrderStatus]}`, action: 'Ver pedido', to: `/pedidos/${o.id}`, module: 'pedidos' });
  }
  if (!cash.open) alerts.push({ level: 'alta', title: 'La caja está cerrada', detail: 'Ábrela para poder recibir pagos en efectivo hoy.', action: 'Abrir caja', to: '/caja', module: 'caja' });
  for (const d of deliveriesToday) {
    alerts.push({
      level: d.status === 'listo' ? 'media' : 'alta',
      title: `Entrega hoy: ${d.number}`,
      detail: `${d.customerName ?? ''} · ${d.status === 'listo' ? 'listo para entregar' : `aún ${ORDER_STATUS_LABELS[d.status as OrderStatus].toLowerCase()}`}${money && d.balance > 0 ? ` · saldo ${formatCOP(d.balance)}` : ''}`,
      action: d.status === 'listo' && can(user.role, 'entrega.registrar') ? 'Registrar entrega' : 'Ver pedido',
      to: `/pedidos/${d.id}${d.status === 'listo' && can(user.role, 'entrega.registrar') ? '?accion=entregar' : ''}`,
      module: 'pedidos',
    });
  }
  for (const b of blocked.slice(0, 3)) {
    alerts.push({ level: 'alta', title: `Falta material para ${b.number}`, detail: b.missing.join(', '), action: 'Ver reposición', to: '/inventario?tab=reposicion', module: 'inventario' });
  }
  if (money && receivables.overdueCount) {
    alerts.push({ level: 'media', title: `${receivables.overdueCount} cuenta(s) por cobrar vencidas`, detail: `Total vencido ${formatCOP(receivables.overdue)}`, action: 'Ver cartera', to: '/cartera', module: 'cartera' });
  }
  if (money) {
    for (const p of payDue.slice(0, 3)) {
      const dd = diffDays(today, p.dueDate);
      alerts.push({ level: dd < 0 ? 'alta' : 'media', title: `${dd < 0 ? 'Cuenta vencida' : 'Pago próximo'}: ${p.concept}`, detail: `${formatCOP(p.amount - p.paid)} · ${dd < 0 ? `venció hace ${-dd} día(s)` : dd === 0 ? 'vence hoy' : `vence en ${dd} día(s)`}`, action: 'Pagar', to: '/caja?tab=pagar', module: 'caja' });
    }
  }
  const lowMat = low.filter((l) => l.type !== 'terminado');
  const lowFin = low.filter((l) => l.type === 'terminado');
  if (lowMat.length) alerts.push({ level: 'media', title: `${lowMat.length} material(es) bajo el mínimo`, detail: lowMat.slice(0, 3).map((l) => `${l.label}: ${formatQty(l.available)} ${l.unit}`).join(' · '), action: 'Ver reposición', to: '/inventario?tab=reposicion', module: 'inventario' });
  if (lowFin.length) alerts.push({ level: 'info', title: `${lowFin.length} producto(s) terminados con poco stock`, detail: lowFin.slice(0, 3).map((l) => l.label).join(' · '), action: 'Ver inventario', to: '/inventario?estado=alerta', module: 'inventario' });
  const visibleAlerts = alerts.filter((a) => canAccess(user.role, a.module));

  const activity = await db
    .select({ id: auditLogs.id, summary: auditLogs.summary, createdAt: auditLogs.createdAt, userName: users.name, entity: auditLogs.entity, entityId: auditLogs.entityId })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(money ? undefined : notInArray(auditLogs.entity, ['caja', 'pago', 'cuenta_por_pagar']))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(8);

  // Los roles sin acceso a dinero no ven valores en la actividad reciente.
  const safeActivity = money ? activity : activity.map((a) => ({ ...a, summary: a.summary.replace(/ (por|de) \$ [\d.]+/g, '').replace(/-?\$ ?[\d.]+/g, '—') }));

  res.json({
    range: { from, to, days },
    money,
    kpis: {
      salesToday: money ? salesToday.total : null,
      salesYesterday: money ? salesYesterday.total : null,
      salesPeriod: money ? period.total : null,
      salesPrevious: money ? previous.total : null,
      ordersPeriod: period.count,
      income: money ? periodCash.income : null,
      expense: money ? periodCash.expense : null,
      activeOrders: statusRows.filter((s) => ACTIVE.includes(s.status)).reduce((a, s) => a + s.n, 0),
      overdueOrders: overdueOrders.length,
      readyOrders: statusRows.find((s) => s.status === 'listo')?.n ?? 0,
      deliveriesToday: deliveriesToday.length,
      lowStock: low.length,
      lowMaterials: lowMat.length,
      productionActive: activePOs.length,
      productionProgress: poProgress.length ? Math.round(poProgress.reduce((a, b) => a + b, 0) / poProgress.length) : 0,
    },
    cash: money ? cash : null,
    receivables: money ? receivables : null,
    ordersByStatus: ['borrador', 'pendiente', 'confirmado', 'en_produccion', 'listo'].map((s) => ({ status: s, label: ORDER_STATUS_LABELS[s as OrderStatus], count: statusRows.find((r) => r.status === s)?.n ?? 0 })),
    salesByDay: money ? salesByDay : [],
    alerts: visibleAlerts,
    activity: safeActivity,
  });
});
