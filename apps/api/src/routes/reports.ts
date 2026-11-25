// Reportes listos para usar: el usuario elige reporte y periodo; no construye consultas.
import { Router } from 'express';
import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { addDays, CUSTOMER_TYPE_LABELS, MOVEMENT_TYPE_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, todayISO, type CustomerType, type MovementType, type OrderStatus, type PaymentMethod } from '@nexo/shared';
import { dateQuery } from '../lib/security';
import { db } from '../db/client';
import { cashMovements, customers, inventoryMovements, orderItems, orders, productionItems, productionOrders, products, purchaseItems, purchases, suppliers, users, variants } from '../db/schema';
import { requireModule } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { variantName } from '../services/inventory';

export const reportsRouter = Router();
reportsRouter.use(requireModule('reportes'));

type Fmt = 'money' | 'qty' | 'text' | 'date' | 'pct' | 'int';
interface Report {
  title: string;
  description: string;
  columns: Array<{ key: string; label: string; format: Fmt }>;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
  chart?: { type: 'bar' | 'line' | 'pie'; x: string; y: string; label: string };
}

const SOLD = notInArray(orders.status, ['borrador', 'cancelado', 'pendiente']);
const sum = (rows: Array<Record<string, unknown>>, k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

export const REPORTS = [
  { key: 'ventas-periodo', group: 'Ventas', title: 'Ventas por periodo' },
  { key: 'ventas-producto', group: 'Ventas', title: 'Ventas por producto' },
  { key: 'ventas-categoria', group: 'Ventas', title: 'Ventas por categoría' },
  { key: 'ventas-talla', group: 'Ventas', title: 'Ventas por talla' },
  { key: 'ventas-color', group: 'Ventas', title: 'Ventas por color' },
  { key: 'ventas-cliente', group: 'Ventas', title: 'Ventas por cliente' },
  { key: 'pedidos-estado', group: 'Pedidos y producción', title: 'Pedidos por estado' },
  { key: 'produccion', group: 'Pedidos y producción', title: 'Producción terminada y retrasos' },
  { key: 'caja', group: 'Dinero', title: 'Ingresos y gastos' },
  { key: 'metodos-pago', group: 'Dinero', title: 'Ingresos por método de pago' },
  { key: 'inventario', group: 'Inventario', title: 'Inventario valorizado' },
  { key: 'mermas', group: 'Inventario', title: 'Mermas y ajustes' },
  { key: 'compras', group: 'Compras', title: 'Compras por proveedor y material' },
] as const;

reportsRouter.get('/catalog', (_req, res) => res.json(REPORTS));

reportsRouter.get('/indicators', async (req, res) => {
  const today = todayISO();
  let from = dateQuery(req.query.from, addDays(today, -29));
  let to = dateQuery(req.query.to, today);
  if (from > to) [from, to] = [to, from];
  const inRange = and(gte(orders.orderDate, from), lte(orders.orderDate, to));
  const [sales] = await db.select({ total: sql<number>`coalesce(sum(${orders.total}),0)::int`, n: sql<number>`count(*)::int` }).from(orders).where(and(SOLD, inRange));
  const [cost] = await db
    .select({ c: sql<number>`coalesce(sum(${orderItems.unitCost} * ${orderItems.quantity}),0)::int`, rev: sql<number>`coalesce(sum(${orderItems.lineTotal}),0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(SOLD, inRange));
  const [cash] = await db
    .select({
      income: sql<number>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.type}='ingreso'),0)::int`,
      expense: sql<number>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.type}='egreso'),0)::int`,
    })
    .from(cashMovements)
    .where(and(gte(cashMovements.createdAt, `${from}T00:00:00-05:00`), lte(cashMovements.createdAt, `${to}T23:59:59-05:00`)));
  const [received] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.kind, 'pedido'), notInArray(orders.status, ['borrador', 'cancelado']), inRange));
  const [delivered] = await db
    .select({ n: sql<number>`count(*)::int`, onTime: sql<number>`count(*) filter (where (${orders.deliveredAt} at time zone 'America/Bogota')::date <= ${orders.promisedDate})::int` })
    .from(orders)
    .where(and(eq(orders.kind, 'pedido'), eq(orders.status, 'entregado'), gte(orders.deliveredAt, `${from}T00:00:00-05:00`), lte(orders.deliveredAt, `${to}T23:59:59-05:00`)));
  const [prodTime] = await db
    .select({ avg: sql<number | null>`avg(extract(epoch from (${productionOrders.finishedAt} - ${productionOrders.createdAt})) / 86400)`, n: sql<number>`count(*)::int` })
    .from(productionOrders)
    .where(and(eq(productionOrders.status, 'terminada'), gte(productionOrders.finishedAt, `${from}T00:00:00-05:00`), lte(productionOrders.finishedAt, `${to}T23:59:59-05:00`)));
  const top = await db
    .select({ name: products.name, units: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(SOLD, inRange))
    .groupBy(products.name)
    .orderBy(sql`sum(${orderItems.quantity}) desc`)
    .limit(5);
  res.json({
    from,
    to,
    sales: sales.total,
    orders: sales.n,
    averageTicket: sales.n ? Math.round(sales.total / sales.n) : 0,
    income: cash.income,
    expense: cash.expense,
    result: cash.income - cash.expense,
    grossMargin: cost.rev ? Math.round(((cost.rev - cost.c) / cost.rev) * 100) : 0,
    grossProfit: cost.rev - cost.c,
    ordersReceived: received.n,
    ordersDelivered: delivered.n,
    onTimePct: delivered.n ? Math.round((delivered.onTime / delivered.n) * 100) : null,
    avgProductionDays: prodTime.n >= 3 && prodTime.avg != null ? Math.round(Number(prodTime.avg) * 10) / 10 : null,
    productionSample: prodTime.n,
    topProducts: top,
  });
});

reportsRouter.get('/:type', async (req, res) => {
  const today = todayISO();
  let from = dateQuery(req.query.from, addDays(today, -29));
  let to = dateQuery(req.query.to, today);
  if (from > to) [from, to] = [to, from];
  const group = String(req.query.group ?? 'dia');
  const inRange = and(gte(orders.orderDate, from), lte(orders.orderDate, to));
  const tsRange = (col: typeof cashMovements.createdAt | typeof inventoryMovements.createdAt) => and(gte(col, `${from}T00:00:00-05:00`), lte(col, `${to}T23:59:59-05:00`));
  let report: Report;

  const itemSales = async (key: ReturnType<typeof sql<string>>, label: string, title: string, description: string) => {
    const rows = await db
      .select({ name: key, units: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal})::int`, cost: sql<number>`sum(${orderItems.unitCost} * ${orderItems.quantity})::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(variants, eq(variants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(SOLD, inRange))
      .groupBy(key)
      .orderBy(sql`sum(${orderItems.lineTotal}) desc`);
    const total = sum(rows, 'revenue');
    const out = rows.map((r) => ({ ...r, name: r.name ?? 'Sin dato', margin: r.revenue ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : 0, share: total ? Math.round((r.revenue / total) * 1000) / 10 : 0 }));
    return {
      title,
      description,
      columns: [
        { key: 'name', label, format: 'text' as Fmt },
        { key: 'units', label: 'Unidades', format: 'int' as Fmt },
        { key: 'revenue', label: 'Ventas', format: 'money' as Fmt },
        { key: 'share', label: '% del total', format: 'pct' as Fmt },
        { key: 'margin', label: 'Margen estimado', format: 'pct' as Fmt },
      ],
      rows: out,
      totals: { units: sum(out, 'units'), revenue: total },
      chart: { type: 'bar' as const, x: 'name', y: 'revenue', label: 'Ventas' },
    };
  };

  switch (req.params.type) {
    case 'ventas-periodo': {
      const bucket = group === 'mes' ? sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')` : group === 'semana' ? sql<string>`to_char(date_trunc('week', ${orders.orderDate}), 'YYYY-MM-DD')` : sql<string>`to_char(${orders.orderDate}, 'YYYY-MM-DD')`;
      const rows = await db
        .select({
          period: bucket,
          count: sql<number>`count(*)::int`,
          ventas: sql<number>`count(*) filter (where ${orders.kind}='venta')::int`,
          pedidos: sql<number>`count(*) filter (where ${orders.kind}='pedido')::int`,
          total: sql<number>`sum(${orders.total})::int`,
        })
        .from(orders)
        .where(and(SOLD, inRange))
        .groupBy(bucket)
        .orderBy(bucket);
      const out = rows.map((r) => ({ ...r, ticket: r.count ? Math.round(r.total / r.count) : 0 }));
      report = {
        title: 'Ventas por periodo',
        description: 'Valor vendido (ventas de mostrador + pedidos confirmados) agrupado por ' + (group === 'mes' ? 'mes' : group === 'semana' ? 'semana' : 'día') + '.',
        columns: [
          { key: 'period', label: group === 'mes' ? 'Mes' : group === 'semana' ? 'Semana desde' : 'Día', format: group === 'mes' ? 'text' : 'date' },
          { key: 'ventas', label: 'Ventas mostrador', format: 'int' },
          { key: 'pedidos', label: 'Pedidos', format: 'int' },
          { key: 'total', label: 'Total vendido', format: 'money' },
          { key: 'ticket', label: 'Ticket promedio', format: 'money' },
        ],
        rows: out,
        totals: { ventas: sum(out, 'ventas'), pedidos: sum(out, 'pedidos'), total: sum(out, 'total') },
        chart: { type: 'line', x: 'period', y: 'total', label: 'Total vendido' },
      };
      break;
    }
    case 'ventas-producto':
      report = await itemSales(sql<string>`${products.name}`, 'Producto', 'Ventas por producto', 'Qué productos se venden más y cuánto dejan.');
      break;
    case 'ventas-categoria':
      report = await itemSales(sql<string>`${products.category}`, 'Categoría', 'Ventas por categoría', 'Ventas agrupadas por categoría del catálogo.');
      break;
    case 'ventas-talla':
      report = await itemSales(sql<string>`coalesce(${variants.size}, 'Única')`, 'Talla', 'Ventas por talla', 'Útil para decidir cuántas unidades fabricar de cada talla.');
      break;
    case 'ventas-color':
      report = await itemSales(sql<string>`coalesce(${variants.color}, 'Sin color')`, 'Color', 'Ventas por color', 'Colores con más salida.');
      break;
    case 'ventas-cliente': {
      const rows = await db
        .select({ name: sql<string>`coalesce(${customers.name}, 'Venta de mostrador')`, type: customers.type, count: sql<number>`count(*)::int`, total: sql<number>`sum(${orders.total})::int`, balance: sql<number>`sum(${orders.total} - ${orders.paid})::int` })
        .from(orders)
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(and(SOLD, inRange))
        .groupBy(customers.name, customers.type)
        .orderBy(sql`sum(${orders.total}) desc`);
      const out = rows.map((r) => ({ ...r, type: r.type ? CUSTOMER_TYPE_LABELS[r.type as CustomerType] : '—' }));
      report = {
        title: 'Ventas por cliente',
        description: 'Quiénes compran más y cuánto deben.',
        columns: [
          { key: 'name', label: 'Cliente', format: 'text' },
          { key: 'type', label: 'Tipo', format: 'text' },
          { key: 'count', label: 'Compras', format: 'int' },
          { key: 'total', label: 'Total comprado', format: 'money' },
          { key: 'balance', label: 'Saldo pendiente', format: 'money' },
        ],
        rows: out,
        totals: { count: sum(out, 'count'), total: sum(out, 'total'), balance: sum(out, 'balance') },
        chart: { type: 'bar', x: 'name', y: 'total', label: 'Total comprado' },
      };
      break;
    }
    case 'pedidos-estado': {
      const rows = await db
        .select({
          status: orders.status,
          count: sql<number>`count(*)::int`,
          total: sql<number>`sum(${orders.total})::int`,
          late: sql<number>`count(*) filter (where ${orders.status} in ('pendiente','confirmado','en_produccion','listo') and ${orders.promisedDate} < ${today})::int`,
        })
        .from(orders)
        .where(and(eq(orders.kind, 'pedido'), inRange))
        .groupBy(orders.status);
      const out = rows.map((r) => ({ ...r, label: ORDER_STATUS_LABELS[r.status as OrderStatus] }));
      report = {
        title: 'Pedidos por estado',
        description: 'Pedidos recibidos en el periodo, según su estado actual.',
        columns: [
          { key: 'label', label: 'Estado', format: 'text' },
          { key: 'count', label: 'Pedidos', format: 'int' },
          { key: 'late', label: 'Atrasados', format: 'int' },
          { key: 'total', label: 'Valor', format: 'money' },
        ],
        rows: out,
        totals: { count: sum(out, 'count'), late: sum(out, 'late'), total: sum(out, 'total') },
        chart: { type: 'pie', x: 'label', y: 'count', label: 'Pedidos' },
      };
      break;
    }
    case 'produccion': {
      const rows = await db
        .select({ po: productionOrders, units: sql<number>`(select coalesce(sum(quantity),0)::int from ${productionItems} pi where pi.production_order_id = ${productionOrders.id})`, orderNumber: orders.number })
        .from(productionOrders)
        .leftJoin(orders, eq(orders.id, productionOrders.orderId))
        .where(and(gte(productionOrders.createdAt, `${from}T00:00:00-05:00`), lte(productionOrders.createdAt, `${to}T23:59:59-05:00`)));
      const out = rows.map((r) => {
        const finishedDay = r.po.finishedAt ? r.po.finishedAt.slice(0, 10) : null;
        const days = r.po.finishedAt ? Math.round(((new Date(r.po.finishedAt).getTime() - new Date(r.po.createdAt).getTime()) / 86400000) * 10) / 10 : null;
        return {
          number: r.po.number,
          orderNumber: r.orderNumber ?? 'Bodega',
          status: r.po.status === 'terminada' ? 'Terminada' : r.po.status === 'cancelada' ? 'Cancelada' : `En curso (${r.po.stage})`,
          units: r.units,
          targetDate: r.po.targetDate,
          days,
          late: (finishedDay ?? today) > r.po.targetDate && r.po.status !== 'cancelada' ? 'Sí' : 'No',
        };
      });
      report = {
        title: 'Producción terminada y retrasos',
        description: 'Órdenes creadas en el periodo, cuánto tardaron y si se pasaron de la fecha objetivo.',
        columns: [
          { key: 'number', label: 'Orden', format: 'text' },
          { key: 'orderNumber', label: 'Pedido', format: 'text' },
          { key: 'status', label: 'Estado', format: 'text' },
          { key: 'units', label: 'Unidades', format: 'int' },
          { key: 'targetDate', label: 'Fecha objetivo', format: 'date' },
          { key: 'days', label: 'Días de fabricación', format: 'qty' },
          { key: 'late', label: '¿Atrasada?', format: 'text' },
        ],
        rows: out,
        totals: { units: sum(out, 'units') },
      };
      break;
    }
    case 'caja': {
      const rows = await db
        .select({ type: cashMovements.type, category: cashMovements.category, total: sql<number>`sum(${cashMovements.amount})::int`, count: sql<number>`count(*)::int` })
        .from(cashMovements)
        .where(tsRange(cashMovements.createdAt))
        .groupBy(cashMovements.type, cashMovements.category)
        .orderBy(cashMovements.type, sql`sum(${cashMovements.amount}) desc`);
      const out = rows.map((r) => ({ ...r, typeLabel: r.type === 'ingreso' ? 'Ingreso' : 'Gasto / egreso', signed: r.type === 'ingreso' ? r.total : -r.total }));
      report = {
        title: 'Ingresos y gastos',
        description: 'Todo el dinero que entró y salió, por categoría. El resultado es aproximado (no es contabilidad formal).',
        columns: [
          { key: 'typeLabel', label: 'Tipo', format: 'text' },
          { key: 'category', label: 'Categoría', format: 'text' },
          { key: 'count', label: 'Movimientos', format: 'int' },
          { key: 'total', label: 'Valor', format: 'money' },
        ],
        rows: out,
        totals: { ingresos: sum(out.filter((r) => r.type === 'ingreso'), 'total'), egresos: sum(out.filter((r) => r.type === 'egreso'), 'total'), resultado: sum(out, 'signed') },
        chart: { type: 'bar', x: 'category', y: 'total', label: 'Valor' },
      };
      break;
    }
    case 'metodos-pago': {
      const rows = await db
        .select({ method: cashMovements.method, total: sql<number>`sum(${cashMovements.amount})::int`, count: sql<number>`count(*)::int` })
        .from(cashMovements)
        .where(and(eq(cashMovements.type, 'ingreso'), tsRange(cashMovements.createdAt)))
        .groupBy(cashMovements.method)
        .orderBy(sql`sum(${cashMovements.amount}) desc`);
      const out = rows.map((r) => ({ ...r, label: PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method }));
      report = {
        title: 'Ingresos por método de pago',
        description: 'Cómo pagan los clientes.',
        columns: [
          { key: 'label', label: 'Método', format: 'text' },
          { key: 'count', label: 'Pagos', format: 'int' },
          { key: 'total', label: 'Valor', format: 'money' },
        ],
        rows: out,
        totals: { count: sum(out, 'count'), total: sum(out, 'total') },
        chart: { type: 'pie', x: 'label', y: 'total', label: 'Valor' },
      };
      break;
    }
    case 'inventario': {
      const rows = await db
        .select({ v: variants, p: products })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(and(eq(products.active, true), inArray(products.type, ['terminado', 'materia_prima', 'insumo'])));
      const map = new Map<string, { category: string; type: string; items: number; stock: number; value: number; low: number }>();
      for (const { v, p } of rows) {
        const k = p.category;
        const e = map.get(k) ?? { category: k, type: p.type === 'terminado' ? 'Producto terminado' : 'Materiales', items: 0, stock: 0, value: 0, low: 0 };
        e.items++;
        e.stock += Number(v.stock);
        e.value += Math.round(Number(v.stock) * (v.cost ?? p.cost));
        if (Number(v.stock) - Number(v.reserved) < Number(v.minStock ?? p.minStock)) e.low++;
        map.set(k, e);
      }
      const out = [...map.values()].sort((a, b) => b.value - a.value);
      report = {
        title: 'Inventario valorizado',
        description: 'Valor aproximado del inventario actual a costo. No depende del periodo.',
        columns: [
          { key: 'category', label: 'Categoría', format: 'text' },
          { key: 'type', label: 'Tipo', format: 'text' },
          { key: 'items', label: 'Referencias', format: 'int' },
          { key: 'stock', label: 'Existencias', format: 'qty' },
          { key: 'low', label: 'Bajo mínimo', format: 'int' },
          { key: 'value', label: 'Valor a costo', format: 'money' },
        ],
        rows: out,
        totals: { items: sum(out, 'items'), low: sum(out, 'low'), value: sum(out, 'value') },
        chart: { type: 'bar', x: 'category', y: 'value', label: 'Valor' },
      };
      break;
    }
    case 'mermas': {
      const rows = await db
        .select({ m: inventoryMovements, v: variants, p: products, userName: users.name })
        .from(inventoryMovements)
        .innerJoin(variants, eq(variants.id, inventoryMovements.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .leftJoin(users, eq(users.id, inventoryMovements.userId))
        .where(and(inArray(inventoryMovements.type, ['salida_merma', 'salida_ajuste', 'entrada_ajuste']), tsRange(inventoryMovements.createdAt), sql`${inventoryMovements.reference} is distinct from 'APERTURA'`))
        .orderBy(inventoryMovements.createdAt);
      const out = rows.map((r) => ({
        date: r.m.createdAt.slice(0, 10),
        label: variantName(r.p, r.v),
        type: MOVEMENT_TYPE_LABELS[r.m.type as MovementType],
        quantity: Number(r.m.quantity),
        unit: r.p.unit,
        value: Math.round(Number(r.m.quantity) * (r.v.cost ?? r.p.cost)),
        reason: r.m.reason,
        user: r.userName ?? '—',
      }));
      report = {
        title: 'Mermas y ajustes',
        description: 'Pérdidas, daños y correcciones de inventario. Valores negativos = salió del inventario.',
        columns: [
          { key: 'date', label: 'Fecha', format: 'date' },
          { key: 'label', label: 'Producto', format: 'text' },
          { key: 'type', label: 'Tipo', format: 'text' },
          { key: 'quantity', label: 'Cantidad', format: 'qty' },
          { key: 'unit', label: 'Unidad', format: 'text' },
          { key: 'value', label: 'Valor a costo', format: 'money' },
          { key: 'reason', label: 'Motivo', format: 'text' },
          { key: 'user', label: 'Usuario', format: 'text' },
        ],
        rows: out,
        totals: { value: sum(out, 'value') },
      };
      break;
    }
    case 'compras': {
      const rows = await db
        .select({ supplier: suppliers.name, pi: purchaseItems, v: variants, p: products })
        .from(purchaseItems)
        .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
        .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
        .innerJoin(variants, eq(variants.id, purchaseItems.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(and(gte(purchases.date, from), lte(purchases.date, to), sql`${purchases.status} <> 'cancelada'`));
      const map = new Map<string, { supplier: string; material: string; unit: string; quantity: number; total: number; minCost: number; maxCost: number }>();
      for (const r of rows) {
        const label = variantName(r.p, r.v);
        const k = `${r.supplier}|${label}`;
        const e = map.get(k) ?? { supplier: r.supplier, material: label, unit: r.p.unit, quantity: 0, total: 0, minCost: Infinity, maxCost: 0 };
        e.quantity += Number(r.pi.quantity);
        e.total += Math.round(Number(r.pi.quantity) * r.pi.unitCost);
        e.minCost = Math.min(e.minCost, r.pi.unitCost);
        e.maxCost = Math.max(e.maxCost, r.pi.unitCost);
        map.set(k, e);
      }
      const out = [...map.values()].map((e) => ({ ...e, avgCost: e.quantity ? Math.round(e.total / e.quantity) : 0 })).sort((a, b) => b.total - a.total);
      report = {
        title: 'Compras por proveedor y material',
        description: 'Qué se compró, a quién y a qué precio.',
        columns: [
          { key: 'supplier', label: 'Proveedor', format: 'text' },
          { key: 'material', label: 'Material', format: 'text' },
          { key: 'quantity', label: 'Cantidad', format: 'qty' },
          { key: 'unit', label: 'Unidad', format: 'text' },
          { key: 'avgCost', label: 'Costo promedio', format: 'money' },
          { key: 'total', label: 'Total comprado', format: 'money' },
        ],
        rows: out,
        totals: { total: sum(out, 'total') },
        chart: { type: 'bar', x: 'material', y: 'total', label: 'Total comprado' },
      };
      break;
    }
    default:
      throw badRequest('Ese reporte no existe.');
  }
  res.json({ ...report, from, to });
});
