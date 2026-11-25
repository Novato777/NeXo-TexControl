// Estados con texto + color + ícono. Un solo lugar define cómo se ve cada estado.
import {
  CAMPAIGN_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYABLE_STATUS_LABELS,
  PRIORITY_LABELS,
  PRODUCTION_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
  RECEIVABLE_STATUS_LABELS,
  type CampaignStatus,
  type OrderStatus,
  type PayableStatus,
  type Priority,
  type ProductionStatus,
  type PurchaseStatus,
  type ReceivableStatus,
} from '@nexo/shared';
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, Factory, FileEdit, Flame, PackageCheck, Truck } from 'lucide-react';
import { Badge, type Tone } from './Feedback';

const ORDER: Record<OrderStatus, { tone: Tone; icon: typeof Circle }> = {
  borrador: { tone: 'neutral', icon: FileEdit },
  pendiente: { tone: 'warn', icon: Clock },
  confirmado: { tone: 'petrol', icon: CheckCircle2 },
  en_produccion: { tone: 'violet', icon: Factory },
  listo: { tone: 'teal', icon: PackageCheck },
  entregado: { tone: 'ok', icon: Truck },
  cancelado: { tone: 'risk', icon: Ban },
};
export const orderTone = (s: string) => ORDER[s as OrderStatus]?.tone ?? 'neutral';

export function OrderStatusBadge({ status, kind }: { status: string; kind?: string }) {
  if (kind === 'venta' && status === 'entregado') return <Badge tone="ok" icon={CheckCircle2}>Vendido</Badge>;
  const s = ORDER[status as OrderStatus] ?? ORDER.borrador;
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {ORDER_STATUS_LABELS[status as OrderStatus] ?? status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'normal') return <span className="text-[13.5px] text-muted">Normal</span>;
  return (
    <Badge tone={priority === 'urgente' ? 'risk' : 'warn'} icon={priority === 'urgente' ? Flame : undefined}>
      {PRIORITY_LABELS[priority as Priority]}
    </Badge>
  );
}

export function ProductionStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === 'terminada' ? 'ok' : status === 'en_proceso' ? 'violet' : status === 'cancelada' ? 'risk' : 'neutral';
  return <Badge tone={tone}>{PRODUCTION_STATUS_LABELS[status as ProductionStatus] ?? status}</Badge>;
}

export function ReceivableBadge({ status }: { status: string }) {
  const tone: Tone = status === 'vencido' ? 'risk' : status === 'por_vencer' ? 'warn' : status === 'pagado' ? 'ok' : 'teal';
  return (
    <Badge tone={tone} icon={status === 'vencido' ? AlertTriangle : undefined}>
      {RECEIVABLE_STATUS_LABELS[status as ReceivableStatus] ?? status}
    </Badge>
  );
}

export function PayableBadge({ status }: { status: string }) {
  const tone: Tone = status === 'vencido' ? 'risk' : status === 'parcial' ? 'warn' : status === 'pagado' ? 'ok' : 'petrol';
  return <Badge tone={tone}>{PAYABLE_STATUS_LABELS[status as PayableStatus] ?? status}</Badge>;
}

export function PurchaseBadge({ status }: { status: string }) {
  const tone: Tone = status === 'recibida' ? 'ok' : status === 'recibida_parcial' ? 'warn' : status === 'cancelada' ? 'risk' : 'petrol';
  return <Badge tone={tone}>{PURCHASE_STATUS_LABELS[status as PurchaseStatus] ?? status}</Badge>;
}

export function CampaignBadge({ status }: { status: string }) {
  const tone: Tone = status === 'programada' ? 'petrol' : status === 'enviada_manual' ? 'teal' : status === 'finalizada' ? 'ok' : 'neutral';
  return <Badge tone={tone}>{CAMPAIGN_STATUS_LABELS[status as CampaignStatus] ?? status}</Badge>;
}

export function StockBadge({ status }: { status: string }) {
  if (status === 'agotado') return <Badge tone="risk" icon={Ban}>Agotado</Badge>;
  if (status === 'bajo') return <Badge tone="warn" icon={AlertTriangle}>Bajo mínimo</Badge>;
  return <Badge tone="ok">Suficiente</Badge>;
}
