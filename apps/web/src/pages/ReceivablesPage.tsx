import { formatCOP, formatDate } from '@nexo/shared';
import { HandCoins, MessageCircle, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, HelpTip, LoadingBlock } from '@/components/ui/Feedback';
import { Card, PageHeader, Segmented, SummaryStrip } from '@/components/ui/Layout';
import { MoneySectionTabs } from './cash/CashPage';
import { SearchInput } from '@/components/ui/Pickers';
import { ReceivableBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { MessageModal, PaymentModal } from './orders/shared';

interface Item {
  orderId: number;
  number: string;
  kind: string;
  status: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  orderDate: string;
  dueDate: string | null;
  total: number;
  paid: number;
  balance: number;
  daysToDue: number | null;
  receivable: string;
}
interface Data {
  summary: { total: number; vencido: number; porVencer: number; vigente: number; count: number };
  items: Item[];
  customers: Array<{ customerId: number | null; customerName: string; customerPhone: string | null; balance: number; overdue: number; count: number; oldestDue: string | null }>;
}

export default function ReceivablesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useApi<Data>('/receivables');
  const [tab, setTab] = useState<'cuentas' | 'clientes'>('cuentas');
  const [filter, setFilter] = useState<string>('');
  const [q, setQ] = useState('');
  const [pay, setPay] = useState<Item | null>(null);
  const [msg, setMsg] = useState<number | null>(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const items = data.items.filter((i) => (!filter || i.receivable === filter) && (!q || i.customerName.toLowerCase().includes(q.toLowerCase()) || i.number.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <PageHeader title="Dinero" />
      <MoneySectionTabs active="cobrar" />
      <SummaryStrip
        items={[
          { label: 'Te deben en total', value: formatCOP(data.summary.total), onClick: () => setFilter(''), active: filter === '' },
          { label: 'Vencido', value: formatCOP(data.summary.vencido), tone: 'risk', onClick: () => setFilter('vencido'), active: filter === 'vencido' },
          { label: 'Vence en 7 días', value: formatCOP(data.summary.porVencer), tone: 'warn', onClick: () => setFilter('por_vencer'), active: filter === 'por_vencer' },
          { label: 'Al día', value: formatCOP(data.summary.vigente), tone: 'ok', onClick: () => setFilter('vigente'), active: filter === 'vigente' },
        ]}
      />
      <Card padded={false}>
        <div className="flex flex-col gap-2.5 border-b border-line p-3.5 md:flex-row md:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar cliente o número" className="flex-1" />
          <Segmented
            label="Agrupar"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'cuentas', label: 'Por pedido', count: items.length },
              { value: 'clientes', label: 'Por cliente', count: data.customers.length },
            ]}
          />
        </div>
        {tab === 'cuentas' ? (
          <DataTable
            rows={items}
            rowKey={(i) => i.orderId}
            initialSort={{ key: 'due', dir: 'asc' }}
            empty={<EmptyState title={filter ? 'No hay cuentas en este grupo' : 'Nadie te debe dinero'} text="Cuando un pedido o venta quede con saldo, aparecerá aquí." />}
            columns={[
              { key: 'n', header: 'Pedido', render: (i) => <Link to={`/pedidos/${i.orderId}`} className="font-bold text-petrol-700 hover:underline">{i.number}</Link> },
              { key: 'c', header: 'Cliente', render: (i) => (i.customerId ? <Link to={`/clientes/${i.customerId}`} className="hover:underline">{i.customerName}</Link> : i.customerName), sortValue: (i) => i.customerName },
              { key: 'st', header: 'Estado', render: (i) => <ReceivableBadge status={i.receivable} /> },
              {
                key: 'due',
                header: 'Vence',
                render: (i) => (
                  <span>
                    {formatDate(i.dueDate)}
                    <span className={`block text-[13px] ${i.daysToDue != null && i.daysToDue < 0 ? 'font-semibold text-risk-700' : 'text-muted'}`}>
                      {i.daysToDue == null ? '' : i.daysToDue < 0 ? `hace ${-i.daysToDue} días` : i.daysToDue === 0 ? 'hoy' : `en ${i.daysToDue} días`}
                    </span>
                  </span>
                ),
                sortValue: (i) => i.dueDate,
              },
              { key: 't', header: 'Total', align: 'right', render: (i) => <span className="num">{formatCOP(i.total)}</span>, hideOnMobile: true },
              { key: 'p', header: 'Pagado', align: 'right', render: (i) => <span className="num">{formatCOP(i.paid)}</span>, hideOnMobile: true },
              { key: 'b', header: 'Saldo', align: 'right', render: (i) => <span className="num font-bold">{formatCOP(i.balance)}</span>, sortValue: (i) => i.balance },
              {
                key: 'a',
                header: '',
                render: (i) => (
                  <div className="flex justify-end gap-1">
                    {i.customerPhone ? <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => setMsg(i.orderId)} aria-label="Recordar por WhatsApp" /> : null}
                    {can('pago.registrar') ? (
                      <Button size="sm" variant="soft" icon={Wallet} onClick={() => setPay(i)}>
                        Registrar abono
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <DataTable
            rows={data.customers.filter((c) => !q || c.customerName.toLowerCase().includes(q.toLowerCase()))}
            rowKey={(c) => c.customerId ?? 0}
            onRowClick={(c) => c.customerId && nav(`/clientes/${c.customerId}`)}
            columns={[
              { key: 'c', header: 'Cliente', render: (c) => <span className="font-semibold">{c.customerName}</span>, sortValue: (c) => c.customerName },
              { key: 'n', header: 'Cuentas', align: 'right', render: (c) => c.count },
              { key: 'o', header: 'Más antigua vence', render: (c) => formatDate(c.oldestDue), sortValue: (c) => c.oldestDue },
              { key: 'v', header: 'Vencido', align: 'right', render: (c) => <span className={`num font-semibold ${c.overdue ? 'text-risk-700' : 'text-muted'}`}>{formatCOP(c.overdue)}</span>, sortValue: (c) => c.overdue },
              { key: 'b', header: 'Total que debe', align: 'right', render: (c) => <span className="num font-bold">{formatCOP(c.balance)}</span>, sortValue: (c) => c.balance },
            ]}
            initialSort={{ key: 'v', dir: 'desc' }}
          />
        )}
      </Card>
      {pay ? <PaymentModal open onClose={() => setPay(null)} order={{ id: pay.orderId, number: pay.number, balance: pay.balance, customerName: pay.customerName }} /> : null}
      {msg ? <MessageModal open onClose={() => setMsg(null)} orderId={msg} template="cobro" /> : null}
    </div>
  );
}
