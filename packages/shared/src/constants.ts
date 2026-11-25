// Catálogos y estados compartidos entre API y web.
// Toda etiqueta visible está en español sencillo.

export const ROLES = ['admin', 'ventas', 'produccion', 'finanzas', 'inventario'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  ventas: 'Ventas',
  produccion: 'Producción',
  finanzas: 'Caja y finanzas',
  inventario: 'Inventario',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Acceso completo, incluida la configuración.',
  ventas: 'Clientes, pedidos y ventas. No modifica configuración financiera.',
  produccion: 'Órdenes de producción y avance. No ve información financiera.',
  finanzas: 'Caja, pagos, gastos, cartera y reportes financieros.',
  inventario: 'Productos, existencias, compras y movimientos.',
};

// ---------- Pedidos ----------
export const ORDER_STATUSES = [
  'borrador',
  'pendiente',
  'confirmado',
  'en_produccion',
  'listo',
  'entregado',
  'cancelado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  borrador: 'Cotización',
  pendiente: 'Por confirmar',
  confirmado: 'Confirmado',
  en_produccion: 'En producción',
  listo: 'Listo para entregar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const ORDER_STATUS_HELP: Record<OrderStatus, string> = {
  borrador: 'Cotización guardada. Todavía no afecta inventario ni producción.',
  pendiente: 'Esperando aprobación del cliente o datos faltantes.',
  confirmado: 'Pedido aceptado. Se reservó el inventario disponible.',
  en_produccion: 'Se está fabricando.',
  listo: 'Terminado y preparado para entregar.',
  entregado: 'El cliente ya recibió el pedido.',
  cancelado: 'Pedido anulado. Las reservas fueron liberadas.',
};

/** Transiciones válidas que el usuario puede ejecutar manualmente. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  borrador: ['pendiente', 'confirmado', 'cancelado'],
  pendiente: ['confirmado', 'borrador', 'cancelado'],
  confirmado: ['en_produccion', 'listo', 'cancelado'],
  en_produccion: ['listo', 'cancelado'],
  listo: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Estados en los que el pedido ya compromete inventario o dinero del cliente. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['pendiente', 'confirmado', 'en_produccion', 'listo'];

export const PRIORITIES = ['normal', 'alta', 'urgente'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

export const DELIVERY_METHODS = ['recoge', 'domicilio', 'institucion'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  recoge: 'El cliente recoge en el local',
  domicilio: 'Envío a domicilio',
  institucion: 'Entrega en la institución',
};

// ---------- Productos ----------
export const PRODUCT_TYPES = ['terminado', 'materia_prima', 'insumo', 'servicio'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  terminado: 'Producto terminado',
  materia_prima: 'Materia prima',
  insumo: 'Insumo',
  servicio: 'Servicio',
};
export const PRODUCT_TYPE_HELP: Record<ProductType, string> = {
  terminado: 'Prendas listas para vender (camisas, sudaderas, medias…).',
  materia_prima: 'Material principal para fabricar (telas).',
  insumo: 'Material de apoyo (hilos, botones, cierres, etiquetas, bolsas).',
  servicio: 'Trabajo que se cobra pero no se guarda en bodega (bordado, estampado).',
};
export const STOCK_PRODUCT_TYPES: ProductType[] = ['terminado', 'materia_prima', 'insumo'];

// ---------- Inventario ----------
export const MOVEMENT_TYPES = [
  'entrada_compra',
  'entrada_produccion',
  'entrada_ajuste',
  'entrada_devolucion',
  'salida_venta',
  'salida_consumo',
  'salida_merma',
  'salida_ajuste',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  entrada_compra: 'Entrada por compra',
  entrada_produccion: 'Entrada por producción',
  entrada_ajuste: 'Ajuste (suma)',
  entrada_devolucion: 'Devolución / reverso',
  salida_venta: 'Salida por venta o entrega',
  salida_consumo: 'Consumo de producción',
  salida_merma: 'Merma o daño',
  salida_ajuste: 'Ajuste (resta)',
};

// ---------- Producción ----------
export const DEFAULT_PRODUCTION_STAGES = [
  'Corte',
  'Confección',
  'Bordado / estampado',
  'Acabados',
  'Control de calidad',
  'Empaque',
] as const;

export const PRODUCTION_STATUSES = ['pendiente', 'en_proceso', 'terminada', 'cancelada'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  pendiente: 'Sin iniciar',
  en_proceso: 'En proceso',
  terminada: 'Terminada',
  cancelada: 'Cancelada',
};
export const INCIDENT_TYPES = ['retraso', 'defecto', 'falta_insumo', 'retrabajo'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_LABELS: Record<IncidentType, string> = {
  retraso: 'Retraso',
  defecto: 'Defecto',
  falta_insumo: 'Falta de insumo',
  retrabajo: 'Retrabajo',
};

// ---------- Dinero ----------
export const PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  nequi: 'Nequi / Daviplata',
  otro: 'Otro',
};

export const INCOME_CATEGORIES = ['Venta', 'Abono de cliente', 'Otro ingreso'] as const;
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Compra de materiales',
  'Servicios públicos',
  'Arriendo',
  'Transporte',
  'Nómina',
  'Mantenimiento',
  'Publicidad',
  'Otros gastos',
] as const;

export const PAYABLE_STATUSES = ['pendiente', 'parcial', 'pagado', 'vencido'] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];
export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  pendiente: 'Pendiente',
  parcial: 'Abonada',
  pagado: 'Pagada',
  vencido: 'Vencida',
};

export const RECEIVABLE_STATUSES = ['vigente', 'por_vencer', 'vencido', 'pagado'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];
export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  vigente: 'Al día',
  por_vencer: 'Vence pronto',
  vencido: 'Vencida',
  pagado: 'Pagada',
};

// ---------- Compras ----------
export const PURCHASE_STATUSES = ['pedida', 'recibida_parcial', 'recibida', 'cancelada'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pedida: 'Pedida (por recibir)',
  recibida_parcial: 'Recibida en parte',
  recibida: 'Recibida completa',
  cancelada: 'Cancelada',
};

// ---------- Clientes ----------
export const CUSTOMER_TYPES = ['persona', 'empresa', 'colegio', 'institucion', 'equipo', 'otro'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  persona: 'Persona',
  empresa: 'Empresa',
  colegio: 'Colegio',
  institucion: 'Institución',
  equipo: 'Equipo deportivo',
  otro: 'Otro',
};
export const DEFAULT_CUSTOMER_TAGS = ['Frecuente', 'Institucional', 'Mayorista', 'Temporada escolar', 'Nuevo'] as const;

// ---------- Marketing ----------
export const CAMPAIGN_STATUSES = ['borrador', 'programada', 'enviada_manual', 'finalizada'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  borrador: 'Borrador',
  programada: 'Programada',
  enviada_manual: 'Enviada a mano',
  finalizada: 'Finalizada',
};
export const SEGMENTS = ['frecuentes', 'institucionales', 'temporada', 'inactivos', 'todos'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABELS: Record<Segment, string> = {
  frecuentes: 'Clientes frecuentes',
  institucionales: 'Colegios e instituciones',
  temporada: 'Clientes de temporada escolar',
  inactivos: 'Clientes inactivos (más de 90 días sin comprar)',
  todos: 'Todos los clientes que aceptan mensajes',
};
export const CHANNELS = ['whatsapp', 'instagram', 'facebook', 'correo'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  correo: 'Correo',
};

// ---------- Configuración por defecto ----------
export const DEFAULT_SIZES = ['4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const DEFAULT_COLORS = ['Blanco', 'Azul oscuro', 'Azul rey', 'Gris', 'Negro', 'Rojo', 'Verde', 'Vinotinto'];
export const DEFAULT_CATEGORIES = [
  'Uniforme escolar',
  'Uniforme deportivo',
  'Dotación empresarial',
  'Camisetas',
  'Accesorios',
  'Telas',
  'Insumos de confección',
  'Empaques',
  'Servicios',
];
export const DEFAULT_UNITS = ['unidad', 'metro', 'rollo', 'cono', 'paquete', 'par', 'docena'];
