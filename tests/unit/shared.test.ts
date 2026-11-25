import { describe, expect, it } from 'vitest';
import {
  addDays,
  can,
  canAccess,
  canTransition,
  diffDays,
  formatCOP,
  marginPct,
  orderCreateSchema,
  parseCOP,
  presetRange,
  quickSaleSchema,
  receivableStatus,
  seesMoney,
} from '../../packages/shared/src';

describe('dinero (COP enteros)', () => {
  it('formatea sin decimales y con puntos de miles', () => {
    expect(formatCOP(1500000)).toBe('$ 1.500.000');
    expect(formatCOP(0)).toBe('$ 0');
  });
  it('interpreta lo que escribe el usuario', () => {
    expect(parseCOP('$ 120.000')).toBe(120000);
    expect(parseCOP('1.500.000')).toBe(1500000);
    expect(parseCOP('')).toBe(0);
  });
  it('calcula margen', () => {
    expect(marginPct(38000, 19000)).toBe(50);
    expect(marginPct(0, 100)).toBe(0);
  });
});

describe('fechas y cartera', () => {
  it('suma días y calcula diferencias', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(diffDays('2026-11-23', '2026-12-03')).toBe(10);
  });
  it('clasifica cuentas por cobrar', () => {
    const today = '2026-11-23';
    expect(receivableStatus(0, '2026-11-01', today)).toBe('pagado');
    expect(receivableStatus(1000, '2026-11-20', today)).toBe('vencido');
    expect(receivableStatus(1000, '2026-11-27', today)).toBe('por_vencer');
    expect(receivableStatus(1000, '2026-12-20', today)).toBe('vigente');
  });
  it('rangos de periodo', () => {
    expect(presetRange('mes', '2026-11-23')).toEqual({ from: '2026-11-01', to: '2026-11-23' });
    expect(presetRange('7d', '2026-11-23')).toEqual({ from: '2026-11-17', to: '2026-11-23' });
  });
});

describe('estados del pedido', () => {
  it('permite solo transiciones válidas', () => {
    expect(canTransition('borrador', 'confirmado')).toBe(true);
    expect(canTransition('confirmado', 'en_produccion')).toBe(true);
    expect(canTransition('entregado', 'cancelado')).toBe(false);
    expect(canTransition('cancelado', 'confirmado')).toBe(false);
    expect(canTransition('borrador', 'entregado')).toBe(false);
  });
});

describe('permisos por rol', () => {
  it('producción no ve dinero ni caja', () => {
    expect(seesMoney('produccion')).toBe(false);
    expect(canAccess('produccion', 'caja')).toBe(false);
    expect(can('produccion', 'pago.registrar')).toBe(false);
  });
  it('ventas no cierra caja ni reversa pagos', () => {
    expect(can('ventas', 'caja.cerrar')).toBe(false);
    expect(can('ventas', 'pago.reversar')).toBe(false);
    expect(can('ventas', 'pedido.crear')).toBe(true);
  });
  it('administrador puede todo', () => {
    expect(can('admin', 'configuracion.editar')).toBe(true);
    expect(canAccess('admin', 'configuracion')).toBe(true);
  });
});

describe('validaciones', () => {
  it('pedido sin productos da un mensaje claro', () => {
    const r = orderCreateSchema.safeParse({ customerId: 1, items: [], promisedDate: '2026-12-01' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/al menos un producto/);
  });
  it('no acepta cantidades en cero ni precios con decimales', () => {
    const r = quickSaleSchema.safeParse({ items: [{ variantId: 1, quantity: 0, unitPrice: 1000 }] });
    expect(r.success).toBe(false);
    const r2 = quickSaleSchema.safeParse({ items: [{ variantId: 1, quantity: 1, unitPrice: 1000.5 }] });
    expect(r2.success).toBe(false);
  });
});
