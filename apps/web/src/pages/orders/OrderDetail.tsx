import {
  addDays,
  DELIVERY_METHOD_LABELS,
  DELIVERY_METHODS,
  formatCOP,
  formatDate,
  formatDateTime,
  ORDER_STATUS_HELP,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  relativeDay,
  todayISO,
  type DeliveryMethod,
  type OrderStatus,
  type PaymentMethod,
  type Priority,
} from '@nexo/shared';
import {
  Ban,
  CheckCircle2,
  Copy,
  Factory,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Phone,
  Printer,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock, Notice, Tape } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Card, Collapsible, KeyValues, PageHeader } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { OrderStatusBadge, PriorityBadge, ProductionStatusBadge, ReceivableBadge } from '@/components/ui/Status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { DeliveryModal, MessageModal, PaymentModal } from './shared';

interface Item {
  id: number;
  variantId: number;
  description: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  customization: Record<string, unknown> | null;
  qtyDelivered: number;
  reserved: number;
  missing: number;
  inProduction: number;
  toProduce: number;
  custom: boolean;
}
interface Detail {
  order: {
    id: number;
    number: string;
    kind: 'pedido' | 'venta';
    status: OrderStatus;
    priority: Priority;
    orderDate: string;
    promisedDate: string | null;
    dueDate: string | null;
    deliveryMethod: DeliveryMethod;
    deliveryAddress: string | null;
    notes: string | null;
    subtotal: number | null;
    discount: number | null;
    total: number | null;
    paid: number | null;
    balance: number | null;
    overdue: boolean;
    receivable: string | null;
    cancelReason: string | null;
    createdByName: string | null;
    createdAt: string;
  };
  customer: Customer | null;
  items: Item[];
  payments: Array<{ id: number; number: string; amount: number; method: PaymentMethod; reference: string | null; notes: string | null; reversed: boolean; createdAt: string; userName: string | null }>;
  events: Array<{ id: number; type: string; summary: string; createdAt: string; userName: string }>;
  production: Array<{ id: number; number: string; stage: string; status: string; targetDate: string; units: number; done: number; progress: number }>;
  deliveries: Array<{ id: number; number: string; receivedBy: string; partial: boolean; createdAt: string; items: Array<{ quantity: number; description: string }> }>;
  canProduce: boolean;
  pendingUnits: number;
}

const JOURNEY: OrderStatus[] = ['borrador', 'confirmado', 'en_produccion', 'listo', 'entregado'];

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can, money } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/orders/${id}`);
  const [modal, setModal] = useState<null | 'pay' | 'deliver' | 'message' | 'cancel' | 'edit' | 'confirm' | 'ready' | 'produce' | 'pending' | 'note'>(null);
  const [reverse, setReverse] = useState<Detail['payments'][number] | null>(null);
  const [refund, setRefund] = useState(true);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (params.get('accion') === 'entregar' && data?.order.status === 'listo') {
      setModal('deliver');
      params.delete('accion');
      setParams(params, { replace: true });
    }
  }, [params, data, setParams]);

  const status = useAction((b: { status: string; reason?: string; refundPayments?: boolean }) => api.post(`/orders/${id}/status`, b), {
    success: (r) => `Pedido ahora está “${ORDER_STATUS_LABELS[(r as { status: OrderStatus }).status]}”`,
    onSuccess: () => setModal(null),
  });
  const produce = useAction((b: object) => api.post<{ id: number; number: string }>('/production', b), {
    success: (r) => `Orden de producción ${r.number} creada`,
    onSuccess: () => setModal(null),
  });
  const rev = useAction((b: { reason: string }) => api.post(`/orders/payments/${reverse!.id}/reverse`, b), {
    success: 'Pago reversado. Se registró la salida de dinero en caja.',
    onSuccess: () => setReverse(null),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const { order: o, customer, items } = data;
  const isSale = o.kind === 'venta';
  const active = ['pendiente', 'confirmado', 'en_produccion', 'listo'].includes(o.status);
  const units = items.reduce((a, i) => a + i.quantity, 0);
  const missing = items.reduce((a, i) => a + i.missing, 0);

  // Acción principal según el estado
  let primary: React.ReactNode = null;
  if ((o.status === 'borrador' || o.status === 'pendiente') && can('pedido.editar'))
    primary = (
      <Button icon={CheckCircle2} onClick={() => setModal('confirm')}>
        Confirmar pedido
      </Button>
    );
  else if (data.canProduce && can('pedido.editar'))
    primary = (
      <Button icon={Factory} onClick={() => setModal('produce')}>
        Enviar a producción
      </Button>
    );
  else if (o.status === 'confirmado' && missing === 0 && can('pedido.editar'))
    primary = (
      <Button icon={PackageCheck} onClick={() => setModal('ready')}>
        Marcar como listo
      </Button>
    );
  else if (o.status === 'listo' && can('entrega.registrar'))
    primary = (
      <Button icon={Truck} variant="success" onClick={() => setModal('deliver')}>
        Registrar entrega
      </Button>
    );

  return (
    <div>
      <PageHeader
        title={`${isSale ? 'Venta' : 'Pedido'} ${o.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} kind={o.kind} />
            {!isSale ? <PriorityBadge priority={o.priority} /> : null}
            {o.overdue ? <Badge tone="risk">Atrasado</Badge> : null}
            <span>
              {customer ? (
                <Link className="font-semibold text-petrol-700 hover:underline" to={`/clientes/${customer.id}`}>
                  {customer.name}
                </Link>
              ) : (
                'Venta de mostrador'
              )}
            </span>
          </span>
        }
        back={{ to: isSale ? '/pedidos?tipo=venta' : '/pedidos', label: isSale ? 'Ventas' : 'Pedidos' }}
        actions={
          <>
            {money && (o.balance ?? 0) > 0 && o.status !== 'cancelado' && can('pago.registrar') ? (
              <Button variant={primary ? 'secondary' : 'primary'} icon={Wallet} onClick={() => setModal('pay')}>
                Registrar pago
              </Button>
            ) : null}
            {primary}
            <div className="relative">
              <Button variant="secondary" icon={MoreHorizontal} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
                Más opciones
              </Button>
              {menu ? (
                <MoreMenu onClose={() => setMenu(false)}>
                  <MenuItem icon={Printer} onClick={() => window.open(`/imprimir/pedido/${o.id}`, '_blank')}>
                    Imprimir comprobante
                  </MenuItem>
                  {customer ? (
                    <MenuItem icon={MessageCircle} onClick={() => setModal('message')}>
                      Mensaje para el cliente
                    </MenuItem>
                  ) : null}
                  {!isSale && can('pedido.crear') ? (
                    <MenuItem icon={Copy} onClick={() => nav(`/pedidos/nuevo?duplicar=${o.id}`)}>
                      Duplicar pedido
                    </MenuItem>
                  ) : null}
                  {!isSale && active && can('pedido.editar') ? (
                    <MenuItem icon={Pencil} onClick={() => setModal('edit')}>
                      Cambiar fecha o prioridad
                    </MenuItem>
                  ) : null}
                  {o.status === 'confirmado' && can('pedido.editar') ? (
                    <MenuItem icon={Undo2} onClick={() => setModal('pending')}>
                      Volver a “por confirmar”
                    </MenuItem>
                  ) : null}
                  <MenuItem icon={Pencil} onClick={() => setModal('note')}>
                    Agregar nota
                  </MenuItem>
                  {!isSale && o.status !== 'entregado' && o.status !== 'cancelado' && can('pedido.cancelar') ? (
                    <MenuItem icon={Ban} danger onClick={() => setModal('cancel')}>
                      Cancelar pedido
                    </MenuItem>
                  ) : null}
                </MoreMenu>
              ) : null}
            </div>
          </>
        }
      />

      {o.status === 'cancelado' ? (
        <div className="mb-5">
          <Notice tone="risk" icon={Ban} title="Pedido cancelado">
            Motivo: {o.cancelReason}
          </Notice>
        </div>
      ) : !isSale ? (
        <Journey status={o.status} />
      ) : null}

      {o.status === 'confirmado' && data.canProduce ? (
        <div className="mb-5">
          <Notice tone="violet" icon={Factory} title={`Faltan ${data.pendingUnits} unidades por fabricar`} action={can('pedido.editar') ? <Button size="sm" onClick={() => setModal('produce')}>Enviar a producción</Button> : null}>
            Lo personalizado y lo que no hay en bodega debe pasar por el taller.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Productos" subtitle={`${units} unidades`} padded={false}>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="text-right">Cant.</th>
                    {!isSale ? <th>Estado</th> : null}
                    {money ? <th className="text-right">Precio</th> : null}
                    {money ? <th className="text-right">Total</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <p className="font-semibold">{i.description}</p>
                        {i.custom ? <CustomSummary c={i.customization} /> : null}
                      </td>
                      <td className="num text-right font-semibold">{i.quantity}</td>
                      {!isSale ? (
                        <td>
                          <ItemState item={i} status={o.status} />
                        </td>
                      ) : null}
                      {money ? <td className="num text-right">{formatCOP(i.unitPrice)}</td> : null}
                      {money ? <td className="num text-right font-semibold">{formatCOP(i.lineTotal)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {data.production.length ? (
            <Card title="Producción" padded={false}>
              <ul className="divide-y divide-line">
                {data.production.map((p) => (
                  <li key={p.id}>
                    <Link to={`/produccion/${p.id}`} className="block px-5 py-4 hover:bg-petrol-50/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-petrol-700">{p.number}</span>
                        <ProductionStatusBadge status={p.status} />
                      </div>
                      <p className="mt-1 text-[14px] text-muted">
                        Etapa: <strong className="text-ink">{p.stage}</strong> · {p.done}/{p.units} unidades terminadas · fecha objetivo {formatDate(p.targetDate)}
                      </p>
                      <div className="mt-2">
                        <Tape value={p.progress} tone={p.status === 'terminada' ? 'ok' : 'petrol'} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.deliveries.length ? (
            <Card title="Entregas" padded={false}>
              <ul className="divide-y divide-line">
                {data.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <Truck className="h-5 w-5 text-ok-500" aria-hidden />
                    <div className="flex-1">
                      <p className="font-semibold">
                        {d.number} {d.partial ? <Badge tone="warn">Parcial</Badge> : <Badge tone="ok">Completa</Badge>}
                      </p>
                      <p className="text-[13.5px] text-muted">
                        Recibió {d.receivedBy} · {formatDateTime(d.createdAt)} · {d.items.reduce((a, x) => a + x.quantity, 0)} unid.
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" icon={Printer} onClick={() => window.open(`/imprimir/entrega/${d.id}`, '_blank')}>
                      Comprobante
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Collapsible title="Historial del pedido" hint={`${data.events.length} registro(s): cambios de estado, pagos, producción y entregas`}>
            <ol className="relative px-5 py-4">
              {data.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < data.events.length - 1 ? <span className="stitch-y absolute bottom-0 left-[7px] top-5 text-line-strong" aria-hidden /> : null}
                  <span className={`mt-1.5 h-4 w-4 shrink-0 rounded-full border-[3px] ${e.type === 'pago' ? 'border-ok-500' : e.type === 'entrega' ? 'border-teal-500' : e.type === 'produccion' ? 'border-violet-500' : 'border-petrol-500'} bg-surface`} aria-hidden />
                  <div>
                    <p className="text-[14.5px] leading-snug">{e.summary}</p>
                    <p className="text-[13px] text-muted">
                      {e.userName} · {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Collapsible>
        </div>

        <div className="space-y-5">
          {money ? (
            <Card title="Dinero">
              <dl className="space-y-2 text-[15px]">
                {o.discount ? (
                  <>
                    <Row label="Subtotal" value={formatCOP(o.subtotal)} />
                    <Row label="Descuento" value={`− ${formatCOP(o.discount)}`} />
                  </>
                ) : null}
                <Row label="Total" value={formatCOP(o.total)} strong />
                <Row label="Pagado" value={formatCOP(o.paid)} />
                <div className="stitch-x my-1 text-line-strong" aria-hidden />
                <Row label="Saldo pendiente" value={formatCOP(o.balance)} strong tone={(o.balance ?? 0) > 0 ? 'warn' : 'ok'} />
              </dl>
              {o.receivable ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
                  <ReceivableBadge status={o.receivable} />
                  <span className="text-muted">vence {formatDate(o.dueDate)}</span>
                </div>
              ) : null}
              {data.payments.length ? (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[13px] font-semibold text-muted">Pagos recibidos</p>
                  <ul className="space-y-2">
                    {data.payments.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-2 text-[14px]">
                        <div className={p.reversed || p.amount < 0 ? 'text-muted' : ''}>
                          <p className="font-semibold">
                            {p.notes ?? 'Pago'} · {PAYMENT_METHOD_LABELS[p.method]}
                            {p.reversed ? <Badge tone="risk" className="ml-1">Reversado</Badge> : null}
                          </p>
                          <p className="text-[12.5px] text-muted">
                            {p.number} · {formatDateTime(p.createdAt)}
                          </p>
                          <div className="mt-0.5 flex gap-3">
                            <button className="text-[12.5px] font-semibold text-petrol-700 hover:underline" onClick={() => window.open(`/imprimir/pago/${p.id}`, '_blank')}>
                              Recibo
                            </button>
                            {!p.reversed && p.amount > 0 && can('pago.reversar') ? (
                              <button className="text-[12.5px] font-semibold text-risk-700 hover:underline" onClick={() => setReverse(p)}>
                                Reversar
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <span className={`num font-bold ${p.amount < 0 ? 'text-risk-700' : ''}`}>{formatCOP(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title={customer ? 'Cliente y entrega' : 'Datos de la venta'}>
            {customer ? (
              <div className="mb-3 border-b border-line pb-3">
                <Link to={`/clientes/${customer.id}`} className="font-bold hover:text-petrol-700 hover:underline">
                  {customer.name}
                </Link>
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="mt-0.5 flex items-center gap-2 text-[14.5px] text-petrol-700 hover:underline">
                    <Phone className="h-4 w-4" /> {customer.phone}
                  </a>
                ) : null}
                <Button size="sm" variant="soft" icon={MessageCircle} className="mt-2" onClick={() => setModal('message')}>
                  Enviar mensaje
                </Button>
              </div>
            ) : null}
            <KeyValues
              columns={1}
              items={[
                !isSale && ['Entrega', o.promisedDate ? `${formatDate(o.promisedDate)} (${relativeDay(o.promisedDate)}) · ${DELIVERY_METHOD_LABELS[o.deliveryMethod]}` : '—'],
                o.deliveryAddress && !isSale && o.deliveryMethod !== 'recoge' ? ['Dirección', o.deliveryAddress] : null,
                o.notes ? ['Notas', o.notes] : null,
                ['Registrado', `${formatDate(o.orderDate)} por ${o.createdByName ?? '—'}`],
              ]}
            />
          </Card>
        </div>
      </div>

      {/* ------- modales ------- */}
      {money ? <PaymentModal open={modal === 'pay'} onClose={() => setModal(null)} order={{ id: o.id, number: o.number, balance: o.balance ?? 0, customerName: customer?.name }} /> : null}
      <DeliveryModal open={modal === 'deliver'} onClose={() => setModal(null)} order={{ id: o.id, number: o.number, balance: o.balance ?? 0 }} items={items} customerName={customer?.name} />
      <MessageModal open={modal === 'message'} onClose={() => setModal(null)} orderId={o.id} />
      <ConfirmDialog
        open={modal === 'confirm'}
        onClose={() => setModal(null)}
        title={`Confirmar pedido ${o.number}`}
        confirmLabel="Confirmar pedido"
        tone="success"
        loading={status.isPending}
        onConfirm={() => status.mutate({ status: 'confirmado' })}
        consequence="El cliente aceptó el pedido. Se separará de bodega lo que esté disponible y podrás enviarlo a producción."
      />
      <ConfirmDialog
        open={modal === 'pending'}
        onClose={() => setModal(null)}
        title="Volver a “por confirmar”"
        confirmLabel="Volver a por confirmar"
        loading={status.isPending}
        onConfirm={(reason) => status.mutate({ status: 'pendiente', reason })}
        requireReason
        consequence="Se liberará el inventario separado para este pedido."
      />
      <ConfirmDialog
        open={modal === 'ready'}
        onClose={() => setModal(null)}
        title="Marcar como listo para entregar"
        confirmLabel="Marcar como listo"
        tone="success"
        loading={status.isPending}
        onConfirm={() => status.mutate({ status: 'listo' })}
        consequence="Todo el pedido está separado en bodega. Quedará en la lista de entregas."
      />
      <ProduceModal open={modal === 'produce'} onClose={() => setModal(null)} loading={produce.isPending} items={items.filter((i) => i.toProduce > 0)} promised={o.promisedDate} onConfirm={(b) => produce.mutate({ ...b, orderId: o.id })} />
      <ConfirmDialog
        open={modal === 'cancel'}
        onClose={() => setModal(null)}
        title={`Cancelar pedido ${o.number}`}
        confirmLabel="Sí, cancelar pedido"
        tone="danger"
        loading={status.isPending}
        requireReason
        reasonLabel="¿Por qué se cancela?"
        onConfirm={(reason) => status.mutate({ status: 'cancelado', reason, refundPayments: refund && (o.paid ?? 0) > 0 })}
        consequence={
          <>
            <p>Esta acción no se puede deshacer. Se liberará el inventario separado y se cancelarán las órdenes de producción abiertas.</p>
          </>
        }
      >
        {money && (o.paid ?? 0) > 0 ? <Checkbox checked={refund} onChange={setRefund} label={`Devolver lo pagado (${formatCOP(o.paid)})`} description="Se registrará la salida de dinero en caja como reverso de cada pago." /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!reverse}
        onClose={() => setReverse(null)}
        title={`Reversar pago ${reverse?.number ?? ''}`}
        confirmLabel="Reversar pago"
        tone="danger"
        loading={rev.isPending}
        requireReason
        onConfirm={(reason) => rev.mutate({ reason })}
        consequence={`Se registrará una salida de ${formatCOP(reverse?.amount)} en caja y el saldo del pedido aumentará. El pago original no se borra: queda marcado como reversado.`}
      />
      <EditModal open={modal === 'edit'} onClose={() => setModal(null)} order={o} />
      <NoteModal open={modal === 'note'} onClose={() => setModal(null)} orderId={o.id} />
    </div>
  );
}

function Journey({ status }: { status: OrderStatus }) {
  const idx = status === 'pendiente' ? 0 : JOURNEY.indexOf(status);
  return (
    <ol className="card mb-6 flex items-center overflow-x-auto px-5 py-4" aria-label="Avance del pedido">
      {JOURNEY.map((s, i) => {
        const done = i < idx || status === 'entregado';
        const current = i === idx && status !== 'entregado';
        const label = s === 'borrador' ? (status === 'pendiente' ? 'Por confirmar' : 'Creado') : ORDER_STATUS_LABELS[s];
        return (
          <li key={s} className="flex flex-1 items-center last:flex-none">
            <span className="flex items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${done ? 'bg-teal-500 text-white' : current ? 'bg-petrol-600 text-white ring-4 ring-petrol-100' : 'border-2 border-line-strong text-muted'}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[14px] font-semibold ${current ? 'text-petrol-700' : done ? 'text-ink' : 'text-muted'}`}>{label}</span>
            </span>
            {i < JOURNEY.length - 1 ? <span className={`stitch-x mx-3 min-w-6 flex-1 ${done ? 'text-teal-500' : 'text-line-strong'}`} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ItemState({ item, status }: { item: Item; status: OrderStatus }) {
  if (item.qtyDelivered >= item.quantity) return <Badge tone="ok">Entregado</Badge>;
  if (status === 'borrador' || status === 'pendiente') return <span className="text-[13.5px] text-muted">Sin separar</span>;
  if (status === 'cancelado') return <span className="text-[13.5px] text-muted">—</span>;
  const pend = item.quantity - item.qtyDelivered;
  return (
    <div className="text-[13.5px]">
      {item.qtyDelivered ? <p className="text-ok-700">{item.qtyDelivered} entregadas</p> : null}
      {item.reserved ? <p className="font-semibold text-teal-700">{item.reserved} listas en bodega</p> : null}
      {item.inProduction ? <p className="font-semibold text-violet-700">{item.inProduction} en producción</p> : null}
      {item.toProduce ? <p className="font-semibold text-warn-700">{item.toProduce} por enviar a producción</p> : null}
      {!item.reserved && !item.missing && pend ? <p>{pend} pendientes</p> : null}
    </div>
  );
}

function CustomSummary({ c }: { c: Record<string, unknown> | null }) {
  if (!c) return null;
  const parts = [
    c.technique && c.technique !== 'ninguna' ? String(c.technique) : null,
    c.logo ? 'con logo' : null,
    c.position ? String(c.position) : null,
    c.names ? `nombres: ${c.names}` : null,
    c.measures ? `medidas: ${c.measures}` : null,
    c.notes ? String(c.notes) : null,
  ].filter(Boolean);
  return <p className="mt-0.5 text-[13px] text-violet-700">Personalizado: {parts.join(' · ')}</p>;
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'warn' | 'ok' }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-bold' : 'text-ink-soft'}>{label}</dt>
      <dd className={`num ${strong ? 'text-[18px] font-extrabold' : 'font-semibold'} ${tone === 'warn' ? 'text-warn-700' : tone === 'ok' ? 'text-ok-700' : ''}`}>{value}</dd>
    </div>
  );
}

function MoreMenu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-pop)]" onClick={onClose}>
      {children}
    </div>
  );
}
export function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Printer; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] font-medium ${danger ? 'text-risk-700 hover:bg-risk-50' : 'text-ink hover:bg-petrol-50'}`}>
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      {children}
    </button>
  );
}

function ProduceModal({ open, onClose, onConfirm, loading, items, promised }: { open: boolean; onClose: () => void; onConfirm: (b: object) => void; loading: boolean; items: Item[]; promised: string | null }) {
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [responsible, setResponsible] = useState('');
  useEffect(() => {
    if (open) setTargetDate(promised ? addDays(promised, -1) < todayISO() ? todayISO() : addDays(promised, -1) : addDays(todayISO(), 10));
  }, [open, promised]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar a producción"
      description="Se crea una orden para el taller con lo que falta fabricar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Factory} loading={loading} onClick={() => onConfirm({ targetDate, priority, responsible: responsible || null })}>
            Crear orden de producción
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="rounded-xl bg-linen p-3 text-[14.5px]">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between py-0.5">
              <span>{i.description}</span>
              <strong className="num">{i.toProduce} unid.</strong>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Terminar a más tardar" required htmlFor="po-date" hint="Normalmente un día antes de la entrega.">
            <Input id="po-date" type="date" value={targetDate} min={todayISO()} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <Field label="Prioridad" required htmlFor="po-prio">
            <Select id="po-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Responsable o área" htmlFor="po-resp">
          <Input id="po-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Ej: Taller 1 — Rosa" />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: Detail['order'] }) {
  const [promisedDate, setPromisedDate] = useState(order.promisedDate ?? '');
  const [priority, setPriority] = useState(order.priority);
  const [deliveryMethod, setDeliveryMethod] = useState(order.deliveryMethod);
  const [dueDate, setDueDate] = useState(order.dueDate ?? '');
  const [notes, setNotes] = useState(order.notes ?? '');
  useEffect(() => {
    if (open) {
      setPromisedDate(order.promisedDate ?? '');
      setPriority(order.priority);
      setDeliveryMethod(order.deliveryMethod);
      setDueDate(order.dueDate ?? '');
      setNotes(order.notes ?? '');
    }
  }, [open, order]);
  const save = useAction((b: object) => api.put(`/orders/${order.id}`, b), { success: 'Cambios guardados y anotados en el historial', onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar datos del pedido"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ promisedDate, priority, deliveryMethod, dueDate: dueDate || null, notes })}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha prometida" required htmlFor="e-date">
          <Input id="e-date" type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
        </Field>
        <Field label="Prioridad" required htmlFor="e-prio">
          <Select id="e-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma de entrega" required htmlFor="e-del">
          <Select id="e-del" value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as DeliveryMethod)}>
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>
                {DELIVERY_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vencimiento del saldo" htmlFor="e-due" hint="Hasta cuándo tiene el cliente para pagar.">
          <Input id="e-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Notas" className="sm:col-span-2" htmlFor="e-notes">
          <Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function NoteModal({ open, onClose, orderId }: { open: boolean; onClose: () => void; orderId: number }) {
  const [text, setText] = useState('');
  const save = useAction((b: object) => api.post(`/orders/${orderId}/notes`, b), {
    success: 'Nota agregada al historial',
    onSuccess: () => {
      setText('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar nota al historial"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!text.trim()} onClick={() => save.mutate({ text })}>
            Guardar nota
          </Button>
        </>
      }
    >
      <Field label="Nota" required htmlFor="note-text">
        <Textarea id="note-text" value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Ej: el cliente llamó para cambiar la talla 10 por 12" />
      </Field>
    </Modal>
  );
}
