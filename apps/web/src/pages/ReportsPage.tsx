import { formatCOP, formatDate, formatQty } from '@nexo/shared';
import { BarChart3, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { BarsChart, TrendChart } from '@/components/ui/Charts';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { Card, PageHeader, SummaryStrip, Tabs } from '@/components/ui/Layout';
import { useAuth } from '@/lib/auth';
import { makePeriod, PeriodPicker, type Period } from '@/components/ui/Pickers';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';

type Fmt = 'money' | 'qty' | 'text' | 'date' | 'pct' | 'int';
interface Report {
  title: string;
  description: string;
  columns: Array<{ key: string; label: string; format: Fmt }>;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
  chart?: { type: 'bar' | 'line' | 'pie'; x: string; y: string; label: string };
  from: string;
  to: string;
}
interface Indicators {
  sales: number;
  orders: number;
  averageTicket: number;
  income: number;
  expense: number;
  result: number;
  grossMargin: number;
  ordersReceived: number;
  ordersDelivered: number;
  onTimePct: number | null;
  avgProductionDays: number | null;
  productionSample: number;
  topProducts: Array<{ name: string; units: number; revenue: number }>;
}

const fmt = (v: unknown, f: Fmt) => {
  if (v == null || v === '') return '—';
  switch (f) {
    case 'money':
      return formatCOP(Number(v));
    case 'qty':
      return formatQty(Number(v));
    case 'int':
      return String(v);
    case 'pct':
      return `${formatQty(Number(v), 1)}%`;
    case 'date':
      return formatDate(String(v));
    default:
      return String(v);
  }
};
const TOTAL_LABELS: Record<string, string> = { ingresos: 'Ingresos', egresos: 'Gastos y egresos', resultado: 'Resultado aproximado' };

/** Pestañas de la sección Reportes. */
export function ReportsSectionTabs({ active }: { active: 'reportes' | 'estimaciones' }) {
  const { access } = useAuth();
  return (
    <Tabs
      value={active}
      tabs={[
        ...(access('reportes') ? [{ value: 'reportes' as const, label: 'Reportes', to: '/reportes' }] : []),
        ...(access('analisis') ? [{ value: 'estimaciones' as const, label: 'Estimaciones', to: '/analisis' }] : []),
      ]}
    />
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<Period>(makePeriod('30d'));
  const [type, setType] = useState('ventas-periodo');
  const [group, setGroup] = useState<'dia' | 'semana' | 'mes'>('dia');
  const catalog = useApi<Array<{ key: string; group: string; title: string }>>('/reports/catalog');
  const ind = useApi<Indicators>(`/reports/indicators${qs({ from: period.from, to: period.to })}`);
  const rep = useApi<Report>(`/reports/${type}${qs({ from: period.from, to: period.to, group })}`);
  const groups = new Map<string, Array<{ key: string; title: string }>>();
  for (const r of catalog.data ?? []) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);

  const exportCsv = () => {
    if (!rep.data) return;
    // Evita que un texto se ejecute como fórmula al abrir el archivo en Excel.
    const safe = (x: unknown) => {
      const t = String(x ?? '');
      return /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
    };
    const esc = (x: unknown) => `"${safe(x).replace(/"/g, '""')}"`;
    const head = rep.data.columns.map((c) => esc(c.label)).join(';');
    const lines = rep.data.rows.map((r) => rep.data!.columns.map((c) => esc(c.format === 'money' || c.format === 'qty' || c.format === 'int' || c.format === 'pct' ? r[c.key] : fmt(r[c.key], c.format))).join(';'));
    const blob = new Blob(['﻿' + [head, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${type}-${period.from}-a-${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const chartData = rep.data?.chart ? (rep.data.chart.type === 'line' ? rep.data.rows : rep.data.rows.slice(0, 15)) : [];
  const chartFmt = rep.data?.columns.find((c) => c.key === rep.data?.chart?.y)?.format === 'money' ? 'money' : 'int';

  return (
    <div>
      <PageHeader title="Reportes" description="Elige un reporte y un periodo. Se puede descargar o imprimir." />
      <ReportsSectionTabs active="reportes" />

      {ind.data ? (
        <SummaryStrip
          items={[
            { label: 'Ventas', value: formatCOP(ind.data.sales), hint: `Ticket promedio ${formatCOP(ind.data.averageTicket)}` },
            { label: 'Resultado aproximado', value: formatCOP(ind.data.result), tone: ind.data.result >= 0 ? 'ok' : 'risk', hint: `Entró ${formatCOP(ind.data.income)} · salió ${formatCOP(ind.data.expense)}` },
            { label: 'Margen estimado', value: `${ind.data.grossMargin}%`, hint: 'Según los costos registrados' },
            {
              label: 'Pedidos entregados',
              value: `${ind.data.ordersDelivered} de ${ind.data.ordersReceived}`,
              hint: ind.data.onTimePct != null ? `${ind.data.onTimePct}% a tiempo${ind.data.avgProductionDays != null ? ` · producción ${formatQty(ind.data.avgProductionDays, 1)} días` : ''}` : 'Sin entregas en el periodo',
            },
          ]}
        />
      ) : null}

      <div>
        <div className="no-print mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <Select aria-label="Reporte" value={type} onChange={(e) => setType(e.target.value)} className="lg:max-w-sm">
            {[...groups.entries()].map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <PeriodPicker value={period} onChange={setPeriod} presets={['7d', 'mes', '30d', '90d', 'anio', 'custom']} />
        </div>

        <div className="min-w-0">
          {rep.error ? (
            <ErrorState error={rep.error} onRetry={rep.refetch} />
          ) : rep.isLoading || !rep.data ? (
            <LoadingBlock />
          ) : (
            <Card
              title={rep.data.title}
              subtitle={
                <>
                  {rep.data.description} {type !== 'inventario' ? `Del ${formatDate(rep.data.from)} al ${formatDate(rep.data.to)}.` : null}
                </>
              }
              actions={
                <div className="no-print flex flex-wrap gap-2">
                  {type === 'ventas-periodo' ? (
                    <Select aria-label="Agrupar por" value={group} onChange={(e) => setGroup(e.target.value as typeof group)} className="h-9 w-auto">
                      <option value="dia">Por día</option>
                      <option value="semana">Por semana</option>
                      <option value="mes">Por mes</option>
                    </Select>
                  ) : null}
                  <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!rep.data.rows.length}>
                    Descargar CSV
                  </Button>
                  <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()}>
                    Imprimir / PDF
                  </Button>
                </div>
              }
              padded={false}
            >
              {!rep.data.rows.length ? (
                <EmptyState title="No hay datos en este periodo" text="Prueba con un periodo más largo." />
              ) : (
                <>
                  {rep.data.chart ? (
                    <div className="border-b border-line p-5">
                      {rep.data.chart.type === 'line' ? (
                        <TrendChart data={chartData} x={rep.data.chart.x} y={rep.data.chart.y} valueLabel={rep.data.chart.label} format={chartFmt} xFormatter={(v) => (v.length === 10 ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : v)} labelFormatter={(v) => (v.length === 10 ? formatDate(v) : v)} />
                      ) : (
                        <BarsChart data={chartData} x={rep.data.chart.x} y={rep.data.chart.y} valueLabel={rep.data.chart.label} format={chartFmt} horizontal />
                      )}
                      {rep.data.chart.type !== 'line' && rep.data.rows.length > 15 ? <p className="mt-2 text-[13px] text-muted">El gráfico muestra los 15 primeros; la tabla tiene todos.</p> : null}
                    </div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          {rep.data.columns.map((c) => (
                            <th key={c.key} className={c.format === 'text' || c.format === 'date' ? '' : 'text-right'}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rep.data.rows.map((r, i) => (
                          <tr key={i}>
                            {rep.data!.columns.map((c, j) => (
                              <td key={c.key} className={`${c.format === 'text' || c.format === 'date' ? '' : 'num text-right'} ${j === 0 ? 'font-semibold' : ''}`}>
                                {fmt(r[c.key], c.format)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {rep.data.totals ? (
                        <tfoot>
                          {rep.data.columns.some((c) => rep.data!.totals![c.key] != null) ? (
                            <tr className="bg-linen font-bold">
                              {rep.data.columns.map((c, j) => (
                                <td key={c.key} className={`px-4 py-3 ${c.format === 'text' || c.format === 'date' ? '' : 'num text-right'}`}>
                                  {j === 0 ? 'Total' : rep.data!.totals![c.key] != null ? fmt(rep.data!.totals![c.key], c.format) : ''}
                                </td>
                              ))}
                            </tr>
                          ) : null}
                          {Object.entries(rep.data.totals)
                            .filter(([k]) => TOTAL_LABELS[k])
                            .map(([k, v]) => (
                              <tr key={k} className="bg-linen">
                                <td className="px-4 py-2 font-bold" colSpan={rep.data!.columns.length - 1}>
                                  {TOTAL_LABELS[k]}
                                </td>
                                <td className={`num px-4 py-2 text-right font-extrabold ${k === 'resultado' ? (v >= 0 ? 'text-ok-700' : 'text-risk-700') : ''}`}>{formatCOP(v)}</td>
                              </tr>
                            ))}
                        </tfoot>
                      ) : null}
                    </table>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint?: string; tone?: 'ink' | 'ok' | 'risk' }) {
  const c = { ink: 'text-ink', ok: 'text-ok-700', risk: 'text-risk-700' }[tone];
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[13.5px] font-semibold text-muted">{label}</p>
      <p className={`num mt-1 whitespace-nowrap text-[20px] font-extrabold ${c}`}>{value}</p>
      {hint ? <p className="text-[12.5px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
