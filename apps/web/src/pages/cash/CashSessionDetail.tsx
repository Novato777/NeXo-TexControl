import { formatCOP, formatDateTime, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@nexo/shared';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Card, KeyValues, PageHeader } from '@/components/ui/Layout';
import { useApi } from '@/lib/hooks';
import { MovementsTable, type CashMovement, type Summary } from './CashPage';

interface Detail {
  session: { id: number; number: string; status: string; openingAmount: number; openedAt: string; openedByName: string | null; closedAt: string | null; closedByName: string | null; expectedCash: number | null; countedCash: number | null; difference: number | null; closeNote: string | null; openNote: string | null };
  summary: Summary;
  movements: CashMovement[];
}

export default function CashSessionDetail() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/cash/sessions/${id}`);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const s = data.session;
  return (
    <div>
      <PageHeader
        title={`Reporte de caja ${s.number}`}
        description={s.status === 'abierta' ? 'Caja abierta' : `Cerrada ${formatDateTime(s.closedAt)}`}
        back={{ to: '/caja?tab=historial', label: 'Cajas anteriores' }}
        actions={
          <Button variant="secondary" icon={Printer} onClick={() => window.open(`/imprimir/caja/${s.id}`, '_blank')}>
            Imprimir reporte
          </Button>
        }
      />
      {s.status === 'cerrada' ? (
        <div className="mb-6">
          {s.difference === 0 ? (
            <Notice tone="ok" title="La caja cuadró">
              El efectivo contado fue igual al esperado: {formatCOP(s.countedCash)}.
            </Notice>
          ) : (
            <Notice tone="risk" title={`Diferencia de ${formatCOP(s.difference)}`}>
              Esperado {formatCOP(s.expectedCash)} · contado {formatCOP(s.countedCash)}. Explicación: {s.closeNote}
            </Notice>
          )}
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Movimientos" padded={false}>
          <MovementsTable rows={data.movements} />
        </Card>
        <div className="space-y-6">
          <Card title="Resumen">
            <KeyValues
              columns={1}
              items={[
                ['Abrió', `${s.openedByName ?? '—'} · ${formatDateTime(s.openedAt)}`],
                s.closedAt ? ['Cerró', `${s.closedByName ?? '—'} · ${formatDateTime(s.closedAt)}`] : null,
                ['Saldo inicial', formatCOP(s.openingAmount)],
                ['Entradas (todas)', formatCOP(data.summary.income)],
                ['Salidas (todas)', formatCOP(data.summary.expense)],
                ['Efectivo esperado', formatCOP(data.summary.expectedCash)],
                s.countedCash != null ? ['Efectivo contado', formatCOP(s.countedCash)] : null,
                s.difference != null ? ['Diferencia', s.difference === 0 ? <Badge key="d" tone="ok">Cuadró</Badge> : <Badge key="d" tone="risk">{formatCOP(s.difference)}</Badge>] : null,
              ]}
            />
          </Card>
          <Card title="Por método de pago">
            <ul className="space-y-2">
              {Object.entries(data.summary.byMethod).map(([m, v]) => (
                <li key={m} className="flex justify-between gap-2 text-[14.5px]">
                  <span className="font-semibold">{PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m}</span>
                  <span className="num text-right">
                    <span className="block text-ok-700">+ {formatCOP(v.ingreso)}</span>
                    {v.egreso ? <span className="block text-risk-700">− {formatCOP(v.egreso)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
