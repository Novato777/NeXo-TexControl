import { ROLE_LABELS, type Module } from '@nexo/shared';
import {
  BarChart3,
  Boxes,
  Factory,
  Home,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  Settings,
  ShoppingBag,
  Truck,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { confirmLeave, useApi } from '@/lib/hooks';
import type { Settings as SettingsT } from '@/lib/types';
import { ButtonLink } from '../ui/Button';
import { ActivityBar, CashChip, CommandPalette, HelpButton, HelpDrawer, OfflineBanner, SearchButton, useGlobalShortcuts } from './TopBarExtras';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  module: Module;
  /** Otras rutas que pertenecen a esta sección (para marcarla como activa). */
  also?: string[];
  divider?: boolean;
}
/** Menú corto: 10 secciones. Las pantallas hermanas se recorren con las pestañas de cada sección. */
const NAV: NavItem[] = [
  { to: '/', label: 'Inicio', icon: Home, module: 'inicio' },
  { to: '/pedidos', label: 'Pedidos y ventas', icon: ShoppingBag, module: 'pedidos', also: ['/venta-rapida', '/entregas'] },
  { to: '/produccion', label: 'Producción', icon: Factory, module: 'produccion' },
  { to: '/inventario', label: 'Inventario', icon: Boxes, module: 'inventario', also: ['/productos'] },
  { to: '/clientes', label: 'Clientes', icon: Users, module: 'clientes' },
  { to: '/proveedores', label: 'Compras', icon: Truck, module: 'proveedores', also: ['/compras'] },
  { to: '/caja', label: 'Dinero', icon: Wallet, module: 'caja', also: ['/cartera'] },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, module: 'reportes', also: ['/analisis'] },
  { to: '/marketing', label: 'Marketing', icon: Megaphone, module: 'marketing', divider: true },
  { to: '/configuracion', label: 'Configuración', icon: Settings, module: 'configuracion' },
];

/** Si el rol no tiene el módulo principal de la sección, se usa la primera pantalla hermana permitida. */
const FALLBACK: Partial<Record<string, { to: string; module: Module }>> = {
  '/caja': { to: '/cartera', module: 'cartera' },
  '/reportes': { to: '/analisis', module: 'analisis' },
  '/inventario': { to: '/productos', module: 'productos' },
  '/pedidos': { to: '/entregas', module: 'entregas' },
};

function Brand({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <img src="/favicon.svg" alt="" className="h-9 w-9" />
      <div className="leading-tight">
        <p className="text-[17px] font-extrabold text-ink">TexControl</p>
        <p className="max-w-[160px] truncate text-[12.5px] text-muted" title={name}>
          {name ?? 'Gestión de uniformes'}
        </p>
      </div>
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { access } = useAuth();
  const { pathname } = useLocation();
  const items = NAV.map((i) => (access(i.module) ? i : FALLBACK[i.to] && access(FALLBACK[i.to]!.module) ? { ...i, to: FALLBACK[i.to]!.to } : null)).filter(Boolean) as NavItem[];
  return (
    <nav aria-label="Menú principal" className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
      <ul className="space-y-0.5">
        {items.map((i) => {
          const isActive = i.to === '/' ? pathname === '/' : [i.to, ...(i.also ?? [])].some((p) => pathname === p || pathname.startsWith(p + '/'));
          return (
            <li key={i.label} className={i.divider ? 'mt-3 border-t border-line pt-3' : ''}>
              <Link
                to={i.to}
                onClick={(e) => {
                  if (!confirmLeave()) {
                    e.preventDefault();
                    return;
                  }
                  onNavigate?.();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] font-semibold transition-colors ${isActive ? 'bg-petrol-50 text-petrol-700' : 'text-ink-soft hover:bg-linen hover:text-ink'}`}
              >
                {isActive ? <span className="stitch-y absolute bottom-2 left-0.5 top-2 text-petrol-600" aria-hidden /> : null}
                <i.icon className={`h-5 w-5 ${isActive ? 'text-petrol-600' : 'text-muted'}`} aria-hidden />
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserBox() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-3 rounded-xl px-2 py-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 font-bold text-teal-700" aria-hidden>
          {initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold text-ink">{user.name}</p>
          <p className="text-[13px] text-muted">{ROLE_LABELS[user.role]}</p>
        </div>
        <button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-risk-50 hover:text-risk-700" aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { can } = useAuth();
  const { data: settings } = useApi<SettingsT>('/settings', { staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useGlobalShortcuts(
    useCallback(() => setSearchOpen(true), []),
    useCallback(() => setHelpOpen(true), []),
  );
  // En la sección de pedidos la página ya muestra estas acciones: no repetirlas arriba.
  const inOrders = loc.pathname === '/' || loc.pathname.startsWith('/pedidos') || loc.pathname.startsWith('/venta-rapida') || loc.pathname.startsWith('/entregas');

  return (
    <div className="min-h-screen lg:flex">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-petrol-600 focus:px-4 focus:py-2 focus:text-white">
        Saltar al contenido
      </a>
      {/* Escritorio */}
      <aside className="no-print sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand name={settings?.companyName} />
        <SideNav />
        <UserBox />
      </aside>
      {/* Móvil / tablet */}
      {open ? (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-surface shadow-[var(--shadow-pop)]" style={{ animation: 'drawer-in .18s ease-out' }}>
            <div className="flex items-center justify-between pr-3">
              <Brand name={settings?.companyName} />
              <button className="rounded-lg p-2 text-muted hover:bg-linen" onClick={() => setOpen(false)} aria-label="Cerrar menú">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setOpen(false)} />
            <UserBox />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 text-ink-soft hover:bg-linen lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu className="h-6 w-6" />
          </button>
          <SearchButton onOpen={() => setSearchOpen(true)} />
          <div className="flex-1" />
          <span className="hidden rounded-full border border-warn-500/40 bg-warn-50 px-2.5 py-0.5 text-[12.5px] font-semibold text-warn-700 2xl:inline" title="Los datos son de ejemplo y se pueden reiniciar desde Configuración.">
            Demo
          </span>
          <CashChip />
          <HelpButton onOpen={() => setHelpOpen(true)} />
          {can('venta.registrar') && !inOrders ? (
            <ButtonLink to="/venta-rapida" variant="secondary" icon={Zap} className="hidden sm:inline-flex">
              Vender
            </ButtonLink>
          ) : null}
          {can('pedido.crear') && !inOrders ? (
            <ButtonLink to="/pedidos/nuevo" icon={Plus}>
              <span className="hidden sm:inline">Crear pedido</span>
              <span className="sm:hidden">Pedido</span>
            </ButtonLink>
          ) : null}
        </header>
        <OfflineBanner />
        <main id="contenido" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
        <ActivityBar />
        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
