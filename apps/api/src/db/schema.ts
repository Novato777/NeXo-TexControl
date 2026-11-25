// Esquema relacional (PostgreSQL). Dinero en enteros COP; cantidades en numeric (admite metros).
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

// ---------- Configuración / usuarios ----------
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  companyName: text('company_name').notNull(),
  nit: text('nit'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  receiptFooter: text('receipt_footer'),
  currency: text('currency').notNull().default('COP'),
  timezone: text('timezone').notNull().default('America/Bogota'),
  sizes: jsonb('sizes').$type<string[]>().notNull(),
  colors: jsonb('colors').$type<string[]>().notNull(),
  categories: jsonb('categories').$type<string[]>().notNull(),
  units: jsonb('units').$type<string[]>().notNull(),
  expenseCategories: jsonb('expense_categories').$type<string[]>().notNull(),
  productionStages: jsonb('production_stages').$type<string[]>().notNull(),
  paymentMethods: jsonb('payment_methods').$type<string[]>().notNull(),
  seededAt: timestamp('seeded_at', { withTimezone: true, mode: 'string' }),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    reference: text('reference'),
    summary: text('summary').notNull(),
    sensitive: boolean('sensitive').notNull().default(false),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

/** Consecutivos legibles: PED-0001, OP-0001, OC-0001, REC-0001… */
export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
});

// ---------- Terceros ----------
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  document: text('document'),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  notes: text('notes'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  creditDays: integer('credit_days').notNull().default(0),
  archived: boolean('archived').notNull().default(false),
  createdAt: createdAt(),
});

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  document: text('document'),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  supplies: text('supplies'),
  notes: text('notes'),
  paymentTermDays: integer('payment_term_days').notNull().default(0),
  archived: boolean('archived').notNull().default(false),
  createdAt: createdAt(),
});

// ---------- Catálogo e inventario ----------
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  description: text('description'),
  unit: text('unit').notNull().default('unidad'),
  price: integer('price').notNull().default(0),
  cost: integer('cost').notNull().default(0),
  minStock: qty('min_stock').notNull().default(0),
  location: text('location'),
  customizable: boolean('customizable').notNull().default(false),
  imageUrl: text('image_url'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Toda existencia vive en la variante. Un producto sin tallas tiene una variante "Única". */
export const variants = pgTable(
  'variants',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id').notNull().references(() => products.id),
    sku: text('sku').notNull().unique(),
    size: text('size'),
    color: text('color'),
    price: integer('price'), // null = usa precio del producto
    cost: integer('cost'), // null = usa costo del producto
    stock: qty('stock').notNull().default(0),
    reserved: qty('reserved').notNull().default(0),
    minStock: qty('min_stock'), // null = usa mínimo del producto
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('variants_product_idx').on(t.productId)],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    variantId: integer('variant_id').notNull().references(() => variants.id),
    type: text('type').notNull(),
    quantity: qty('quantity').notNull(), // con signo: + entra, - sale
    stockAfter: qty('stock_after').notNull(),
    unitCost: integer('unit_cost'),
    reason: text('reason').notNull(),
    reference: text('reference'),
    refType: text('ref_type'),
    refId: integer('ref_id'),
    userId: integer('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('mov_variant_idx').on(t.variantId), index('mov_created_idx').on(t.createdAt)],
);

/** Reservas activas de stock por pedido (disponible = stock - reservado). */
export const stockReservations = pgTable(
  'stock_reservations',
  {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  orderItemId: integer('order_item_id').notNull(),
  variantId: integer('variant_id').notNull().references(() => variants.id),
  quantity: qty('quantity').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  },
  (t) => [index('reservations_item_idx').on(t.orderItemId, t.active), index('reservations_order_idx').on(t.orderId, t.active)],
);

// ---------- Pedidos y ventas ----------
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    number: text('number').notNull().unique(),
    kind: text('kind').notNull().default('pedido'), // pedido | venta
    customerId: integer('customer_id').references(() => customers.id),
    status: text('status').notNull(),
    priority: text('priority').notNull().default('normal'),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    promisedDate: date('promised_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }), // vencimiento del saldo (crédito)
    deliveryMethod: text('delivery_method').notNull().default('recoge'),
    deliveryAddress: text('delivery_address'),
    notes: text('notes'),
    subtotal: integer('subtotal').notNull().default(0),
    discount: integer('discount').notNull().default(0),
    tax: integer('tax').notNull().default(0),
    total: integer('total').notNull().default(0),
    paid: integer('paid').notNull().default(0),
    cancelReason: text('cancel_reason'),
    createdBy: integer('created_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'string' }),
    readyAt: timestamp('ready_at', { withTimezone: true, mode: 'string' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [index('orders_status_idx').on(t.status), index('orders_customer_idx').on(t.customerId)],
);

export const orderItems = pgTable(
  'order_items',
  {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  variantId: integer('variant_id').notNull().references(() => variants.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
  unitCost: integer('unit_cost').notNull().default(0),
  lineTotal: integer('line_total').notNull(),
  customization: jsonb('customization'),
  qtyDelivered: integer('qty_delivered').notNull().default(0),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), index('order_items_variant_idx').on(t.variantId)],
);

export const orderEvents = pgTable(
  'order_events',
  {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  type: text('type').notNull(), // estado | pago | entrega | nota | produccion
  summary: text('summary').notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

// ---------- Caja ----------
export const cashSessions = pgTable(
  'cash_sessions',
  {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  status: text('status').notNull().default('abierta'), // abierta | cerrada
  openingAmount: integer('opening_amount').notNull(),
  openedBy: integer('opened_by').references(() => users.id),
  openedAt: timestamp('opened_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  openNote: text('open_note'),
  closedBy: integer('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
  expectedCash: integer('expected_cash'),
  countedCash: integer('counted_cash'),
  difference: integer('difference'),
  closeNote: text('close_note'),
  },
  (t) => [uniqueIndex('one_open_cash_session').on(t.status).where(sql`${t.status} = 'abierta'`)],
);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').references(() => cashSessions.id),
    type: text('type').notNull(), // ingreso | egreso
    category: text('category').notNull(),
    concept: text('concept').notNull(),
    amount: integer('amount').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    refType: text('ref_type'),
    refId: integer('ref_id'),
    reversalOf: integer('reversal_of'),
    userId: integer('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('cashmov_session_idx').on(t.sessionId), index('cashmov_created_idx').on(t.createdAt)],
);

/** Pagos de clientes (anticipos, abonos, pagos de venta). Los reversos son registros negativos. */
export const payments = pgTable(
  'payments',
  {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  orderId: integer('order_id').references(() => orders.id),
  customerId: integer('customer_id').references(() => customers.id),
  amount: integer('amount').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  notes: text('notes'),
  reversalOf: integer('reversal_of'),
  reversed: boolean('reversed').notNull().default(false),
  cashMovementId: integer('cash_movement_id').references(() => cashMovements.id),
  userId: integer('user_id').references(() => users.id),
  createdAt: createdAt(),
  },
  (t) => [index('payments_order_idx').on(t.orderId), index('payments_customer_idx').on(t.customerId)],
);

// ---------- Cuentas por pagar ----------
export const payables = pgTable('payables', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  purchaseId: integer('purchase_id'),
  category: text('category').notNull(),
  concept: text('concept').notNull(),
  amount: integer('amount').notNull(),
  paid: integer('paid').notNull().default(0),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  notes: text('notes'),
  cancelled: boolean('cancelled').notNull().default(false),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const payablePayments = pgTable('payable_payments', {
  id: serial('id').primaryKey(),
  payableId: integer('payable_id').notNull().references(() => payables.id),
  amount: integer('amount').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  cashMovementId: integer('cash_movement_id').references(() => cashMovements.id),
  userId: integer('user_id').references(() => users.id),
  createdAt: createdAt(),
});

// ---------- Compras ----------
export const purchases = pgTable('purchases', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  supplierId: integer('supplier_id').notNull().references(() => suppliers.id),
  status: text('status').notNull().default('pedida'),
  date: date('date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  subtotal: integer('subtotal').notNull(),
  discount: integer('discount').notNull().default(0),
  total: integer('total').notNull(),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }),
  createdAt: createdAt(),
});

export const purchaseItems = pgTable(
  'purchase_items',
  {
  id: serial('id').primaryKey(),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id),
  variantId: integer('variant_id').notNull().references(() => variants.id),
  description: text('description').notNull(),
  quantity: qty('quantity').notNull(),
  qtyReceived: qty('qty_received').notNull().default(0),
  unitCost: integer('unit_cost').notNull(),
  },
  (t) => [index('purchase_items_purchase_idx').on(t.purchaseId)],
);

// ---------- Producción ----------
export const productionOrders = pgTable('production_orders', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  orderId: integer('order_id').references(() => orders.id),
  stage: text('stage').notNull(),
  status: text('status').notNull().default('pendiente'),
  priority: text('priority').notNull().default('normal'),
  targetDate: date('target_date', { mode: 'string' }).notNull(),
  responsible: text('responsible'),
  notes: text('notes'),
  qcApproved: boolean('qc_approved').notNull().default(false),
  qcNotes: text('qc_notes'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const productionItems = pgTable(
  'production_items',
  {
  id: serial('id').primaryKey(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  orderItemId: integer('order_item_id'),
  variantId: integer('variant_id').notNull().references(() => variants.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  qtyDone: integer('qty_done').notNull().default(0),
  specs: text('specs'),
  },
  (t) => [index('production_items_po_idx').on(t.productionOrderId)],
);

export const productionMaterials = pgTable(
  'production_materials',
  {
  id: serial('id').primaryKey(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  variantId: integer('variant_id').notNull().references(() => variants.id),
  qtyRequired: qty('qty_required').notNull(),
  qtyConsumed: qty('qty_consumed').notNull().default(0),
  qtyWaste: qty('qty_waste').notNull().default(0),
  },
  (t) => [index('production_materials_po_idx').on(t.productionOrderId)],
);

export const productionEvents = pgTable('production_events', {
  id: serial('id').primaryKey(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  type: text('type').notNull(), // etapa | consumo | avance | incidencia | calidad | nota
  subtype: text('subtype'),
  summary: text('summary').notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: createdAt(),
});

/** Receta estimada: cuánto material consume una unidad de un producto terminado. */
export const billOfMaterials = pgTable(
  'bill_of_materials',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id').notNull().references(() => products.id),
    materialVariantId: integer('material_variant_id').notNull().references(() => variants.id),
    qtyPerUnit: qty('qty_per_unit').notNull(),
  },
  (t) => [uniqueIndex('bom_unique').on(t.productId, t.materialVariantId)],
);

// ---------- Entregas ----------
export const deliveries = pgTable('deliveries', {
  id: serial('id').primaryKey(),
  number: text('number').notNull().unique(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  deliveredBy: text('delivered_by'),
  receivedBy: text('received_by').notNull(),
  notes: text('notes'),
  partial: boolean('partial').notNull().default(false),
  balanceAtDelivery: integer('balance_at_delivery').notNull().default(0),
  items: jsonb('items').$type<Array<{ orderItemId: number; quantity: number; description: string }>>().notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: createdAt(),
});

// ---------- Marketing ----------
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  objective: text('objective'),
  segment: text('segment').notNull(),
  channel: text('channel').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('borrador'),
  checklist: jsonb('checklist').$type<Array<{ text: string; done: boolean }>>().notNull().default([]),
  createdAt: createdAt(),
});

export const contentAssets = pgTable('content_assets', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // imagen | video | documento
  description: text('description'),
  url: text('url'),
  createdAt: createdAt(),
});

export const messageTemplates = pgTable('message_templates', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  body: text('body').notNull(),
});
