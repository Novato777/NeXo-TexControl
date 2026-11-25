// Datos demo: empresa de uniformes con 12 meses de historia coherente.
// Toda la historia pasa por los mismos servicios que usa la aplicación, así stock, caja, pagos,
// producción y cartera quedan consistentes entre sí. Es determinístico (misma semilla = mismos datos)
// y no duplica registros: solo se carga si la base está vacía (o con un reset explícito).
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import {
  addDays,
  DEFAULT_CATEGORIES,
  DEFAULT_COLORS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PRODUCTION_STAGES,
  DEFAULT_SIZES,
  DEFAULT_UNITS,
  diffDays,
  todayISO,
  type CustomerType,
  type PaymentMethod,
  type Priority,
  type ProductType,
  type Role,
} from '@nexo/shared';
import { config } from '../config';
import type { AuthUser } from '../lib/auth';
import { addCashMovement, sessionSummary } from '../services/cash';
import { moveStock, round3 } from '../services/inventory';
import { changeOrderStatus, createOrder, quickSale, registerDelivery, registerPayment } from '../services/orders';
import {
  createProductionOrder,
  finishProductionOrder,
  moveStage,
  registerConsumption,
  registerIncident,
  registerProgress,
} from '../services/production';
import { createPayable, createPurchase, payPayable, receivePurchase } from '../services/purchasing';
import { db } from './client';
import * as s from './schema';

// ------------------------------------------------------------------ utilidades
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261123);
const ri = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
function weighted<T>(items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((a, i) => a + weight(i), 0);
  let r = rand() * total;
  for (const i of items) {
    r -= weight(i);
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}
/** Hora de hoy N minutos antes de ahora (nunca antes de las 8:05 a. m.), para que nada quede en el futuro. */
function todayMinus(minutes: number): string {
  const now = new Date(Date.now() - 5 * 3600_000); // hora de Bogotá expresada en UTC
  let mins = now.getUTCHours() * 60 + now.getUTCMinutes() - minutes;
  mins = Math.max(mins, 8 * 60 + 5 + (minutes % 20));
  return `${now.toISOString().slice(0, 10)}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00-05:00`;
}
const at = (date: string, hh: number, mm = 0) => `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-05:00`;

// ------------------------------------------------------------------ catálogo
const SCHOOL = ['6', '8', '10', '12', '14', '16'];
const ADULT = ['S', 'M', 'L', 'XL', 'XXL'];

interface MatDef {
  key: string;
  name: string;
  sku: string;
  type: ProductType;
  category: string;
  unit: string;
  cost: number;
  min: number;
  colors?: string[];
  target: number | number[];
  supplier: string;
  location: string;
}
const MATERIALS: MatDef[] = [
  { key: 'oxford', name: 'Tela oxford blanca', sku: 'TEL-OXF', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 9500, min: 80, target: 46, supplier: 'textiles', location: 'Bodega telas · Estante A' },
  { key: 'dacron', name: 'Tela dacrón a cuadros azul', sku: 'TEL-DAC', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 12000, min: 60, target: 140, supplier: 'textiles', location: 'Bodega telas · Estante A' },
  { key: 'dril', name: 'Tela dril', sku: 'TEL-DRI', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 11000, min: 60, colors: ['Gris', 'Azul oscuro'], target: [120, 95], supplier: 'textiles', location: 'Bodega telas · Estante B' },
  { key: 'perchada', name: 'Tela perchada deportiva', sku: 'TEL-PER', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 10500, min: 100, colors: ['Azul oscuro'], target: [210], supplier: 'textiles', location: 'Bodega telas · Estante B' },
  { key: 'pique', name: 'Tela piqué', sku: 'TEL-PIQ', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 9800, min: 60, colors: ['Blanco', 'Azul rey'], target: [150, 85], supplier: 'textiles', location: 'Bodega telas · Estante C' },
  { key: 'antifluido', name: 'Tela antifluido', sku: 'TEL-ANT', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 13500, min: 50, colors: ['Azul rey', 'Verde'], target: [24, 70], supplier: 'textiles', location: 'Bodega telas · Estante C' },
  { key: 'micro', name: 'Tela microfibra deportiva', sku: 'TEL-MIC', type: 'materia_prima', category: 'Telas', unit: 'metro', cost: 8500, min: 50, colors: ['Azul oscuro', 'Rojo', 'Blanco'], target: [120, 64, 90], supplier: 'textiles', location: 'Bodega telas · Estante D' },
  { key: 'hilo', name: 'Hilo poliéster', sku: 'HIL-POL', type: 'insumo', category: 'Insumos de confección', unit: 'cono', cost: 7500, min: 12, colors: ['Blanco', 'Azul oscuro', 'Gris', 'Negro'], target: [30, 26, 9, 18], supplier: 'hilos', location: 'Cuarto de insumos' },
  { key: 'hilo_bordar', name: 'Hilo para bordar', sku: 'HIL-BOR', type: 'insumo', category: 'Insumos de confección', unit: 'cono', cost: 9500, min: 8, target: 22, supplier: 'hilos', location: 'Cuarto de insumos' },
  { key: 'botones', name: 'Botón camisa 4 huecos', sku: 'BOT-CAM', type: 'insumo', category: 'Insumos de confección', unit: 'unidad', cost: 60, min: 600, target: 420, supplier: 'hilos', location: 'Cuarto de insumos' },
  { key: 'cremallera', name: 'Cremallera 20 cm', sku: 'CRE-20', type: 'insumo', category: 'Insumos de confección', unit: 'unidad', cost: 1200, min: 120, target: 310, supplier: 'hilos', location: 'Cuarto de insumos' },
  { key: 'etiqueta', name: 'Etiqueta marquilla tejida', sku: 'ETI-MAR', type: 'insumo', category: 'Insumos de confección', unit: 'unidad', cost: 250, min: 500, target: 1650, supplier: 'etiquetas', location: 'Cuarto de insumos' },
  { key: 'bolsa', name: 'Bolsa de empaque individual', sku: 'EMP-BOL', type: 'insumo', category: 'Empaques', unit: 'unidad', cost: 300, min: 400, target: 980, supplier: 'empaques', location: 'Zona de empaque' },
  { key: 'vinilo', name: 'Vinilo textil para estampar', sku: 'VIN-TEX', type: 'insumo', category: 'Insumos de confección', unit: 'metro', cost: 18000, min: 10, target: 7, supplier: 'vinilos', location: 'Taller de estampado' },
];

interface ProdDef {
  key: string;
  name: string;
  sku: string;
  category: string;
  sizes: string[];
  colors: string[];
  price: number;
  cost: number;
  min: number;
  customizable: boolean;
  popularity: number;
  description: string;
  bom: Array<[matKey: string, color: string | null, qty: number]>;
  sizePrice?: Record<string, number>;
}
const PRODUCTS: ProdDef[] = [
  {
    key: 'camisa', name: 'Camisa escolar manga corta', sku: 'CAM-ESC', category: 'Uniforme escolar', sizes: SCHOOL, colors: ['Blanco'], price: 38000, cost: 19000, min: 6, customizable: true, popularity: 10,
    description: 'Camisa en tela oxford con bolsillo y escudo opcional.',
    bom: [['oxford', null, 1.2], ['hilo', 'Blanco', 0.05], ['botones', null, 7], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'jardinera', name: 'Jardinera escolar a cuadros', sku: 'JAR-ESC', category: 'Uniforme escolar', sizes: ['6', '8', '10', '12', '14'], colors: ['Azul oscuro'], price: 62000, cost: 31000, min: 4, customizable: true, popularity: 6,
    description: 'Jardinera en dacrón a cuadros, con pretina ajustable.',
    bom: [['dacron', null, 1.5], ['hilo', 'Azul oscuro', 0.06], ['cremallera', null, 1], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'pantalon', name: 'Pantalón escolar', sku: 'PAN-ESC', category: 'Uniforme escolar', sizes: ['8', '10', '12', '14', '16'], colors: ['Gris'], price: 55000, cost: 27000, min: 4, customizable: false, popularity: 6,
    description: 'Pantalón clásico en dril con pretina reforzada.',
    bom: [['dril', 'Gris', 1.3], ['hilo', 'Gris', 0.06], ['cremallera', null, 1], ['botones', null, 1], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'sudadera', name: 'Sudadera deportiva completa', sku: 'SUD-DEP', category: 'Uniforme deportivo', sizes: [...SCHOOL, 'S', 'M', 'L'], colors: ['Azul oscuro'], price: 98000, cost: 52000, min: 4, customizable: true, popularity: 8,
    description: 'Chaqueta y pantalón en tela perchada. Tallas de adulto con precio diferente.',
    sizePrice: { S: 108000, M: 108000, L: 112000 },
    bom: [['perchada', 'Azul oscuro', 2.2], ['hilo', 'Azul oscuro', 0.1], ['cremallera', null, 1], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'polo_dep', name: 'Camiseta deportiva tipo polo', sku: 'POL-DEP', category: 'Uniforme deportivo', sizes: SCHOOL, colors: ['Blanco'], price: 34000, cost: 16000, min: 6, customizable: true, popularity: 8,
    description: 'Camiseta en piqué para educación física.',
    bom: [['pique', 'Blanco', 0.8], ['hilo', 'Blanco', 0.04], ['botones', null, 2], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'pantaloneta', name: 'Pantaloneta deportiva', sku: 'PTA-DEP', category: 'Uniforme deportivo', sizes: SCHOOL, colors: ['Azul oscuro'], price: 26000, cost: 11000, min: 6, customizable: false, popularity: 6,
    description: 'Pantaloneta en microfibra con resorte.',
    bom: [['micro', 'Azul oscuro', 0.5], ['hilo', 'Azul oscuro', 0.03], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'chaqueta', name: 'Chaqueta institucional impermeable', sku: 'CHA-INS', category: 'Dotación empresarial', sizes: ADULT, colors: ['Azul oscuro'], price: 120000, cost: 65000, min: 3, customizable: true, popularity: 2,
    description: 'Chaqueta con capota, forro y bordado institucional.',
    bom: [['antifluido', 'Azul rey', 1.8], ['hilo', 'Azul oscuro', 0.1], ['cremallera', null, 2], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'camibuso', name: 'Camibuso empresarial', sku: 'CMB-EMP', category: 'Dotación empresarial', sizes: ADULT, colors: ['Blanco', 'Azul rey'], price: 42000, cost: 20000, min: 4, customizable: true, popularity: 4,
    description: 'Polo en piqué para dotación, con bordado del logo.',
    bom: [['pique', 'Azul rey', 0.9], ['hilo', 'Blanco', 0.04], ['botones', null, 3], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'overol', name: 'Overol de dotación', sku: 'OVE-DOT', category: 'Dotación empresarial', sizes: ADULT, colors: ['Azul oscuro'], price: 89000, cost: 45000, min: 3, customizable: true, popularity: 2,
    description: 'Overol en dril con cinta reflectiva.',
    bom: [['dril', 'Azul oscuro', 2.6], ['hilo', 'Azul oscuro', 0.12], ['cremallera', null, 1], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'quirurgico', name: 'Uniforme quirúrgico antifluido', sku: 'UNQ-ANT', category: 'Dotación empresarial', sizes: ['S', 'M', 'L', 'XL'], colors: ['Azul rey', 'Verde'], price: 75000, cost: 36000, min: 3, customizable: true, popularity: 3,
    description: 'Blusa y pantalón en tela antifluido.',
    bom: [['antifluido', 'Azul rey', 2.0], ['hilo', 'Blanco', 0.08], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'futbol', name: 'Uniforme de fútbol', sku: 'UNF-FUT', category: 'Uniforme deportivo', sizes: ['8', '10', '12', '14', 'S', 'M', 'L'], colors: ['Rojo'], price: 65000, cost: 30000, min: 3, customizable: true, popularity: 3,
    description: 'Camiseta y pantaloneta en microfibra; admite nombre y número.',
    bom: [['micro', 'Rojo', 1.1], ['hilo', 'Blanco', 0.05], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'delantal', name: 'Delantal de cocina', sku: 'DEL-COC', category: 'Dotación empresarial', sizes: [], colors: ['Negro'], price: 28000, cost: 12000, min: 5, customizable: true, popularity: 2,
    description: 'Delantal en dril con bolsillo frontal.',
    bom: [['dril', 'Azul oscuro', 0.9], ['hilo', 'Negro', 0.03], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
  {
    key: 'medias', name: 'Medias escolares (par)', sku: 'MED-ESC', category: 'Accesorios', sizes: [], colors: ['Azul oscuro', 'Blanco'], price: 9000, cost: 3500, min: 20, customizable: false, popularity: 9,
    description: 'Media larga en algodón. Se compran a proveedor y se revenden.', bom: [],
  },
  {
    key: 'corbata', name: 'Corbata escolar', sku: 'COR-ESC', category: 'Accesorios', sizes: [], colors: ['Vinotinto'], price: 15000, cost: 6000, min: 10, customizable: false, popularity: 4,
    description: 'Corbata con resorte para niños.', bom: [],
  },
  {
    key: 'gorra', name: 'Gorra bordada', sku: 'GOR-BOR', category: 'Accesorios', sizes: [], colors: ['Azul oscuro'], price: 22000, cost: 9000, min: 8, customizable: true, popularity: 3,
    description: 'Gorra en drill con bordado frontal.', bom: [['hilo_bordar', null, 0.02]],
  },
  {
    key: 'camiseta', name: 'Camiseta básica estampada', sku: 'CAM-BAS', category: 'Camisetas', sizes: ['S', 'M', 'L', 'XL'], colors: ['Blanco'], price: 25000, cost: 10000, min: 6, customizable: true, popularity: 4,
    description: 'Camiseta en microfibra para eventos, con estampado.',
    bom: [['micro', 'Blanco', 0.7], ['hilo', 'Blanco', 0.03], ['vinilo', null, 0.05], ['etiqueta', null, 1], ['bolsa', null, 1]],
  },
];

const SERVICES = [
  { key: 'bordado', name: 'Bordado de logo', sku: 'SER-BOR', price: 6000, cost: 2500, description: 'Bordado de escudo o logo hasta 8 cm.' },
  { key: 'estampado', name: 'Estampado de nombre y número', sku: 'SER-EST', price: 8000, cost: 3000, description: 'Estampado en vinilo textil.' },
  { key: 'arreglo', name: 'Ajuste o arreglo de prenda', sku: 'SER-ARR', price: 10000, cost: 4000, description: 'Ajuste de largo, ruedo o cintura.' },
];

const CUSTOMERS: Array<{ key: string; name: string; type: CustomerType; doc?: string; phone: string; email?: string; address?: string; tags: string[]; credit: number; consent: boolean; notes?: string }> = [
  { key: 'sanjose', name: 'Colegio San José de la Montaña', type: 'colegio', doc: '860.512.334-1', phone: '6017451230', email: 'compras@sanjosemontana.edu.co', address: 'Cra 15 # 85-40', tags: ['Institucional', 'Frecuente'], credit: 30, consent: true, notes: 'Pagan 50% de anticipo y el resto a 30 días. Contacto: rectoría.' },
  { key: 'horizonte', name: 'Colegio Nuevo Horizonte', type: 'colegio', doc: '900.231.887-4', phone: '6016402288', email: 'administracion@nuevohorizonte.edu.co', address: 'Cl 140 # 12-15', tags: ['Institucional'], credit: 30, consent: true },
  { key: 'andes', name: 'Gimnasio Los Andes', type: 'colegio', doc: '830.044.120-9', phone: '6018023344', email: 'compras@gimnasiolosandes.edu.co', address: 'Km 3 vía La Calera', tags: ['Institucional', 'Frecuente'], credit: 30, consent: true },
  { key: 'roble', name: 'Liceo Campestre El Roble', type: 'colegio', doc: '900.765.001-2', phone: '6018765012', address: 'Vereda Yerbabuena, Chía', tags: ['Institucional'], credit: 30, consent: false },
  { key: 'clinica', name: 'Clínica Santa Lucía', type: 'institucion', doc: '800.112.556-7', phone: '6013334455', email: 'dotacion@clinicasantalucia.co', address: 'Av 68 # 22-10', tags: ['Institucional', 'Mayorista'], credit: 45, consent: true },
  { key: 'pilares', name: 'Constructora Pilares S.A.S.', type: 'empresa', doc: '901.334.876-3', phone: '3104567890', email: 'sst@pilares.co', address: 'Cl 26 # 69-76 Of 502', tags: ['Mayorista'], credit: 30, consent: true },
  { key: 'atletico', name: 'Club Deportivo Atlético Sur', type: 'equipo', phone: '3157788990', address: 'Polideportivo El Tunal', tags: ['Frecuente'], credit: 15, consent: true },
  { key: 'gigantes', name: 'Escuela de Fútbol Pequeños Gigantes', type: 'equipo', phone: '3001122334', tags: [], credit: 15, consent: true },
  { key: 'cazuela', name: 'Restaurante La Cazuela', type: 'empresa', doc: '901.009.332-1', phone: '3205566778', address: 'Cl 53 # 13-20', tags: [], credit: 0, consent: false },
  { key: 'fundacion', name: 'Fundación Manos Unidas', type: 'institucion', doc: '900.888.123-5', phone: '3112233445', email: 'contacto@manosunidas.org', tags: ['Institucional'], credit: 15, consent: true },
  { key: 'lapiz', name: 'Distribuidora Escolar El Lápiz', type: 'empresa', doc: '900.456.789-0', phone: '3016677889', address: 'Cra 10 # 12-34 Local 8', tags: ['Mayorista', 'Frecuente'], credit: 30, consent: true },
  { key: 'mafe', name: 'María Fernanda López', type: 'persona', doc: '52.345.678', phone: '3009876543', email: 'mafe.lopez@correo.com', tags: ['Frecuente', 'Temporada escolar'], credit: 0, consent: true },
  { key: 'jorge', name: 'Jorge Enrique Castro', type: 'persona', doc: '79.876.543', phone: '3123456789', tags: ['Temporada escolar'], credit: 15, consent: true },
  { key: 'paola', name: 'Paola Andrea Ríos', type: 'persona', phone: '3187654321', tags: ['Temporada escolar'], credit: 0, consent: true },
  { key: 'ana', name: 'Ana Lucía Moreno', type: 'persona', phone: '3145678901', tags: [], credit: 0, consent: true, notes: 'Compró uniformes para sus 3 hijos el año pasado.' },
];

const SUPPLIERS = [
  { key: 'textiles', name: 'Textiles Andinos S.A.S.', document: '890.903.210-5', contactName: 'Ricardo Gómez', phone: '6044441122', email: 'ventas@textilesandinos.co', address: 'Itagüí, Antioquia', supplies: 'Telas oxford, dacrón, dril, perchada, piqué, antifluido y microfibra', term: 30 },
  { key: 'hilos', name: 'Hilos y Botones La Costura', document: '900.112.334-8', contactName: 'Gloria Patiño', phone: '3102223344', email: 'pedidos@lacostura.co', address: 'Cra 10 # 9-50, Bogotá', supplies: 'Hilos, botones, cremalleras, hilo para bordar', term: 0 },
  { key: 'etiquetas', name: 'Etiquetas y Marquillas Express', document: '901.223.445-1', contactName: 'Felipe Cárdenas', phone: '3118889900', email: 'felipe@marquillasexpress.co', address: 'Cl 13 # 24-60, Bogotá', supplies: 'Marquillas tejidas, etiquetas de talla', term: 15 },
  { key: 'empaques', name: 'Empaques del Valle', document: '805.667.223-0', contactName: 'Sandra Ocampo', phone: '6023345566', email: 'comercial@empaquesdelvalle.co', address: 'Yumbo, Valle', supplies: 'Bolsas plásticas y cajas de cartón', term: 15 },
  { key: 'vinilos', name: 'Tintas y Vinilos Pro', document: '901.556.778-2', contactName: 'Mauricio León', phone: '3176655443', email: 'ventas@vinilospro.co', address: 'Cra 30 # 5-12, Bogotá', supplies: 'Vinilo textil, tintas de sublimación', term: 30 },
  { key: 'medias', name: 'Calcetería Nacional', document: '860.009.887-3', contactName: 'Hernán Ruiz', phone: '6045556677', email: 'pedidos@calceterianal.co', address: 'Medellín', supplies: 'Medias escolares, corbatas y gorras sin marcar', term: 30 },
];

const USERS: Array<{ name: string; email: string; role: Role }> = [
  { name: 'Laura Méndez', email: 'admin@demo.co', role: 'admin' },
  { name: 'Carlos Rojas', email: 'ventas@demo.co', role: 'ventas' },
  { name: 'Martha Gil', email: 'produccion@demo.co', role: 'produccion' },
  { name: 'Andrés Pardo', email: 'caja@demo.co', role: 'finanzas' },
  { name: 'Diana Suárez', email: 'inventario@demo.co', role: 'inventario' },
];

// Temporadas (calendario escolar A: ene-feb fuerte; jul y dic medianos)
const MONTH_WEIGHT = [2.4, 1.9, 0.9, 0.8, 0.8, 0.9, 1.4, 1.2, 0.9, 0.8, 1.0, 1.3];

const METHODS: Array<[PaymentMethod, number]> = [
  ['efectivo', 45],
  ['nequi', 25],
  ['transferencia', 15],
  ['tarjeta', 15],
];
const pickMethod = () => weighted(METHODS, (m) => m[1])[0];

// ------------------------------------------------------------------ API pública
export async function isSeeded(): Promise<boolean> {
  const [row] = await db.select({ seededAt: s.settings.seededAt }).from(s.settings).limit(1);
  return Boolean(row?.seededAt);
}

export async function seedIfEmpty(): Promise<boolean> {
  if (await isSeeded()) return false;
  const [u] = await db.select({ n: sql<string>`count(*)` }).from(s.users);
  if (Number(u.n) > 0) return false; // hay datos reales: nunca sobreescribir
  await runSeed();
  return true;
}

export async function resetAndSeed() {
  await wipe();
  await runSeed();
}

async function wipe() {
  const tables = [
    'audit_logs', 'counters', 'order_events', 'stock_reservations', 'deliveries', 'production_events', 'production_materials',
    'production_items', 'production_orders', 'bill_of_materials', 'payments', 'payable_payments', 'payables', 'cash_movements',
    'cash_sessions', 'purchase_items', 'purchases', 'order_items', 'orders', 'inventory_movements', 'variants', 'products',
    'customers', 'suppliers', 'campaigns', 'content_assets', 'message_templates', 'users', 'settings',
  ];
  await db.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}

// ------------------------------------------------------------------ seed
async function runSeed() {
  const started = Date.now();
  const today = todayISO();
  const start = addDays(today, -365);
  // Bcrypt fuera de la transacción (es lento).
  const passwordHash = await bcrypt.hash(config.demoPassword, 10);

  await db.transaction(async (tx) => {
    await tx.insert(s.settings).values({
      id: 1,
      companyName: 'Confecciones Horizonte S.A.S.',
      nit: '901.234.567-8',
      phone: '601 745 1230 · 310 555 0101',
      email: 'contacto@confeccioneshorizonte.co',
      address: 'Cra 24 # 63-15, barrio 7 de Agosto',
      city: 'Bogotá D.C.',
      receiptFooter: 'Gracias por su compra. Cambios dentro de los 8 días siguientes con este comprobante.',
      sizes: DEFAULT_SIZES,
      colors: DEFAULT_COLORS,
      categories: DEFAULT_CATEGORIES,
      units: DEFAULT_UNITS,
      expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
      productionStages: [...DEFAULT_PRODUCTION_STAGES],
      paymentMethods: ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'],
    });

    const userIds: Record<Role, AuthUser> = {} as Record<Role, AuthUser>;
    for (const u of USERS) {
      const [row] = await tx.insert(s.users).values({ ...u, passwordHash }).returning();
      userIds[u.role] = { id: row.id, name: row.name, email: row.email, role: u.role };
    }
    const admin = userIds.admin;
    const ventas = userIds.ventas;
    const prod = userIds.produccion;
    const caja = userIds.finanzas;
    const inv = userIds.inventario;

    // --- terceros
    const cust: Record<string, number> = {};
    for (const c of CUSTOMERS) {
      const [row] = await tx
        .insert(s.customers)
        .values({
          name: c.name, type: c.type, document: c.doc ?? null, phone: c.phone, whatsapp: c.phone.startsWith('3') ? c.phone : null,
          email: c.email ?? null, address: c.address ?? null, city: 'Bogotá', tags: c.tags, creditDays: c.credit,
          marketingConsent: c.consent, notes: c.notes ?? null, createdAt: at(addDays(start, ri(0, 40)), 10),
        })
        .returning();
      cust[c.key] = row.id;
    }
    const supp: Record<string, number> = {};
    for (const sp of SUPPLIERS) {
      const [row] = await tx
        .insert(s.suppliers)
        .values({
          name: sp.name, document: sp.document, contactName: sp.contactName, phone: sp.phone, email: sp.email, address: sp.address,
          supplies: sp.supplies, paymentTermDays: sp.term, createdAt: at(start, 9),
        })
        .returning();
      supp[sp.key] = row.id;
    }

    // --- catálogo
    const matVariant = new Map<string, number>(); // "key|color" -> variantId
    const matSupplier = new Map<number, string>();
    const matCost = new Map<number, number>();
    const target = new Map<number, number>(); // stock final deseado por variante
    for (const m of MATERIALS) {
      const [p] = await tx
        .insert(s.products)
        .values({ sku: m.sku, name: m.name, type: m.type, category: m.category, unit: m.unit, price: 0, cost: m.cost, minStock: m.min, location: m.location, createdAt: at(start, 8) })
        .returning();
      const colors = m.colors ?? [null];
      for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        const [v] = await tx
          .insert(s.variants)
          .values({ productId: p.id, sku: color ? `${m.sku}-${color.slice(0, 3).toUpperCase()}${i}` : `${m.sku}-U`, color })
          .returning();
        matVariant.set(`${m.key}|${color ?? ''}`, v.id);
        matSupplier.set(v.id, m.supplier);
        matCost.set(v.id, m.cost);
        target.set(v.id, Array.isArray(m.target) ? m.target[i] : m.target);
      }
    }
    const mv = (key: string, color: string | null) => {
      const id = matVariant.get(`${key}|${color ?? ''}`) ?? matVariant.get(`${key}|`) ?? [...matVariant.entries()].find(([k]) => k.startsWith(`${key}|`))?.[1];
      if (!id) throw new Error(`Material no encontrado: ${key} ${color}`);
      return id;
    };

    interface FV { id: number; productKey: string; size: string | null; color: string; price: number; popularity: number; customizable: boolean }
    const finished: FV[] = [];
    const bomByProductKey = new Map<string, Array<[number, number]>>();
    const productIdByKey = new Map<string, number>();
    for (const pd of PRODUCTS) {
      const [p] = await tx
        .insert(s.products)
        .values({
          sku: pd.sku, name: pd.name, type: 'terminado', category: pd.category, unit: pd.key === 'medias' ? 'par' : 'unidad', price: pd.price, cost: pd.cost,
          minStock: pd.min, customizable: pd.customizable, description: pd.description, location: 'Bodega producto terminado', createdAt: at(start, 8),
        })
        .returning();
      productIdByKey.set(pd.key, p.id);
      const sizes = pd.sizes.length ? pd.sizes : [null];
      for (const color of pd.colors) {
        for (const size of sizes) {
          const sku = [pd.sku, size, pd.colors.length > 1 ? color.slice(0, 3).toUpperCase() : null].filter(Boolean).join('-');
          const vPrice = size && pd.sizePrice?.[size] ? pd.sizePrice[size] : null;
          const [v] = await tx.insert(s.variants).values({ productId: p.id, sku, size, color, price: vPrice }).returning();
          finished.push({ id: v.id, productKey: pd.key, size, color, price: vPrice ?? pd.price, popularity: pd.popularity, customizable: pd.customizable });
          // stock final: algunos por debajo del mínimo para generar alertas
          const low = rand() < 0.14;
          target.set(v.id, low ? ri(0, Math.max(1, pd.min - 1)) : ri(pd.min + 2, pd.min * 3 + 6));
        }
      }
      const bom: Array<[number, number]> = pd.bom.map(([k, c, q]) => [mv(k, c), q]);
      bomByProductKey.set(pd.key, bom);
      for (const [matId, q] of bom) await tx.insert(s.billOfMaterials).values({ productId: p.id, materialVariantId: matId, qtyPerUnit: q });
    }
    for (const sv of SERVICES) {
      const [p] = await tx
        .insert(s.products)
        .values({ sku: sv.sku, name: sv.name, type: 'servicio', category: 'Servicios', unit: 'unidad', price: sv.price, cost: sv.cost, description: sv.description, createdAt: at(start, 8) })
        .returning();
      await tx.insert(s.variants).values({ productId: p.id, sku: `${sv.sku}-U` });
    }
    const fvBy = (key: string, size?: string | null, color?: string) =>
      finished.find((f) => f.productKey === key && (size === undefined || f.size === size) && (!color || f.color === color))!;
    const variantProductKey = new Map(finished.map((f) => [f.id, f.productKey]));

    /** Materiales requeridos (misma lógica que el servicio de producción). */
    function bomReq(lines: Array<{ variantId: number; quantity: number }>) {
      const req = new Map<number, number>();
      for (const l of lines) {
        for (const [matId, q] of bomByProductKey.get(variantProductKey.get(l.variantId)!) ?? []) {
          req.set(matId, round3((req.get(matId) ?? 0) + q * l.quantity));
        }
      }
      return req;
    }

    // ---------------------------------------------------------------- plan de eventos
    /** deltas = cambio de stock físico; res = cambio de reservado (para simular el disponible). */
    interface Ev { at: string; deltas: Array<[number, number]>; res?: Array<[number, number]>; run: () => Promise<void> }
    const events: Ev[] = [];
    const sessionByDate = new Map<string, number>();
    const sessionFor = (iso: string) => sessionByDate.get(iso.slice(0, 10)) ?? null;
    const CASH_DAYS = 10; // últimas 10 jornadas con caja (abrir/cerrar)

    // 1) Ventas de mostrador diarias
    const walkIns = ['mafe', 'jorge', 'paola', 'ana'];
    for (let d = 1; d <= 365; d++) {
      const date = addDays(start, d);
      const dow = new Date(date + 'T12:00:00Z').getUTCDay();
      if (dow === 0) continue; // domingo cerrado
      if (date === today) continue; // las ventas de hoy se crean aparte, antes de la hora actual
      const month = Number(date.slice(5, 7)) - 1;
      const lambda = 1.25 * MONTH_WEIGHT[month] * (dow === 6 ? 1.4 : 1);
      let n = 0;
      let r = rand();
      // Poisson simple
      let p = Math.exp(-lambda);
      let cum = p;
      while (r > cum && n < 8) {
        n++;
        p *= lambda / n;
        cum += p;
      }
      for (let k = 0; k < n; k++) {
        const items: Array<{ variantId: number; quantity: number; unitPrice: number }> = [];
        const nItems = ri(1, 3);
        for (let j = 0; j < nItems; j++) {
          const f = weighted(finished, (x) => x.popularity);
          if (items.some((i) => i.variantId === f.id)) continue;
          items.push({ variantId: f.id, quantity: f.productKey === 'medias' ? ri(1, 4) : ri(1, 2), unitPrice: f.price });
        }
        const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
        const credit = rand() < 0.07;
        const customerKey = credit ? pick(['jorge', 'lapiz', 'atletico', 'gigantes']) : rand() < 0.3 ? pick(walkIns) : null;
        const advance = credit ? Math.round((total * 0.4) / 1000) * 1000 : total;
        const when = at(date, ri(9, 18), ri(0, 59));
        const daysAgo = diffDays(date, today);
        const method = pickMethod();
        const ctx = { orderId: 0 };
        events.push({
          at: when,
          deltas: items.map((i) => [i.variantId, -i.quantity]),
          run: async () => {
            const o = await quickSale(
              tx,
              {
                customerId: customerKey ? cust[customerKey] : null,
                items,
                discount: 0,
                payments: advance > 0 ? [{ amount: advance, method, reference: null }] : [],
                dueDate: credit ? addDays(date, 30) : null,
                notes: null,
              },
              pick([ventas, ventas, caja, admin]),
              { at: when, saleDate: date, sessionId: sessionFor(when) },
            );
            ctx.orderId = o.id;
          },
        });
        if (credit && daysAgo > 50) {
          const payDate = addDays(date, ri(12, 35));
          const w2 = at(payDate, ri(9, 17), ri(0, 59));
          events.push({
            at: w2,
            deltas: [],
            run: async () => {
              await registerPayment(tx, { orderId: ctx.orderId, amount: total - advance, method: pick(['transferencia', 'nequi']), notes: 'Abono saldo' }, caja, { at: w2, sessionId: sessionFor(w2) });
            },
          });
        }
      }
    }

    // 2) Pedidos institucionales históricos (fabricados y entregados)
    const instCustomers = ['sanjose', 'horizonte', 'andes', 'roble', 'clinica', 'pilares', 'atletico', 'gigantes', 'lapiz', 'fundacion'];
    const packages: Record<string, Array<[string, string]>> = {
      colegio: [['camisa', 'Blanco'], ['jardinera', 'Azul oscuro'], ['pantalon', 'Gris'], ['sudadera', 'Azul oscuro'], ['polo_dep', 'Blanco']],
      institucion: [['quirurgico', 'Azul rey'], ['camibuso', 'Blanco'], ['chaqueta', 'Azul oscuro']],
      empresa: [['overol', 'Azul oscuro'], ['camibuso', 'Azul rey'], ['chaqueta', 'Azul oscuro']],
      equipo: [['futbol', 'Rojo'], ['sudadera', 'Azul oscuro']],
    };
    for (let d = 8; d <= 330; d += ri(6, 11)) {
      const date = addDays(start, d);
      const ck = pick(instCustomers);
      const cdef = CUSTOMERS.find((c) => c.key === ck)!;
      const pkg = packages[cdef.type === 'colegio' ? 'colegio' : cdef.type === 'equipo' ? 'equipo' : cdef.type === 'empresa' ? 'empresa' : 'institucion'];
      const nLines = ri(1, 2);
      const items: Array<{ variantId: number; quantity: number; unitPrice: number; customization: { logo: boolean; technique: 'bordado' | 'estampado'; position: string } }> = [];
      for (let j = 0; j < nLines; j++) {
        const [pk, color] = pkg[(j + ri(0, pkg.length - 1)) % pkg.length];
        const vars = finished.filter((f) => f.productKey === pk && f.color === color);
        const sizes = vars.slice(0, ri(2, Math.min(4, vars.length)));
        for (const v of sizes) {
          if (items.some((i) => i.variantId === v.id)) continue;
          items.push({
            variantId: v.id,
            quantity: ri(4, 14),
            unitPrice: v.price,
            customization: { logo: true, technique: pk === 'futbol' ? 'estampado' : 'bordado', position: pk === 'futbol' ? 'Espalda: número; pecho: escudo' : 'Pecho izquierdo' },
          });
        }
      }
      const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
      const adv = Math.round((total * 0.5) / 1000) * 1000;
      const req = bomReq(items);
      const ctx = { orderId: 0, poId: 0 };
      const tCreate = at(date, 10, ri(0, 59));
      const tProd = at(addDays(date, 1), 8, 30);
      const tFinish = at(addDays(date, ri(7, 10)), 16, 0);
      const tDeliver = at(addDays(date, 12), 11, 0);
      const tPay = at(addDays(date, 12 + ri(5, 25)), 15, 0);
      events.push({
        at: tCreate,
        deltas: [],
        run: async () => {
          const o = await createOrder(
            tx,
            {
              customerId: cust[ck], items, promisedDate: addDays(date, 12), priority: 'normal', deliveryMethod: 'institucion',
              deliveryAddress: null, notes: null, discount: 0, dueDate: addDays(date, 12 + cdef.credit), status: 'confirmado',
              advance: { amount: adv, method: 'transferencia', reference: null },
            },
            ventas,
            { at: tCreate, orderDate: date, sessionId: null },
          );
          ctx.orderId = o.id;
        },
      });
      events.push({
        at: tProd,
        deltas: [],
        run: async () => {
          const po = await createProductionOrder(tx, { orderId: ctx.orderId, targetDate: addDays(date, 10), priority: 'normal', responsible: pick(['Taller 1 — Rosa', 'Taller 2 — Édgar']) }, prod, { at: tProd });
          ctx.poId = po.id;
          await moveStage(tx, po.id, 'Confección', null, prod, { at: at(addDays(date, 3), 9) });
        },
      });
      events.push({
        at: tFinish,
        deltas: [...[...req.entries()].map(([id, q]) => [id, -q] as [number, number]), ...items.map((i) => [i.variantId, i.quantity] as [number, number])],
        res: items.map((i) => [i.variantId, i.quantity]),
        run: async () => {
          const pis = await tx.select().from(s.productionItems).where(eq(s.productionItems.productionOrderId, ctx.poId));
          await registerProgress(tx, ctx.poId, pis.map((p) => ({ itemId: p.id, done: p.quantity })), prod, { at: tFinish });
          await moveStage(tx, ctx.poId, 'Control de calidad', null, prod, { at: tFinish });
          await finishProductionOrder(tx, ctx.poId, { consumeRemaining: true }, prod, { at: tFinish });
        },
      });
      const recent = diffDays(addDays(date, 12), today) < 60;
      events.push({
        at: tDeliver,
        deltas: items.map((i) => [i.variantId, -i.quantity]),
        res: items.map((i) => [i.variantId, -i.quantity]),
        run: async () => {
          const ois = await tx.select().from(s.orderItems).where(eq(s.orderItems.orderId, ctx.orderId));
          await registerDelivery(
            tx, ctx.orderId,
            { receivedBy: pick(['Coordinación administrativa', 'Almacén', 'Rectoría', 'Jefe de compras']), items: ois.map((i) => ({ orderItemId: i.id, quantity: i.quantity })), allowBalance: true },
            admin, { at: tDeliver },
          );
        },
      });
      if (!recent) {
        events.push({
          at: tPay,
          deltas: [],
          run: async () => {
            await registerPayment(tx, { orderId: ctx.orderId, amount: total - adv, method: 'transferencia', notes: 'Pago saldo' }, caja, { at: tPay, sessionId: null });
          },
        });
      }
    }

    // 3) Medias, corbatas y gorras se compran a proveedor (reventa)
    const resale = finished.filter((f) => ['medias', 'corbata', 'gorra'].includes(f.productKey));

    // 4) Gastos fijos mensuales (pagados) + compras mensuales de materiales
    const monthStarts: string[] = [];
    for (let m = 0; m < 12; m++) {
      const d0 = new Date(start + 'T12:00:00Z');
      d0.setUTCMonth(d0.getUTCMonth() + m + 1, 1);
      monthStarts.push(d0.toISOString().slice(0, 10));
    }
    for (const ms of monthStarts) {
      if (ms > today) continue;
      const fixed: Array<[string, string, number, number]> = [
        ['Arriendo', 'Arriendo local y taller', 2800000, 5],
        ['Nómina', 'Nómina operarios y administración (quincena 1)', 4200000, 15],
        ['Servicios públicos', 'Energía, agua y gas', 620000, 20],
        ['Nómina', 'Nómina operarios y administración (quincena 2)', 4200000, 28],
      ];
      for (const [cat, concept, amount, day] of fixed) {
        const due = addDays(ms, day - 1);
        const isCurrent = diffDays(due, today) < 0; // vencimiento futuro
        const w = at(addDays(due, -2), 9, 0);
        if (w.slice(0, 10) > today) continue;
        events.push({
          at: w,
          deltas: [],
          run: async () => {
            const p = await createPayable(tx, { category: cat, concept: `${concept} ${ms.slice(0, 7)}`, amount: Math.round(amount * (0.95 + rand() * 0.1) / 1000) * 1000, dueDate: due, issueDate: w.slice(0, 10) }, admin, { at: w });
            if (!isCurrent) await payPayable(tx, p.id, { amount: p.amount, method: 'transferencia', reference: null }, caja, { at: at(due, 10), sessionId: null });
          },
        });
      }
    }

    // Consumo de materiales por mes (para compras de reposición)
    const purchaseEvents = (planEvents: Ev[]) => {
      const consumption = new Map<string, Map<number, number>>(); // yyyy-mm -> mat -> qty
      const sold = new Map<string, Map<number, number>>();
      for (const e of planEvents) {
        const ym = e.at.slice(0, 7);
        for (const [id, q] of e.deltas) {
          if (q >= 0) continue;
          if (matSupplier.has(id)) {
            const m = consumption.get(ym) ?? new Map();
            m.set(id, (m.get(id) ?? 0) - q);
            consumption.set(ym, m);
          } else if (resale.some((r) => r.id === id)) {
            const m = sold.get(ym) ?? new Map();
            m.set(id, (m.get(id) ?? 0) - q);
            sold.set(ym, m);
          }
        }
      }
      const out: Ev[] = [];
      for (const ms of monthStarts) {
        const prevYm = addDays(ms, -1).slice(0, 7);
        const cons = consumption.get(prevYm);
        const bySupplier = new Map<string, Array<{ variantId: number; quantity: number; unitCost: number }>>();
        for (const [id, q] of cons ?? []) {
          const sk = matSupplier.get(id)!;
          const unit = matCost.get(id)!;
          const quantity = unit < 1000 ? Math.ceil(q / 100) * 100 : Math.ceil(q / 5) * 5;
          if (quantity <= 0) continue;
          bySupplier.set(sk, [...(bySupplier.get(sk) ?? []), { variantId: id, quantity, unitCost: unit }]);
        }
        const soldPrev = sold.get(prevYm);
        if (soldPrev?.size) {
          bySupplier.set(
            'medias',
            [...soldPrev.entries()].map(([id, q]) => {
              const pk = variantProductKey.get(id)!;
              const pd = PRODUCTS.find((p) => p.key === pk)!;
              return { variantId: id, quantity: Math.ceil(q / 6) * 6, unitCost: pd.cost };
            }),
          );
        }
        let offset = 2;
        for (const [sk, items] of bySupplier) {
          const date = addDays(ms, offset++);
          if (date > addDays(today, -6)) continue; // las compras recientes se manejan aparte
          const w = at(date, 9, 30);
          const wr = at(addDays(date, 2), 11, 0);
          const ctx = { id: 0 };
          const sup = SUPPLIERS.find((x) => x.key === sk)!;
          const old = diffDays(addDays(date, sup.term), today) > 0;
          out.push({
            at: w,
            deltas: [],
            run: async () => {
              const p = await createPurchase(
                tx,
                { supplierId: supp[sk], items, discount: 0, date, dueDate: addDays(date, sup.term), notes: null, payNow: sup.term === 0 ? { amount: Math.round(items.reduce((a, i) => a + i.quantity * i.unitCost, 0)), method: 'transferencia', reference: null } : null },
                inv,
                { at: w, sessionId: null },
              );
              ctx.id = p.id;
            },
          });
          out.push({
            at: wr,
            deltas: items.map((i) => [i.variantId, i.quantity]),
            run: async () => {
              const pis = await tx.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseId, ctx.id));
              await receivePurchase(tx, ctx.id, { lines: pis.map((p) => ({ itemId: p.id, quantity: Number(p.quantity) })) }, inv, { at: wr });
              if (sup.term > 0 && old) {
                const [pay] = await tx.select().from(s.payables).where(eq(s.payables.purchaseId, ctx.id));
                await payPayable(tx, pay.id, { amount: pay.amount, method: 'transferencia', reference: null }, caja, { at: at(addDays(date, sup.term - 1), 10), sessionId: null });
              }
            },
          });
        }
      }
      return out;
    };
    events.push(...purchaseEvents(events));

    // 5) Jornadas de caja recientes (abrir / cerrar) y gastos menores en efectivo
    for (let k = CASH_DAYS; k >= 0; k--) {
      const date = addDays(today, -k);
      if (new Date(date + 'T12:00:00Z').getUTCDay() === 0 && k !== 0) continue;
      const wOpen = at(date, 8, 0);
      const wClose = at(date, 19, 0);
      events.push({
        at: wOpen,
        deltas: [],
        run: async () => {
          const number = `CAJA-${date.replaceAll('-', '')}`;
          const [sess] = await tx.insert(s.cashSessions).values({ number, openingAmount: 200000, openedBy: caja.id, openedAt: wOpen }).returning();
          sessionByDate.set(date, sess.id);
        },
      });
      const wExp = k === 0 ? todayMinus(35) : at(date, 12, ri(0, 59));
      events.push({
        at: wExp,
        deltas: [],
        run: async () => {
          const [cat, concept, amount] = pick([
            ['Transporte', 'Domicilio entrega de pedido', 18000],
            ['Otros gastos', 'Cafetería y aseo', 23500],
            ['Mantenimiento', 'Repuesto de máquina plana', 45000],
            ['Transporte', 'Taxi a proveedor', 22000],
          ] as const);
          await addCashMovement(tx, { type: 'egreso', category: cat, concept, amount, method: 'efectivo', userId: caja.id, at: wExp, sessionId: sessionByDate.get(date) ?? null });
        },
      });
      if (k === 0) continue; // la caja de hoy queda abierta
      events.push({
        at: wClose,
        deltas: [],
        run: async () => {
          const id = sessionByDate.get(date)!;
          const sum = await sessionSummary(tx, id);
          const diff = k === 3 ? -5000 : 0;
          await tx
            .update(s.cashSessions)
            .set({
              status: 'cerrada', closedBy: caja.id, closedAt: wClose, expectedCash: sum.expectedCash, countedCash: sum.expectedCash + diff, difference: diff,
              closeNote: diff ? 'Faltaron $5.000: se dio cambio de más a un cliente. Se informó a administración.' : null,
            })
            .where(eq(s.cashSessions.id, id));
        },
      });
    }

    // 5b) Ventas de mostrador de hoy (siempre antes de la hora actual)
    {
      const todaySales: Array<[string, Array<[FV, number]>, PaymentMethod, number]> = [
        ['mafe', [[fvBy('camisa', '8'), 2], [fvBy('medias', null, 'Blanco'), 3]], 'efectivo', 150],
        ['', [[fvBy('pantaloneta', '10'), 1], [fvBy('polo_dep', '12'), 1]], 'nequi', 110],
        ['', [[fvBy('corbata'), 2]], 'efectivo', 80],
        ['paola', [[fvBy('jardinera', '10'), 1], [fvBy('camisa', '10'), 1]], 'tarjeta', 50],
        ['', [[fvBy('gorra'), 1]], 'efectivo', 20],
      ];
      for (const [ck, lines, method, minsAgo] of todaySales) {
        const w = todayMinus(minsAgo);
        const items = lines.map(([f, q]) => ({ variantId: f.id, quantity: q, unitPrice: f.price }));
        const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
        events.push({
          at: w,
          deltas: items.map((i) => [i.variantId, -i.quantity]),
          run: async () => {
            await quickSale(tx, { customerId: ck ? cust[ck] : null, items, discount: 0, payments: [{ amount: total, method, reference: null }], dueDate: null, notes: null }, pick([ventas, caja]), { at: w, saleDate: today, sessionId: sessionFor(w) });
          },
        });
      }
    }

    // 6) Escenario actual (lo que el cliente ve "hoy")
    const recentOrder = (
      daysAgo: number,
      ck: string,
      lines: Array<[FV, number, boolean]>,
      o: { promised: number; priority?: Priority; status: 'borrador' | 'pendiente' | 'confirmado'; advancePct?: number; notes?: string; delivery?: 'recoge' | 'domicilio' | 'institucion' },
    ) => {
      const date = addDays(today, -daysAgo);
      const when = at(date, 10, ri(0, 50));
      const items = lines.map(([f, q, custom]) => ({
        variantId: f.id,
        quantity: q,
        unitPrice: f.price,
        customization: custom ? { logo: true, technique: f.productKey === 'futbol' || f.productKey === 'camiseta' ? ('estampado' as const) : ('bordado' as const), position: 'Pecho izquierdo' } : null,
      }));
      const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
      const ctx = { orderId: 0 };
      const cdef = CUSTOMERS.find((c) => c.key === ck)!;
      events.push({
        at: when,
        deltas: [],
        // Al confirmar, lo que no es personalizado se separa de bodega.
        res: o.status === 'confirmado' ? lines.filter(([, , custom]) => !custom).map(([f, q]) => [f.id, q] as [number, number]) : [],
        run: async () => {
          const ord = await createOrder(
            tx,
            {
              customerId: cust[ck], items, promisedDate: addDays(today, o.promised), priority: o.priority ?? 'normal', deliveryMethod: o.delivery ?? 'institucion',
              deliveryAddress: null, notes: o.notes ?? null, discount: 0, dueDate: addDays(today, o.promised + cdef.credit), status: o.status,
              advance: o.advancePct ? { amount: Math.round((total * o.advancePct) / 1000) * 1000, method: 'transferencia', reference: null } : null,
            },
            ventas,
            { at: when, orderDate: date, sessionId: sessionFor(when) },
          );
          ctx.orderId = ord.id;
        },
      });
      return { ctx };
    };

    // Helpers de escenario que necesitan el id del pedido
    const scenario: Array<() => void> = [];
    // a) Borrador: delantales restaurante
    recentOrder(1, 'cazuela', [[fvBy('delantal'), 12, true]], { promised: 15, status: 'borrador', notes: 'Cotización: confirmar si el logo va bordado o estampado.' });
    // b) Pendiente de confirmación: fundación camisetas
    recentOrder(2, 'fundacion', [[fvBy('camiseta', 'M'), 20, true], [fvBy('camiseta', 'L'), 20, true]], { promised: 12, status: 'pendiente', notes: 'Esperando arte final del logo de la fundación.' });
    // c) Confirmado (sin producción aún): Colegio Nuevo Horizonte, varias tallas
    recentOrder(
      3, 'horizonte',
      [[fvBy('camisa', '8'), 25, true], [fvBy('camisa', '10'), 30, true], [fvBy('camisa', '12'), 28, true], [fvBy('jardinera', '8'), 15, true], [fvBy('jardinera', '10'), 18, true]],
      { promised: 18, status: 'confirmado', advancePct: 0.5, priority: 'alta', notes: 'Escudo bordado en pecho izquierdo. Entregar empacado por curso.' },
    );
    // d) Confirmado desde bodega (reserva de stock): Distribuidora El Lápiz
    const lapizLines: Array<[FV, number, boolean]> = [[fvBy('medias', null, 'Azul oscuro'), 12, false], [fvBy('corbata'), 6, false]];
    for (const [f, q] of lapizLines) target.set(f.id, Math.max(target.get(f.id)!, q + 10));
    recentOrder(2, 'lapiz', lapizLines, { promised: 4, status: 'confirmado', advancePct: 0.3, delivery: 'domicilio' });
    // e) Listo (desde bodega) para entregar HOY: María Fernanda, pagado completo
    const mafeLines: Array<[FV, number, boolean]> = [[fvBy('sudadera', '10'), 1, false], [fvBy('polo_dep', '10'), 2, false], [fvBy('medias', null, 'Blanco'), 3, false]];
    for (const [f, q] of mafeLines) target.set(f.id, Math.max(target.get(f.id)!, q + 4));
    const mafe = recentOrder(4, 'mafe', mafeLines, { promised: 0, status: 'confirmado', advancePct: 1, delivery: 'recoge' });
    scenario.push(() => {
      const w = at(addDays(today, -2), 15, 0);
      events.push({ at: w, deltas: [], run: async () => void (await changeOrderStatus(tx, mafe.ctx.orderId, 'listo', ventas, { at: w })) });
    });

    // Producción de pedidos personalizados
    const producedOrder = (
      daysAgo: number,
      ck: string,
      lines: Array<[FV, number]>,
      o: { promised: number; priority?: Priority; stage: string; consumeFrac?: number; donePct?: number; finish?: boolean; incident?: [import('@nexo/shared').IncidentType, string]; advancePct: number; responsible: string; notes?: string },
    ) => {
      const r = recentOrder(daysAgo, ck, lines.map(([f, q]) => [f, q, true]), { promised: o.promised, status: 'confirmado', advancePct: o.advancePct, priority: o.priority, notes: o.notes });
      const items = lines.map(([f, q]) => ({ variantId: f.id, quantity: q }));
      const req = bomReq(items);
      const ctx = { poId: 0 };
      const wP = at(addDays(today, -daysAgo + 1), 8, 15);
      events.push({
        at: wP,
        deltas: [],
        run: async () => {
          const po = await createProductionOrder(tx, { orderId: r.ctx.orderId, targetDate: addDays(today, o.promised - 1), priority: o.priority ?? 'normal', responsible: o.responsible }, prod, { at: wP });
          ctx.poId = po.id;
        },
      });
      const wS = at(addDays(today, -Math.max(0, daysAgo - 2)), 9, 0);
      const consumeDeltas: Array<[number, number]> = o.consumeFrac ? [...req.entries()].map(([id, q]) => [id, -round3(q * o.consumeFrac!)]) : [];
      const finishDeltas: Array<[number, number]> = o.finish
        ? [...[...req.entries()].map(([id, q]) => [id, -round3(q - round3(q * (o.consumeFrac ?? 0)))] as [number, number]), ...items.map((i) => [i.variantId, i.quantity] as [number, number])]
        : [];
      events.push({
        at: wS,
        deltas: [...consumeDeltas, ...finishDeltas],
        res: o.finish ? items.map((i) => [i.variantId, i.quantity] as [number, number]) : [],
        run: async () => {
          const stagesOrder = [...DEFAULT_PRODUCTION_STAGES];
          for (const st of stagesOrder.slice(1, stagesOrder.indexOf(o.stage as (typeof DEFAULT_PRODUCTION_STAGES)[number]) + 1)) {
            await moveStage(tx, ctx.poId, st, null, prod, { at: wS });
          }
          if (o.consumeFrac) {
            const mats = await tx.select().from(s.productionMaterials).where(eq(s.productionMaterials.productionOrderId, ctx.poId));
            await registerConsumption(tx, ctx.poId, mats.map((m) => ({ materialId: m.id, quantity: round3(Number(m.qtyRequired) * o.consumeFrac!), waste: 0 })), prod, { at: wS });
          }
          if (o.donePct || o.finish) {
            const pis = await tx.select().from(s.productionItems).where(eq(s.productionItems.productionOrderId, ctx.poId));
            await registerProgress(tx, ctx.poId, pis.map((p) => ({ itemId: p.id, done: o.finish ? p.quantity : Math.floor(p.quantity * o.donePct!) })), prod, { at: wS });
          }
          if (o.incident) await registerIncident(tx, ctx.poId, o.incident[0], o.incident[1], prod, { at: wS });
          if (o.finish) await finishProductionOrder(tx, ctx.poId, { consumeRemaining: true, qcNotes: 'Revisadas costuras y bordado.' }, prod, { at: wS });
        },
      });
      return r;
    };

    // f) En producción — Colegio San José sudaderas (en confección, 50% material consumido)
    producedOrder(
      6, 'sanjose',
      [[fvBy('sudadera', '8'), 20], [fvBy('sudadera', '10'), 26], [fvBy('sudadera', '12'), 24], [fvBy('sudadera', '14'), 18], [fvBy('sudadera', 'S'), 12]],
      { promised: 9, stage: 'Confección', consumeFrac: 0.5, donePct: 0.3, advancePct: 0.5, responsible: 'Taller 1 — Rosa', notes: 'Escudo bordado en chaqueta; nombre del colegio en pierna izquierda.' },
    );
    // g) En producción y ATRASADO — Club Atlético Sur, fútbol con números
    producedOrder(
      12, 'atletico',
      [[fvBy('futbol', '12'), 8], [fvBy('futbol', '14'), 9], [fvBy('futbol', 'M'), 8]],
      { promised: -1, priority: 'urgente', stage: 'Bordado / estampado', consumeFrac: 1, donePct: 0.6, advancePct: 0.5, incident: ['falta_insumo', 'Se acabó el vinilo blanco; se pidió a Tintas y Vinilos Pro.'], responsible: 'Estampado — Wilson', notes: 'Números del 1 al 25 en espalda. Lista de nombres adjunta por WhatsApp.' },
    );
    // h) En producción sin iniciar — Clínica, falta tela antifluido
    producedOrder(
      2, 'clinica',
      [[fvBy('quirurgico', 'S', 'Azul rey'), 6], [fvBy('quirurgico', 'M', 'Azul rey'), 14], [fvBy('quirurgico', 'L', 'Azul rey'), 10]],
      { promised: 14, stage: 'Corte', advancePct: 0.4, responsible: 'Taller 2 — Édgar', notes: 'Bordar nombre de la clínica en el bolsillo.' },
    );
    // i) Listo con saldo — Constructora Pilares, overoles (entrega hoy)
    producedOrder(
      11, 'pilares',
      [[fvBy('overol', 'M'), 6], [fvBy('overol', 'L'), 6], [fvBy('overol', 'XL'), 3]],
      { promised: 0, stage: 'Empaque', consumeFrac: 1, finish: true, advancePct: 0.5, responsible: 'Taller 2 — Édgar' },
    );
    // j) Listo — Gimnasio Los Andes, polos (entrega mañana)
    producedOrder(
      9, 'andes',
      [[fvBy('polo_dep', '8'), 10], [fvBy('polo_dep', '10'), 12]],
      { promised: 1, stage: 'Empaque', consumeFrac: 1, finish: true, advancePct: 1, responsible: 'Taller 1 — Rosa' },
    );

    // k) Entregados con saldo (cartera): vencido, por vencer y vigente
    const deliveredWithBalance = (daysAgo: number, ck: string, lines: Array<[FV, number]>, dueIn: number) => {
      const r = recentOrder(daysAgo, ck, lines.map(([f, q]) => [f, q, true]), { promised: -daysAgo + 10, status: 'confirmado', advancePct: 0.5 });
      const items = lines.map(([f, q]) => ({ variantId: f.id, quantity: q }));
      const req = bomReq(items);
      const ctx = { poId: 0 };
      const wP = at(addDays(today, -daysAgo + 1), 8, 0);
      const wF = at(addDays(today, -daysAgo + 8), 16, 0);
      const wD = at(addDays(today, -daysAgo + 10), 11, 0);
      events.push({
        at: wP,
        deltas: [],
        run: async () => {
          ctx.poId = (await createProductionOrder(tx, { orderId: r.ctx.orderId, targetDate: addDays(today, -daysAgo + 9), priority: 'normal', responsible: 'Taller 1 — Rosa' }, prod, { at: wP })).id;
        },
      });
      events.push({
        at: wF,
        deltas: [...[...req.entries()].map(([id, q]) => [id, -q] as [number, number]), ...items.map((i) => [i.variantId, i.quantity] as [number, number])],
        res: items.map((i) => [i.variantId, i.quantity]),
        run: async () => {
          const pis = await tx.select().from(s.productionItems).where(eq(s.productionItems.productionOrderId, ctx.poId));
          await registerProgress(tx, ctx.poId, pis.map((p) => ({ itemId: p.id, done: p.quantity })), prod, { at: wF });
          await finishProductionOrder(tx, ctx.poId, { consumeRemaining: true }, prod, { at: wF });
        },
      });
      events.push({
        at: wD,
        deltas: items.map((i) => [i.variantId, -i.quantity]),
        res: items.map((i) => [i.variantId, -i.quantity]),
        run: async () => {
          const ois = await tx.select().from(s.orderItems).where(eq(s.orderItems.orderId, r.ctx.orderId));
          await registerDelivery(tx, r.ctx.orderId, { receivedBy: 'Coordinación', items: ois.map((i) => ({ orderItemId: i.id, quantity: i.quantity })), allowBalance: true }, admin, { at: wD });
          await tx.update(s.orders).set({ dueDate: addDays(today, dueIn) }).where(eq(s.orders.id, r.ctx.orderId));
        },
      });
    };
    deliveredWithBalance(45, 'roble', [[fvBy('camisa', '10'), 15], [fvBy('camisa', '12'), 15]], -12);
    deliveredWithBalance(26, 'gigantes', [[fvBy('futbol', '8'), 10], [fvBy('futbol', '10'), 12]], 5);
    deliveredWithBalance(20, 'sanjose', [[fvBy('polo_dep', '12'), 20], [fvBy('polo_dep', '14'), 20]], 22);

    // l) Cancelado
    const canc = recentOrder(8, 'paola', [[fvBy('jardinera', '6'), 2, true]], { promised: 5, status: 'confirmado' });
    scenario.push(() => {
      const w = at(addDays(today, -7), 11, 0);
      events.push({ at: w, deltas: [], run: async () => void (await changeOrderStatus(tx, canc.ctx.orderId, 'cancelado', ventas, { at: w, reason: 'La clienta consiguió el uniforme de segunda.' })) });
    });

    // m) Producción para bodega (sin pedido): reponer camisas talla 10 y 12
    {
      const w = at(addDays(today, -1), 14, 0);
      events.push({
        at: w,
        deltas: [],
        run: async () => {
          await createProductionOrder(tx, { orderId: null, targetDate: addDays(today, 6), priority: 'normal', responsible: 'Taller 1 — Rosa', notes: 'Reposición de stock para temporada escolar.', items: [{ variantId: fvBy('camisa', '10').id, quantity: 30 }, { variantId: fvBy('camisa', '12').id, quantity: 30 }] }, inv, { at: w });
        },
      });
    }

    // n) Compras recientes: una por recibir y otra recibida en parte (cuenta por pagar vencida)
    {
      const w1 = at(addDays(today, -2), 10, 0);
      events.push({
        at: w1,
        deltas: [],
        run: async () => {
          await createPurchase(tx, { supplierId: supp.textiles, items: [{ variantId: mv('antifluido', 'Azul rey'), quantity: 80, unitCost: 13500 }, { variantId: mv('oxford', null), quantity: 120, unitCost: 9500 }], discount: 50000, date: addDays(today, -2), dueDate: addDays(today, 28), notes: 'Urgente para pedido de la clínica.', payNow: null }, inv, { at: w1 });
        },
      });
      const w2 = at(addDays(today, -40), 9, 0);
      const ctx = { id: 0 };
      events.push({
        at: w2,
        deltas: [],
        run: async () => {
          ctx.id = (await createPurchase(tx, { supplierId: supp.vinilos, items: [{ variantId: mv('vinilo', null), quantity: 20, unitCost: 18000 }, { variantId: mv('hilo_bordar', null), quantity: 12, unitCost: 9500 }], discount: 0, date: addDays(today, -40), dueDate: addDays(today, -10), notes: null, payNow: null }, inv, { at: w2 })).id;
        },
      });
      const w3 = at(addDays(today, -37), 11, 0);
      events.push({
        at: w3,
        deltas: [[mv('vinilo', null), 12], [mv('hilo_bordar', null), 12]],
        run: async () => {
          const pis = await tx.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseId, ctx.id));
          await receivePurchase(tx, ctx.id, { lines: pis.map((p) => ({ itemId: p.id, quantity: p.variantId === mv('vinilo', null) ? 12 : 12 })), note: 'Llegaron 12 de 20 metros de vinilo; el resto llega la otra semana.' }, inv, { at: w3 });
          const [pay] = await tx.select().from(s.payables).where(eq(s.payables.purchaseId, ctx.id));
          await payPayable(tx, pay.id, { amount: 150000, method: 'transferencia', reference: null }, caja, { at: w3, sessionId: null });
        },
      });
      // Cuenta por pagar por vencer (servicio sin compra)
      const w4 = at(addDays(today, -5), 9, 0);
      events.push({
        at: w4,
        deltas: [],
        run: async () => {
          await createPayable(tx, { category: 'Mantenimiento', concept: 'Mantenimiento preventivo máquinas bordadoras', amount: 480000, dueDate: addDays(today, 3), issueDate: addDays(today, -5), notes: 'Técnico externo — pagar contra factura.' }, admin, { at: w4 });
        },
      });
    }

    // o) Ajuste por merma y abono reciente
    {
      const w = at(addDays(today, -4), 16, 30);
      const id = mv('oxford', null);
      events.push({ at: w, deltas: [[id, -3.5]], run: async () => void (await moveStock(tx, { variantId: id, quantity: -3.5, type: 'salida_merma', reason: 'Rollo con manchas de humedad', userId: inv.id, at: w })) });
    }
    scenario.forEach((f) => f());

    // ---------------------------------------------------------------- simulación de stock inicial
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    // "Libre" = físico - reservado. El objetivo de cada variante es su stock libre al final.
    const free = new Map<number, number>();
    const minFree = new Map<number, number>();
    const touch = (id: number, q: number) => {
      const v = round3((free.get(id) ?? 0) + q);
      free.set(id, v);
      minFree.set(id, Math.min(minFree.get(id) ?? 0, v));
    };
    for (const e of events) {
      for (const [id, q] of e.deltas) touch(id, q);
      for (const [id, q] of e.res ?? []) touch(id, -q);
    }
    const opening = new Map<number, number>();
    for (const [id, tgt] of target) {
      const net = free.get(id) ?? 0;
      // stock inicial = libre final deseado - neto; nunca menos de lo necesario para no quedar negativo en ningún momento
      opening.set(id, Math.ceil(Math.max(tgt - net, -(minFree.get(id) ?? 0)) + 0.01));
    }
    const wOpening = at(start, 7, 0);
    for (const [id, q] of opening) {
      if (q <= 0) continue;
      await moveStock(tx, { variantId: id, quantity: q, type: 'entrada_ajuste', reason: 'Inventario inicial (carga de apertura)', reference: 'APERTURA', userId: inv.id, at: wOpening, unitCost: matCost.get(id) ?? null });
    }

    // ---------------------------------------------------------------- ejecutar historia
    for (const e of events) await e.run();

    // ---------------------------------------------------------------- marketing
    await tx.insert(s.messageTemplates).values([
      { key: 'recibido', name: 'Pedido recibido', body: 'Hola {cliente}, recibimos tu pedido {pedido} por {total}. La fecha estimada de entrega es {fecha}. ¡Gracias por confiar en {empresa}!' },
      { key: 'avance', name: 'Avance del pedido', body: 'Hola {cliente}, tu pedido {pedido} va en la etapa de {etapa}. Te avisaremos cuando esté listo.' },
      { key: 'listo', name: 'Pedido listo', body: 'Hola {cliente}, ¡tu pedido {pedido} está listo! Saldo pendiente: {saldo}. Puedes recogerlo de lunes a sábado de 8 a. m. a 6 p. m.' },
      { key: 'entregado', name: 'Pedido entregado', body: 'Hola {cliente}, confirmamos la entrega de tu pedido {pedido}. ¡Gracias por tu compra!' },
      { key: 'cobro', name: 'Recordatorio de saldo', body: 'Hola {cliente}, te recordamos que el pedido {pedido} tiene un saldo de {saldo} con vencimiento el {fecha}. Cualquier duda estamos atentos.' },
      { key: 'temporada', name: 'Temporada escolar', body: '¡Llegó la temporada escolar! En {empresa} tenemos uniformes en todas las tallas y bordado del escudo. Escríbenos y separa los tuyos.' },
      { key: 'promocion', name: 'Promoción', body: 'Hola {cliente}, este mes tenemos 10% de descuento en sudaderas y camisetas deportivas. ¡Te esperamos!' },
      { key: 'gracias', name: 'Agradecimiento', body: 'Hola {cliente}, gracias por elegirnos. Nos encantaría saber cómo te fue con tus uniformes.' },
    ]);
    await tx.insert(s.campaigns).values([
      {
        name: 'Temporada escolar 2027', objective: 'Separar pedidos de colegios antes de diciembre', segment: 'institucionales', channel: 'whatsapp', date: addDays(today, 7),
        message: 'Buen día. En Confecciones Horizonte ya estamos tomando pedidos de uniformes para 2027. Agenda tu cita para toma de tallas y aparta con el 30%.',
        status: 'programada', checklist: [{ text: 'Actualizar lista de precios 2027', done: true }, { text: 'Preparar fotos del catálogo', done: true }, { text: 'Enviar a rectorías', done: false }],
      },
      {
        name: 'Clientes inactivos — regreso', objective: 'Reactivar familias que compraron el año pasado', segment: 'inactivos', channel: 'whatsapp', date: addDays(today, 14),
        message: 'Hola, te extrañamos en Confecciones Horizonte. Este mes tienes 10% en sudaderas presentando este mensaje.',
        status: 'borrador', checklist: [{ text: 'Revisar lista de clientes', done: false }, { text: 'Aprobar descuento con gerencia', done: false }],
      },
      {
        name: 'Dotación empresarial — fin de año', objective: 'Ofrecer dotación de diciembre a empresas', segment: 'frecuentes', channel: 'correo', date: addDays(today, -20),
        message: 'Recuerde que la tercera dotación del año vence en diciembre. Tenemos camibusos, overoles y chaquetas con su logo.',
        status: 'enviada_manual', checklist: [{ text: 'Enviar correo a empresas', done: true }, { text: 'Hacer seguimiento por teléfono', done: true }],
      },
    ]);
    await tx.insert(s.contentAssets).values([
      { name: 'Catálogo uniformes escolares 2027', kind: 'documento', description: 'PDF con fotos y precios de uniformes escolares.', url: null },
      { name: 'Foto sudadera bordada', kind: 'imagen', description: 'Sudadera azul con escudo bordado, fondo blanco.', url: null },
      { name: 'Video taller de confección', kind: 'video', description: 'Video corto del proceso de corte y confección para redes.', url: null },
    ]);

    await tx.update(s.settings).set({ seededAt: new Date().toISOString() }).where(eq(s.settings.id, 1));
  });
  console.log(`[seed] Datos demo cargados en ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

