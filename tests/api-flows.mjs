// Prueba de extremo a extremo de los 5 flujos del brief contra la API en ejecución.
// Uso: con la API corriendo (npm run dev), ejecutar:  node tests/api-flows.mjs [http://localhost:4000]
// Modifica datos (crea pedidos, ventas, compras, cierra caja). Para volver al estado inicial: npm run db:reset
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api';
let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✔', msg);
  } else {
    failed++;
    console.log('  ✘', msg);
  }
}

async function session(role) {
  const r = await fetch(`${BASE}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
}

const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const plus = (d) => new Date(Date.parse(today) + d * 86400e3).toISOString().slice(0, 10);

const ventas = await session('ventas');
const prod = await session('produccion');
const caja = await session('finanzas');
const inv = await session('inventario');
const admin = await session('admin');

// ------------------------------------------------------------------ Flujo A
console.log('\nFlujo A — Pedido personalizado');
const customers = (await ventas.get('/customers?q=Horizonte')).data;
ok(customers.length > 0, 'buscar cliente por nombre');
const camisas = (await ventas.get('/products/variants/search?q=Camisa escolar&types=terminado')).data;
const c10 = camisas.find((v) => v.size === '10');
const c12 = camisas.find((v) => v.size === '12');
const bad = await ventas.post('/orders', { customerId: customers[0].id, items: [], promisedDate: plus(10) });
ok(bad.status === 400 && /al menos un producto/i.test(bad.data.error), `validación sin productos: "${bad.data.error}"`);
const create = await ventas.post('/orders', {
  customerId: customers[0].id,
  items: [
    { variantId: c10.id, quantity: 10, unitPrice: c10.price, customization: { logo: true, technique: 'bordado', position: 'Pecho izquierdo' } },
    { variantId: c12.id, quantity: 8, unitPrice: c12.price, customization: { logo: true, technique: 'bordado' } },
  ],
  promisedDate: plus(10),
  priority: 'alta',
  deliveryMethod: 'institucion',
  discount: 0,
  status: 'confirmado',
  advance: { amount: 200000, method: 'transferencia' },
});
ok(create.status === 201, `crear pedido confirmado con anticipo (${create.data?.number ?? create.data?.error})`);
const orderId = create.data.id;
let detail = (await ventas.get(`/orders/${orderId}`)).data;
ok(detail.order.status === 'confirmado', 'estado: confirmado');
ok(detail.order.paid === 200000 && detail.order.balance === detail.order.total - 200000, `saldo calculado ${detail.order.balance}`);
ok(detail.canProduce && detail.pendingUnits === 18, 'personalizado: 18 unidades por fabricar');
const over = await ventas.post(`/orders/${orderId}/payments`, { amount: detail.order.balance + 1000, method: 'efectivo' });
ok(over.status === 400, `no permite pagar más del saldo: "${over.data.error}"`);
const po = await ventas.post('/production', { orderId, targetDate: plus(8), priority: 'alta', responsible: 'Taller 1' });
ok(po.status === 201, `crear orden de producción (${po.data?.number ?? po.data?.error})`);
detail = (await ventas.get(`/orders/${orderId}`)).data;
ok(detail.order.status === 'en_produccion', 'pedido pasa a "en producción"');
const dup = await ventas.post('/production', { orderId, targetDate: plus(8), priority: 'alta' });
ok(dup.status === 400, 'no permite duplicar la producción del mismo pedido');

// ------------------------------------------------------------------ Flujo B
console.log('\nFlujo B — Avanzar producción');
const poId = po.data.id;
let pod = (await prod.get(`/production/${poId}`)).data;
ok(pod.materials.length > 0, `materiales requeridos: ${pod.materials.map((m) => `${m.name} ${m.required}`).join(', ')}`);
const stockBefore = (await prod.get(`/products/${c10.productId}`)).data.variants.find((v) => v.id === c10.id).stock;
const r1 = await prod.post(`/production/${poId}/consume`, { lines: pod.materials.map((m) => ({ materialId: m.id, quantity: Math.round(m.required * 0.5 * 100) / 100, waste: 0 })) });
ok(r1.status === 200, 'registrar consumo del 50% de materiales');
ok((await prod.post(`/production/${poId}/stage`, { stage: 'Confección' })).status === 200, 'mover a etapa Confección');
const early = await prod.post(`/production/${poId}/finish`, { qcApproved: true });
ok(early.status === 400, `no permite terminar sin unidades: "${early.data.error}"`);
pod = (await prod.get(`/production/${poId}`)).data;
ok((await prod.post(`/production/${poId}/progress`, { lines: pod.items.map((i) => ({ itemId: i.id, done: i.quantity })) })).status === 200, 'registrar todas las unidades terminadas');
const fin = await prod.post(`/production/${poId}/finish`, { qcApproved: true, qcNotes: 'OK', consumeRemaining: true });
ok(fin.status === 200 && fin.data.orderReady, 'terminar con control de calidad → pedido listo');
pod = (await prod.get(`/production/${poId}`)).data;
ok(pod.materials.every((m) => Math.abs(m.consumed - m.required) < 0.01), 'consumo total = requerido (sin doble descuento)');
const after = (await prod.get(`/products/${c10.productId}`)).data.variants.find((v) => v.id === c10.id);
ok(after.stock === stockBefore + 10 && after.reserved >= 10, `stock talla 10: ${stockBefore} → ${after.stock} (separadas ${after.reserved})`);
detail = (await ventas.get(`/orders/${orderId}`)).data;
ok(detail.order.status === 'listo', 'pedido en estado "listo"');
const noBal = await ventas.post(`/orders/${orderId}/deliveries`, { receivedBy: 'Rectoría', items: detail.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) });
ok(noBal.status === 400 && /saldo/i.test(noBal.data.error), 'entrega bloqueada si hay saldo pendiente');
const noPerm = await ventas.post(`/orders/${orderId}/deliveries`, { receivedBy: 'Rectoría', allowBalance: true, items: detail.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) });
ok(noPerm.status === 403, 'Ventas no puede autorizar entrega con saldo');
const pay = await ventas.post(`/orders/${orderId}/payments`, { amount: detail.order.balance, method: 'transferencia' });
ok(pay.status === 201, 'pagar saldo completo');
const twice = await ventas.post(`/orders/${orderId}/payments`, { amount: detail.order.balance, method: 'transferencia' });
ok(twice.status === 400 || twice.status === 409, 'no permite pago duplicado');
const del = await ventas.post(`/orders/${orderId}/deliveries`, { receivedBy: 'Rectoría', items: detail.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) });
ok(del.status === 201, `entrega registrada (${del.data?.number})`);
detail = (await ventas.get(`/orders/${orderId}`)).data;
ok(detail.order.status === 'entregado', 'pedido entregado');

// ------------------------------------------------------------------ Flujo C
console.log('\nFlujo C — Venta rápida');
const avail = (await caja.get('/products/variants/search?types=terminado&onlyAvailable=true')).data.filter((v) => v.available >= 3);
const v = avail[0];
const cashBefore = (await caja.get('/cash/current')).data;
const sale = await caja.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 2, unitPrice: v.price }], payments: [{ amount: v.price * 2, method: 'efectivo' }] });
ok(sale.status === 201, `venta registrada ${sale.data?.number ?? sale.data?.error}`);
const vAfter = (await caja.get(`/products/variants/search?q=${encodeURIComponent(v.sku)}`)).data.find((x) => x.id === v.id);
ok(vAfter.stock === v.stock - 2, `inventario descontado: ${v.stock} → ${vAfter.stock}`);
const cashAfter = (await caja.get('/cash/current')).data;
ok(cashAfter.summary.cashIn === cashBefore.summary.cashIn + v.price * 2, 'caja: ingreso en efectivo registrado una sola vez');
const sd = (await caja.get(`/orders/${sale.data.id}`)).data;
const receipt = await caja.get(`/orders/payments/${sd.payments[0].id}`);
ok(receipt.status === 200 && receipt.data.number.startsWith('REC-'), `comprobante ${receipt.data.number}`);
const tooMany = await caja.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 5000, unitPrice: v.price }], payments: [{ amount: v.price * 5000, method: 'tarjeta' }] });
ok(tooMany.status === 400 && /disponible/.test(tooMany.data.error), `no vende más de lo disponible: "${tooMany.data.error}"`);
const credit = await caja.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 1, unitPrice: v.price }], payments: [] });
ok(credit.status === 400 && /cliente/i.test(credit.data.error), 'venta a crédito exige cliente');

// ------------------------------------------------------------------ Flujo D
console.log('\nFlujo D — Compra y recepción');
const sup = (await inv.get('/suppliers?q=Hilos')).data[0];
const boton = (await inv.get('/products/variants/search?q=Botón&types=insumo')).data[0];
const purch = await inv.post('/purchases', { supplierId: sup.id, date: today, items: [{ variantId: boton.id, quantity: 1000, unitCost: 55 }], discount: 0 });
ok(purch.status === 201, `compra creada ${purch.data?.number ?? purch.data?.error}`);
let pdet = (await inv.get(`/purchases/${purch.data.id}`)).data;
ok(pdet.payable && pdet.payable.balance === 55000, 'cuenta por pagar creada por $55.000');
const sBefore = (await inv.get(`/products/variants/search?q=${encodeURIComponent(boton.sku)}`)).data[0].stock;
ok((await inv.post(`/purchases/${purch.data.id}/receive`, { lines: [{ itemId: pdet.items[0].id, quantity: 600 }] })).data.status === 'recibida_parcial', 'recepción parcial (600 de 1000)');
ok((await inv.post(`/purchases/${purch.data.id}/receive`, { lines: [{ itemId: pdet.items[0].id, quantity: 400 }] })).data.status === 'recibida', 'recepción del resto');
const sAfter = (await inv.get(`/products/variants/search?q=${encodeURIComponent(boton.sku)}`)).data[0].stock;
ok(sAfter === sBefore + 1000, `stock botones ${sBefore} → ${sAfter}`);
const overRecv = await inv.post(`/purchases/${purch.data.id}/receive`, { lines: [{ itemId: pdet.items[0].id, quantity: 1 }] });
ok(overRecv.status === 400, 'no permite recibir de más');
const payP = await caja.post(`/payables/${pdet.payable.id}/pay`, { amount: 55000, method: 'transferencia' });
ok(payP.status === 200, 'pagar cuenta al proveedor');

// ------------------------------------------------------------------ Flujo E
console.log('\nFlujo E — Cierre de caja');
let cur = (await caja.get('/cash/current')).data;
if (!cur.open) await caja.post('/cash/open', { openingAmount: 200000 });
cur = (await caja.get('/cash/current')).data;
const exp = await caja.post('/cash/movements', { type: 'egreso', category: 'Transporte', concept: 'Domicilio prueba', amount: 15000, method: 'efectivo' });
ok(exp.status === 201, 'registrar gasto en efectivo');
cur = (await caja.get('/cash/current')).data;
const noNote = await caja.post('/cash/close', { countedCash: cur.summary.expectedCash - 2000 });
ok(noNote.status === 400 && /explicación/i.test(noNote.data.error), 'exige explicación si hay diferencia');
const prodCash = await prod.get('/cash/current');
ok(prodCash.status === 403, 'Producción no puede ver la caja');
const close = await caja.post('/cash/close', { countedCash: cur.summary.expectedCash - 2000, note: 'Faltan $2.000 de cambio' });
ok(close.status === 200 && close.data.difference === -2000, 'caja cerrada con diferencia de -$2.000');
const sess = (await caja.get(`/cash/sessions/${close.data.id}`)).data;
ok(sess.session.status === 'cerrada' && sess.session.closeNote, 'reporte de la caja cerrada disponible');
const cashSale = await caja.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 1, unitPrice: v.price }], payments: [{ amount: v.price, method: 'efectivo' }] });
ok(cashSale.status === 400 && /caja está cerrada/i.test(cashSale.data.error), 'sin caja abierta no se recibe efectivo');
ok((await caja.post('/cash/open', { openingAmount: 150000 })).status === 201, 'abrir caja nueva');

// ------------------------------------------------------------------ Cancelación + reversos
console.log('\nCancelación y auditoría');
const lap = (await ventas.get('/orders?status=confirmado')).data.rows.find((o) => o.paid > 0);
if (lap) {
  const c = await admin.post(`/orders/${lap.id}/status`, { status: 'cancelado', reason: 'Prueba automática', refundPayments: true });
  ok(c.status === 200 && c.data.status === 'cancelado', `cancelar ${lap.number} con devolución del anticipo`);
  const d = (await admin.get(`/orders/${lap.id}`)).data;
  ok(d.order.paid === 0 && d.items.every((i) => i.reserved === 0), 'pagos reversados y reservas liberadas');
}
const audit = (await admin.get('/audit?sensitive=true')).data;
ok(audit.some((a) => a.action === 'caja_cerrada') && audit.some((a) => a.action === 'pedido_cancelado'), 'auditoría registra cierre de caja y cancelación');

console.log(`\n${passed} pruebas correctas, ${failed} fallidas.`);
process.exit(failed ? 1 : 0);
