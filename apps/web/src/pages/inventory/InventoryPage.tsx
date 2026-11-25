import { formatCOP, formatDateTime, formatQty, MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from '@nexo/shared';
import { ArrowDownCircle, ArrowUpCircle, Boxes, ClipboardList, Factory, History, ShoppingCart, SlidersHorizontal, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, HelpTip, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { ChoiceCards, Field, Input, QtyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, FilterBar, PageHeader, Segmented, SummaryStrip, Tabs } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { SearchInput } from '@/components/ui/Pickers';
import { StockBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced } from '@/lib/hooks';

export interface StockRow {
  variantId: number;
  productId: number;
  label: string;
  sku: string;
  type: string;
  category: string;
  unit: string;
  location: string | null;
  stock: number;
  reserved: number;
  available: number;
  min: number;
  cost: number;
  value: number;
  status: 'ok' | 'bajo' | 'agotado';
}

type Tab = 'existencias' | 'movimientos' | 'reposicion' | 'conteo';

/** Pestañas de la sección Inventario (incluye el catálogo de productos). */
export function InventorySectionTabs({ active }: { active: string }) {
  const { access } = useAuth();
  return (
    <Tabs
      value={active}
      tabs={[
        ...(access('inventario')
          ? [
              { value: 'existencias', label: 'Existencias', to: '/inventario' },
              { value: 'movimientos', label: 'Movimientos', to: '/inventario?tab=movimientos' },
              { value: 'reposicion', label: 'Reponer', to: '/inventario?tab=reposicion' },
              { value: 'conteo', label: 'Conteo físico', to: '/inventario?tab=conteo' },
            ]
          : []),
        ...(access('productos') ? [{ value: 'productos', label: 'Productos', to: '/productos' }] : []),
      ]}
    />
  );
}

export default function InventoryPage() {
  const [params] = useSearchParams();
  const raw = params.get('tab') ?? 'existencias';
  const tab = (raw === 'terminado' || raw === 'materiales' ? 'existencias' : raw) as Tab;
  const { data: summary } = useApi<{ finishedValue: number; materialsValue: number; finishedUnits: number; reservedUnits: number; lowFinished: number; lowMaterials: number; outOfStock: number }>('/inventory/summary');
  const { money } = useAuth();
  return (
    <div>
      <PageHeader title="Inventario" />
      <InventorySectionTabs active={tab} />
      {summary && tab === 'existencias' ? (
        <SummaryStrip
          items={[
            { label: 'Producto terminado', value: `${formatQty(summary.finishedUnits)} unid.`, hint: `${formatQty(summary.reservedUnits)} separadas para pedidos` },
            { label: 'Bajo el mínimo', value: summary.lowFinished + summary.lowMaterials, tone: summary.lowFinished + summary.lowMaterials ? 'warn' : 'ok', hint: 'Ver qué reponer', to: '/inventario?tab=reposicion' },
            money ? { label: 'Valor a costo', value: formatCOP(summary.finishedValue + summary.materialsValue), hint: `Agotados: ${summary.outOfStock}` } : { label: 'Agotados', value: summary.outOfStock, tone: summary.outOfStock ? 'risk' : 'ok' },
          ]}
        />
      ) : null}
      {tab === 'existencias' ? <StockTab /> : null}
      {tab === 'movimientos' ? <MovementsTab /> : null}
      {tab === 'reposicion' ? <ReorderTab /> : null}
      {tab === 'conteo' ? <CountTab /> : null}
    </div>
  );
}

function Tile({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint?: string; tone?: 'ink' | 'warn' | 'risk' | 'ok' }) {
  const c = { ink: 'text-ink', warn: 'text-warn-700', risk: 'text-risk-700', ok: 'text-ok-700' }[tone];
  return (
    <div className="card px-5 py-4">
      <p className="text-[13.5px] font-semibold text-muted">{label}</p>
      <p className={`num mt-1 text-[22px] font-extrabold ${c}`}>{value}</p>
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

function StockTab() {
  const { can, money } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<'terminado' | 'materiales'>(params.get('tab') === 'materiales' ? 'materiales' : 'terminado');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState(params.get('estado') ?? '');
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const { data, isLoading, error, refetch } = useApi<StockRow[]>(`/inventory/stock${qs({ kind, q: dq, status })}`);
  return (
    <Card padded={false}>
      <FilterBar
        search={<SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, código, talla o color" />}
        quick={
          <Segmented
            label="Tipo de existencias"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'terminado', label: 'Producto terminado' },
              { value: 'materiales', label: 'Telas e insumos' },
            ]}
          />
        }
        activeCount={status ? 1 : 0}
      >
        <Segmented
          label="Estado"
          value={(status || 'todo') as 'todo' | 'alerta' | 'agotado'}
          onChange={(v) => setStatus(v === 'todo' ? '' : v)}
          options={[
            { value: 'todo', label: 'Todo' },
            { value: 'alerta', label: 'Bajo el mínimo' },
            { value: 'agotado', label: 'Agotados' },
          ]}
        />
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={data ?? []}
          rowKey={(r) => r.variantId}
          pageSize={25}
          empty={<EmptyState title="No hay existencias que coincidan" text="Prueba con otra búsqueda o quita el filtro." />}
          columns={[
            {
              key: 'label',
              header: 'Producto',
              render: (r) => (
                <Link to={`/productos/${r.productId}`} title={`${r.sku}${r.location ? ` · ${r.location}` : ''}`} className="font-semibold hover:text-petrol-700 hover:underline">
                  {r.label}
                </Link>
              ),
              sortValue: (r) => r.label,
            },
            { key: 'stock', header: 'En bodega', align: 'right', render: (r) => <span className="num">{formatQty(r.stock)} <span className="text-[12px] text-muted">{r.unit}</span></span>, sortValue: (r) => r.stock },
            ...(kind === 'terminado'
              ? [
                  {
                    key: 'res',
                    header: 'Separado',
                    align: 'right' as const,
                    render: (r: StockRow) => <span className="num text-violet-700">{r.reserved ? formatQty(r.reserved) : '—'}</span>,
                    sortValue: (r: StockRow) => r.reserved,
                  },
                ]
              : []),
            { key: 'av', header: 'Disponible', align: 'right', render: (r) => <span className="num font-bold">{formatQty(r.available)}</span>, sortValue: (r) => r.available },
            { key: 'min', header: 'Mínimo', align: 'right', render: (r) => <span className="num text-muted">{formatQty(r.min)}</span>, hideOnMobile: true },
            { key: 'st', header: 'Estado', render: (r) => <StockBadge status={r.status} />, sortValue: (r) => (r.status === 'agotado' ? 0 : r.status === 'bajo' ? 1 : 2) },
            {
              key: 'act',
              header: '',
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <IconButton icon={History} label={`Ver movimientos de ${r.label}`} onClick={() => nav(`/inventario?tab=movimientos&variante=${r.variantId}&nombre=${encodeURIComponent(r.label)}`)} />
                  {can('inventario.ajustar') ? (
                    <Button size="sm" variant="soft" icon={SlidersHorizontal} onClick={() => setAdjust(r)}>
                      Ajustar
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
          caption="Existencias"
        />
      )}
      {adjust ? <AdjustModal row={adjust} onClose={() => setAdjust(null)} /> : null}
    </Card>
  );
}

function AdjustModal({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [direction, setDirection] = useState<'entrada' | 'salida'>('salida');
  const [kind, setKind] = useState<'ajuste' | 'merma'>('merma');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const save = useAction((b: object) => api.post('/inventory/adjust', b), { success: 'Ajuste registrado en el historial de movimientos', onSuccess: onClose });
  const after = direction === 'entrada' ? row.stock + quantity : row.stock - quantity;
  const tooMuch = direction === 'salida' && quantity > row.available;
  return (
    <>
      <Modal
        open={!confirm}
        onClose={onClose}
        title={`Ajustar existencias`}
        description={row.label}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!reason.trim() || quantity <= 0 || tooMuch} onClick={() => setConfirm(true)}>
              Revisar ajuste
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Notice tone="petrol">
            Los ajustes no borran el historial: quedan como un movimiento nuevo con tu nombre y el motivo. Úsalos para corregir errores, registrar daños o pérdidas.
          </Notice>
          <ChoiceCards
            name="dir"
            columns={2}
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'salida', label: 'Sacar unidades', description: 'Daño, pérdida, merma o sobrante en el sistema.', icon: ArrowDownCircle },
              { value: 'entrada', label: 'Sumar unidades', description: 'Encontradas en bodega o faltantes en el sistema.', icon: ArrowUpCircle },
            ]}
          />
          {direction === 'salida' ? (
            <Select aria-label="Tipo de salida" value={kind} onChange={(e) => setKind(e.target.value as 'ajuste' | 'merma')}>
              <option value="merma">Merma o daño (se pierde)</option>
              <option value="ajuste">Corrección de un error</option>
            </Select>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Cantidad (${row.unit})`} required error={tooMuch ? `Solo hay ${formatQty(row.available)} disponibles.` : null}>
              <QtyInput value={quantity} onChange={setQuantity} min={0} decimals={row.unit !== 'unidad'} step={row.unit === 'unidad' ? 1 : 0.5} invalid={tooMuch} aria-label="Cantidad" />
            </Field>
            <div className="rounded-xl bg-linen p-3 text-[14px]">
              <p className="text-muted">Quedarán en bodega</p>
              <p className="num text-[20px] font-extrabold">
                {formatQty(row.stock)} → {formatQty(after)}
              </p>
            </div>
          </div>
          <Field label="Motivo" required hint="Ejemplo: rollo con humedad, conteo de fin de mes, error al recibir." htmlFor="adj-r">
            <Textarea id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirmar ajuste de inventario"
        confirmLabel={direction === 'entrada' ? `Sumar ${formatQty(quantity)}` : `Sacar ${formatQty(quantity)}`}
        tone={direction === 'salida' ? 'danger' : 'primary'}
        loading={save.isPending}
        onConfirm={() => save.mutate({ variantId: row.variantId, direction, kind, quantity, reason })}
        consequence={
          <p>
            {row.label}: el inventario pasará de <strong>{formatQty(row.stock)}</strong> a <strong>{formatQty(after)}</strong> {row.unit}(s). Quedará registrado en la auditoría.
          </p>
        }
      />
    </>
  );
}

interface Movement {
  id: number;
  createdAt: string;
  label: string;
  unit: string;
  type: string;
  typeLabel: string;
  quantity: number;
  stockAfter: number;
  reference: string | null;
  reason: string;
  userName: string;
}
function MovementsTab() {
  const [params, setParams] = useSearchParams();
  const variantId = params.get('variante');
  const name = params.get('nombre');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState('');
  const [direction, setDirection] = useState('');
  const [limit, setLimit] = useState(100);
  const { data, isLoading, error, refetch } = useApi<{ rows: Movement[]; hasMore: boolean }>(`/inventory/movements${qs({ variantId, q: dq, type, direction, limit })}`);
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        {variantId ? (
          <div className="flex items-center gap-2 rounded-full bg-petrol-50 py-1 pl-3 pr-1 text-[14px] font-semibold text-petrol-700">
            Solo: {name}
            <button
              className="rounded-full px-2 hover:bg-petrol-100"
              onClick={() => {
                params.delete('variante');
                params.delete('nombre');
                setParams(params);
              }}
              aria-label="Quitar filtro de producto"
            >
              ×
            </button>
          </div>
        ) : (
          <SearchInput value={q} onChange={setQ} placeholder="Buscar producto, referencia o motivo" className="flex-1" />
        )}
        <Select aria-label="Entradas o salidas" value={direction} onChange={(e) => setDirection(e.target.value)} className="lg:w-48">
          <option value="">Entradas y salidas</option>
          <option value="entrada">Solo entradas</option>
          <option value="salida">Solo salidas</option>
        </Select>
        <Select aria-label="Tipo de movimiento" value={type} onChange={(e) => setType(e.target.value)} className="lg:w-60">
          <option value="">Todos los tipos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          <DataTable
            rows={data?.rows ?? []}
            rowKey={(m) => m.id}
            pageSize={25}
            empty={<EmptyState title="No hay movimientos con estos filtros" />}
            columns={[
              { key: 'd', header: 'Fecha', render: (m) => <span className="whitespace-nowrap">{formatDateTime(m.createdAt)}</span> },
              { key: 'p', header: 'Producto', render: (m) => <span className="font-medium">{m.label}</span> },
              { key: 't', header: 'Tipo', render: (m) => m.typeLabel },
              {
                key: 'q',
                header: 'Cantidad',
                align: 'right',
                render: (m) => (
                  <span className={`num font-bold ${m.quantity > 0 ? 'text-ok-700' : 'text-risk-700'}`}>
                    {m.quantity > 0 ? '+' : '−'}
                    {formatQty(Math.abs(m.quantity))} <span className="text-[12px] font-normal text-muted">{m.unit}</span>
                  </span>
                ),
              },
              { key: 's', header: 'Quedó', align: 'right', render: (m) => <span className="num">{formatQty(m.stockAfter)}</span> },
              { key: 'r', header: 'Motivo y referencia', render: (m) => <span className="text-[14px]">{m.reason}{m.reference ? <span className="block text-[12.5px] text-muted">{m.reference}</span> : null}</span> },
              { key: 'u', header: 'Usuario', render: (m) => m.userName, hideOnMobile: true },
            ]}
          />
          {data?.hasMore ? (
            <div className="border-t border-line p-3 text-center">
              <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>
                Cargar movimientos más antiguos
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

interface ReorderRow extends StockRow {
  needProduction: number;
  onTheWay: number;
  projected: number;
  suggested: number;
  supplierId: number | null;
  supplierName: string | null;
  lastCost: number;
  why: string;
  action: 'comprar' | 'producir';
}
function ReorderTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useApi<ReorderRow[]>('/inventory/reorder');
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <Card
      title={
        <span>
          Lista de reposición{' '}
          <HelpTip>
            Incluye lo que está bajo el mínimo y lo que va a faltar para la producción pendiente. Ya descuenta lo que viene en camino en compras no recibidas.
          </HelpTip>
        </span>
      }
      subtitle={`${data.length} referencia(s) por reponer`}
      padded={false}
    >
      {data.length ? (
        <ul className="divide-y divide-line">
          {data.map((r) => (
            <li key={r.variantId} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
              <div className="flex-1">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {r.label} <StockBadge status={r.available <= 0 ? 'agotado' : 'bajo'} />
                </p>
                <p className="mt-0.5 text-[14px] text-ink-soft">{r.why}</p>
                {r.supplierName ? <p className="text-[13px] text-muted">Último proveedor: {r.supplierName}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-[13px] text-muted">Sugerido</p>
                <p className="num text-[18px] font-extrabold">
                  {formatQty(r.suggested)} {r.unit}
                </p>
              </div>
              {r.action === 'comprar' && can('compra.gestionar') ? (
                <Button variant="soft" icon={Truck} onClick={() => nav(`/compras/nueva${qs({ proveedor: r.supplierId, material: r.variantId, cantidad: r.suggested })}`)}>
                  Crear compra
                </Button>
              ) : r.action === 'producir' && can('produccion.gestionar') ? (
                <Button variant="soft" icon={Factory} onClick={() => nav('/produccion')}>
                  Programar producción
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No hay nada por reponer" text="Todas las existencias están por encima del mínimo." />
      )}
    </Card>
  );
}

function CountTab() {
  const { can } = useAuth();
  const [kind, setKind] = useState<'materiales' | 'terminado'>('materiales');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, isLoading } = useApi<StockRow[]>(`/inventory/stock${qs({ kind, q: dq })}`);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const diffs = useMemo(
    () =>
      (data ?? [])
        .filter((r) => counts[r.variantId] !== undefined && counts[r.variantId] !== '')
        .map((r) => ({ r, counted: Number(counts[r.variantId].replace(',', '.')), diff: Number(counts[r.variantId].replace(',', '.')) - r.stock }))
        .filter((d) => Number.isFinite(d.counted)),
    [data, counts],
  );
  const save = useAction((b: object) => api.post<{ adjusted: number }>('/inventory/count', b), {
    success: (r) => (r.adjusted ? `Conteo guardado: ${r.adjusted} diferencia(s) ajustadas` : 'Conteo guardado: todo coincide'),
    onSuccess: () => {
      setCounts({});
      setReview(false);
    },
  });
  if (!can('inventario.ajustar')) return <Notice tone="warn">Solo Inventario o el administrador pueden registrar conteos físicos.</Notice>;
  const withDiff = diffs.filter((d) => Math.abs(d.diff) > 0.0001);
  return (
    <Card
      title="Conteo físico"
      subtitle="1) Cuenta lo que hay en bodega. 2) Escribe lo contado. 3) Revisa las diferencias y confirma el ajuste."
      actions={
        <Button icon={ClipboardList} disabled={!diffs.length} onClick={() => setReview(true)}>
          Revisar diferencias ({withDiff.length})
        </Button>
      }
      padded={false}
    >
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row">
        <Select aria-label="Qué contar" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setCounts({}); }} className="md:w-64">
          <option value="materiales">Materias primas e insumos</option>
          <option value="terminado">Producto terminado</option>
        </Select>
        <SearchInput value={q} onChange={setQ} placeholder="Filtrar por nombre" className="flex-1" />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="max-h-[560px] overflow-y-auto">
          <table className="table-base">
            <thead className="sticky top-0">
              <tr>
                <th>Producto</th>
                <th className="text-right">Según sistema</th>
                <th className="text-right">Contado</th>
                <th className="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => {
                const d = diffs.find((x) => x.r.variantId === r.variantId);
                return (
                  <tr key={r.variantId}>
                    <td>
                      <span className="font-medium">{r.label}</span>
                      <span className="block text-[12.5px] text-muted">{r.location ?? r.category}</span>
                    </td>
                    <td className="num text-right">
                      {formatQty(r.stock)} {r.unit}
                    </td>
                    <td className="text-right">
                      <Input
                        inputMode="decimal"
                        className="num ml-auto h-10 w-28 text-right"
                        value={counts[r.variantId] ?? ''}
                        placeholder="—"
                        onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
                        aria-label={`Contado de ${r.label}`}
                      />
                    </td>
                    <td className={`num text-right font-bold ${!d ? 'text-muted' : d.diff === 0 ? 'text-ok-700' : d.diff > 0 ? 'text-teal-700' : 'text-risk-700'}`}>
                      {!d ? '' : d.diff === 0 ? 'Coincide' : `${d.diff > 0 ? '+' : ''}${formatQty(d.diff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={review}
        onClose={() => setReview(false)}
        title="Confirmar ajuste por conteo"
        confirmLabel={withDiff.length ? `Ajustar ${withDiff.length} diferencia(s)` : 'Guardar conteo'}
        loading={save.isPending}
        onConfirm={() => save.mutate({ note, lines: diffs.map((d) => ({ variantId: d.r.variantId, counted: d.counted })) })}
        consequence={
          withDiff.length ? (
            <div>
              <p className="mb-2">El inventario se corregirá para que coincida con lo contado:</p>
              <ul className="max-h-52 overflow-y-auto rounded-lg bg-linen p-3 text-[14px]">
                {withDiff.map((d) => (
                  <li key={d.r.variantId} className="flex justify-between gap-3 py-0.5">
                    <span>{d.r.label}</span>
                    <strong className={d.diff > 0 ? 'text-teal-700' : 'text-risk-700'}>
                      {d.diff > 0 ? '+' : ''}
                      {formatQty(d.diff)}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            'Todo lo contado coincide con el sistema. No se harán ajustes.'
          )
        }
      >
        <Field label="Nota del conteo" htmlFor="cnt-note">
          <Input id="cnt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: conteo de fin de mes" />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
