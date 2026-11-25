import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { addDays, formatCOP, marginPct, PRODUCT_TYPE_LABELS, productSchema, STOCK_PRODUCT_TYPES, todayISO, type ProductType } from '@nexo/shared';
import { db, type Executor } from '../db/client';
import { billOfMaterials, inventoryMovements, orderItems, orders, products, users, variants } from '../db/schema';
import { audit } from '../lib/audit';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { nextNumber } from '../lib/counters';
import { badRequest, idParam, notFound, parse } from '../lib/errors';
import { moveStock, variantName } from '../services/inventory';

export const productsRouter = Router();
productsRouter.use(requireModule('productos', 'inventario', 'pedidos', 'produccion', 'proveedores'));

const minOf = (v: { minStock: number | null }, p: { minStock: number }) => Number(v.minStock ?? p.minStock);

function skuBase(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w.slice(0, 3))
    .join('-') || 'PRD';
}

async function uniqueSku(tx: Executor, table: typeof products | typeof variants, base: string) {
  let sku = base;
  for (let i = 2; i < 200; i++) {
    const [hit] = await tx.select({ id: table.id }).from(table).where(eq(table.sku, sku));
    if (!hit) return sku;
    sku = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

// ---------- Búsqueda de variantes para formularios (pedidos, ventas, compras, producción)
productsRouter.get('/variants/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const types = String(req.query.types ?? '')
    .split(',')
    .filter(Boolean);
  const onlyAvailable = req.query.onlyAvailable === 'true';
  const rows = await db
    .select({ v: variants, p: products })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      and(
        eq(products.active, true),
        eq(variants.active, true),
        types.length ? inArray(products.type, types) : undefined,
        q ? or(ilike(products.name, `%${q}%`), ilike(variants.sku, `%${q}%`), ilike(products.sku, `%${q}%`), ilike(products.category, `%${q}%`)) : undefined,
        onlyAvailable ? sql`${variants.stock} - ${variants.reserved} > 0` : undefined,
      ),
    )
    .orderBy(asc(products.name), asc(variants.id))
    .limit(400);
  res.json(
    rows.map(({ v, p }) => ({
      id: v.id,
      productId: p.id,
      productName: p.name,
      label: variantName(p, v),
      sku: v.sku,
      size: v.size,
      color: v.color,
      type: p.type,
      category: p.category,
      unit: p.unit,
      price: v.price ?? p.price,
      cost: v.cost ?? p.cost,
      stock: Number(v.stock),
      reserved: Number(v.reserved),
      available: Number(v.stock) - Number(v.reserved),
      minStock: minOf(v, p),
      customizable: p.customizable,
    })),
  );
});

// ---------- Exportar catálogo CSV
productsRouter.get('/export.csv', async (_req, res) => {
  const rows = await db.select({ v: variants, p: products }).from(variants).innerJoin(products, eq(products.id, variants.productId)).orderBy(asc(products.name));
  const head = ['SKU', 'Producto', 'Tipo', 'Categoría', 'Talla', 'Color', 'Unidad', 'Precio', 'Costo', 'Stock', 'Reservado', 'Disponible', 'Mínimo', 'Estado'];
  const esc = (x: unknown) => `"${csvSafe(x).replace(/"/g, '""')}"`;
  const lines = rows.map(({ v, p }) =>
    [v.sku, p.name, PRODUCT_TYPE_LABELS[p.type as ProductType], p.category, v.size ?? '', v.color ?? '', p.unit, v.price ?? p.price, v.cost ?? p.cost, Number(v.stock), Number(v.reserved), Number(v.stock) - Number(v.reserved), minOf(v, p), p.active ? 'Activo' : 'Archivado']
      .map(esc)
      .join(';'),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="catalogo-${todayISO()}.csv"`);
  res.send('﻿' + [head.map(esc).join(';'), ...lines].join('\r\n'));
});

// ---------- Lista
productsRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const type = String(req.query.type ?? '');
  const category = String(req.query.category ?? '');
  const status = String(req.query.status ?? 'active');
  const lowOnly = req.query.lowStock === 'true';
  const prods = await db
    .select()
    .from(products)
    .where(
      and(
        status === 'archived' ? eq(products.active, false) : status === 'all' ? undefined : eq(products.active, true),
        type ? eq(products.type, type) : undefined,
        category ? eq(products.category, category) : undefined,
        q ? or(ilike(products.name, `%${q}%`), ilike(products.sku, `%${q}%`), ilike(products.category, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(asc(products.name));
  const vars = prods.length ? await db.select().from(variants).where(inArray(variants.productId, prods.map((p) => p.id))) : [];
  const out = prods.map((p) => {
    const vs = vars.filter((v) => v.productId === p.id);
    const stock = vs.reduce((a, v) => a + Number(v.stock), 0);
    const reserved = vs.reduce((a, v) => a + Number(v.reserved), 0);
    const isStock = STOCK_PRODUCT_TYPES.includes(p.type as ProductType);
    const lowCount = isStock ? vs.filter((v) => Number(v.stock) - Number(v.reserved) < minOf(v, p)).length : 0;
    const prices = vs.map((v) => v.price ?? p.price);
    return {
      ...p,
      variantsCount: vs.length,
      sizes: [...new Set(vs.map((v) => v.size).filter(Boolean))],
      colors: [...new Set(vs.map((v) => v.color).filter(Boolean))],
      stock,
      reserved,
      available: stock - reserved,
      lowCount,
      minPrice: Math.min(...prices, p.price),
      maxPrice: Math.max(...prices, p.price),
      margin: marginPct(p.price, p.cost),
      isStock,
    };
  });
  res.json(lowOnly ? out.filter((p) => p.lowCount > 0) : out);
});

// ---------- Detalle
productsRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) throw notFound('El producto');
  const vs = await db.select().from(variants).where(eq(variants.productId, id)).orderBy(asc(variants.id));
  const bom = await db
    .select({ b: billOfMaterials, v: variants, mp: products })
    .from(billOfMaterials)
    .innerJoin(variants, eq(variants.id, billOfMaterials.materialVariantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(billOfMaterials.productId, id));
  const vIds = vs.map((v) => v.id);
  const movements = vIds.length
    ? await db
        .select({ m: inventoryMovements, userName: users.name })
        .from(inventoryMovements)
        .leftJoin(users, eq(users.id, inventoryMovements.userId))
        .where(inArray(inventoryMovements.variantId, vIds))
        .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
        .limit(40)
    : [];
  const since = addDays(todayISO(), -90);
  const sales = vIds.length
    ? await db
        .select({ variantId: orderItems.variantId, units: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal})::int` })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(inArray(orderItems.variantId, vIds), gte(orders.orderDate, since), ne(orders.status, 'cancelado'), ne(orders.status, 'borrador')))
        .groupBy(orderItems.variantId)
    : [];
  res.json({
    product: { ...p, margin: marginPct(p.price, p.cost), isStock: STOCK_PRODUCT_TYPES.includes(p.type as ProductType) },
    variants: vs.map((v) => {
      const s = sales.find((x) => x.variantId === v.id);
      return {
        ...v,
        label: variantName(p, v),
        stock: Number(v.stock),
        reserved: Number(v.reserved),
        available: Number(v.stock) - Number(v.reserved),
        effectivePrice: v.price ?? p.price,
        effectiveCost: v.cost ?? p.cost,
        effectiveMin: minOf(v, p),
        low: Number(v.stock) - Number(v.reserved) < minOf(v, p),
        sold90: s?.units ?? 0,
      };
    }),
    bom: bom.map((b) => ({ id: b.b.id, materialVariantId: b.v.id, name: variantName(b.mp, b.v), unit: b.mp.unit, qtyPerUnit: Number(b.b.qtyPerUnit), cost: b.v.cost ?? b.mp.cost })),
    movements: movements.map((m) => ({ ...m.m, label: variantName(p, vs.find((v) => v.id === m.m.variantId)!), userName: m.userName })),
    sales90: { units: sales.reduce((a, s) => a + s.units, 0), revenue: sales.reduce((a, s) => a + s.revenue, 0) },
  });
});

// ---------- Crear
productsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'producto.editar');
  const input = parse(productSchema, req.body);
  const created = await db.transaction(async (tx) => {
    const sku = input.sku ? input.sku.toUpperCase() : await uniqueSku(tx, products, `${skuBase(input.name)}-${String((await nextNumber(tx, 'sku', 'X')).slice(2))}`);
    const [dup] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, sku));
    if (dup) throw badRequest('Ese código (SKU) ya existe. Déjalo vacío para crear uno automático.', { sku: 'Código repetido.' });
    const { variants: vInputs, ...data } = input;
    const [p] = await tx.insert(products).values({ ...data, sku }).returning();
    const seen = new Set<string>();
    for (const vi of vInputs) {
      const key = `${vi.size ?? ''}|${vi.color ?? ''}`;
      if (seen.has(key)) throw badRequest(`La combinación talla "${vi.size ?? 'única'}" y color "${vi.color ?? '—'}" está repetida.`);
      seen.add(key);
      const vsku = await uniqueSku(tx, variants, vi.sku || [sku, vi.size, vi.color?.slice(0, 3).toUpperCase()].filter(Boolean).join('-'));
      const [v] = await tx
        .insert(variants)
        .values({ productId: p.id, sku: vsku, size: vi.size, color: vi.color, price: vi.price && vi.price !== p.price ? vi.price : null, cost: vi.cost ?? null, minStock: vi.minStock ?? null })
        .returning();
      if (vi.initialStock && vi.initialStock > 0 && STOCK_PRODUCT_TYPES.includes(p.type as ProductType)) {
        await moveStock(tx, { variantId: v.id, quantity: vi.initialStock, type: 'entrada_ajuste', reason: 'Inventario inicial al crear el producto', reference: p.sku, userId: user.id, unitCost: p.cost });
      }
    }
    await audit(tx, user, { action: 'producto_creado', entity: 'producto', entityId: p.id, reference: p.sku, summary: `Producto ${p.name} creado (${vInputs.length} variante(s))` });
    return p;
  });
  res.status(201).json(created);
});

// ---------- Editar
productsRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'producto.editar');
  const id = idParam(req.params.id);
  const input = parse(productSchema, req.body);
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(products).where(eq(products.id, id));
    if (!old) throw notFound('El producto');
    const { variants: vInputs, ...data } = input;
    const sku = (input.sku || old.sku).toUpperCase();
    if (sku !== old.sku) {
      const [dup] = await tx.select({ id: products.id }).from(products).where(and(eq(products.sku, sku), ne(products.id, id)));
      if (dup) throw badRequest('Ese código (SKU) ya lo usa otro producto.', { sku: 'Código repetido.' });
    }
    if (old.type !== data.type) {
      const [mov] = await tx.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements).innerJoin(variants, eq(variants.id, inventoryMovements.variantId)).where(eq(variants.productId, id));
      if (mov.n > 0) throw badRequest('No se puede cambiar el tipo de un producto que ya tiene movimientos de inventario.');
    }
    await tx.update(products).set({ ...data, sku }).where(eq(products.id, id));
    if (old.price !== data.price || old.cost !== data.cost) {
      await audit(tx, user, {
        action: 'precio_modificado',
        entity: 'producto',
        entityId: id,
        reference: sku,
        summary: `${old.name}: precio ${formatCOP(old.price)} → ${formatCOP(data.price)}; costo ${formatCOP(old.cost)} → ${formatCOP(data.cost)}`,
        sensitive: true,
      });
    }
    const existing = await tx.select().from(variants).where(eq(variants.productId, id));
    for (const vi of vInputs) {
      if (vi.id) {
        const ev = existing.find((e) => e.id === vi.id);
        if (!ev) continue;
        await tx
          .update(variants)
          .set({ size: vi.size, color: vi.color, price: vi.price && vi.price !== data.price ? vi.price : null, cost: vi.cost ?? null, minStock: vi.minStock ?? null })
          .where(eq(variants.id, ev.id));
      } else {
        if (existing.some((e) => (e.size ?? '') === (vi.size ?? '') && (e.color ?? '') === (vi.color ?? ''))) {
          throw badRequest(`Ya existe la variante talla "${vi.size ?? 'única'}" color "${vi.color ?? '—'}".`);
        }
        const vsku = await uniqueSku(tx, variants, [sku, vi.size, vi.color?.slice(0, 3).toUpperCase()].filter(Boolean).join('-'));
        const [v] = await tx
          .insert(variants)
          .values({ productId: id, sku: vsku, size: vi.size, color: vi.color, price: vi.price && vi.price !== data.price ? vi.price : null, cost: vi.cost ?? null, minStock: vi.minStock ?? null })
          .returning();
        if (vi.initialStock && vi.initialStock > 0 && STOCK_PRODUCT_TYPES.includes(data.type)) {
          await moveStock(tx, { variantId: v.id, quantity: vi.initialStock, type: 'entrada_ajuste', reason: 'Inventario inicial de nueva variante', reference: sku, userId: user.id });
        }
      }
    }
    await audit(tx, user, { action: 'producto_editado', entity: 'producto', entityId: id, reference: sku, summary: `Producto ${data.name} actualizado` });
  });
  res.json({ ok: true });
});

productsRouter.post('/:id/duplicate', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'producto.editar');
  const id = idParam(req.params.id);
  const created = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, id));
    if (!p) throw notFound('El producto');
    const sku = await uniqueSku(tx, products, `${p.sku}-COPIA`);
    const { id: _id, createdAt: _c, ...rest } = p;
    const [np] = await tx.insert(products).values({ ...rest, sku, name: `${p.name} (copia)` }).returning();
    const vs = await tx.select().from(variants).where(eq(variants.productId, id));
    for (const v of vs) {
      await tx.insert(variants).values({ productId: np.id, sku: await uniqueSku(tx, variants, v.sku.replace(p.sku, sku)), size: v.size, color: v.color, price: v.price, cost: v.cost, minStock: v.minStock });
    }
    const bom = await tx.select().from(billOfMaterials).where(eq(billOfMaterials.productId, id));
    for (const b of bom) await tx.insert(billOfMaterials).values({ productId: np.id, materialVariantId: b.materialVariantId, qtyPerUnit: b.qtyPerUnit });
    await audit(tx, user, { action: 'producto_duplicado', entity: 'producto', entityId: np.id, reference: sku, summary: `Producto ${np.name} creado como copia de ${p.name} (sin existencias)` });
    return np;
  });
  res.status(201).json(created);
});

productsRouter.post('/:id/archive', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'producto.editar');
  const id = idParam(req.params.id);
  const active = Boolean(req.body?.active ?? false);
  await db.transaction(async (tx) => {
    const [p] = await tx.update(products).set({ active }).where(eq(products.id, id)).returning();
    if (!p) throw notFound('El producto');
    await audit(tx, user, { action: active ? 'producto_activado' : 'producto_archivado', entity: 'producto', entityId: id, reference: p.sku, summary: `Producto ${p.name} ${active ? 'reactivado' : 'archivado'}` });
  });
  res.json({ ok: true });
});

/** Receta (materiales por unidad). */
productsRouter.put('/:id/bom', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'producto.editar');
  const id = idParam(req.params.id);
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []) as Array<{ materialVariantId: number; qtyPerUnit: number }>;
  await db.transaction(async (tx) => {
    await tx.delete(billOfMaterials).where(eq(billOfMaterials.productId, id));
    for (const l of lines) {
      const q = Number(l.qtyPerUnit);
      if (!Number.isFinite(q) || q <= 0) throw badRequest('La cantidad por unidad debe ser mayor que cero.');
      await tx.insert(billOfMaterials).values({ productId: id, materialVariantId: Number(l.materialVariantId), qtyPerUnit: q });
    }
    await audit(tx, user, { action: 'receta_editada', entity: 'producto', entityId: id, summary: `Receta de materiales actualizada (${lines.length} materiales)` });
  });
  res.json({ ok: true });
});import { csvSafe } from '../lib/security';

