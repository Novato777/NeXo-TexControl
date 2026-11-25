import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { adjustmentSchema, formatQty, MOVEMENT_TYPE_LABELS, physicalCountSchema, type MovementType } from '@nexo/shared';
import { dateQuery, idQuery, intQuery } from '../lib/security';
import { db } from '../db/client';
import { inventoryMovements, productionMaterials, productionOrders, products, purchaseItems, purchases, suppliers, users, variants } from '../db/schema';
import { audit } from '../lib/audit';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { badRequest, parse } from '../lib/errors';
import { getVariant, moveStock, round3, variantName } from '../services/inventory';

export const inventoryRouter = Router();
inventoryRouter.use(requireModule('inventario', 'produccion', 'productos'));

const MATERIAL_TYPES = ['materia_prima', 'insumo'];

async function stockRows(kind: string, q: string, category: string) {
  const types = kind === 'materiales' ? MATERIAL_TYPES : kind === 'terminado' ? ['terminado'] : ['terminado', ...MATERIAL_TYPES];
  const rows = await db
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      and(
        eq(products.active, true),
        inArray(products.type, types),
        category ? eq(products.category, category) : undefined,
        q ? or(ilike(products.name, `%${q}%`), ilike(variants.sku, `%${q}%`), ilike(variants.color, `%${q}%`), eq(variants.size, q)) : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(variants.id));
  return rows.map(({ v, p }) => {
    const stock = Number(v.stock);
    const reserved = Number(v.reserved);
    const available = round3(stock - reserved);
    const min = Number(v.minStock ?? p.minStock);
    const cost = v.cost ?? p.cost;
    return {
      variantId: v.id,
      productId: p.id,
      label: variantName(p, v),
      productName: p.name,
      size: v.size,
      color: v.color,
      sku: v.sku,
      type: p.type,
      category: p.category,
      unit: p.unit,
      location: p.location,
      stock,
      reserved,
      available,
      min,
      cost,
      value: Math.round(stock * cost),
      status: available <= 0 ? 'agotado' : available < min ? 'bajo' : 'ok',
    };
  });
}

inventoryRouter.get('/stock', async (req, res) => {
  const rows = await stockRows(String(req.query.kind ?? 'terminado'), String(req.query.q ?? '').trim(), String(req.query.category ?? ''));
  const status = String(req.query.status ?? '');
  res.json(status ? rows.filter((r) => (status === 'alerta' ? r.status !== 'ok' : r.status === status)) : rows);
});

inventoryRouter.get('/summary', async (_req, res) => {
  const all = await stockRows('todo', '', '');
  const fin = all.filter((r) => r.type === 'terminado');
  const mat = all.filter((r) => r.type !== 'terminado');
  res.json({
    finishedValue: fin.reduce((a, r) => a + r.value, 0),
    materialsValue: mat.reduce((a, r) => a + r.value, 0),
    finishedUnits: fin.reduce((a, r) => a + r.stock, 0),
    reservedUnits: fin.reduce((a, r) => a + r.reserved, 0),
    lowFinished: fin.filter((r) => r.status !== 'ok').length,
    lowMaterials: mat.filter((r) => r.status !== 'ok').length,
    outOfStock: all.filter((r) => r.status === 'agotado').length,
  });
});

inventoryRouter.get('/movements', async (req, res) => {
  const variantId = idQuery(req.query.variantId);
  const type = String(req.query.type ?? '');
  const direction = String(req.query.direction ?? '');
  const q = String(req.query.q ?? '').trim();
  const from = dateQuery(req.query.from, '') || null;
  const to = dateQuery(req.query.to, '') || null;
  const limit = intQuery(req.query.limit, 100, 1, 1000);
  const offset = intQuery(req.query.offset, 0, 0, 1_000_000);
  const where = and(
    variantId ? eq(inventoryMovements.variantId, variantId) : undefined,
    type ? eq(inventoryMovements.type, type) : undefined,
    direction === 'entrada' ? sql`${inventoryMovements.quantity} > 0` : direction === 'salida' ? sql`${inventoryMovements.quantity} < 0` : undefined,
    q ? or(ilike(products.name, `%${q}%`), ilike(inventoryMovements.reference, `%${q}%`), ilike(inventoryMovements.reason, `%${q}%`)) : undefined,
    from ? gte(inventoryMovements.createdAt, `${from}T00:00:00-05:00`) : undefined,
    to ? lte(inventoryMovements.createdAt, `${to}T23:59:59-05:00`) : undefined,
  );
  const rows = await db
    .select({ m: inventoryMovements, v: variants, p: products, userName: users.name })
    .from(inventoryMovements)
    .innerJoin(variants, eq(variants.id, inventoryMovements.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(users, eq(users.id, inventoryMovements.userId))
    .where(where)
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(limit + 1)
    .offset(offset);
  res.json({
    hasMore: rows.length > limit,
    rows: rows.slice(0, limit).map((r) => ({
      ...r.m,
      quantity: Number(r.m.quantity),
      stockAfter: Number(r.m.stockAfter),
      typeLabel: MOVEMENT_TYPE_LABELS[r.m.type as MovementType] ?? r.m.type,
      label: variantName(r.p, r.v),
      unit: r.p.unit,
      userName: r.userName ?? 'Sistema',
    })),
  });
});

inventoryRouter.post('/adjust', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'inventario.ajustar', 'Solo Inventario o el administrador pueden ajustar existencias.');
  const input = parse(adjustmentSchema, req.body);
  const mov = await db.transaction(async (tx) => {
    const { label, unit } = await getVariant(tx, input.variantId);
    const qty = input.direction === 'entrada' ? input.quantity : -input.quantity;
    const type: MovementType = input.direction === 'entrada' ? 'entrada_ajuste' : input.kind === 'merma' ? 'salida_merma' : 'salida_ajuste';
    const m = await moveStock(tx, { variantId: input.variantId, quantity: qty, type, reason: input.reason, reference: 'AJUSTE', userId: user.id, checkAvailable: qty < 0 });
    await audit(tx, user, {
      action: 'ajuste_stock',
      entity: 'inventario',
      entityId: input.variantId,
      summary: `${MOVEMENT_TYPE_LABELS[type]}: ${qty > 0 ? '+' : ''}${formatQty(qty)} ${unit} de ${label}. Motivo: ${input.reason}`,
      sensitive: true,
    });
    return m;
  });
  res.status(201).json(mov);
});

/** Conteo físico: compara lo contado con el sistema y ajusta las diferencias. */
inventoryRouter.post('/count', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'inventario.ajustar', 'Solo Inventario o el administrador pueden registrar conteos.');
  const input = parse(physicalCountSchema, req.body);
  const result = await db.transaction(async (tx) => {
    const diffs = [];
    for (const l of input.lines) {
      const { v, label, unit } = await getVariant(tx, l.variantId, true);
      const diff = round3(l.counted - Number(v.stock));
      if (diff === 0) continue;
      if (l.counted < Number(v.reserved)) {
        throw badRequest(`"${label}": contaste ${formatQty(l.counted)} pero hay ${formatQty(v.reserved)} separadas para pedidos. Revisa el conteo.`);
      }
      await moveStock(tx, {
        variantId: v.id,
        quantity: diff,
        type: diff > 0 ? 'entrada_ajuste' : 'salida_ajuste',
        reason: `Conteo físico${input.note ? `: ${input.note}` : ''}`,
        reference: 'CONTEO',
        userId: user.id,
      });
      diffs.push({ label, unit, system: Number(v.stock), counted: l.counted, diff });
    }
    if (diffs.length) {
      await audit(tx, user, {
        action: 'conteo_fisico',
        entity: 'inventario',
        summary: `Conteo físico con ${diffs.length} diferencia(s): ${diffs.map((d) => `${d.label} ${d.diff > 0 ? '+' : ''}${formatQty(d.diff)}`).join('; ')}`,
        sensitive: true,
        detail: diffs,
      });
    }
    return diffs;
  });
  res.json({ adjusted: result.length, diffs: result });
});

/** Lista de reposición: bajo mínimo + lo que necesita producción pendiente. */
inventoryRouter.get('/reorder', async (_req, res) => {
  const all = await stockRows('todo', '', '');
  const pendingMat = await db
    .select({ variantId: productionMaterials.variantId, pending: sql<string>`sum(greatest(${productionMaterials.qtyRequired} - ${productionMaterials.qtyConsumed}, 0))` })
    .from(productionMaterials)
    .innerJoin(productionOrders, eq(productionOrders.id, productionMaterials.productionOrderId))
    .where(inArray(productionOrders.status, ['pendiente', 'en_proceso']))
    .groupBy(productionMaterials.variantId);
  const incoming = await db
    .select({ variantId: purchaseItems.variantId, qty: sql<string>`sum(${purchaseItems.quantity} - ${purchaseItems.qtyReceived})` })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .where(inArray(purchases.status, ['pedida', 'recibida_parcial']))
    .groupBy(purchaseItems.variantId);
  const lastSupplier = await db
    .selectDistinctOn([purchaseItems.variantId], { variantId: purchaseItems.variantId, supplierId: suppliers.id, supplierName: suppliers.name, unitCost: purchaseItems.unitCost })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .orderBy(purchaseItems.variantId, desc(purchases.date));
  const out = [];
  for (const r of all) {
    const needProd = Number(pendingMat.find((p) => p.variantId === r.variantId)?.pending ?? 0);
    const onTheWay = Number(incoming.find((p) => p.variantId === r.variantId)?.qty ?? 0);
    const projected = round3(r.available - needProd + onTheWay);
    if (projected >= r.min) continue;
    const suggested = Math.ceil(r.min * 2 - projected);
    const sup = lastSupplier.find((s) => s.variantId === r.variantId);
    const why =
      needProd > 0
        ? `Hay ${formatQty(r.available)} ${r.unit}; la producción pendiente necesita ${formatQty(needProd)}${onTheWay ? ` y vienen ${formatQty(onTheWay)} en camino` : ''}. El mínimo es ${formatQty(r.min)}.`
        : `Hay ${formatQty(r.available)} ${r.unit} disponibles y el mínimo es ${formatQty(r.min)}${onTheWay ? `; vienen ${formatQty(onTheWay)} en camino` : ''}.`;
    out.push({ ...r, needProduction: needProd, onTheWay, projected, suggested, supplierId: sup?.supplierId ?? null, supplierName: sup?.supplierName ?? null, lastCost: sup?.unitCost ?? r.cost, why, action: r.type === 'terminado' && !sup ? 'producir' : 'comprar' });
  }
  out.sort((a, b) => a.projected - a.min - (b.projected - b.min));
  res.json(out);
});
