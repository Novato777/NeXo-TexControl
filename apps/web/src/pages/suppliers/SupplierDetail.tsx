import { formatCOP, formatDate, formatQty } from '@nexo/shared';
import { PackagePlus, Pencil, Phone, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, KeyValues, PageHeader, SummaryStrip, Tabs } from '@/components/ui/Layout';
import { PurchaseBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { Supplier } from '@/lib/types';
import { PayPayableModal } from '../cash/shared';
import { SupplierFormModal } from './SuppliersPage';

interface Detail {
  supplier: Supplier;
  purchases: Array<{ id: number; number: string; status: string; date: string; total: number }>;
  payables: Array<{ id: number; number: string; concept: string; amount: number; paid: number; balance: number; dueDate: string; overdue: boolean }>;
  priceHistory: Array<{ date: string; label: string; unit: string; quantity: number; unitCost: number }>;
  summary: { totalBought: number; balance: number; overdue: number };
}

export default function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/suppliers/${id}`);
  const [tab, setTab] = useState<'compras' | 'cuentas' | 'precios'>('compras');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState<Detail['payables'][number] | null>(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const s = data.supplier;
  const openPay = data.payables.filter((p) => p.balance > 0);
  return (
    <div>
      <PageHeader
        title={s.name}
        description={s.supplies ?? undefined}
        back={{ to: '/proveedores', label: 'Proveedores' }}
        actions={
          <>
            {can('proveedor.editar') ? (
              <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>
                Editar datos
              </Button>
            ) : null}
            {can('compra.gestionar') ? (
              <ButtonLink to={`/compras/nueva?proveedor=${s.id}`} icon={PackagePlus}>
                Nueva compra
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <SummaryStrip
        items={[
          { label: 'Total comprado', value: formatCOP(data.summary.totalBought) },
          { label: 'Le debes', value: formatCOP(data.summary.balance), tone: data.summary.balance ? 'warn' : 'ok', hint: data.summary.overdue ? <span className="font-semibold text-risk-700">{formatCOP(data.summary.overdue)} vencido</span> : 'Nada vencido' },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'compras', label: 'Compras', count: data.purchases.length },
              { value: 'cuentas', label: 'Cuentas por pagar', count: openPay.length },
              { value: 'precios', label: 'Precios de compra' },
            ]}
          />
          <Card padded={false}>
            {tab === 'compras' ? (
              <DataTable
                rows={data.purchases}
                rowKey={(p) => p.id}
                onRowClick={(p) => nav(`/compras/${p.id}`)}
                columns={[
                  { key: 'n', header: 'Compra', render: (p) => <span className="font-bold text-petrol-700">{p.number}</span> },
                  { key: 'd', header: 'Fecha', render: (p) => formatDate(p.date), sortValue: (p) => p.date },
                  { key: 's', header: 'Estado', render: (p) => <PurchaseBadge status={p.status} /> },
                  { key: 't', header: 'Total', align: 'right', render: (p) => <span className="num">{formatCOP(p.total)}</span> },
                ]}
              />
            ) : tab === 'cuentas' ? (
              <DataTable
                rows={data.payables}
                rowKey={(p) => p.id}
                columns={[
                  { key: 'c', header: 'Concepto', render: (p) => <span className="font-medium">{p.concept}</span> },
                  { key: 'd', header: 'Vence', render: (p) => <span className={p.overdue ? 'font-semibold text-risk-700' : ''}>{formatDate(p.dueDate)}</span>, sortValue: (p) => p.dueDate },
                  { key: 'a', header: 'Valor', align: 'right', render: (p) => <span className="num">{formatCOP(p.amount)}</span> },
                  { key: 'b', header: 'Saldo', align: 'right', render: (p) => (p.balance ? <span className="num font-bold">{formatCOP(p.balance)}</span> : <Badge tone="ok">Pagada</Badge>) },
                  { key: 'x', header: '', render: (p) => (p.balance && can('gasto.registrar') ? <Button size="sm" variant="soft" icon={Wallet} onClick={() => setPay(p)}>Pagar</Button> : null) },
                ]}
              />
            ) : (
              <DataTable
                rows={data.priceHistory}
                rowKey={(p) => `${p.date}-${p.label}-${p.unitCost}`}
                columns={[
                  { key: 'd', header: 'Fecha', render: (p) => formatDate(p.date) },
                  { key: 'l', header: 'Material', render: (p) => p.label },
                  { key: 'q', header: 'Cantidad', align: 'right', render: (p) => <span className="num">{formatQty(p.quantity)} {p.unit}</span> },
                  { key: 'c', header: 'Costo unitario', align: 'right', render: (p) => <span className="num font-semibold">{formatCOP(p.unitCost)}</span> },
                ]}
              />
            )}
          </Card>
        </div>
        <Card title="Datos de contacto">
          <KeyValues
            columns={1}
            items={[
              ['NIT', s.document ?? '—'],
              ['Contacto', s.contactName ?? '—'],
              ['Teléfono', s.phone ? <a key="t" href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 text-petrol-700 hover:underline"><Phone className="h-4 w-4" />{s.phone}</a> : '—'],
              ['Correo', s.email ?? '—'],
              ['Dirección', s.address ?? '—'],
              ['Plazo de pago', s.paymentTermDays ? `${s.paymentTermDays} días` : 'De contado'],
              s.notes ? ['Notas', s.notes] : null,
            ]}
          />
        </Card>
      </div>
      <SupplierFormModal open={edit} onClose={() => setEdit(false)} supplier={s} />
      {pay ? <PayPayableModal open onClose={() => setPay(null)} payable={{ ...pay, supplierName: s.name }} /> : null}
    </div>
  );
}
