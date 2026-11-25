// Producción: órdenes, etapas, consumo de materiales, avance y cierre con control de calidad.
// Regla clave: los materiales solo se descuentan cuando se registra el consumo (una sola vez por orden).
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { formatQty, INCIDENT_LABELS, type IncidentType, type Priority } from '@nexo/shared';
import type { Executor } from '../db/client';
import {
  billOfMaterials,
  orders,
  productionEvents,
  productionItems,
  productionMaterials,
  productionOrders,
  products,
  settings,
  variants,
} from '../db/schema';
import { audit } from '../lib/audit';
import type { AuthUser } from '../lib/auth';
import { nextNumber } from '../lib/counters';
import { badRequest, notFound } from '../lib/errors';
import { getVariant, moveStock, reserve, round3, variantName } from './inventory';
import { addOrderEvent, getOrder, needsProduction, orderShortages } from './orders';

type Opts = { at?: string };

export async function getStages(tx: Executor): Promise<string[]> {
  const [s] = await tx.select({ stages: settings.productionStages }).from(settings).limit(1);
  return s?.stages ?? ['Corte', 'Confección', 'Acabados', 'Control de calidad', 'Empaque'];
}

export function progressOf(stageIndex: number, stagesCount: number, done: number, total: number, status: string) {
  if (status === 'terminada') return 100;
  const stagePart = stagesCount > 0 ? stageIndex / stagesCount : 0;
  const unitsPart = total > 0 ? done / total : 0;
  return Math.min(99, Math.round(stagePart * 60 + unitsPart * 40));
}

async function addEvent(tx: Executor, poId: number, type: string, summary: string, userId: number | null, at?: string, subtype?: string) {
  await tx
    .insert(productionEvents)
    .values({ productionOrderId: poId, type, subtype: subtype ?? null, summary, userId, ...(at ? { createdAt: at } : {}) });
}

export async function getProductionOrder(tx: Executor, id: number, lock = false) {
  const q = tx.select().from(productionOrders).where(eq(productionOrders.id, id));
  const [po] = lock ? await q.for('update') : await q;
  if (!po) throw notFound('La orden de producción');
  return po;
}

/** Calcula materiales requeridos según la receta (BOM) de cada producto. */
async function computeMaterials(tx: Executor, lines: { variantId: number; quantity: number }[]) {
  const req = new Map<number, number>();
  for (const l of lines) {
    const { p } = await getVariant(tx, l.variantId);
    const bom = await tx.select().from(billOfMaterials).where(eq(billOfMaterials.productId, p.id));
    for (const b of bom) {
      req.set(b.materialVariantId, round3((req.get(b.materialVariantId) ?? 0) + Number(b.qtyPerUnit) * l.quantity));
    }
  }
  return req;
}

export async function createProductionOrder(
  tx: Executor,
  input: {
    orderId?: number | null;
    targetDate: string;
    priority: Priority;
    responsible?: string | null;
    notes?: string | null;
    items?: { variantId: number; quantity: number; specs?: string | null }[];
  },
  user: AuthUser,
  opts: Opts = {},
) {
  const stages = await getStages(tx);
  let lines: { variantId: number; quantity: number; specs: string | null; orderItemId: number | null; description: string }[] = [];
  let orderNumber: string | null = null;

  if (input.orderId) {
    const order = await getOrder(tx, input.orderId, true);
    if (!['confirmado', 'en_produccion'].includes(order.status)) {
      throw badRequest('Solo se puede enviar a producción un pedido confirmado.');
    }
    orderNumber = order.number;
    // Lo que ya está en órdenes activas no se vuelve a fabricar.
    const active = await tx
      .select({ it: productionItems })
      .from(productionItems)
      .innerJoin(productionOrders, eq(productionOrders.id, productionItems.productionOrderId))
      .where(and(eq(productionOrders.orderId, order.id), ne(productionOrders.status, 'cancelada')));
    const inProd = new Map<number, number>();
    for (const a of active) {
      if (a.it.orderItemId) inProd.set(a.it.orderItemId, (inProd.get(a.it.orderItemId) ?? 0) + a.it.quantity - (a.it.qtyDone ?? 0));
    }
    for (const s of await orderShortages(tx, order.id)) {
      const pending = s.missing - (inProd.get(s.item.id) ?? 0);
      if (pending <= 0) continue;
      const c = (s.item.customization ?? {}) as Record<string, unknown>;
      const specs = [
        c.technique && c.technique !== 'ninguna' ? `Técnica: ${c.technique}` : null,
        c.logo ? 'Lleva logo' : null,
        c.position ? `Ubicación: ${c.position}` : null,
        c.names ? `Nombres: ${c.names}` : null,
        c.measures ? `Medidas: ${c.measures}` : null,
        c.notes ? String(c.notes) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push({ variantId: s.item.variantId, quantity: pending, specs: specs || null, orderItemId: s.item.id, description: s.item.description });
    }
    if (!lines.length) {
      throw badRequest('Todo este pedido ya está separado en bodega o en producción. Puedes marcarlo como "Listo".');
    }
  } else {
    if (!input.items?.length) throw badRequest('Agrega al menos un producto para fabricar.');
    for (const it of input.items) {
      const { p, label } = await getVariant(tx, it.variantId);
      if (p.type !== 'terminado') throw badRequest(`"${label}" no es un producto terminado.`);
      lines.push({ variantId: it.variantId, quantity: it.quantity, specs: it.specs ?? null, orderItemId: null, description: label });
    }
  }

  const number = await nextNumber(tx, 'produccion', 'OP');
  const [po] = await tx
    .insert(productionOrders)
    .values({
      number,
      orderId: input.orderId ?? null,
      stage: stages[0],
      status: 'pendiente',
      priority: input.priority,
      targetDate: input.targetDate,
      responsible: input.responsible ?? null,
      notes: input.notes ?? null,
      createdBy: user.id,
      ...(opts.at ? { createdAt: opts.at } : {}),
    })
    .returning();
  await tx.insert(productionItems).values(
    lines.map((l) => ({
      productionOrderId: po.id,
      orderItemId: l.orderItemId,
      variantId: l.variantId,
      description: l.description,
      quantity: l.quantity,
      specs: l.specs,
    })),
  );
  const mats = await computeMaterials(tx, lines);
  if (mats.size) {
    await tx
      .insert(productionMaterials)
      .values([...mats.entries()].map(([variantId, q]) => ({ productionOrderId: po.id, variantId, qtyRequired: q })));
  }
  await addEvent(tx, po.id, 'nota', `Orden creada${orderNumber ? ` desde el pedido ${orderNumber}` : ' (producción para bodega)'}`, user.id, opts.at);
  if (input.orderId) {
    const order = await getOrder(tx, input.orderId);
    if (order.status === 'confirmado') {
      await tx.update(orders).set({ status: 'en_produccion' }).where(eq(orders.id, input.orderId));
    }
    await addOrderEvent(tx, input.orderId, 'produccion', `Se creó la orden de producción ${number}`, user.id, opts.at);
  }
  return po;
}

export async function moveStage(tx: Executor, id: number, stage: string, note: string | null, user: AuthUser, opts: Opts = {}) {
  const po = await getProductionOrder(tx, id, true);
  if (po.status === 'terminada' || po.status === 'cancelada') throw badRequest('Esta orden ya está cerrada.');
  const stages = await getStages(tx);
  if (!stages.includes(stage)) throw badRequest('Esa etapa no existe. Revísala en Configuración.');
  if (stage === po.stage) return po;
  await tx
    .update(productionOrders)
    .set({ stage, status: 'en_proceso', startedAt: po.startedAt ?? opts.at ?? new Date().toISOString() })
    .where(eq(productionOrders.id, id));
  await addEvent(tx, id, 'etapa', `Pasó de "${po.stage}" a "${stage}"${note ? ` — ${note}` : ''}`, user.id, opts.at);
  if (po.orderId) await addOrderEvent(tx, po.orderId, 'produccion', `${po.number}: ahora en "${stage}"`, user.id, opts.at);
  return getProductionOrder(tx, id);
}

export async function registerConsumption(
  tx: Executor,
  id: number,
  lines: { materialId: number; quantity: number; waste: number }[],
  user: AuthUser,
  opts: Opts = {},
) {
  const po = await getProductionOrder(tx, id, true);
  if (po.status === 'terminada' || po.status === 'cancelada') throw badRequest('Esta orden ya está cerrada.');
  const mats = await tx.select().from(productionMaterials).where(eq(productionMaterials.productionOrderId, id));
  const parts: string[] = [];
  for (const l of lines) {
    if (l.quantity <= 0 && l.waste <= 0) continue;
    const m = mats.find((x) => x.id === l.materialId);
    if (!m) throw badRequest('Ese material no pertenece a la orden.');
    const { label, unit } = await getVariant(tx, m.variantId);
    if (l.quantity > 0) {
      await moveStock(tx, {
        variantId: m.variantId,
        quantity: -l.quantity,
        type: 'salida_consumo',
        reason: `Consumo en ${po.number}`,
        reference: po.number,
        refType: 'produccion',
        refId: po.id,
        userId: user.id,
        at: opts.at,
      });
    }
    if (l.waste > 0) {
      await moveStock(tx, {
        variantId: m.variantId,
        quantity: -l.waste,
        type: 'salida_merma',
        reason: `Merma en ${po.number}`,
        reference: po.number,
        refType: 'produccion',
        refId: po.id,
        userId: user.id,
        at: opts.at,
      });
    }
    await tx
      .update(productionMaterials)
      .set({ qtyConsumed: round3(Number(m.qtyConsumed) + l.quantity), qtyWaste: round3(Number(m.qtyWaste) + l.waste) })
      .where(eq(productionMaterials.id, m.id));
    parts.push(`${formatQty(l.quantity)} ${unit} de ${label}${l.waste > 0 ? ` (+${formatQty(l.waste)} merma)` : ''}`);
  }
  if (!parts.length) throw badRequest('Escribe la cantidad usada de al menos un material.');
  if (po.status === 'pendiente') {
    await tx
      .update(productionOrders)
      .set({ status: 'en_proceso', startedAt: opts.at ?? new Date().toISOString() })
      .where(eq(productionOrders.id, id));
  }
  await addEvent(tx, id, 'consumo', `Consumo registrado: ${parts.join('; ')}`, user.id, opts.at);
}

export async function registerProgress(tx: Executor, id: number, lines: { itemId: number; done: number }[], user: AuthUser, opts: Opts = {}) {
  const po = await getProductionOrder(tx, id, true);
  if (po.status === 'terminada' || po.status === 'cancelada') throw badRequest('Esta orden ya está cerrada.');
  const items = await tx.select().from(productionItems).where(eq(productionItems.productionOrderId, id));
  const parts: string[] = [];
  for (const l of lines) {
    const it = items.find((x) => x.id === l.itemId);
    if (!it) throw badRequest('Ese producto no pertenece a la orden.');
    if (l.done > it.quantity) throw badRequest(`"${it.description}": no puedes terminar más de ${it.quantity} unidades.`);
    if (l.done === it.qtyDone) continue;
    await tx.update(productionItems).set({ qtyDone: l.done }).where(eq(productionItems.id, it.id));
    parts.push(`${it.description}: ${l.done}/${it.quantity}`);
  }
  if (!parts.length) return;
  if (po.status === 'pendiente') {
    await tx
      .update(productionOrders)
      .set({ status: 'en_proceso', startedAt: opts.at ?? new Date().toISOString() })
      .where(eq(productionOrders.id, id));
  }
  await addEvent(tx, id, 'avance', `Unidades terminadas — ${parts.join('; ')}`, user.id, opts.at);
}

export async function registerIncident(tx: Executor, id: number, type: IncidentType, detail: string, user: AuthUser, opts: Opts = {}) {
  const po = await getProductionOrder(tx, id);
  await addEvent(tx, id, 'incidencia', `${INCIDENT_LABELS[type]}: ${detail}`, user.id, opts.at, type);
  if (po.orderId) await addOrderEvent(tx, po.orderId, 'produccion', `${po.number} — ${INCIDENT_LABELS[type]}: ${detail}`, user.id, opts.at);
}

/**
 * Cierra la orden: exige todas las unidades terminadas y control de calidad aprobado.
 * Suma el producto terminado al inventario y lo separa para el pedido.
 * Si quedó material sin registrar, puede consumir automáticamente lo estimado pendiente.
 */
export async function finishProductionOrder(
  tx: Executor,
  id: number,
  input: { qcNotes?: string | null; consumeRemaining?: boolean },
  user: AuthUser,
  opts: Opts = {},
) {
  const po = await getProductionOrder(tx, id, true);
  if (po.status === 'terminada') throw badRequest('Esta orden ya fue terminada.');
  if (po.status === 'cancelada') throw badRequest('Esta orden fue cancelada.');
  const items = await tx.select().from(productionItems).where(eq(productionItems.productionOrderId, id));
  const missing = items.filter((i) => i.qtyDone < i.quantity);
  if (missing.length) {
    throw badRequest(
      `Faltan unidades por terminar: ${missing.map((m) => `${m.quantity - m.qtyDone} × ${m.description}`).join(', ')}. Registra el avance primero.`,
    );
  }
  if (input.consumeRemaining) {
    const mats = await tx.select().from(productionMaterials).where(eq(productionMaterials.productionOrderId, id));
    const pending = mats
      .map((m) => ({ materialId: m.id, quantity: round3(Number(m.qtyRequired) - Number(m.qtyConsumed)), waste: 0 }))
      .filter((m) => m.quantity > 0);
    if (pending.length) await registerConsumption(tx, id, pending, user, opts);
  }
  for (const it of items) {
    await moveStock(tx, {
      variantId: it.variantId,
      quantity: it.qtyDone,
      type: 'entrada_produccion',
      reason: `Producción terminada ${po.number}`,
      reference: po.number,
      refType: 'produccion',
      refId: po.id,
      userId: user.id,
      at: opts.at,
    });
    if (po.orderId && it.orderItemId) {
      await reserve(tx, { orderId: po.orderId, orderItemId: it.orderItemId, variantId: it.variantId, quantity: it.qtyDone, at: opts.at });
    }
  }
  const stages = await getStages(tx);
  await tx
    .update(productionOrders)
    .set({
      status: 'terminada',
      stage: stages[stages.length - 1],
      qcApproved: true,
      qcNotes: input.qcNotes ?? null,
      finishedAt: opts.at ?? new Date().toISOString(),
    })
    .where(eq(productionOrders.id, id));
  await addEvent(tx, id, 'calidad', `Control de calidad aprobado y orden terminada${input.qcNotes ? ` — ${input.qcNotes}` : ''}`, user.id, opts.at);

  let orderReady = false;
  if (po.orderId) {
    const open = await tx
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(and(eq(productionOrders.orderId, po.orderId), inArray(productionOrders.status, ['pendiente', 'en_proceso'])));
    const short = (await orderShortages(tx, po.orderId)).filter((s) => s.missing > 0);
    await addOrderEvent(tx, po.orderId, 'produccion', `${po.number} terminada; productos ingresados a bodega para este pedido`, user.id, opts.at);
    if (!open.length && !short.length) {
      await tx
        .update(orders)
        .set({ status: 'listo', readyAt: opts.at ?? new Date().toISOString() })
        .where(and(eq(orders.id, po.orderId), inArray(orders.status, ['confirmado', 'en_produccion'])));
      await addOrderEvent(tx, po.orderId, 'estado', 'Pedido listo para entregar', user.id, opts.at);
      orderReady = true;
    }
  }
  await audit(tx, user, {
    at: opts.at,
    action: 'produccion_terminada',
    entity: 'produccion',
    entityId: id,
    reference: po.number,
    summary: `Orden ${po.number} terminada (${items.reduce((a, i) => a + i.qtyDone, 0)} unidades)`,
  });
  return { orderReady };
}

/** Disponibilidad de materiales para una orden. */
export async function materialsStatus(tx: Executor, id: number) {
  // Una sola consulta (antes: una por material).
  const mats = await tx
    .select({ m: productionMaterials, v: variants, p: products })
    .from(productionMaterials)
    .innerJoin(variants, eq(variants.id, productionMaterials.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(productionMaterials.productionOrderId, id))
    .orderBy(asc(productionMaterials.id));
  const out = [];
  for (const { m, v, p } of mats) {
    const label = variantName(p, v);
    const unit = p.unit;
    const pending = Math.max(0, round3(Number(m.qtyRequired) - Number(m.qtyConsumed)));
    const available = Number(v.stock) - Number(v.reserved);
    out.push({
      id: m.id,
      variantId: v.id,
      name: label,
      unit,
      required: Number(m.qtyRequired),
      consumed: Number(m.qtyConsumed),
      waste: Number(m.qtyWaste),
      pending,
      available,
      enough: available >= pending,
    });
  }
  return out;
}


/**
 * Materiales que no alcanzan, para muchas órdenes a la vez, en UNA consulta.
 * Lo usan el Inicio y el tablero de producción (antes hacían una consulta por orden y por material).
 */
export async function missingMaterialsByOrder(tx: Executor, poIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!poIds.length) return out;
  const rows = await tx
    .select({ poId: productionMaterials.productionOrderId, v: variants, p: products })
    .from(productionMaterials)
    .innerJoin(variants, eq(variants.id, productionMaterials.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(
      and(
        inArray(productionMaterials.productionOrderId, poIds),
        sql`(${variants.stock} - ${variants.reserved}) < (${productionMaterials.qtyRequired} - ${productionMaterials.qtyConsumed})`,
      ),
    );
  for (const r of rows) out.set(r.poId, [...(out.get(r.poId) ?? []), variantName(r.p, r.v)]);
  return out;
}
