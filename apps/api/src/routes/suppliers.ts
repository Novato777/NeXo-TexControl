import { Router } from 'express';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { formatCOP, purchaseCreateSchema, purchaseReceiveSchema, supplierSchema, todayISO } from '@nexo/shared';
import { csvSafe, idQuery } from '../lib/security';
import { db } from '../db/client';
import { payables, products, purchaseItems, purchases, suppliers, users, variants } from '../db/schema';
import { audit } from '../lib/audit';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { badRequest, idParam, notFound, parse } from '../lib/errors';
import { variantName } from '../services/inventory';
import { createPurchase, receivePurchase } from '../services/purchasing';

// ================================================================ PROVEEDORES
export const suppliersRouter = Router();
suppliersRouter.use(requireModule('proveedores', 'inventario', 'caja'));

suppliersRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await db
    .select({
      s: suppliers,
      purchasesCount: sql<number>`(select count(*)::int from purchases p where p.supplier_id = ${suppliers.id} and p.status <> 'cancelada')`,
      totalBought: sql<number>`(select coalesce(sum(total),0)::int from purchases p where p.supplier_id = ${suppliers.id} and p.status <> 'cancelada')`,
      balance: sql<number>`(select coalesce(sum(amount - paid),0)::int from payables x where x.supplier_id = ${suppliers.id} and not x.cancelled)`,
      lastPurchase: sql<string | null>`(select max(date) from purchases p where p.supplier_id = ${suppliers.id})`,
    })
    .from(suppliers)
    .where(and(eq(suppliers.archived, false), q ? or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.document, `%${q}%`), ilike(suppliers.supplies, `%${q}%`)) : undefined))
    .orderBy(asc(suppliers.name));
  res.json(rows.map((r) => ({ ...r.s, purchasesCount: r.purchasesCount, totalBought: r.totalBought, balance: r.balance, lastPurchase: r.lastPurchase })));
});

suppliersRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) throw notFound('El proveedor');
  const purch = await db.select().from(purchases).where(eq(purchases.supplierId, id)).orderBy(desc(purchases.date), desc(purchases.id));
  const pays = await db.select().from(payables).where(and(eq(payables.supplierId, id), eq(payables.cancelled, false))).orderBy(asc(payables.dueDate));
  const prices = await db
    .select({ pi: purchaseItems, date: purchases.date, v: variants, p: products })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .innerJoin(variants, eq(variants.id, purchaseItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(purchases.supplierId, id))
    .orderBy(desc(purchases.date))
    .limit(60);
  const today = todayISO();
  res.json({
    supplier: s,
    purchases: purch,
    payables: pays.map((p) => ({ ...p, balance: p.amount - p.paid, overdue: p.amount > p.paid && p.dueDate < today })),
    priceHistory: prices.map((x) => ({ date: x.date, label: variantName(x.p, x.v), unit: x.p.unit, quantity: Number(x.pi.quantity), unitCost: x.pi.unitCost })),
    summary: {
      totalBought: purch.filter((p) => p.status !== 'cancelada').reduce((a, p) => a + p.total, 0),
      balance: pays.reduce((a, p) => a + p.amount - p.paid, 0),
      overdue: pays.filter((p) => p.dueDate < today).reduce((a, p) => a + p.amount - p.paid, 0),
    },
  });
});

suppliersRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'proveedor.editar');
  const input = parse(supplierSchema, req.body);
  const s = await db.transaction(async (tx) => {
    const [row] = await tx.insert(suppliers).values(input).returning();
    await audit(tx, user, { action: 'proveedor_creado', entity: 'proveedor', entityId: row.id, summary: `Proveedor ${row.name} creado` });
    return row;
  });
  res.status(201).json(s);
});

suppliersRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'proveedor.editar');
  const id = idParam(req.params.id);
  const input = parse(supplierSchema, req.body);
  const s = await db.transaction(async (tx) => {
    const [row] = await tx.update(suppliers).set(input).where(eq(suppliers.id, id)).returning();
    if (!row) throw notFound('El proveedor');
    await audit(tx, user, { action: 'proveedor_editado', entity: 'proveedor', entityId: id, summary: `Proveedor ${row.name} actualizado` });
    return row;
  });
  res.json(s);
});

suppliersRouter.post('/:id/archive', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'proveedor.editar');
  const id = idParam(req.params.id);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(suppliers).set({ archived: true }).where(eq(suppliers.id, id)).returning();
    if (!row) throw notFound('El proveedor');
    await audit(tx, user, { action: 'proveedor_archivado', entity: 'proveedor', entityId: id, summary: `Proveedor ${row.name} archivado` });
  });
  res.json({ ok: true });
});

// ================================================================ COMPRAS
export const purchasesRouter = Router();
purchasesRouter.use(requireModule('proveedores', 'inventario'));

purchasesRouter.get('/', async (req, res) => {
  const status = String(req.query.status ?? '');
  const rows = await db
    .select({ p: purchases, supplierName: suppliers.name, paid: payables.paid, payableAmount: payables.amount })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(payables, eq(payables.purchaseId, purchases.id))
    .where(and(status === 'abiertas' ? sql`${purchases.status} in ('pedida','recibida_parcial')` : status ? eq(purchases.status, status) : undefined, idQuery(req.query.supplierId) ? eq(purchases.supplierId, idQuery(req.query.supplierId)!) : undefined))
    .orderBy(desc(purchases.date), desc(purchases.id))
    .limit(200);
  res.json(rows.map((r) => ({ ...r.p, supplierName: r.supplierName, paid: r.paid ?? 0, balance: (r.payableAmount ?? r.p.total) - (r.paid ?? 0) })));
});

purchasesRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [row] = await db
    .select({ p: purchases, s: suppliers, userName: users.name })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(eq(purchases.id, id));
  if (!row) throw notFound('La compra');
  const items = await db
    .select({ pi: purchaseItems, v: variants, p: products })
    .from(purchaseItems)
    .innerJoin(variants, eq(variants.id, purchaseItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(asc(purchaseItems.id));
  const [pay] = await db.select().from(payables).where(eq(payables.purchaseId, id));
  res.json({
    purchase: { ...row.p, createdByName: row.userName },
    supplier: row.s,
    items: items.map((i) => ({ ...i.pi, quantity: Number(i.pi.quantity), qtyReceived: Number(i.pi.qtyReceived), unit: i.p.unit, label: variantName(i.p, i.v), pending: Number(i.pi.quantity) - Number(i.pi.qtyReceived) })),
    payable: pay ? { ...pay, balance: pay.amount - pay.paid } : null,
  });
});

purchasesRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'compra.gestionar');
  const input = parse(purchaseCreateSchema, req.body);
  const p = await db.transaction((tx) => createPurchase(tx, input, user));
  res.status(201).json(p);
});

purchasesRouter.post('/:id/receive', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'compra.gestionar');
  const input = parse(purchaseReceiveSchema, req.body);
  const r = await db.transaction((tx) => receivePurchase(tx, idParam(req.params.id), input, user));
  res.json(r);
});

purchasesRouter.post('/:id/cancel', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'compra.gestionar');
  const id = idParam(req.params.id);
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) throw badRequest('Escribe el motivo de la cancelación.', { reason: 'Obligatorio.' });
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update');
    if (!p) throw notFound('La compra');
    if (p.status !== 'pedida') throw badRequest('Solo se puede cancelar una compra que todavía no se ha recibido.');
    const [pay] = await tx.select().from(payables).where(eq(payables.purchaseId, id));
    if (pay && pay.paid > 0) throw badRequest(`Esta compra ya tiene pagos por ${formatCOP(pay.paid)}. Primero gestiona la devolución con el proveedor.`);
    await tx.update(purchases).set({ status: 'cancelada', notes: `${p.notes ? p.notes + ' · ' : ''}Cancelada: ${reason}` }).where(eq(purchases.id, id));
    if (pay) await tx.update(payables).set({ cancelled: true }).where(eq(payables.id, pay.id));
    await audit(tx, user, { action: 'compra_cancelada', entity: 'compra', entityId: id, reference: p.number, summary: `Compra ${p.number} cancelada: ${reason}`, sensitive: true });
  });
  res.json({ ok: true });
});
