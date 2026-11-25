// npm run db:check — verifica la integridad de los datos (stock vs movimientos, pagos vs pedidos, reservas, cajas).
import { sql } from 'drizzle-orm';
import { closeDb, db, initDb } from './client';
await initDb();
const q = async (label: string, s: string) => {
  const r = (await db.execute(sql.raw(s))) as unknown as { rows: unknown[] };
  console.log('--', label);
  console.table(r.rows);
};
await q('counts', `select (select count(*) from orders where kind='venta') ventas, (select count(*) from orders where kind='pedido') pedidos, (select count(*) from inventory_movements) movs, (select count(*) from payments) pagos, (select count(*) from cash_movements) caja, (select count(*) from production_orders) ops, (select count(*) from purchases) compras, (select count(*) from payables) cxp`);
await q('pedidos por estado', `select status, count(*) from orders where kind='pedido' group by 1 order by 1`);
await q('stock negativo o reservado>stock', `select id, sku, stock, reserved from variants where stock < 0 or reserved > stock`);
await q('stock vs movimientos', `select v.sku, v.stock, sum(m.quantity) s from variants v join inventory_movements m on m.variant_id=v.id group by v.id having abs(v.stock - sum(m.quantity)) > 0.001`);
await q('reservado vs reservas', `select v.sku, v.reserved, coalesce(sum(r.quantity) filter (where r.active),0) s from variants v left join stock_reservations r on r.variant_id=v.id group by v.id having abs(v.reserved - coalesce(sum(r.quantity) filter (where r.active),0)) > 0.001`);
await q('paid vs pagos', `select o.number, o.paid, coalesce(sum(p.amount),0) s from orders o left join payments p on p.order_id=o.id group by o.id having o.paid <> coalesce(sum(p.amount),0)`);
await q('cartera', `select count(*), sum(total-paid) from orders where status not in ('borrador','cancelado') and total>paid`);
await q('cxp', `select number, concept, amount, paid, due_date from payables where paid < amount`);
await q('cajas', `select number, status, opening_amount, expected_cash, counted_cash, difference from cash_sessions order by id`);
await q('bajo minimo', `select p.name, v.size, v.color, v.stock, v.reserved, p.min_stock min from variants v join products p on p.id=v.product_id where p.type<>'servicio' and v.stock - v.reserved < coalesce(v.min_stock,p.min_stock)`);
await q('ops activas', `select number, stage, status, order_id from production_orders where status in ('pendiente','en_proceso')`);
await q('pedidos activos', `select number, status, promised_date, total, paid from orders where kind='pedido' and status not in ('entregado') order by id desc limit 15`);
await closeDb();
