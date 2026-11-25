import { formatCOP, formatDate, ORDER_STATUS_LABELS, ORDER_STATUSES, relativeDay } from '@nexo/shared';
import { Flame, Plus, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { Card, FilterBar, PageHeader, Segmented, Tabs } from '@/components/ui/Layout';
import { SearchInput } from '@/components/ui/Pickers';
import { OrderStatusBadge, PriorityBadge } from '@/components/ui/Status';
import { DataTable, type Column } from '@/components/ui/Table';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import type { OrderRow } from '@/lib/types';

/** Pestañas compartidas por las pantallas de la sección Pedidos. */
export function OrdersSectionTabs({ active }: { active: 'pedido' | 'venta' | 'entregas' }) {
  const { access } = useAuth();
  return (
    <Tabs
      value={active}
      tabs={[
        ...(access('pedidos')
          ? [
              { value: 'pedido' as const, label: 'Pedidos', to: '/pedidos' },
              { value: 'venta' as const, label: 'Ventas de mostrador', to: '/pedidos?tipo=venta' },
            ]
          : []),
        ...(access('entregas') ? [{ value: 'entregas' as const, label: 'Entregas', to: '/entregas' }] : []),
      ]}
    />
  );
}

const VIEWS = [
  { value: 'activos', label: 'En curso' },
  { value: 'atrasados', label: 'Atrasados' },
  { value: 'hoy', label: 'Para hoy' },
  { value: 'con_saldo', label: 'Con saldo' },
  { value: 'todos', label: 'Todos' },
] as const;

export default function OrdersPage() {
  const { money, can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = (params.get('tipo') ?? 'pedido') as 'pedido' | 'venta';
  const status = params.get('estado') ?? '';
  const view = params.get('vista') ?? (kind === 'pedido' && !status ? 'activos' : 'todos');
  const mode = params.get('modo') ?? 'lista';
  const sort = params.get('orden') ?? (view === 'activos' ? 'entrega' : 'reciente');
  const q = params.get('q') ?? '';
  const dq = useDebounced(q, 300);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const list = useApi<{ rows: OrderRow[]; total: number }>(mode === 'lista' || kind === 'venta' ? `/orders${qs({ kind, view, status, q: dq, sort, limit: 200 })}` : null);
  const board = useApi<OrderRow[]>(mode === 'tablero' && kind === 'pedido' ? '/orders/board' : null);

  const columns: Column<OrderRow>[] = useMemo(
    () => [
      {
        key: 'number',
        header: kind === 'venta' ? 'Venta' : 'Pedido',
        render: (o) => (
          <span className="inline-flex items-center gap-1.5">
            <Link to={`/pedidos/${o.id}`} className="whitespace-nowrap font-bold text-petrol-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              {o.number}
            </Link>
            {o.priority === 'urgente' ? <Flame className="h-4 w-4 text-risk-500" aria-label="Urgente" /> : null}
          </span>
        ),
        sortValue: (o) => o.id,
      },
      { key: 'customer', header: 'Cliente', render: (o) => <span className="font-medium">{o.customerName}</span>, sortValue: (o) => o.customerName },
      { key: 'status', header: 'Estado', render: (o) => <OrderStatusBadge status={o.status} kind={o.kind} />, sortValue: (o) => ORDER_STATUSES.indexOf(o.status as never) },
      kind === 'pedido'
        ? {
            key: 'promised',
            header: 'Entrega',
            render: (o: OrderRow) => (o.promisedDate ? <span className={o.overdue ? 'font-semibold text-risk-700' : ''}>{o.overdue ? `Atrasado (${relativeDay(o.promisedDate)})` : relativeDay(o.promisedDate)}</span> : '—'),
            sortValue: (o: OrderRow) => o.promisedDate,
          }
        : { key: 'date', header: 'Fecha', render: (o: OrderRow) => formatDate(o.orderDate), sortValue: (o: OrderRow) => o.createdAt },
      ...(money
        ? [
            kind === 'venta'
              ? { key: 'total', header: 'Total', align: 'right' as const, render: (o: OrderRow) => <span className="num font-semibold">{formatCOP(o.total)}</span>, sortValue: (o: OrderRow) => o.total }
              : {
                  key: 'balance',
                  header: 'Saldo',
                  align: 'right' as const,
                  render: (o: OrderRow) => (o.balance && o.status !== 'cancelado' ? <span className="num font-semibold text-warn-700">{formatCOP(o.balance)}</span> : <span className="text-ok-700">Pagado</span>),
                  sortValue: (o: OrderRow) => o.balance,
                },
          ]
        : []),
    ],
    [kind, money],
  );

  return (
    <div>
      <PageHeader
        title="Pedidos y ventas"
        actions={
          <>
            {can('venta.registrar') ? (
              <ButtonLink to="/venta-rapida" variant="secondary" icon={Zap}>
                Vender
              </ButtonLink>
            ) : null}
            {can('pedido.crear') ? (
              <ButtonLink to="/pedidos/nuevo" icon={Plus}>
                Crear pedido
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <OrdersSectionTabs active={kind} />

      <Card padded={false}>
        <FilterBar
          search={<SearchInput value={q} onChange={(v) => set('q', v)} placeholder="Buscar por número, cliente o teléfono" />}
          quick={
            kind === 'pedido' ? (
              <Segmented
                label="Forma de ver"
                value={mode as 'lista' | 'tablero'}
                onChange={(v) => set('modo', v === 'lista' ? '' : v)}
                options={[
                  { value: 'lista', label: 'Lista' },
                  { value: 'tablero', label: 'Tablero' },
                ]}
              />
            ) : null
          }
          activeCount={status ? 1 : 0}
        >
          {kind === 'pedido' && mode === 'lista' ? (
            <Select aria-label="Filtrar por estado" value={status} onChange={(e) => set('estado', e.target.value)} className="w-auto">
              <option value="">Cualquier estado</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          ) : null}
          {mode === 'lista' || kind === 'venta' ? (
            <Select aria-label="Ordenar" value={sort} onChange={(e) => set('orden', e.target.value)} className="w-auto">
              <option value="reciente">Más recientes primero</option>
              {kind === 'pedido' ? <option value="entrega">Entrega más cercana</option> : null}
              {money ? <option value="valor">Mayor valor primero</option> : null}
            </Select>
          ) : null}
        </FilterBar>
        {kind === 'pedido' && mode === 'lista' ? (
          <div className="overflow-x-auto border-b border-line px-3.5 py-2.5">
            <Segmented label="Qué pedidos ver" value={view as (typeof VIEWS)[number]['value']} onChange={(v) => set('vista', v)} options={[...VIEWS]} />
          </div>
        ) : null}

        {mode === 'tablero' && kind === 'pedido' ? (
          board.error ? (
            <ErrorState error={board.error} onRetry={board.refetch} />
          ) : board.isLoading ? (
            <LoadingBlock />
          ) : (
            <Board rows={board.data ?? []} money={money} />
          )
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : list.isLoading ? (
          <LoadingBlock />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data?.rows ?? []}
            rowKey={(o) => o.id}
            onRowClick={(o) => nav(`/pedidos/${o.id}`)}
            pageSize={20}
            caption="Lista de pedidos"
            empty={
              <EmptyState
                title={q || view !== 'activos' ? 'No hay resultados con estos filtros' : kind === 'pedido' ? 'No hay pedidos en curso' : 'Todavía no hay ventas'}
                text={q ? 'Prueba con otro nombre o número.' : undefined}
                action={
                  kind === 'pedido' && can('pedido.crear') ? (
                    <ButtonLink to="/pedidos/nuevo" icon={Plus}>
                      Crear pedido
                    </ButtonLink>
                  ) : kind === 'venta' && can('venta.registrar') ? (
                    <ButtonLink to="/venta-rapida" icon={Zap}>
                      Registrar una venta
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}

const COLUMNS = ['borrador', 'pendiente', 'confirmado', 'en_produccion', 'listo'];

function Board({ rows, money }: { rows: OrderRow[]; money: boolean }) {
  return (
    <div className="overflow-x-auto p-3">
      <div className="grid min-w-[1000px] grid-cols-5 gap-2.5">
        {COLUMNS.map((st) => {
          const items = rows.filter((r) => r.status === st);
          return (
            <section key={st} className="flex flex-col rounded-xl bg-linen" aria-label={ORDER_STATUS_LABELS[st as never]}>
              <header className="flex items-center justify-between px-3 py-2.5">
                <OrderStatusBadge status={st} />
                <span className="num text-[14px] font-bold text-muted">{items.length}</span>
              </header>
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2.5">
                {items.length === 0 ? <p className="stitch-border rounded-lg px-3 py-4 text-center text-[13px] text-muted">Sin pedidos</p> : null}
                {items.map((o) => (
                  <Link key={o.id} to={`/pedidos/${o.id}`} className={`block rounded-lg border bg-surface p-3 shadow-[var(--shadow-card)] transition-colors hover:border-petrol-200 ${o.overdue ? 'border-risk-500/50' : 'border-line'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap font-bold text-petrol-700">{o.number}</span>
                      {o.priority !== 'normal' ? <PriorityBadge priority={o.priority} /> : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug">{o.customerName}</p>
                    <p className={`mt-1 text-[13px] ${o.overdue ? 'font-semibold text-risk-700' : 'text-muted'}`}>
                      {o.overdue ? `Atrasado · era para ${relativeDay(o.promisedDate)}` : `Entrega ${relativeDay(o.promisedDate)}`}
                    </p>
                    {money && o.balance ? <p className="num text-[13px] font-semibold text-warn-700">Saldo {formatCOP(o.balance)}</p> : null}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
