// Gráficos sencillos de una sola serie (el título nombra la serie; no hace falta leyenda).
// Marcas delgadas, extremos redondeados de 4px, cuadrícula discreta y tooltip al pasar el cursor.
import { formatCOP, formatQty } from '@nexo/shared';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const INK_MUTED = '#5f6e7d';
const GRID = '#e1e5e8';
const PETROL = '#0b5c73';

export type ValueFormat = 'money' | 'qty' | 'int';
const fmt = (v: number, f: ValueFormat) => (f === 'money' ? formatCOP(v) : formatQty(v));
const short = (v: number, f: ValueFormat) => {
  if (f !== 'money') return formatQty(v, 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)} mil`;
  return `$${v}`;
};

function TooltipBox({ active, payload, label, format, valueLabel, labelFormatter }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; format: ValueFormat; valueLabel: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-[var(--shadow-pop)]">
      <p className="text-[13px] text-muted">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      <p className="num text-[15px] font-bold text-ink">
        {valueLabel}: {fmt(payload[0].value, format)}
      </p>
    </div>
  );
}

export function TrendChart({
  data,
  x,
  y,
  format = 'money',
  valueLabel,
  height = 240,
  xFormatter,
  labelFormatter,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  x: string;
  y: string;
  format?: ValueFormat;
  valueLabel: string;
  height?: number;
  xFormatter?: (v: string) => string;
  labelFormatter?: (v: string) => string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Gráfico de ${valueLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} tick={{ fill: INK_MUTED, fontSize: 12.5 }} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={xFormatter} minTickGap={18} />
          <YAxis tick={{ fill: INK_MUTED, fontSize: 12.5 }} tickLine={false} axisLine={false} tickFormatter={(v) => short(Number(v), format)} width={64} />
          <Tooltip content={<TooltipBox format={format} valueLabel={valueLabel} labelFormatter={labelFormatter} />} cursor={{ stroke: INK_MUTED, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey={y} stroke={PETROL} strokeWidth={2} fill={PETROL} fillOpacity={0.08} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2, fill: PETROL }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({
  data,
  x,
  y,
  format = 'money',
  valueLabel,
  height = 260,
  horizontal = false,
  color = PETROL,
  xFormatter,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  x: string;
  y: string;
  format?: ValueFormat;
  valueLabel: string;
  height?: number;
  horizontal?: boolean;
  color?: string;
  xFormatter?: (v: string) => string;
}) {
  if (horizontal) {
    const h = Math.max(height, data.length * 34 + 30);
    return (
      <div style={{ height: h }} role="img" aria-label={`Gráfico de ${valueLabel}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={{ fill: INK_MUTED, fontSize: 12.5 }} tickLine={false} axisLine={false} tickFormatter={(v) => short(Number(v), format)} />
            <YAxis type="category" dataKey={x} tick={{ fill: '#3c4b5b', fontSize: 13 }} tickLine={false} axisLine={{ stroke: GRID }} width={170} tickFormatter={(v: string) => (v.length > 24 ? v.slice(0, 23) + '…' : v)} />
            <Tooltip content={<TooltipBox format={format} valueLabel={valueLabel} />} cursor={{ fill: 'rgb(11 92 115 / 0.06)' }} />
            <Bar dataKey={y} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div style={{ height }} role="img" aria-label={`Gráfico de ${valueLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} tick={{ fill: INK_MUTED, fontSize: 12.5 }} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={xFormatter} interval="preserveStartEnd" />
          <YAxis tick={{ fill: INK_MUTED, fontSize: 12.5 }} tickLine={false} axisLine={false} tickFormatter={(v) => short(Number(v), format)} width={64} allowDecimals={false} />
          <Tooltip content={<TooltipBox format={format} valueLabel={valueLabel} />} cursor={{ fill: 'rgb(11 92 115 / 0.06)' }} />
          <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
