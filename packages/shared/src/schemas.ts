// Validaciones compartidas (API y formularios). Mensajes en español y con instrucción de cómo corregir.
import { z } from 'zod';
import {
  CAMPAIGN_STATUSES,
  CHANNELS,
  CUSTOMER_TYPES,
  DELIVERY_METHODS,
  INCIDENT_TYPES,
  PAYMENT_METHODS,
  PRIORITIES,
  PRODUCT_TYPES,
  ROLES,
  SEGMENTS,
} from './constants';

/** Límites de seguridad: evitan desbordes en la base de datos y peticiones abusivas. */
export const LIMITS = {
  money: 2_000_000_000, // tope de un entero en PostgreSQL (~2.147 millones)
  qty: 1_000_000,
  text: 200,
  longText: 2000,
  lines: 300, // productos por pedido, venta, compra u orden
  list: 200,
};
const id = z.coerce.number({ message: 'Selecciona una opción válida.' }).int('Selecciona una opción válida.').positive('Selecciona una opción válida.').max(2_147_483_647, 'Selecciona una opción válida.');
const req = (label: string) => z.string().trim().min(1, `Escribe ${label}.`).max(LIMITS.text, `Es muy largo: máximo ${LIMITS.text} caracteres.`);
const optStr = z
  .string()
  .trim()
  .max(LIMITS.longText, `Es muy largo: máximo ${LIMITS.longText} caracteres.`)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const money = (label: string) =>
  z.coerce.number().int(`${label} debe ser un valor en pesos sin decimales.`).min(0, `${label} no puede ser negativo.`).max(LIMITS.money, `${label} supera el máximo permitido.`);
const positiveMoney = (label: string) =>
  z.coerce.number().int(`${label} debe ser un valor en pesos sin decimales.`).positive(`${label} debe ser mayor que cero.`).max(LIMITS.money, `${label} supera el máximo permitido.`);
const qty = (label = 'La cantidad') => z.coerce.number().positive(`${label} debe ser mayor que cero.`).max(LIMITS.qty, `${label} supera el máximo permitido (${LIMITS.qty}).`);
const qtyInt = (label = 'La cantidad') => z.coerce.number().int(`${label} debe ser un número entero.`).positive(`${label} debe ser mayor que cero.`).max(LIMITS.qty, `${label} supera el máximo permitido.`);
const qtyMin0 = z.coerce.number().min(0, 'No puede ser negativo.').max(LIMITS.qty, 'Supera el máximo permitido.');
const lines = <T extends z.ZodTypeAny>(item: T, msg: string) => z.array(item).min(1, msg).max(LIMITS.lines, `Máximo ${LIMITS.lines} renglones por registro.`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida.');
const optDate = isoDate.optional().nullable().or(z.literal('').transform(() => null));
const phone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/[^\d+]/g, '') : null))
  .refine((v) => !v || v.replace(/\D/g, '').length >= 7, 'El teléfono debe tener al menos 7 números.');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Escribe un correo válido, por ejemplo: nombre@empresa.com'),
  password: z.string().min(1, 'Escribe tu contraseña.').max(128, 'La contraseña es muy larga.'),
});

// ---------- Clientes ----------
export const customerSchema = z.object({
  name: req('el nombre o razón social'),
  type: z.enum(CUSTOMER_TYPES),
  document: optStr,
  phone,
  whatsapp: phone,
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'El correo no parece válido. Ejemplo: nombre@correo.com'),
  address: optStr,
  city: optStr,
  notes: optStr,
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  marketingConsent: z.boolean().default(false),
  creditDays: z.coerce.number().int().min(0).max(180).default(0),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// ---------- Proveedores ----------
export const supplierSchema = z.object({
  name: req('el nombre del proveedor'),
  document: optStr,
  contactName: optStr,
  phone,
  email: optStr,
  address: optStr,
  supplies: optStr,
  notes: optStr,
  paymentTermDays: z.coerce.number().int().min(0).max(180).default(0),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

// ---------- Productos ----------
export const variantInputSchema = z.object({
  id: id.optional(),
  size: optStr,
  color: optStr,
  sku: optStr,
  price: z.coerce.number().int().min(0).max(LIMITS.money).optional().nullable(),
  cost: z.coerce.number().int().min(0).max(LIMITS.money).optional().nullable(),
  minStock: qtyMin0.optional().nullable(),
  initialStock: qtyMin0.optional().nullable(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const productSchema = z.object({
  name: req('el nombre del producto'),
  sku: optStr,
  type: z.enum(PRODUCT_TYPES),
  category: req('la categoría'),
  description: optStr,
  unit: req('la unidad de medida'),
  price: money('El precio de venta'),
  cost: money('El costo'),
  minStock: z.coerce.number().min(0, 'El stock mínimo no puede ser negativo.').max(LIMITS.qty, 'El stock mínimo supera el máximo.').default(0),
  location: optStr,
  customizable: z.boolean().default(false),
  imageUrl: optStr,
  variants: lines(variantInputSchema, 'Agrega al menos una talla o presentación.'),
});
export type ProductInput = z.infer<typeof productSchema>;

// ---------- Inventario ----------
export const adjustmentSchema = z.object({
  variantId: id,
  direction: z.enum(['entrada', 'salida']),
  kind: z.enum(['ajuste', 'merma']).default('ajuste'),
  quantity: qty(),
  reason: req('el motivo del ajuste'),
});

export const physicalCountSchema = z.object({
  note: optStr,
  lines: z
    .array(z.object({ variantId: id, counted: z.coerce.number().min(0, 'El conteo no puede ser negativo.').max(LIMITS.qty, 'El conteo supera el máximo permitido.') }))
    .min(1, 'Registra al menos un conteo.')
    .max(2000, 'Máximo 2000 renglones por conteo.'),
});

// ---------- Pedidos ----------
export const customizationSchema = z
  .object({
    logo: z.boolean().default(false),
    technique: z.enum(['ninguna', 'bordado', 'estampado', 'sublimado']).default('ninguna'),
    position: optStr,
    names: optStr,
    measures: optStr,
    notes: optStr,
  })
  .partial()
  .optional()
  .nullable();
export type Customization = z.infer<typeof customizationSchema>;

export const orderItemInputSchema = z.object({
  variantId: id,
  quantity: qtyInt(),
  unitPrice: money('El precio'),
  customization: customizationSchema,
});

export const orderCreateSchema = z.object({
  customerId: id,
  items: lines(orderItemInputSchema, 'Agrega al menos un producto al pedido.'),
  promisedDate: isoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  deliveryMethod: z.enum(DELIVERY_METHODS).default('recoge'),
  deliveryAddress: optStr,
  notes: optStr,
  discount: money('El descuento').default(0),
  dueDate: optDate,
  status: z.enum(['borrador', 'pendiente', 'confirmado']).default('confirmado'),
  advance: z
    .object({ amount: positiveMoney('El anticipo'), method: z.enum(PAYMENT_METHODS), reference: optStr })
    .optional()
    .nullable(),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderStatusChangeSchema = z.object({
  status: z.enum(['borrador', 'pendiente', 'confirmado', 'en_produccion', 'listo', 'entregado', 'cancelado']),
  reason: optStr,
});

export const orderUpdateSchema = z.object({
  promisedDate: isoDate.optional(),
  priority: z.enum(PRIORITIES).optional(),
  deliveryMethod: z.enum(DELIVERY_METHODS).optional(),
  deliveryAddress: optStr,
  notes: optStr,
  dueDate: optDate,
});

export const paymentSchema = z.object({
  amount: positiveMoney('El valor del pago'),
  method: z.enum(PAYMENT_METHODS),
  reference: optStr,
  notes: optStr,
});

export const reversePaymentSchema = z.object({ reason: req('el motivo del reverso') });

export const quickSaleSchema = z.object({
  customerId: id.optional().nullable(),
  items: lines(z.object({ variantId: id, quantity: qtyInt(), unitPrice: money('El precio') }), 'Agrega al menos un producto.'),
  discount: money('El descuento').default(0),
  payments: z.array(z.object({ amount: positiveMoney('El pago'), method: z.enum(PAYMENT_METHODS), reference: optStr })).max(5, 'Máximo 5 pagos por venta.').default([]),
  dueDate: optDate,
  notes: optStr,
});
export type QuickSaleInput = z.infer<typeof quickSaleSchema>;

// ---------- Producción ----------
export const productionCreateSchema = z.object({
  orderId: id.optional().nullable(),
  targetDate: isoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  responsible: optStr,
  notes: optStr,
  items: z
    .array(z.object({ variantId: id, quantity: qtyInt(), specs: optStr }))
    .max(LIMITS.lines)
    .optional(),
});

export const productionStageSchema = z.object({ stage: req('la etapa'), note: optStr });
export const productionConsumeSchema = z.object({
  lines: z
    .array(z.object({ materialId: id, quantity: qtyMin0, waste: qtyMin0.default(0) }))
    .min(1)
    .max(LIMITS.lines),
});
export const productionProgressSchema = z.object({
  lines: z.array(z.object({ itemId: id, done: z.coerce.number().int().min(0).max(LIMITS.qty) })).min(1).max(LIMITS.lines),
});
export const productionIncidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  detail: req('qué pasó'),
});
export const productionFinishSchema = z.object({
  qcApproved: z.literal(true, { message: 'Confirma que el control de calidad fue aprobado.' }),
  qcNotes: optStr,
  consumeRemaining: z.boolean().default(true),
});

// ---------- Entregas ----------
export const deliverySchema = z.object({
  receivedBy: req('el nombre de quien recibe'),
  deliveredBy: optStr,
  notes: optStr,
  items: z.array(z.object({ orderItemId: id, quantity: z.coerce.number().int().min(0).max(LIMITS.qty) })).min(1).max(LIMITS.lines),
  allowBalance: z.boolean().default(false),
});

// ---------- Caja ----------
export const cashOpenSchema = z.object({ openingAmount: money('El saldo inicial'), note: optStr });
export const cashMovementSchema = z.object({
  type: z.enum(['ingreso', 'egreso']),
  category: req('la categoría'),
  concept: req('el concepto'),
  amount: positiveMoney('El valor'),
  method: z.enum(PAYMENT_METHODS),
  reference: optStr,
  supplierId: id.optional().nullable(),
});
export const cashCloseSchema = z
  .object({ countedCash: money('El efectivo contado'), note: optStr })
  .strict();

// ---------- Cuentas por pagar ----------
export const payableSchema = z.object({
  supplierId: id.optional().nullable(),
  category: req('la categoría'),
  concept: req('el concepto'),
  amount: positiveMoney('El valor'),
  dueDate: isoDate,
  notes: optStr,
});
export const payablePaymentSchema = z.object({
  amount: positiveMoney('El valor del pago'),
  method: z.enum(PAYMENT_METHODS),
  reference: optStr,
});

// ---------- Compras ----------
export const purchaseCreateSchema = z.object({
  supplierId: id,
  items: z
    .array(z.object({ variantId: id, quantity: qty(), unitCost: positiveMoney('El costo') }))
    .min(1, 'Agrega al menos un material.')
    .max(LIMITS.lines, `Máximo ${LIMITS.lines} materiales por compra.`),
  discount: money('El descuento').default(0),
  date: isoDate,
  dueDate: optDate,
  notes: optStr,
  payNow: z
    .object({ amount: positiveMoney('El pago'), method: z.enum(PAYMENT_METHODS), reference: optStr })
    .optional()
    .nullable(),
});
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export const purchaseReceiveSchema = z.object({
  lines: z.array(z.object({ itemId: id, quantity: qtyMin0 })).min(1).max(LIMITS.lines),
  note: optStr,
  closeShort: z.boolean().default(false),
});

// ---------- Marketing ----------
export const campaignSchema = z.object({
  name: req('el nombre de la campaña'),
  objective: optStr,
  segment: z.enum(SEGMENTS),
  channel: z.enum(CHANNELS),
  date: isoDate,
  message: z.string().trim().min(1, 'Escribe el mensaje.').max(LIMITS.longText, 'El mensaje es muy largo.'),
  status: z.enum(CAMPAIGN_STATUSES).default('borrador'),
  checklist: z.array(z.object({ text: z.string().trim().max(LIMITS.text), done: z.boolean() })).max(50).default([]),
});

// ---------- Configuración ----------
export const settingsSchema = z.object({
  companyName: req('el nombre de la empresa'),
  nit: optStr,
  phone: optStr,
  email: optStr,
  address: optStr,
  city: optStr,
  receiptFooter: optStr,
  sizes: z.array(z.string().trim().min(1).max(60)).min(1).max(LIMITS.list),
  colors: z.array(z.string().trim().min(1).max(60)).min(1).max(LIMITS.list),
  categories: z.array(z.string().trim().min(1).max(60)).min(1).max(LIMITS.list),
  units: z.array(z.string().trim().min(1).max(60)).min(1).max(LIMITS.list),
  expenseCategories: z.array(z.string().trim().min(1).max(60)).min(1).max(LIMITS.list),
  productionStages: z.array(z.string().trim().min(1).max(60)).min(2).max(20),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const userSchema = z.object({
  name: req('el nombre'),
  email: z.string().trim().toLowerCase().email('Escribe un correo válido.'),
  role: z.enum(ROLES),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128, 'La contraseña es muy larga.').optional().nullable(),
  active: z.boolean().default(true),
});

/** Solo enlaces web (http/https). Bloquea "javascript:" y otros esquemas peligrosos. */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.longText)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => !v || /^https?:\/\//i.test(v), 'El enlace debe empezar por http:// o https://');

export const contentAssetSchema = z.object({
  name: req('el nombre del contenido'),
  kind: z.enum(['imagen', 'video', 'documento']).default('imagen'),
  description: optStr,
  url: safeUrlSchema,
});
