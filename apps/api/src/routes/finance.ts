// Caja, gastos/cuentas por pagar y cartera (cuentas por cobrar).
import { Router } from 'express';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  cashCloseSchema,
  cashMovementSchema,
  cashOpenSchema,
  diffDays,
  formatCOP,
  payablePaymentSchema,
  payableSchema,
  receivableStatus,
  seesMoney,
  todayISO,
} from '@nexo/shared';
import { idQuery } from '../lib/security';
import { db } from '../db/client';
import { cashMovements, cashSessions, customers, orders, payablePayments, payables, suppliers, users } from '../db/schema';
import { audit } from '../lib/audit';
import { assertCan, currentUser, requireModule } from '../lib/auth';
import { nextNumber } from '../lib/counters';
import { badRequest, forbidden, idParam, notFound, parse } from '../lib/errors';
import { addCashMovement, getOpenSession, sessionSummary } from '../services/cash';
import { createPayable, payPayable } from '../services/purchasing';

// ================================================================ CAJA
export const cashRouter = Router();
cashRouter.use(requireModule('caja', 'pedidos'));
// La caja muestra dinero: solo roles con acceso financiero (Producción no).
cashRouter.use((req, _res, next) => (seesMoney(currentUser(req).role) ? next() : next(forbidden('Tu rol no tiene acceso a la información de caja.'))));

async function sessionDetail(id: number) {
  const [sess] = await db.select().from(cashSessions).where(eq(cashSessions.id, id));
  if (!sess) throw notFound('La caja');
  const movements = await db
    .select({ m: cashMovements, userName: users.name })
    .from(cashMovements)
    .leftJoin(users, eq(users.id, cashMovements.userId))
    .where(eq(cashMovements.sessionId, id))
    .orderBy(desc(cashMovements.createdAt), desc(cashMovements.id));
  const [opener] = sess.openedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, sess.openedBy)) : [null];
  const [closer] = sess.closedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, sess.closedBy)) : [null];
  return {
    session: { ...sess, openedByName: opener?.name ?? null, closedByName: closer?.name ?? null },
    summary: await sessionSummary(db, id),
    movements: movements.map((m) => ({ ...m.m, userName: m.userName ?? 'Sistema' })),
  };
}

cashRouter.get('/current', async (_req, res) => {
  const open = await getOpenSession(db);
  if (!open) {
    const [last] = await db.select().from(cashSessions).where(eq(cashSessions.status, 'cerrada')).orderBy(desc(cashSessions.id)).limit(1);
    return res.json({ open: false, lastClosed: last ?? null });
  }
  res.json({ open: true, ...(await sessionDetail(open.id)) });
});

cashRouter.get('/sessions', async (_req, res) => {
  const rows = await db
    .select({ s: cashSessions, openedByName: users.name })
    .from(cashSessions)
    .leftJoin(users, eq(users.id, cashSessions.openedBy))
    .orderBy(desc(cashSessions.id))
    .limit(60);
  const out = [];
  for (const r of rows) out.push({ ...r.s, openedByName: r.openedByName, summary: await sessionSummary(db, r.s.id) });
  res.json(out);
});

cashRouter.get('/sessions/:id', async (req, res) => {
  res.json(await sessionDetail(idParam(req.params.id)));
});

cashRouter.post('/open', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'caja.operar');
  const input = parse(cashOpenSchema, req.body);
  const sess = await db.transaction(async (tx) => {
    if (await getOpenSession(tx)) throw badRequest('Ya hay una caja abierta. Ciérrala antes de abrir otra.');
    const number = await nextNumber(tx, 'caja', 'CAJA');
    const [s] = await tx.insert(cashSessions).values({ number, openingAmount: input.openingAmount, openedBy: user.id, openNote: input.note }).returning();
    await audit(tx, user, { action: 'caja_abierta', entity: 'caja', entityId: s.id, reference: number, summary: `Caja ${number} abierta con ${formatCOP(input.openingAmount)}` });
    return s;
  });
  res.status(201).json(sess);
});

cashRouter.post('/movements', async (req, res) => {
  const user = currentUser(req);
  const input = parse(cashMovementSchema, req.body);
  assertCan(user, input.type === 'egreso' ? 'gasto.registrar' : 'caja.operar');
  const mov = await db.transaction(async (tx) => {
    if (!(await getOpenSession(tx))) throw badRequest('Abre la caja antes de registrar movimientos.');
    let concept = input.concept;
    if (input.supplierId) {
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
      if (s) concept = `${concept} — ${s.name}`;
    }
    const m = await addCashMovement(tx, { ...input, concept, refType: 'manual', userId: user.id });
    await audit(tx, user, {
      action: input.type === 'egreso' ? 'gasto_registrado' : 'ingreso_registrado',
      entity: 'caja',
      entityId: m.id,
      summary: `${input.type === 'egreso' ? 'Gasto' : 'Ingreso'} de ${formatCOP(input.amount)}: ${concept}`,
    });
    return m;
  });
  res.status(201).json(mov);
});

/** Reverso de un movimiento manual: operación compensatoria, nunca borrado. */
cashRouter.post('/movements/:id/reverse', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'pago.reversar', 'Reversar movimientos requiere permiso de Caja/Finanzas.');
  const id = idParam(req.params.id);
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) throw badRequest('Escribe el motivo del reverso.', { reason: 'Obligatorio.' });
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(cashMovements).where(eq(cashMovements.id, id));
    if (!m) throw notFound('El movimiento');
    if (m.refType !== 'manual') throw badRequest('Este movimiento viene de un pago o venta. Revérsalo desde el pedido o la cuenta correspondiente.');
    const [already] = await tx.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.reversalOf, id));
    if (already) throw badRequest('Este movimiento ya fue reversado.');
    await addCashMovement(tx, {
      type: m.type === 'ingreso' ? 'egreso' : 'ingreso',
      category: 'Reverso',
      concept: `Reverso: ${m.concept} (${reason})`,
      amount: m.amount,
      method: m.method,
      refType: 'reverso',
      reversalOf: m.id,
      userId: user.id,
    });
    await audit(tx, user, { action: 'movimiento_reversado', entity: 'caja', entityId: id, summary: `Reverso de ${formatCOP(m.amount)} (${m.concept}). Motivo: ${reason}`, sensitive: true });
  });
  res.json({ ok: true });
});

cashRouter.post('/close', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'caja.cerrar', 'Cerrar la caja requiere permiso de Caja/Finanzas o del administrador.');
  const input = parse(cashCloseSchema, req.body);
  const result = await db.transaction(async (tx) => {
    const open = await getOpenSession(tx);
    if (!open) throw badRequest('No hay una caja abierta.');
    const sum = await sessionSummary(tx, open.id);
    const difference = input.countedCash - sum.expectedCash;
    if (difference !== 0 && !input.note) {
      throw badRequest(`Hay una diferencia de ${formatCOP(difference)}. Escribe una explicación para poder cerrar.`, { note: 'Explica la diferencia.' });
    }
    await tx
      .update(cashSessions)
      .set({ status: 'cerrada', closedBy: user.id, closedAt: new Date().toISOString(), expectedCash: sum.expectedCash, countedCash: input.countedCash, difference, closeNote: input.note })
      .where(eq(cashSessions.id, open.id));
    await audit(tx, user, {
      action: 'caja_cerrada',
      entity: 'caja',
      entityId: open.id,
      reference: open.number,
      summary: `Caja ${open.number} cerrada. Esperado ${formatCOP(sum.expectedCash)}, contado ${formatCOP(input.countedCash)}, diferencia ${formatCOP(difference)}`,
      sensitive: true,
    });
    return { id: open.id, difference };
  });
  res.json(result);
});

// ================================================================ CUENTAS POR PAGAR / GASTOS
export const payablesRouter = Router();
payablesRouter.use(requireModule('caja', 'proveedores', 'cartera'));

payablesRouter.get('/', async (req, res) => {
  const status = String(req.query.status ?? '');
  const today = todayISO();
  const rows = await db
    .select({ p: payables, supplierName: suppliers.name })
    .from(payables)
    .leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .where(and(eq(payables.cancelled, false), idQuery(req.query.supplierId) ? eq(payables.supplierId, idQuery(req.query.supplierId)!) : undefined))
    .orderBy(asc(payables.dueDate));
  const list = rows.map((r) => {
    const balance = r.p.amount - r.p.paid;
    const st = balance <= 0 ? 'pagado' : r.p.dueDate < today ? 'vencido' : r.p.paid > 0 ? 'parcial' : 'pendiente';
    return { ...r.p, supplierName: r.supplierName, balance, status: st, daysToDue: diffDays(today, r.p.dueDate) };
  });
  const open = list.filter((p) => p.balance > 0);
  res.json({
    summary: {
      pending: open.reduce((a, p) => a + p.balance, 0),
      overdue: open.filter((p) => p.status === 'vencido').reduce((a, p) => a + p.balance, 0),
      dueSoon: open.filter((p) => p.status !== 'vencido' && p.daysToDue <= 7).reduce((a, p) => a + p.balance, 0),
      count: open.length,
    },
    rows: status === 'abiertas' ? open : status ? list.filter((p) => p.status === status) : list.slice().reverse().slice(0, 200).reverse(),
  });
});

payablesRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [p] = await db.select({ p: payables, supplierName: suppliers.name }).from(payables).leftJoin(suppliers, eq(suppliers.id, payables.supplierId)).where(eq(payables.id, id));
  if (!p) throw notFound('La cuenta por pagar');
  const pays = await db.select({ pp: payablePayments, userName: users.name }).from(payablePayments).leftJoin(users, eq(users.id, payablePayments.userId)).where(eq(payablePayments.payableId, id)).orderBy(asc(payablePayments.id));
  res.json({ ...p.p, supplierName: p.supplierName, balance: p.p.amount - p.p.paid, payments: pays.map((x) => ({ ...x.pp, userName: x.userName })) });
});

payablesRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'gasto.registrar');
  const input = parse(payableSchema, req.body);
  const p = await db.transaction(async (tx) => {
    const created = await createPayable(tx, input, user);
    await audit(tx, user, { action: 'cuenta_por_pagar', entity: 'cuenta_por_pagar', entityId: created.id, reference: created.number, summary: `Obligación ${created.number}: ${input.concept} por ${formatCOP(input.amount)}` });
    return created;
  });
  res.status(201).json(p);
});

payablesRouter.post('/:id/pay', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'gasto.registrar', 'Pagar cuentas requiere permiso de Caja/Finanzas.');
  const input = parse(payablePaymentSchema, req.body);
  await db.transaction(async (tx) => {
    await payPayable(tx, idParam(req.params.id), input, user);
    await audit(tx, user, { action: 'pago_proveedor', entity: 'cuenta_por_pagar', entityId: idParam(req.params.id), summary: `Pago de ${formatCOP(input.amount)} a cuenta por pagar` });
  });
  res.json({ ok: true });
});

// ================================================================ CARTERA (cuentas por cobrar)
export const receivablesRouter = Router();
receivablesRouter.use(requireModule('cartera', 'caja', 'clientes'));

receivablesRouter.get('/', async (_req, res) => {
  const today = todayISO();
  const rows = await db
    .select({ o: orders, customerName: customers.name, customerPhone: customers.phone, customerType: customers.type })
    .from(orders)
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(and(notInArray(orders.status, ['borrador', 'cancelado']), sql`${orders.total} > ${orders.paid}`))
    .orderBy(asc(orders.dueDate));
  const items = rows.map((r) => {
    const balance = r.o.total - r.o.paid;
    const due = r.o.dueDate ?? r.o.promisedDate;
    return {
      orderId: r.o.id,
      number: r.o.number,
      kind: r.o.kind,
      status: r.o.status,
      customerId: r.o.customerId,
      customerName: r.customerName ?? 'Sin cliente',
      customerPhone: r.customerPhone,
      orderDate: r.o.orderDate,
      dueDate: due,
      total: r.o.total,
      paid: r.o.paid,
      balance,
      daysToDue: due ? diffDays(today, due) : null,
      receivable: receivableStatus(balance, due),
    };
  });
  const byCustomer = new Map<number | null, { customerId: number | null; customerName: string; customerPhone: string | null; balance: number; overdue: number; count: number; oldestDue: string | null }>();
  for (const i of items) {
    const c = byCustomer.get(i.customerId) ?? { customerId: i.customerId, customerName: i.customerName, customerPhone: i.customerPhone, balance: 0, overdue: 0, count: 0, oldestDue: null };
    c.balance += i.balance;
    if (i.receivable === 'vencido') c.overdue += i.balance;
    c.count++;
    if (i.dueDate && (!c.oldestDue || i.dueDate < c.oldestDue)) c.oldestDue = i.dueDate;
    byCustomer.set(i.customerId, c);
  }
  const sum = (st: string) => items.filter((i) => i.receivable === st).reduce((a, i) => a + i.balance, 0);
  res.json({
    summary: { total: items.reduce((a, i) => a + i.balance, 0), vencido: sum('vencido'), porVencer: sum('por_vencer'), vigente: sum('vigente'), count: items.length },
    items,
    customers: [...byCustomer.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance),
  });
});

