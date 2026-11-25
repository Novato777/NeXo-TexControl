// Análisis y estimaciones con reglas y cálculos determinísticos (NO hay un modelo de IA conectado).
// Cada bloque explica qué datos usa, qué periodo cubre y qué tan confiable es.
import { Router } from 'express';
import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { addDays, diffDays, formatQty, todayISO } from '@nexo/shared';
import { db } from '../db/client';
import { billOfMaterials, cashMovements, inventoryMovements, orderItems, orders, payables, productionMaterials, productionOrders, products, variants } from '../db/schema';
import { requireModule } from '../lib/auth';
import { variantName } from '../services/inventory';

export const analysisRouter = Router();
analysisRouter.use(requireModule('analisis', 'reportes'));

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ymLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

analysisRouter.get('/', async (_req, res) => {
  const today = todayISO();
  // Desde el primer día del mes, 11 meses atrás: así no entra un mes con datos incompletos.
  const sinceDate = new Date(today.slice(0, 8) + '01T12:00:00Z');
  sinceDate.setUTCMonth(sinceDate.getUTCMonth() - 11);
  const since = sinceDate.toISOString().slice(0, 10);
  const SOLD = notInArray(orders.status, ['borrador', 'cancelado', 'pendiente']);

  // ---------- 1. Ventas históricas y temporadas
  const monthly = await db
    .select({ ym: sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')`, total: sql<number>`sum(${orders.total})::int`, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(SOLD, gte(orders.orderDate, since)))
    .groupBy(sql`to_char(${orders.orderDate}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${orders.orderDate}, 'YYYY-MM')`);
  const complete = monthly.filter((m) => m.ym < today.slice(0, 7));
  const avg = complete.length ? complete.reduce((a, m) => a + m.total, 0) / complete.length : 0;
  const history = monthly.map((m) => ({ ym: m.ym, label: ymLabel(m.ym), total: m.total, orders: m.n, index: avg ? Math.round((m.total / avg) * 100) : 0, partial: m.ym === today.slice(0, 7) }));
  const high = complete.filter((m) => m.total > avg * 1.2).map((m) => ymLabel(m.ym));
  const lowM = complete.filter((m) => m.total < avg * 0.85).map((m) => ymLabel(m.ym));

  // ---------- 2. Estimación de ventas por categoría (próximos 3 meses)
  const catMonthly = await db
    .select({ ym: sql<string>`to_char(${orders.orderDate}, 'YYYY-MM')`, category: products.category, units: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(SOLD, gte(orders.orderDate, since), eq(products.type, 'terminado')))
    .groupBy(sql`to_char(${orders.orderDate}, 'YYYY-MM')`, products.category);
  const categories = [...new Set(catMonthly.map((c) => c.category))];
  const nextMonths = [1, 2, 3].map((k) => {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + k, 1);
    return d.toISOString().slice(0, 7);
  });
  const last3 = complete.slice(-3).map((m) => m.ym);
  const seasonal = (ym: string) => {
    // índice del mismo mes del año pasado frente al promedio
    const lastYear = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
    const m = complete.find((x) => x.ym === lastYear);
    return m && avg ? m.total / avg : 1;
  };
  const recentIdx = last3.length ? last3.reduce((a, ym) => a + seasonal(addDays(ym + '-15', 365).slice(0, 7)), 0) / last3.length : 1;
  const forecast = categories
    .map((cat) => {
      const base = last3.length ? last3.reduce((a, ym) => a + (catMonthly.find((c) => c.ym === ym && c.category === cat)?.units ?? 0), 0) / last3.length : 0;
      const baseRev = last3.length ? last3.reduce((a, ym) => a + (catMonthly.find((c) => c.ym === ym && c.category === cat)?.revenue ?? 0), 0) / last3.length : 0;
      const deseason = recentIdx || 1;
      return {
        category: cat,
        baseUnits: Math.round(base),
        months: nextMonths.map((ym) => {
          const f = seasonal(ym) / deseason;
          const probable = Math.round(base * f);
          return { ym, label: ymLabel(ym), conservador: Math.round(probable * 0.8), probable, alto: Math.round(probable * 1.25), revenue: Math.round(baseRev * f) };
        }),
      };
    })
    .filter((c) => c.baseUnits > 0)
    .sort((a, b) => b.months[0].revenue - a.months[0].revenue);
  const totalNext = nextMonths.map((ym, i) => ({ ym, label: ymLabel(ym), conservador: Math.round(forecast.reduce((a, f) => a + f.months[i].revenue, 0) * 0.8), probable: forecast.reduce((a, f) => a + f.months[i].revenue, 0), alto: Math.round(forecast.reduce((a, f) => a + f.months[i].revenue, 0) * 1.25) }));

  // ---------- 3. Materiales: necesidad vs. disponible y recomendación de compra
  const pendingProd = await db
    .select({ variantId: productionMaterials.variantId, pending: sql<string>`sum(greatest(${productionMaterials.qtyRequired} - ${productionMaterials.qtyConsumed}, 0))` })
    .from(productionMaterials)
    .innerJoin(productionOrders, eq(productionOrders.id, productionMaterials.productionOrderId))
    .where(inArray(productionOrders.status, ['pendiente', 'en_proceso']))
    .groupBy(productionMaterials.variantId);
  // pedidos confirmados aún sin orden de producción (personalizados)
  const unplanned = await db
    .select({ productId: variants.productId, qty: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .where(and(inArray(orders.status, ['pendiente', 'confirmado']), sql`not exists (select 1 from production_orders po where po.order_id = ${orders.id} and po.status <> 'cancelada')`))
    .groupBy(variants.productId);
  const bom = await db.select().from(billOfMaterials);
  const unplannedNeed = new Map<number, number>();
  for (const u of unplanned) for (const b of bom.filter((x) => x.productId === u.productId)) unplannedNeed.set(b.materialVariantId, (unplannedNeed.get(b.materialVariantId) ?? 0) + Number(b.qtyPerUnit) * u.qty);
  const consumption = await db
    .select({ variantId: inventoryMovements.variantId, qty: sql<string>`-sum(${inventoryMovements.quantity})` })
    .from(inventoryMovements)
    .where(and(inArray(inventoryMovements.type, ['salida_consumo', 'salida_merma']), gte(inventoryMovements.createdAt, `${addDays(today, -90)}T00:00:00-05:00`)))
    .groupBy(inventoryMovements.variantId);
  const mats = await db.select({ v: variants, p: products }).from(variants).innerJoin(products, eq(products.id, variants.productId)).where(inArray(products.type, ['materia_prima', 'insumo']));
  // Pedidos promedio que cubre un material: consumo por pedido histórico
  const [ordersLast90] = await db.select({ n: sql<number>`count(*)::int` }).from(productionOrders).where(and(gte(productionOrders.createdAt, `${addDays(today, -90)}T00:00:00-05:00`), eq(productionOrders.status, 'terminada')));
  const materials = mats
    .map(({ v, p }) => {
      const available = Number(v.stock) - Number(v.reserved);
      const prodNeed = Number(pendingProd.find((x) => x.variantId === v.id)?.pending ?? 0);
      const unplannedQ = Math.round((unplannedNeed.get(v.id) ?? 0) * 100) / 100;
      const daily = Number(consumption.find((c) => c.variantId === v.id)?.qty ?? 0) / 90;
      const min = Number(v.minStock ?? p.minStock);
      const free = available - prodNeed - unplannedQ;
      const coverageDays = daily > 0 ? Math.max(0, Math.floor(free / daily)) : null;
      const perOrder = ordersLast90.n ? (daily * 90) / ordersLast90.n : 0;
      const coversOrders = perOrder > 0 ? Math.max(0, Math.floor(free / perOrder)) : null;
      const need30 = daily * 30;
      const recommended = Math.max(0, Math.ceil(min + need30 - free));
      const label = variantName(p, v);
      let why = '';
      if (recommended > 0) {
        why = `Se recomienda comprar ${formatQty(recommended)} ${p.unit}(s) porque, después de lo que necesita la producción pendiente (${formatQty(prodNeed + unplannedQ)}), quedarían ${formatQty(Math.max(free, 0))}`;
        why += coversOrders != null ? `, que alcanzan para aproximadamente ${coversOrders} pedido(s) típicos` : '';
        why += coverageDays != null ? ` o unos ${coverageDays} días de trabajo.` : '.';
      }
      return { variantId: v.id, label, unit: p.unit, available, productionNeed: Math.round((prodNeed + unplannedQ) * 100) / 100, dailyUse: Math.round(daily * 100) / 100, coverageDays, coversOrders, min, recommended, cost: v.cost ?? p.cost, why };
    })
    .filter((m) => m.recommended > 0 || m.productionNeed > 0)
    .sort((a, b) => (a.coverageDays ?? 999) - (b.coverageDays ?? 999));

  // ---------- 4. Proyección de flujo de dinero (próximas 4 semanas)
  const recv = await db
    .select({ due: orders.dueDate, promised: orders.promisedDate, balance: sql<number>`${orders.total} - ${orders.paid}` })
    .from(orders)
    .where(and(notInArray(orders.status, ['borrador', 'cancelado']), sql`${orders.total} > ${orders.paid}`));
  const pays = await db
    .select({ due: payables.dueDate, balance: sql<number>`${payables.amount} - ${payables.paid}` })
    .from(payables)
    .where(and(eq(payables.cancelled, false), sql`${payables.amount} > ${payables.paid}`));
  const [avgDaily] = await db
    .select({
      inc: sql<number>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.type}='ingreso' and ${cashMovements.category} = 'Venta'),0)::int`,
    })
    .from(cashMovements)
    .where(gte(cashMovements.createdAt, `${addDays(today, -56)}T00:00:00-05:00`));
  const counterPerWeek = Math.round(avgDaily.inc / 8);
  const weeks = [0, 1, 2, 3].map((w) => {
    const start = addDays(today, w * 7);
    const end = addDays(start, 6);
    const due = (d: string | null) => d && (w === 0 ? d <= end : d >= start && d <= end);
    const collections = recv.filter((r) => due(r.due ?? r.promised)).reduce((a, r) => a + Number(r.balance), 0);
    const obligations = pays.filter((p) => due(p.due)).reduce((a, p) => a + Number(p.balance), 0);
    return {
      label: w === 0 ? 'Esta semana (incluye vencidos)' : `Semana del ${start.slice(8, 10)}/${start.slice(5, 7)}`,
      counter: counterPerWeek,
      collections,
      obligations,
      net: counterPerWeek + collections - obligations,
    };
  });

  const monthsWithData = complete.length;
  res.json({
    generatedAt: new Date().toISOString(),
    disclaimer:
      'Estas cifras son ESTIMACIONES calculadas con reglas simples sobre los datos registrados en el sistema. No hay un modelo de inteligencia artificial conectado. Úsalas como guía, no como certeza.',
    history: {
      data: history,
      average: Math.round(avg),
      highSeason: high,
      lowSeason: lowM,
      method: `Ventas confirmadas por mes de los últimos ${monthsWithData} meses completos. El índice compara cada mes con el promedio (100 = mes normal).`,
    },
    forecast: {
      categories: forecast,
      total: totalNext,
      confidence: monthsWithData >= 24 ? 'media' : monthsWithData >= 12 ? 'baja-media' : 'baja',
      method:
        'Promedio de unidades de los últimos 3 meses, ajustado por la temporada del mismo mes del año anterior. Escenarios: conservador (−20 %), probable y alto (+25 %). ' +
        (monthsWithData < 24 ? 'Solo hay un año de historia: la temporada se basa en un único año y puede variar.' : ''),
    },
    materials: {
      items: materials,
      method:
        'Disponible actual menos lo que necesitan las órdenes de producción abiertas y los pedidos confirmados sin orden (según la receta de cada producto). La recomendación cubre el mínimo más 30 días del consumo promedio de los últimos 90 días.',
    },
    cashflow: {
      weeks,
      method:
        'Ventas de mostrador: promedio semanal de las últimas 8 semanas. Cobros: saldos de clientes según su fecha de vencimiento. Pagos: cuentas por pagar según vencimiento. No incluye gastos que aún no estén registrados (por ejemplo, nómina futura).',
    },
    daysOfData: diffDays(since, today),
  });
});

