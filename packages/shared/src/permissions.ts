import type { Role } from './constants';

/** Módulos de la aplicación (coinciden con la navegación). */
export const MODULES = [
  'inicio',
  'pedidos',
  'produccion',
  'entregas',
  'inventario',
  'productos',
  'clientes',
  'proveedores',
  'caja',
  'cartera',
  'reportes',
  'analisis',
  'marketing',
  'configuracion',
] as const;
export type Module = (typeof MODULES)[number];

/** Acciones sensibles que se controlan individualmente. */
export const ACTIONS = [
  'pedido.crear',
  'pedido.editar',
  'pedido.cancelar',
  'pedido.descuento',
  'pago.registrar',
  'pago.reversar',
  'venta.registrar',
  'produccion.gestionar',
  'entrega.registrar',
  'entrega.con_saldo',
  'inventario.ajustar',
  'producto.editar',
  'producto.precio',
  'cliente.editar',
  'proveedor.editar',
  'compra.gestionar',
  'caja.operar',
  'caja.cerrar',
  'gasto.registrar',
  'finanzas.ver',
  'configuracion.editar',
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL_MODULES = [...MODULES];

export const ROLE_MODULES: Record<Role, Module[]> = {
  admin: ALL_MODULES,
  ventas: ['inicio', 'pedidos', 'entregas', 'productos', 'clientes', 'inventario', 'marketing'],
  produccion: ['inicio', 'produccion', 'pedidos', 'inventario', 'productos'],
  finanzas: ['inicio', 'pedidos', 'caja', 'cartera', 'clientes', 'proveedores', 'reportes', 'analisis'],
  inventario: ['inicio', 'inventario', 'productos', 'proveedores', 'produccion', 'analisis'],
};

export const ROLE_ACTIONS: Record<Role, Action[]> = {
  admin: [...ACTIONS],
  ventas: [
    'pedido.crear',
    'pedido.editar',
    'pedido.cancelar',
    'pago.registrar',
    'venta.registrar',
    'entrega.registrar',
    'cliente.editar',
    'caja.operar',
  ],
  produccion: ['produccion.gestionar'],
  finanzas: [
    'pago.registrar',
    'pago.reversar',
    'venta.registrar',
    'caja.operar',
    'caja.cerrar',
    'gasto.registrar',
    'finanzas.ver',
    'entrega.con_saldo',
    'compra.gestionar',
    'proveedor.editar',
    'cliente.editar',
    'pedido.descuento',
  ],
  inventario: [
    'inventario.ajustar',
    'producto.editar',
    'compra.gestionar',
    'proveedor.editar',
    'produccion.gestionar',
  ],
};

export function canAccess(role: Role, module: Module): boolean {
  return ROLE_MODULES[role]?.includes(module) ?? false;
}

export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
}

/** Roles que pueden ver cifras de dinero (ventas, caja, márgenes). */
export function seesMoney(role: Role): boolean {
  return role !== 'produccion';
}
