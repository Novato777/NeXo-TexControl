// Verificación de integridad de los datos. Cada regla devuelve los registros que la incumplen (debería ser 0).
import { sql } from 'drizzle-orm';
import type { Executor } from './client';

const CHECKS: Array<{ key: string; label: string; query: string }> = [
  { key: 'stock_negativo', label: 'Existencias negativas o separado mayor que lo que hay', query: `select id, sku, stock, reserved from variants where stock < 0 or reserved < 0 or reserved > stock + 0.001` },
  { key: 'stock_vs_movimientos', label: 'Existencias que no coinciden con la suma de movimientos', query: `select v.id, v.sku, v.stock, coalesce(sum(m.quantity),0) as movimientos from variants v left join inventory_movements m on m.variant_id = v.id group by v.id having abs(v.stock - coalesce(sum(m.quantity),0)) > 0.001` },
  { key: 'reservado_vs_reservas', label: 'Separado que no coincide con las reservas activas', query: `select v.id, v.sku, v.reserved, coalesce(sum(r.quantity) filter (where r.active),0) as reservas from variants v left join stock_reservations r on r.variant_id = v.id group by v.id having abs(v.reserved - coalesce(sum(r.quantity) filter (where r.active),0)) > 0.001` },
  { key: 'pagado_vs_pagos', label: 'Valor pagado del pedido distinto a la suma de sus pagos', query: `select o.id, o.number, o.paid, coalesce(sum(p.amount),0) as pagos from orders o left join payments p on p.order_id = o.id group by o.id having o.paid <> coalesce(sum(p.amount),0)` },
  { key: 'sobrepago', label: 'Pedidos pagados por encima del total', query: `select id, number, total, paid from orders where paid > total or paid < 0` },
  { key: 'total_pedido', label: 'Total del pedido distinto a la suma de sus productos menos descuento', query: `select o.id, o.number, o.total, o.subtotal, o.discount, coalesce(sum(i.line_total),0) as renglones from orders o left join order_items i on i.order_id = o.id group by o.id having o.subtotal <> coalesce(sum(i.line_total),0) or o.total <> o.subtotal - o.discount` },
  { key: 'entregado_de_mas', label: 'Productos entregados por encima de lo pedido', query: `select id, order_id, quantity, qty_delivered from order_items where qty_delivered > quantity or qty_delivered < 0` },
  { key: 'pagos_sin_caja', label: 'Pagos sin movimiento de caja asociado', query: `select id, number from payments where cash_movement_id is null` },
  { key: 'cuentas_por_pagar', label: 'Cuentas por pagar con abonos distintos a lo registrado', query: `select x.id, x.number, x.paid, coalesce(sum(pp.amount),0) as abonos from payables x left join payable_payments pp on pp.payable_id = x.id group by x.id having x.paid <> coalesce(sum(pp.amount),0) or x.paid > x.amount` },
  { key: 'cajas_abiertas', label: 'Más de una caja abierta al mismo tiempo', query: `select count(*) as abiertas from cash_sessions where status = 'abierta' having count(*) > 1` },
  { key: 'recepcion_de_mas', label: 'Compras recibidas por encima de lo pedido', query: `select id, purchase_id, quantity, qty_received from purchase_items where qty_received > quantity + 0.001` },
];

export async function runIntegrity(db: Executor) {
  const results = [];
  for (const c of CHECKS) {
    const r = (await db.execute(sql.raw(c.query))) as unknown as { rows: unknown[] };
    results.push({ key: c.key, label: c.label, problems: r.rows.length, sample: r.rows.slice(0, 5) });
  }
  return { ok: results.every((r) => r.problems === 0), checkedAt: new Date().toISOString(), results };
}
