import { formatCOP, formatQty } from '@nexo/shared';
import { Calculator, Info, Lightbulb, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { BarsChart } from '@/components/ui/Charts';
import { Badge, ErrorState, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Card, PageHeader, Segmented } from '@/components/ui/Layout';
import { ReportsSectionTabs } from './ReportsPage';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';

interface Data {
  disclaimer: string;
  history: { data: Array<{ ym: string; label: string; total: number; orders: number; index: number; partial: boolean }>; average: number; highSeason: string[]; lowSeason: string[]; method: string };
  forecast: {
    categories: Array<{ category: string; baseUnits: number; months: Array<{ ym: string; label: string; conservador: number; probable: number; alto: number; revenue: number }> }>;
    total: Array<{ ym: string; label: string; conservador: number; probable: number; alto: number }>;
    confidence: string;
    method: string;
  };
  materials: { items: Array<{ variantId: number; label: string; unit: string; available: number; productionNeed: number; dailyUse: number; coverageDays: number | null; coversOrders: number | null; min: number; recommended: number; cost: number; why: string }>; method: string };
  cashflow: { weeks: Array<{ label: string; counter: number; collections: number; obligations: number; net: number }>; method: string };
}

function Method({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-4 rounded-lg bg-linen px-3 py-2 text-[13.5px] text-ink-soft">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-petrol-700">
        <Calculator className="h-4 w-4" aria-hidden /> ¿Cómo se calcula?
      </summary>
      <p className="mt-1.5">{children}</p>
    </details>
  );
}

export default function AnalysisPage() {
  const { money, can } = useAuth();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useApi<Data>('/analysis');
  const [section, setSection] = useState<'temporadas' | 'ventas' | 'comprar' | 'dinero'>(money ? 'temporadas' : 'comprar');
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const buy = data.materials.items.filter((m) => m.recommended > 0);
  const conf = { baja: 'Confianza baja', 'baja-media': 'Confianza baja a media', media: 'Confianza media' }[data.forecast.confidence] ?? data.forecast.confidence;
  return (
    <div>
      <PageHeader title="Reportes" />
      <ReportsSectionTabs active="estimaciones" />
      <p className="mb-4 flex items-start gap-2 text-[14px] text-warn-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>Son estimaciones, no certezas.</strong> Se calculan con reglas simples sobre tus datos; no hay inteligencia artificial conectada.
        </span>
      </p>
      <div className="mb-4">
        <Segmented
          label="Qué estimación ver"
          value={section}
          onChange={setSection}
          options={[
            ...(money ? [{ value: 'temporadas' as const, label: 'Temporadas' }] : []),
            { value: 'ventas' as const, label: 'Ventas esperadas' },
            { value: 'comprar' as const, label: 'Qué comprar', count: buy.length },
            ...(money ? [{ value: 'dinero' as const, label: 'Dinero próximo' }] : []),
          ]}
        />
      </div>
      <div className="space-y-5">
        {money && section === 'temporadas' ? (
          <Card title="Ventas por mes y temporadas" subtitle={`Promedio mensual: ${formatCOP(data.history.average)}`}>
            <BarsChart data={data.history.data} x="label" y="total" valueLabel="Ventas del mes" height={250} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-ok-500/30 bg-ok-50 p-3">
                <p className="text-[13px] font-bold text-ok-700">Temporada alta (más de 20% sobre el promedio)</p>
                <p className="mt-0.5 font-semibold">{data.history.highSeason.join(', ') || 'No se detecta'}</p>
              </div>
              <div className="rounded-xl border border-warn-500/30 bg-warn-50 p-3">
                <p className="text-[13px] font-bold text-warn-700">Temporada baja (más de 15% bajo el promedio)</p>
                <p className="mt-0.5 font-semibold">{data.history.lowSeason.join(', ') || 'No se detecta'}</p>
              </div>
            </div>
            <Method>{data.history.method}</Method>
          </Card>
        ) : null}

        {section === 'ventas' ? (
        <Card title="Ventas esperadas en los próximos 3 meses" subtitle={<span className="flex items-center gap-2">Por escenario <Badge tone="warn">{conf}</Badge></span>} padded={false}>
          {money ? (
            <div className="overflow-x-auto border-b border-line">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="text-right">Conservador</th>
                    <th className="text-right">Probable</th>
                    <th className="text-right">Alto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.total.map((m) => (
                    <tr key={m.ym}>
                      <td className="font-semibold capitalize">{m.label}</td>
                      <td className="num text-right text-muted">{formatCOP(m.conservador)}</td>
                      <td className="num text-right font-bold">{formatCOP(m.probable)}</td>
                      <td className="num text-right text-muted">{formatCOP(m.alto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Categoría (unidades)</th>
                  {data.forecast.total.map((m) => (
                    <th key={m.ym} className="text-right capitalize">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.forecast.categories.map((c) => (
                  <tr key={c.category}>
                    <td className="font-semibold">
                      {c.category}
                      <span className="block text-[12.5px] font-normal text-muted">Hoy vende ~{c.baseUnits} unid./mes</span>
                    </td>
                    {c.months.map((m) => (
                      <td key={m.ym} className="num text-right">
                        <span className="font-bold">{m.probable}</span>
                        <span className="block text-[12.5px] text-muted">
                          entre {m.conservador} y {m.alto}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-5">
            <Method>{data.forecast.method}</Method>
          </div>
        </Card>
        ) : null}

        {section === 'comprar' ? (
        <Card title="Qué conviene comprar" subtitle={buy.length ? `${buy.length} material(es), ordenados por lo que se acaba primero.` : undefined} padded={false}>
          {buy.length ? (
            <ul className="divide-y divide-line">
              {buy.map((m) => (
                <li key={m.variantId} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                  <div className="flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {m.label}
                      {m.recommended > 0 ? <Badge tone={m.coverageDays != null && m.coverageDays < 7 ? 'risk' : 'warn'}>Comprar</Badge> : <Badge tone="ok">Alcanza</Badge>}
                    </p>
                    <p className="mt-0.5 text-[14px] text-ink-soft">{m.why || `Hay ${formatQty(m.available)} ${m.unit} y la producción pendiente necesita ${formatQty(m.productionNeed)}. Alcanza por ahora.`}</p>
                    <p className="text-[13px] text-muted">
                      Uso promedio: {formatQty(m.dailyUse)} {m.unit}/día{m.coverageDays != null ? ` · cubre ~${m.coverageDays} días` : ''}
                    </p>
                  </div>
                  {m.recommended > 0 ? (
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[13px] text-muted">Recomendado</p>
                        <p className="num text-[18px] font-extrabold">
                          {formatQty(m.recommended)} {m.unit}
                        </p>
                        {money ? <p className="num text-[13px] text-muted">≈ {formatCOP(m.recommended * m.cost)}</p> : null}
                      </div>
                      {can('compra.gestionar') ? (
                        <Button size="sm" variant="soft" icon={Truck} onClick={() => nav(`/compras/nueva${qs({ material: m.variantId, cantidad: m.recommended })}`)}>
                          Crear compra
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-muted">No hay materiales en riesgo.</p>
          )}
          <div className="px-5 pb-5">
            <Method>{data.materials.method}</Method>
          </div>
        </Card>
        ) : null}

        {money && section === 'dinero' ? (
          <Card title="Dinero de las próximas 4 semanas" subtitle="Lo que se espera que entre y salga." padded={false}>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th className="text-right">Ventas de mostrador (estimado)</th>
                    <th className="text-right">Cobros a clientes</th>
                    <th className="text-right">Pagos por hacer</th>
                    <th className="text-right">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cashflow.weeks.map((w) => (
                    <tr key={w.label}>
                      <td className="font-semibold">{w.label}</td>
                      <td className="num text-right">{formatCOP(w.counter)}</td>
                      <td className="num text-right text-ok-700">+ {formatCOP(w.collections)}</td>
                      <td className="num text-right text-risk-700">− {formatCOP(w.obligations)}</td>
                      <td className={`num text-right font-bold ${w.net >= 0 ? 'text-ok-700' : 'text-risk-700'}`}>{formatCOP(w.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 pb-5">
              <Method>{data.cashflow.method}</Method>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
