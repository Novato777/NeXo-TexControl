import { CUSTOMER_TYPE_LABELS, formatCOP, formatDate, formatDateTime, type CustomerType } from '@nexo/shared';
import { Archive, MessageCircle, Pencil, Phone, Plus, ShoppingBag, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, KeyValues, PageHeader, SummaryStrip, Tabs } from '@/components/ui/Layout';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { OrderStatusBadge, ReceivableBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { CustomerFormModal } from './CustomerForm';

interface Detail {
  customer: Customer;
  summary: { ordersCount: number; totalBought: number; balance: number; lastPurchase: string | null; averageTicket: number };
  orders: Array<{ id: number; number: string; kind: string; status: string; orderDate: string; total: number; paid: number; balance: number; dueDate: string | null; receivable: string | null }>;
  payments: Array<{ id: number; number: string; amount: number; method: string; createdAt: string; orderNumber: string | null }>;
  timeline: Array<{ at: string; kind: string; text: string; ref: number | null }>;
}

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, money } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/customers/${id}`);
  const [tab, setTab] = useState<'pedidos' | 'historial'>('pedidos');
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const arch = useAction(() => api.post(`/customers/${id}/archive`, { archived: !data?.customer.archived }), { success: 'Listo', onSuccess: () => setArchive(false) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const c = data.customer;
  const wa = (c.whatsapp ?? c.phone ?? '').replace(/\D/g, '');
  const open = data.orders.filter((o) => o.receivable);
  return (
    <div>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {CUSTOMER_TYPE_LABELS[c.type as CustomerType]}
            {c.tags.map((t) => (
              <Badge key={t} tone="teal">
                {t}
              </Badge>
            ))}
            {c.archived ? <Badge tone="neutral">Archivado</Badge> : null}
          </span>
        }
        back={{ to: '/clientes', label: 'Clientes' }}
        actions={
          <>
            {can('cliente.editar') ? (
              <>
                <Button variant="secondary" icon={Archive} onClick={() => setArchive(true)}>
                  {c.archived ? 'Restaurar' : 'Archivar'}
                </Button>
                <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>
                  Editar datos
                </Button>
              </>
            ) : null}
            {can('pedido.crear') ? (
              <ButtonLink to={`/pedidos/nuevo?cliente=${c.id}`} icon={Plus}>
                Crear pedido
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <SummaryStrip
        items={[
          { label: 'Compras', value: data.summary.ordersCount, hint: `Última: ${formatDate(data.summary.lastPurchase)}` },
          money && { label: 'Total comprado', value: formatCOP(data.summary.totalBought), hint: `Crédito: ${c.creditDays ? `${c.creditDays} días` : 'no tiene'}` },
          money && { label: 'Debe', value: formatCOP(data.summary.balance), tone: data.summary.balance ? 'warn' : 'ok', hint: open.length ? `${open.length} cuenta(s) abierta(s)` : 'Está al día' },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'pedidos', label: 'Pedidos y compras', count: data.orders.length },
              { value: 'historial', label: 'Historial' },
            ]}
          />
          {tab === 'pedidos' ? (
            <Card padded={false}>
              <DataTable
                rows={data.orders}
                rowKey={(o) => o.id}
                onRowClick={(o) => nav(`/pedidos/${o.id}`)}
                columns={[
                  { key: 'n', header: 'Número', render: (o) => <span className="font-bold text-petrol-700">{o.number}</span> },
                  { key: 'd', header: 'Fecha', render: (o) => formatDate(o.orderDate), sortValue: (o) => o.orderDate },
                  { key: 's', header: 'Estado', render: (o) => <OrderStatusBadge status={o.status} kind={o.kind} /> },
                  ...(money
                    ? [
                        { key: 't', header: 'Total', align: 'right' as const, render: (o: Detail['orders'][number]) => <span className="num">{formatCOP(o.total)}</span> },
                        {
                          key: 'b',
                          header: 'Saldo',
                          align: 'right' as const,
                          render: (o: Detail['orders'][number]) =>
                            o.receivable ? (
                              <span className="flex flex-col items-end gap-0.5">
                                <span className="num font-semibold">{formatCOP(o.balance)}</span>
                                <ReceivableBadge status={o.receivable} />
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
          ) : (
            <Card padded={false}>
              <ol className="px-5 py-4">
                {data.timeline.map((t, i) => {
                  const Icon = t.kind === 'pago' ? Wallet : t.kind === 'entrega' ? Truck : ShoppingBag;
                  return (
                    <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < data.timeline.length - 1 ? <span className="stitch-y absolute bottom-0 left-[11px] top-7 text-line-strong" aria-hidden /> : null}
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-petrol-600">
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div>
                        {t.ref ? (
                          <Link to={`/pedidos/${t.ref}`} className="text-[14.5px] hover:text-petrol-700 hover:underline">
                            {t.text}
                          </Link>
                        ) : (
                          <p className="text-[14.5px]">{t.text}</p>
                        )}
                        <p className="text-[13px] text-muted">{formatDateTime(t.at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>
        <Card title="Contacto">
          <KeyValues
            columns={1}
            items={[
              ['Documento', c.document ?? '—'],
              ['Teléfono', c.phone ? <a key="p" href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-petrol-700 hover:underline"><Phone className="h-4 w-4" />{c.phone}</a> : '—'],
              ['Correo', c.email ?? '—'],
              ['Dirección', [c.address, c.city].filter(Boolean).join(', ') || '—'],
              ['Acepta promociones', c.marketingConsent ? 'Sí' : 'No'],
              c.notes ? ['Notas', c.notes] : null,
            ]}
          />
          {wa ? (
            <a href={`https://wa.me/57${wa.slice(-10)}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-btn)] bg-petrol-50 px-3 py-2 text-[14px] font-semibold text-petrol-700 hover:bg-petrol-100">
              <MessageCircle className="h-4 w-4" /> Abrir chat de WhatsApp
            </a>
          ) : null}
        </Card>
      </div>
      <CustomerFormModal open={edit} onClose={() => setEdit(false)} customer={c} />
      <ConfirmDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={c.archived ? `Restaurar ${c.name}` : `Archivar ${c.name}`}
        confirmLabel={c.archived ? 'Restaurar cliente' : 'Archivar cliente'}
        loading={arch.isPending}
        onConfirm={() => arch.mutate(undefined)}
        consequence={c.archived ? 'Volverá a aparecer en las búsquedas.' : 'Ya no aparecerá en las búsquedas para nuevos pedidos. Su historial y saldos se conservan.'}
      />
    </div>
  );
}

function Tile({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint?: string; tone?: 'ink' | 'warn' | 'ok' }) {
  const c = { ink: 'text-ink', warn: 'text-warn-700', ok: 'text-ok-700' }[tone];
  return (
    <div className="card px-5 py-4">
      <p className="text-[13.5px] font-semibold text-muted">{label}</p>
      <p className={`num mt-1 text-[22px] font-extrabold ${c}`}>{value}</p>
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
