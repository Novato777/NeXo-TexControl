import { formatCOP, formatDate, formatDateTime, todayISO } from '@nexo/shared';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, PackagePlus, Plus, Receipt, Truck, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendChart } from '@/components/ui/Charts';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, Segmented, SummaryStrip } from '@/components/ui/Layout';
import { makePeriod } from '@/components/ui/Pickers';
import { OrderStatusBadge } from '@/components/ui/Status';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDocumentTitle } from '@/lib/hooks';

interface DashboardData {
  range: { from: string; to: string; days: number };
  money: boolean;
  kpis: {
    salesToday: number | null;
    salesYesterday: number | null;
    activeOrders: number;
    overdueOrders: number;
    readyOrders: number;
    deliveriesToday: number;
    lowStock: number;
    lowMaterials: number;
    productionActive: number;
    productionProgress: number;
  };
  cash: { open: boolean; expectedCash?: number } | null;
  ordersByStatus: Array<{ status: string; label: string; count: number }>;
  salesByDay: Array<{ date: string; total: number; count: number }>;
  alerts: Array<{ level: 'alta' | 'media' | 'info'; title: string; detail: string; action: string; to: string }>;
  activity: Array<{ id: number; summary: string; createdAt: string; userName: string | null }>;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('es-CO', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }).format(new Date()));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function vsYesterday(now: number | null, before: number | null) {
  if (now == null || before == null) return null;
  if (!before) return 'Ayer no hubo ventas';
  const pct = Math.round(((now - before) / before) * 100);
  return <span className={pct >= 0 ? 'text-ok-700' : 'text-warn-700'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% frente a ayer</span>;
}

const QUICK: Array<{ to: string; label: string; icon: LucideIcon; action: Parameters<ReturnType<typeof useAuth>['can']>[0] }> = [
  { to: '/pedidos/nuevo', label: 'Crear pedido', icon: Plus, action: 'pedido.crear' },
  { to: '/venta-rapida', label: 'Vender', icon: Zap, action: 'venta.registrar' },
  { to: '/caja?accion=gasto', label: 'Registrar gasto', icon: Receipt, action: 'gasto.registrar' },
  { to: '/proveedores?tab=compras', label: 'Recibir mercancía', icon: Truck, action: 'compra.gestionar' },
  { to: '/productos/nuevo', label: 'Agregar producto', icon: PackagePlus, action: 'producto.editar' },
];

const RANGES = [
  { value: '7d', label: '7 días' },
  { value: 'mes', label: 'Este mes' },
  { value: '30d', label: '30 días' },
] as const;

export default function Dashboard() {
  const { user, can, money } = useAuth();
  useDocumentTitle('Inicio');
  const [range, setRange] = useState<'7d' | 'mes' | '30d'>('7d');
  const [allAlerts, setAllAlerts] = useState(false);
  const period = makePeriod(range);
  const { data, isLoading, error, refetch } = useApi<DashboardData>(`/dashboard${qs({ from: period.from, to: period.to })}`, { placeholderData: (prev) => prev });
  const quick = QUICK.filter((q) => can(q.action));

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-[24px] font-extrabold leading-tight">
          {greeting()}, {user?.name.split(' ')[0]}
        </h1>
        <p className="text-[14.5px] text-muted">{formatDate(todayISO())} · así va el negocio hoy</p>
      </header>

      {quick.length ? (
        <nav aria-label="Accesos rápidos" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {quick.map((q, i) => (
            <Link
              key={q.to}
              to={q.to}
              className={`flex items-center gap-2.5 rounded-[var(--radius-card)] border px-4 py-3 font-semibold transition-colors ${i === 0 ? 'border-petrol-600 bg-petrol-600 text-white hover:bg-petrol-700' : 'border-line bg-surface text-ink hover:border-petrol-200 hover:bg-petrol-50'}`}
            >
              <q.icon className={`h-5 w-5 shrink-0 ${i === 0 ? '' : 'text-petrol-600'}`} aria-hidden />
              {q.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}
      {isLoading || !data ? (
        <LoadingBlock rows={6} />
      ) : (
        <>
          <SummaryStrip
            items={[
              money && { label: 'Ventas de hoy', value: formatCOP(data.kpis.salesToday), hint: vsYesterday(data.kpis.salesToday, data.kpis.salesYesterday), to: '/pedidos?tipo=venta' },
              {
                label: 'Pedidos activos',
                value: data.kpis.activeOrders,
                hint: data.kpis.overdueOrders ? <span className="font-semibold text-risk-700">{data.kpis.overdueOrders} atrasado(s)</span> : <span className="text-ok-700">Ninguno atrasado</span>,
                to: '/pedidos',
              },
              { label: 'Entregas para hoy', value: data.kpis.deliveriesToday, hint: `${data.kpis.readyOrders} listo(s) para entregar`, to: '/entregas' },
              money && data.cash
                ? { label: 'Efectivo en caja', value: data.cash.open ? formatCOP(data.cash.expectedCash) : 'Caja cerrada', tone: data.cash.open ? 'ink' : 'risk', hint: data.cash.open ? 'Lo que debe haber en el cajón' : 'Ábrela para recibir efectivo', to: '/caja' }
                : { label: 'Producción', value: `${data.kpis.productionProgress}%`, hint: `${data.kpis.productionActive} órdenes en curso`, to: '/produccion' },
              !money && { label: 'Stock bajo', value: data.kpis.lowStock, tone: data.kpis.lowStock ? 'warn' : 'ok', hint: `${data.kpis.lowMaterials} materiales`, to: '/inventario?estado=alerta' },
            ]}
          />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <Card title="Qué requiere atención" padded={false}>
                {data.alerts.length ? (
                  <>
                    <ul className="divide-y divide-line">
                      {(allAlerts ? data.alerts : data.alerts.slice(0, 5)).map((a, i) => (
                        <AlertRow key={i} {...a} />
                      ))}
                    </ul>
                    {data.alerts.length > 5 ? (
                      <button onClick={() => setAllAlerts((v) => !v)} className="w-full border-t border-line px-5 py-2.5 text-[14px] font-semibold text-petrol-700 hover:bg-petrol-50">
                        {allAlerts ? 'Ver menos' : `Ver ${data.alerts.length - 5} aviso(s) más`}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-5 text-ok-700">
                    <CheckCircle2 className="h-6 w-6" />
                    <p className="font-semibold">Todo en orden. No hay pendientes urgentes.</p>
                  </div>
                )}
              </Card>

              {money ? (
                <Card title="Ventas por día" actions={<Segmented label="Periodo de ventas" value={range} onChange={setRange} options={[...RANGES]} />}>
                  <TrendChart data={data.salesByDay} x="date" y="total" valueLabel="Ventas" height={220} xFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} labelFormatter={(d) => formatDate(d)} />
                </Card>
              ) : null}
            </div>

            <div className="space-y-5">
              <Card title="Pedidos por estado" padded={false}>
                <ul className="divide-y divide-line">
                  {data.ordersByStatus.map((s) => (
                    <li key={s.status}>
                      <Link to={`/pedidos?vista=todos&estado=${s.status}`} className="flex items-center justify-between px-5 py-2.5 hover:bg-petrol-50">
                        <OrderStatusBadge status={s.status} />
                        <span className="num text-[16px] font-bold">{s.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Actividad reciente" padded={false}>
                <ul className="divide-y divide-line">
                  {data.activity.slice(0, 5).map((a) => (
                    <li key={a.id} className="px-5 py-2.5">
                      <p className="text-[14px] leading-snug text-ink">{a.summary}</p>
                      <p className="text-[12.5px] text-muted">
                        {a.userName ?? 'Sistema'} · {formatDateTime(a.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AlertRow({ level, title, detail, action, to }: DashboardData['alerts'][number]) {
  const conf =
    level === 'alta'
      ? { icon: CircleAlert, cls: 'text-risk-500', label: 'Urgente' }
      : level === 'media'
        ? { icon: AlertTriangle, cls: 'text-warn-500', label: 'Importante' }
        : { icon: Info, cls: 'text-petrol-500', label: 'Para revisar' };
  const Icon = conf.icon;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Icon className={`h-5 w-5 shrink-0 ${conf.cls}`} aria-label={conf.label} />
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug text-ink">{title}</p>
        <p className="truncate text-[13.5px] text-muted" title={detail}>
          {detail}
        </p>
      </div>
      <Link to={to} className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-btn)] bg-petrol-50 px-3 text-[14px] font-semibold text-petrol-700 hover:bg-petrol-100">
        {action}
      </Link>
    </li>
  );
}
