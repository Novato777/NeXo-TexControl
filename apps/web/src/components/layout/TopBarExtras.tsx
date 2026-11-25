// Elementos transversales de la barra superior, pensados con las 10 heurísticas de usabilidad:
// - Visibilidad del estado: barra de actividad, estado de la caja, aviso sin conexión.
// - Reconocer antes que recordar + eficiencia: buscador global (Ctrl+K) con acciones y atajos.
// - Ayuda y documentación: guía rápida según la pantalla actual.
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { formatCOP } from '@nexo/shared';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleHelp, Keyboard, Lock, LockOpen, Package, Plus, Search, ShoppingBag, Truck, User, WifiOff, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Customer, OrderRow } from '@/lib/types';
import { Drawer } from '../ui/Overlay';

// ------------------------------------------------------------------ H1: estado del sistema
/** Línea fina arriba de la pantalla mientras se carga o se guarda algo. */
export function ActivityBar() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden" aria-hidden>
      {busy ? <div className="h-full w-1/3 bg-teal-500" style={{ animation: 'activity 1.1s ease-in-out infinite' }} /> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {mutating ? 'Guardando…' : ''}
      </span>
    </div>
  );
}

/** Aviso permanente si se pierde la conexión a internet. */
export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div role="alert" className="no-print flex items-center justify-center gap-2 bg-risk-500 px-4 py-2 text-[14px] font-semibold text-white">
      <WifiOff className="h-4 w-4" aria-hidden /> Sin conexión a internet. Lo que intentes guardar no se registrará hasta que vuelva la conexión.
    </div>
  );
}

/** Estado de la caja siempre visible para quien maneja dinero. */
export function CashChip() {
  const { access, money } = useAuth();
  const enabled = money && access('caja');
  const { data } = useApi<{ open: boolean; summary?: { expectedCash: number } }>(enabled ? '/cash/current' : null, { staleTime: 60_000 });
  if (!enabled || !data) return null;
  return (
    <Link
      to="/caja"
      title={data.open ? 'Efectivo que debe haber en el cajón' : 'Abre la caja para recibir efectivo'}
      className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold md:inline-flex ${data.open ? 'border-ok-500/30 bg-ok-50 text-ok-700' : 'border-risk-500/40 bg-risk-50 text-risk-700'}`}
    >
      {data.open ? <LockOpen className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}
      {data.open ? `Caja abierta · ${formatCOP(data.summary?.expectedCash)}` : 'Caja cerrada'}
    </Link>
  );
}

// ------------------------------------------------------------------ H6 + H7: buscador global y atajos
interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
  group: 'Acciones' | 'Pedidos' | 'Clientes' | 'Productos';
  shortcut?: string;
}

export function useGlobalShortcuts(openSearch: () => void, openHelp: () => void) {
  const nav = useNavigate();
  const { can } = useAuth();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      } else if (e.altKey && e.key.toLowerCase() === 'n' && can('pedido.crear')) {
        e.preventDefault();
        nav('/pedidos/nuevo');
      } else if (e.altKey && e.key.toLowerCase() === 'v' && can('venta.registrar')) {
        e.preventDefault();
        nav('/venta-rapida');
      } else if (!typing && e.key === '?') {
        openHelp();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nav, can, openSearch, openHelp]);
}

export function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex h-10 min-w-0 items-center gap-2 rounded-[var(--radius-btn)] border border-line-strong bg-surface px-3 text-left text-[14.5px] text-muted hover:border-petrol-200 sm:w-64"
      aria-label="Buscar en todo el sistema"
    >
      <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="hidden flex-1 truncate sm:inline">Buscar en todo…</span>
      <kbd className="hidden rounded border border-line bg-linen px-1.5 text-[12px] font-semibold text-ink-soft lg:inline">Ctrl K</kbd>
    </button>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { can, access } = useAuth();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q.trim(), 200);
  const listRef = useRef<HTMLUListElement>(null);
  const searching = open && dq.length >= 2;
  const orders = useApi<{ rows: OrderRow[] }>(searching && access('pedidos') ? `/orders${qs({ kind: 'todos', q: dq, limit: 5 })}` : null);
  const customers = useApi<Customer[]>(searching && access('clientes') ? `/customers${qs({ q: dq })}` : null);
  const products = useApi<Array<{ id: number; name: string; sku: string; category: string }>>(searching && access('productos') ? `/products${qs({ q: dq })}` : null);

  const actions: Cmd[] = useMemo(
    () =>
      [
        can('pedido.crear') && { id: 'a1', label: 'Crear pedido', icon: Plus, to: '/pedidos/nuevo', group: 'Acciones' as const, shortcut: 'Alt N' },
        can('venta.registrar') && { id: 'a2', label: 'Vender (venta rápida)', icon: Zap, to: '/venta-rapida', group: 'Acciones' as const, shortcut: 'Alt V' },
        can('entrega.registrar') && { id: 'a3', label: 'Ver entregas de hoy', icon: Truck, to: '/entregas', group: 'Acciones' as const },
        can('gasto.registrar') && { id: 'a4', label: 'Registrar gasto', icon: Lock, to: '/caja?accion=gasto', group: 'Acciones' as const },
        can('compra.gestionar') && { id: 'a5', label: 'Nueva compra a proveedor', icon: Package, to: '/compras/nueva', group: 'Acciones' as const },
        can('cliente.editar') && { id: 'a6', label: 'Ver clientes', icon: User, to: '/clientes', group: 'Acciones' as const },
      ].filter(Boolean) as Cmd[],
    [can],
  );

  const results: Cmd[] = useMemo(() => {
    const t = q.trim().toLowerCase();
    const acts = actions.filter((a) => !t || a.label.toLowerCase().includes(t));
    if (!searching) return acts;
    return [
      ...acts,
      ...(orders.data?.rows ?? []).slice(0, 5).map((o) => ({ id: `o${o.id}`, label: `${o.number} · ${o.customerName}`, hint: o.kind === 'venta' ? 'Venta' : 'Pedido', icon: ShoppingBag, to: `/pedidos/${o.id}`, group: 'Pedidos' as const })),
      ...(customers.data ?? []).slice(0, 5).map((c) => ({ id: `c${c.id}`, label: c.name, hint: c.phone ?? undefined, icon: User, to: `/clientes/${c.id}`, group: 'Clientes' as const })),
      ...(products.data ?? []).slice(0, 5).map((p) => ({ id: `p${p.id}`, label: p.name, hint: p.sku, icon: Package, to: `/productos/${p.id}`, group: 'Productos' as const })),
    ];
  }, [q, actions, searching, orders.data, customers.data, products.data]);

  useEffect(() => setSel(0), [q, results.length]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const go = (c: Cmd | undefined) => {
    if (!c) return;
    onClose();
    nav(c.to);
  };
  const loading = searching && (orders.isFetching || customers.isFetching || products.isFetching);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" style={{ animation: 'overlay-in .12s ease-out' }} />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow-pop)] focus:outline-none" style={{ animation: 'panel-in .15s ease-out' }}>
          <Dialog.Title className="sr-only">Buscar en todo el sistema</Dialog.Title>
          <Dialog.Description className="sr-only">Escribe para buscar pedidos, clientes o productos, o elige una acción.</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-5 w-5 text-muted" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSel((s) => Math.min(s + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSel((s) => Math.max(s - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  go(results[sel]);
                }
              }}
              placeholder="Número de pedido, cliente, teléfono o producto…"
              aria-label="Buscar"
              className="h-14 flex-1 bg-transparent text-[16px] text-ink placeholder:text-muted/70 focus:outline-none"
            />
            {loading ? <span className="text-[13px] text-muted">Buscando…</span> : null}
          </div>
          <ul ref={listRef} className="max-h-[55vh] overflow-y-auto py-2" role="listbox" aria-label="Resultados">
            {results.map((r, i) => {
              const first = i === 0 || results[i - 1].group !== r.group;
              return (
                <li key={r.id}>
                  {first ? <p className="px-4 pb-1 pt-2 text-[12.5px] font-bold text-muted">{r.group}</p> : null}
                  <button
                    role="option"
                    aria-selected={i === sel}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(r)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === sel ? 'bg-petrol-50' : ''}`}
                  >
                    <r.icon className={`h-[18px] w-[18px] shrink-0 ${i === sel ? 'text-petrol-600' : 'text-muted'}`} aria-hidden />
                    <span className="flex-1 truncate font-medium text-ink">{r.label}</span>
                    {r.hint ? <span className="text-[13px] text-muted">{r.hint}</span> : null}
                    {r.shortcut ? <kbd className="rounded border border-line bg-linen px-1.5 text-[12px] font-semibold text-ink-soft">{r.shortcut}</kbd> : null}
                  </button>
                </li>
              );
            })}
            {searching && !loading && results.length === actions.filter((a) => a.label.toLowerCase().includes(q.trim().toLowerCase())).length ? (
              <li className="px-4 py-4 text-[14.5px] text-muted">No encontramos pedidos, clientes ni productos con “{q}”. Revisa cómo está escrito o busca por número o teléfono.</li>
            ) : null}
          </ul>
          <p className="border-t border-line bg-linen px-4 py-2 text-[12.5px] text-muted">↑ ↓ para moverte · Enter para abrir · Esc para cerrar</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ------------------------------------------------------------------ H10: ayuda contextual
const HELP: Array<{ match: string; title: string; steps: string[] }> = [
  { match: '/pedidos/nuevo', title: 'Crear un pedido', steps: ['Busca o crea el cliente.', 'Toca el producto y luego la talla. Tocar otra vez suma una unidad.', 'Si lleva logo o nombres, responde “Sí” y descríbelo.', 'Elige la fecha de entrega y registra el anticipo si lo deja.', 'Revisa y toca “Confirmar pedido”. Luego puedes enviarlo a producción.'] },
  { match: '/pedidos/', title: 'Detalle del pedido', steps: ['La barra de arriba muestra en qué va el pedido.', 'El botón principal cambia según lo que sigue: confirmar, enviar a producción, marcar listo o entregar.', '“Registrar pago” guarda abonos; el saldo se calcula solo.', 'En “Más opciones” están imprimir, mensaje al cliente, duplicar y cancelar.'] },
  { match: '/pedidos', title: 'Pedidos y ventas', steps: ['“En curso” muestra lo que falta entregar, ordenado por fecha.', 'Cambia a “Tablero” para ver los pedidos por estado.', 'Toca cualquier fila para abrir el pedido.', 'Usa “Filtros” para buscar por estado u ordenar.'] },
  { match: '/venta-rapida', title: 'Vender', steps: ['Busca el producto y toca la talla.', 'Elige cómo paga. Si es efectivo, escribe lo recibido para ver el cambio.', 'Para vender a crédito, abre “Otras formas de cobro” y elige el cliente.', 'Toca “Confirmar venta”. La caja y el inventario se actualizan solos.'] },
  { match: '/entregas', title: 'Entregas', steps: ['Arriba aparecen los atrasados y los de hoy.', '“Registrar entrega” pide quién recibe y cuántas unidades.', 'Si el pedido tiene saldo, primero cobra o pide autorización.'] },
  { match: '/produccion', title: 'Producción', steps: ['Cada columna es una etapa del taller.', 'Abre una orden y usa el botón principal para pasarla a la siguiente etapa.', '“Registrar avance” guarda cuántas prendas van terminadas por talla.', 'Al terminar, aprueba la calidad: las prendas entran a bodega y el pedido queda listo.'] },
  { match: '/inventario', title: 'Inventario', steps: ['“Disponible” es lo que hay menos lo separado para pedidos.', '“Reponer” te dice qué comprar y por qué.', '“Ajustar” corrige diferencias o registra daños; siempre queda el motivo.', '“Conteo físico” compara lo contado con el sistema y ajusta las diferencias.'] },
  { match: '/productos', title: 'Productos', steps: ['Toca “Agregar producto” y sigue las secciones.', 'Elige tallas y colores: el sistema crea cada combinación.', 'En la ficha del producto puedes registrar la receta de materiales.'] },
  { match: '/clientes', title: 'Clientes', steps: ['Busca por nombre, documento o teléfono.', '“Los que deben” muestra solo clientes con saldo.', 'En la ficha ves sus pedidos, pagos e historial.'] },
  { match: '/proveedores', title: 'Compras', steps: ['“Nueva compra” registra lo que le pides al proveedor.', 'Cuando llegue la mercancía, abre la compra y toca “Confirmar lo que llegó”.', 'El inventario solo sube al confirmar la recepción.'] },
  { match: '/compras', title: 'Compras', steps: ['Registra lo que pediste y cuándo vence el pago.', 'Confirma lo que llegó: puede ser una parte.', 'Paga desde la compra o desde Dinero → Por pagar.'] },
  { match: '/caja', title: 'Dinero', steps: ['Abre la caja al empezar el día con el efectivo del cajón.', 'Las ventas y abonos se registran solos; aquí registras gastos e ingresos extra.', 'Al final del día toca “Cerrar caja” y escribe lo que contaste.', 'Si no cuadra, el sistema te pide una explicación.'] },
  { match: '/cartera', title: 'Por cobrar', steps: ['Toca una cifra de arriba para filtrar (vencido, por vencer, al día).', '“Registrar abono” guarda el pago del cliente.', 'El botón de mensaje abre WhatsApp con un recordatorio listo.'] },
  { match: '/reportes', title: 'Reportes', steps: ['Elige el reporte en el selector y el periodo.', 'Descarga en CSV para Excel o imprime como PDF.'] },
  { match: '/analisis', title: 'Estimaciones', steps: ['Son cálculos sencillos, no certezas.', 'Abre “¿Cómo se calcula?” para ver qué datos usa cada estimación.'] },
  { match: '/', title: 'Inicio', steps: ['Los botones de arriba son las tareas más comunes.', '“Qué requiere atención” está ordenado de más a menos urgente; cada aviso te lleva a resolverlo.', 'Toca cualquier cifra para ir al detalle.'] },
];

export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-btn)] px-2.5 text-[14.5px] font-semibold text-petrol-700 hover:bg-petrol-50" aria-label="Ayuda de esta pantalla">
      <CircleHelp className="h-5 w-5" aria-hidden />
      <span className="hidden xl:inline">Ayuda</span>
    </button>
  );
}

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const { can } = useAuth();
  const help = HELP.find((h) => (h.match === '/' ? pathname === '/' : pathname.startsWith(h.match))) ?? HELP[HELP.length - 1];
  return (
    <Drawer open={open} onClose={onClose} title={`Ayuda · ${help.title}`}>
      <h3 className="mb-2 font-bold">Cómo se usa esta pantalla</h3>
      <ol className="space-y-2.5">
        {help.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-[13px] font-bold text-petrol-700">{i + 1}</span>
            <span className="text-[15px] leading-snug text-ink-soft">{s}</span>
          </li>
        ))}
      </ol>
      <div className="stitch-x my-6 text-line-strong" aria-hidden />
      <h3 className="mb-2 flex items-center gap-2 font-bold">
        <Keyboard className="h-4 w-4" aria-hidden /> Atajos de teclado
      </h3>
      <dl className="space-y-1.5 text-[14.5px]">
        {[
          ['Ctrl K', 'Buscar pedido, cliente o producto'],
          can('pedido.crear') && ['Alt N', 'Crear pedido'],
          can('venta.registrar') && ['Alt V', 'Vender'],
          ['?', 'Abrir esta ayuda'],
          ['Esc', 'Cerrar ventanas'],
        ]
          .filter(Boolean)
          .map((x) => {
            const [k, v] = x as string[];
            return (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-ink-soft">{v}</dt>
                <dd>
                  <kbd className="rounded border border-line bg-linen px-2 py-0.5 text-[13px] font-semibold">{k}</kbd>
                </dd>
              </div>
            );
          })}
      </dl>
      <div className="stitch-x my-6 text-line-strong" aria-hidden />
      <p className="text-[14px] text-muted">Todo lo que mueve dinero o inventario pide confirmación y queda registrado. Si algo se registró mal, se corrige con un reverso o un ajuste: nunca se pierde el historial.</p>
    </Drawer>
  );
}
