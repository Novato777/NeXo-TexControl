import { formatCOP, formatDate, formatDateTime, relativeDay, todayISO } from '@nexo/shared';
import { MessageCircle, Printer, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, PageHeader, Segmented } from '@/components/ui/Layout';
import { OrdersSectionTabs } from './orders/OrdersPage';
import { OrderStatusBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { DeliveryModal, MessageModal } from './orders/shared';

interface AgendaRow {
  id: number;
  number: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  promisedDate: string;
  units: number;
  balance: number;
  late: boolean;
  isToday: boolean;
}
interface Data {
  agenda: AgendaRow[];
  recent: Array<{ id: number; number: string; orderId: number; orderNumber: string; customerName: string | null; receivedBy: string; partial: boolean; createdAt: string; userName: string | null; balanceAtDelivery: number }>;
}

export default function DeliveriesPage() {
  const { can, money } = useAuth();
  const [tab, setTab] = useState<'agenda' | 'historial'>('agenda');
  const { data, isLoading, error, refetch } = useApi<Data>('/deliveries?days=21');
  const [deliver, setDeliver] = useState<AgendaRow | null>(null);
  const [message, setMessage] = useState<number | null>(null);
  const detail = useApi<{ items: Array<{ id: number; description: string; quantity: number; qtyDelivered: number; reserved: number }> }>(deliver ? `/orders/${deliver.id}` : null);

  const groups: Array<{ title: string; tone: 'risk' | 'petrol' | 'neutral'; rows: AgendaRow[] }> = [];
  if (data) {
    const today = todayISO();
    const late = data.agenda.filter((a) => a.late);
    const tod = data.agenda.filter((a) => a.isToday);
    const next = data.agenda.filter((a) => a.promisedDate > today);
    if (late.length) groups.push({ title: 'Atrasados', tone: 'risk', rows: late });
    groups.push({ title: 'Para hoy', tone: 'petrol', rows: tod });
    if (next.length) groups.push({ title: 'Próximos días', tone: 'neutral', rows: next });
  }

  return (
    <div>
      <PageHeader title="Pedidos y ventas" actions={<Segmented label="Ver" value={tab} onChange={setTab} options={[{ value: 'agenda', label: 'Por entregar' }, { value: 'historial', label: 'Ya entregadas' }]} />} />
      <OrdersSectionTabs active="entregas" />
      {error ? <ErrorState error={error} onRetry={refetch} /> : null}
      {isLoading || !data ? (
        <LoadingBlock />
      ) : tab === 'agenda' ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.title} title={<span className={g.tone === 'risk' ? 'text-risk-700' : ''}>{g.title}</span>} subtitle={`${g.rows.length} pedido(s)`} padded={false}>
              {g.rows.length ? (
                <ul className="divide-y divide-line">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex flex-col gap-3 px-5 py-3.5 md:flex-row md:items-center">
                      <div className="flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <Link to={`/pedidos/${r.id}`} className="font-bold text-petrol-700 hover:underline">
                            {r.number}
                          </Link>
                          <OrderStatusBadge status={r.status} />
                          {r.late ? <Badge tone="risk">Prometido {relativeDay(r.promisedDate)}</Badge> : !r.isToday ? <span className="text-[13.5px] font-semibold text-ink-soft">{formatDate(r.promisedDate)} ({relativeDay(r.promisedDate)})</span> : null}
                        </p>
                        <p className="text-[14.5px] font-medium">{r.customerName}</p>
                        <p className="text-[13.5px] text-muted">
                          {r.units} unidades por entregar
                          {money && r.balance > 0 ? <span className="font-semibold text-warn-700"> · saldo {formatCOP(r.balance)}</span> : money ? <span className="text-ok-700"> · pagado</span> : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.customerPhone ? (
                          <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => setMessage(r.id)}>
                            Avisar al cliente
                          </Button>
                        ) : null}
                        {r.status === 'listo' && can('entrega.registrar') ? (
                          <Button size="sm" variant="success" icon={Truck} onClick={() => setDeliver(r)}>
                            Registrar entrega
                          </Button>
                        ) : (
                          <span className="self-center text-[13.5px] text-muted">{r.status === 'listo' ? '' : 'Aún no está listo'}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-muted">No hay entregas programadas para hoy.</p>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card padded={false}>
          <DataTable
            rows={data.recent}
            rowKey={(r) => r.id}
            empty={<EmptyState title="Todavía no hay entregas registradas" />}
            columns={[
              { key: 'n', header: 'Entrega', render: (r) => <span className="font-bold">{r.number}</span> },
              { key: 'o', header: 'Pedido', render: (r) => <Link className="font-semibold text-petrol-700 hover:underline" to={`/pedidos/${r.orderId}`}>{r.orderNumber}</Link> },
              { key: 'c', header: 'Cliente', render: (r) => r.customerName },
              { key: 'r', header: 'Recibió', render: (r) => r.receivedBy },
              { key: 't', header: 'Tipo', render: (r) => (r.partial ? <Badge tone="warn">Parcial</Badge> : <Badge tone="ok">Completa</Badge>) },
              { key: 'd', header: 'Fecha', render: (r) => formatDateTime(r.createdAt), sortValue: (r) => r.createdAt },
              { key: 'p', header: '', render: (r) => <Button size="sm" variant="ghost" icon={Printer} onClick={() => window.open(`/imprimir/entrega/${r.id}`, '_blank')}>Comprobante</Button> },
            ]}
          />
        </Card>
      )}
      {deliver && detail.data ? (
        <DeliveryModal open onClose={() => setDeliver(null)} order={{ id: deliver.id, number: deliver.number, balance: deliver.balance }} items={detail.data.items} customerName={deliver.customerName} />
      ) : null}
      {message ? <MessageModal open onClose={() => setMessage(null)} orderId={message} template="listo" /> : null}
    </div>
  );
}
