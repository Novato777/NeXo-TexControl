import { formatCOP, formatDateTime, formatQty, PRODUCT_TYPE_LABELS, type ProductType } from '@nexo/shared';
import { Archive, ArchiveRestore, Copy, ListTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';
import { Card, KeyValues, PageHeader } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { VariantPicker } from '@/components/ui/Pickers';
import { StockBadge } from '@/components/ui/Status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import type { VariantOption } from '@/lib/types';

interface Detail {
  product: { id: number; sku: string; name: string; type: ProductType; category: string; description: string | null; unit: string; price: number; cost: number; minStock: number; location: string | null; customizable: boolean; active: boolean; margin: number; isStock: boolean };
  variants: Array<{ id: number; sku: string; size: string | null; color: string | null; stock: number; reserved: number; available: number; effectivePrice: number; effectiveMin: number; low: boolean; sold90: number }>;
  bom: Array<{ id: number; materialVariantId: number; name: string; unit: string; qtyPerUnit: number; cost: number }>;
  movements: Array<{ id: number; createdAt: string; label: string; type: string; quantity: number; stockAfter: number; reason: string; userName: string | null }>;
  sales90: { units: number; revenue: number };
}

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, money } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/products/${id}`);
  const [archive, setArchive] = useState(false);
  const [bomOpen, setBomOpen] = useState(false);
  const dup = useAction(() => api.post<{ id: number; name: string }>(`/products/${id}/duplicate`), { success: (r) => `Copia creada: ${r.name}`, onSuccess: (r) => nav(`/productos/${r.id}/editar`) });
  const arch = useAction((active: boolean) => api.post(`/products/${id}/archive`, { active }), { success: 'Listo', onSuccess: () => setArchive(false) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const p = data.product;
  const bomCost = data.bom.reduce((a, b) => a + b.qtyPerUnit * b.cost, 0);
  return (
    <div>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{PRODUCT_TYPE_LABELS[p.type]}</span>·<span>{p.category}</span>·<span>{p.sku}</span>
            {!p.active ? <Badge tone="neutral">Archivado</Badge> : null}
            {p.customizable ? <Badge tone="violet">Personalizable</Badge> : null}
          </span>
        }
        back={{ to: '/productos', label: 'Productos' }}
        actions={
          can('producto.editar') ? (
            <>
              <Button variant="secondary" icon={p.active ? Archive : ArchiveRestore} onClick={() => setArchive(true)}>
                {p.active ? 'Archivar' : 'Reactivar'}
              </Button>
              <Button variant="secondary" icon={Copy} loading={dup.isPending} onClick={() => dup.mutate(undefined)}>
                Duplicar
              </Button>
              <ButtonLink to={`/productos/${p.id}/editar`} icon={Pencil}>
                Editar producto
              </ButtonLink>
            </>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {p.type !== 'servicio' ? (
            <Card title="Tallas, colores y existencias" padded={false}>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Variante</th>
                      {money && p.type !== 'materia_prima' && p.type !== 'insumo' ? <th className="text-right">Precio</th> : null}
                      <th className="text-right">En bodega</th>
                      <th className="text-right">Separado</th>
                      <th className="text-right">Disponible</th>
                      <th>Estado</th>
                      {p.type === 'terminado' ? <th className="text-right">Vendido 90 días</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.variants.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <p className="font-semibold">
                            {v.size ? `Talla ${v.size}` : 'Única'}
                            {v.color ? ` · ${v.color}` : ''}
                          </p>
                          <p className="text-[12.5px] text-muted">{v.sku}</p>
                        </td>
                        {money && p.type !== 'materia_prima' && p.type !== 'insumo' ? <td className="num text-right">{formatCOP(v.effectivePrice)}</td> : null}
                        <td className="num text-right">{formatQty(v.stock)}</td>
                        <td className="num text-right text-violet-700">{v.reserved ? formatQty(v.reserved) : '—'}</td>
                        <td className="num text-right font-bold">{formatQty(v.available)}</td>
                        <td>
                          <StockBadge status={v.available <= 0 ? 'agotado' : v.low ? 'bajo' : 'ok'} />
                        </td>
                        {p.type === 'terminado' ? <td className="num text-right">{v.sold90}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {p.type === 'terminado' ? (
            <Card
              title="Receta de materiales (por unidad)"
              subtitle="Producción la usa para calcular cuánto material necesita cada orden."
              actions={can('producto.editar') ? <Button size="sm" variant="soft" icon={ListTree} onClick={() => setBomOpen(true)}>{data.bom.length ? 'Cambiar receta' : 'Agregar receta'}</Button> : null}
              padded={false}
            >
              {data.bom.length ? (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="text-right">Cantidad por prenda</th>
                      {money ? <th className="text-right">Costo</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.bom.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td className="num text-right">
                          {formatQty(b.qtyPerUnit, 3)} {b.unit}
                        </td>
                        {money ? <td className="num text-right">{formatCOP(b.qtyPerUnit * b.cost)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                  {money ? (
                    <tfoot>
                      <tr>
                        <td className="px-4 py-3 font-bold">Costo de materiales por prenda</td>
                        <td />
                        <td className="num px-4 py-3 text-right font-bold">{formatCOP(bomCost)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              ) : (
                <p className="px-5 py-4 text-muted">Sin receta. Producción no podrá estimar materiales de este producto.</p>
              )}
            </Card>
          ) : null}

          {data.movements.length ? (
            <Card title="Últimos movimientos de inventario" padded={false}>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Variante</th>
                    <th className="text-right">Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.slice(0, 15).map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-[14px]">{formatDateTime(m.createdAt)}</td>
                      <td className="text-[14px]">{m.label}</td>
                      <td className={`num text-right font-bold ${m.quantity > 0 ? 'text-ok-700' : 'text-risk-700'}`}>
                        {m.quantity > 0 ? '+' : ''}
                        {formatQty(m.quantity)}
                      </td>
                      <td className="text-[14px] text-ink-soft">{m.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title="Resumen">
            <KeyValues
              columns={1}
              items={[
                money && (p.type === 'terminado' || p.type === 'servicio') ? ['Precio de venta', <span key="p" className="num text-[18px] font-bold">{formatCOP(p.price)}</span>] : null,
                money ? ['Costo', formatCOP(p.cost)] : null,
                money && (p.type === 'terminado' || p.type === 'servicio') ? ['Margen estimado', <span key="m" className={p.margin < 20 ? 'font-semibold text-warn-700' : 'font-semibold text-ok-700'}>{p.margin}%</span>] : null,
                ['Unidad', p.unit],
                p.isStock ? ['Stock mínimo', `${formatQty(p.minStock)} ${p.unit}`] : null,
                p.location ? ['Ubicación', p.location] : null,
                p.type === 'terminado' ? ['Vendido en 90 días', `${data.sales90.units} unidades${money ? ` · ${formatCOP(data.sales90.revenue)}` : ''}`] : null,
                p.description ? ['Descripción', p.description] : null,
              ]}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={p.active ? `Archivar ${p.name}` : `Reactivar ${p.name}`}
        confirmLabel={p.active ? 'Archivar producto' : 'Reactivar producto'}
        loading={arch.isPending}
        onConfirm={() => arch.mutate(!p.active)}
        consequence={p.active ? 'Dejará de aparecer para vender, comprar o producir. Su historial se conserva y puedes reactivarlo cuando quieras.' : 'Volverá a aparecer en ventas, compras y producción.'}
      />
      <BomModal open={bomOpen} onClose={() => setBomOpen(false)} productId={p.id} current={data.bom} />
    </div>
  );
}

function BomModal({ open, onClose, productId, current }: { open: boolean; onClose: () => void; productId: number; current: Detail['bom'] }) {
  const [lines, setLines] = useState<Array<{ materialVariantId: number; name: string; unit: string; qtyPerUnit: string }>>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (open) setLines(current.map((b) => ({ materialVariantId: b.materialVariantId, name: b.name, unit: b.unit, qtyPerUnit: String(b.qtyPerUnit).replace('.', ',') })));
  }, [open, current]);
  const save = useAction((b: object) => api.put(`/products/${productId}/bom`, b), { success: 'Receta guardada', onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Receta de materiales"
      description="¿Cuánto material lleva UNA prenda? Ejemplo: 1,2 metros de tela, 7 botones."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ lines: lines.map((l) => ({ materialVariantId: l.materialVariantId, qtyPerUnit: Number(l.qtyPerUnit.replace(',', '.')) })) })}>
            Guardar receta
          </Button>
        </>
      }
    >
      <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
        {lines.map((l, i) => (
          <li key={l.materialVariantId} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 font-medium">{l.name}</span>
            <Input inputMode="decimal" className="num h-10 w-24 text-right" value={l.qtyPerUnit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qtyPerUnit: e.target.value } : x)))} aria-label={`Cantidad de ${l.name}`} />
            <span className="w-16 text-[13px] text-muted">{l.unit}</span>
            <button className="rounded p-1.5 text-muted hover:text-risk-700" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${l.name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {!lines.length ? <li className="px-3 py-4 text-muted">Sin materiales todavía.</li> : null}
      </ul>
      {adding ? (
        <VariantPicker
          types={['materia_prima', 'insumo']}
          placeholder="Buscar tela, hilo, botones…"
          autoFocus
          onPick={(v: VariantOption) => {
            setLines((ls) => (ls.some((x) => x.materialVariantId === v.id) ? ls : [...ls, { materialVariantId: v.id, name: v.label, unit: v.unit, qtyPerUnit: '1' }]));
            setAdding(false);
          }}
        />
      ) : (
        <Button variant="soft" icon={Plus} onClick={() => setAdding(true)}>
          Agregar material
        </Button>
      )}
    </Modal>
  );
}
